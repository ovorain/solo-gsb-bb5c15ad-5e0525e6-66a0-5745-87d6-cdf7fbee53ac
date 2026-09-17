import { intToIp } from './ip'
import type {
  AddrRange,
  AllocationSnapshot,
  PlanDiff,
  PlanResult,
  PlanSnapshot,
  PlannerInput,
  RequirementDiff,
} from './types'

const STORAGE_KEY = 'vlsm-planner-baseline-v1'

// ---------- 快照构造 ----------

/**
 * 将一次「无输入错误」的规划结果连同输入压成快照。
 * 按输入中的稳定 ID 逐条记录（含自动分配失败的需求），供后续对比。
 */
export function createSnapshot(input: PlannerInput, result: PlanResult): PlanSnapshot {
  const parentStart = intToIpBound(result.parentNetwork)
  const allocations: AllocationSnapshot[] = []

  const segByReservation = new Map<string, (typeof result.segments)[number]>()
  const segByRequirement = new Map<string, (typeof result.segments)[number]>()
  for (const seg of result.segments) {
    if (!seg.refId) continue
    if (seg.kind === 'reserved') segByReservation.set(seg.refId, seg)
    else if (seg.kind !== 'free') segByRequirement.set(seg.refId, seg)
  }
  const failureById = new Map(result.failures.map((f) => [f.id, f]))

  for (const r of input.reservations) {
    if (!r.cidr.trim() && !r.name.trim()) continue
    const seg = segByReservation.get(r.id)
    if (seg) {
      allocations.push({
        id: r.id,
        name: seg.name,
        kind: 'reserved',
        start: seg.start,
        end: seg.end,
        capacity: seg.capacity,
        cidr: seg.cidr,
      })
    }
  }

  for (const req of input.requirements) {
    if (req.name.trim() === '' && req.hosts === '' && req.cidr.trim() === '') continue
    const failure = failureById.get(req.id)
    if (failure) {
      allocations.push({
        id: req.id,
        name: failure.name,
        kind: 'auto',
        start: null,
        end: null,
        capacity: 0,
        cidr: '—',
        requestedHosts: failure.hosts,
        reason: failure.reason,
      })
      continue
    }
    const seg = segByRequirement.get(req.id)
    if (seg) {
      allocations.push({
        id: req.id,
        name: seg.name,
        kind: seg.kind === 'auto' ? 'auto' : 'fixed',
        start: seg.start,
        end: seg.end,
        capacity: seg.capacity,
        cidr: seg.cidr,
        requestedHosts: seg.requestedHosts,
      })
    }
  }

  return {
    createdAt: new Date().toISOString(),
    parentCidr: result.parentCidr,
    parentStart,
    parentEnd: parentEndOf(parentStart, result.parentSize),
    parentSize: result.parentSize,
    allocations,
  }
}

function intToIpBound(ip: string): number {
  // parentNetwork 来自一次成功规划，必然可解析
  const parts = ip.split('.')
  let v = 0
  for (const p of parts) v = (v << 8) + Number(p)
  return v >>> 0
}

function parentEndOf(start: number, size: number): number {
  if (size >= 0x100000000) return 0xffffffff // /0
  return (start + size - 1) >>> 0
}

// ---------- 区间工具（重叠部分不重复计数） ----------

/** 合并互相重叠或相邻的区间 */
function mergeRanges(ranges: AddrRange[]): AddrRange[] {
  const sorted = ranges
    .filter((r) => r.end >= r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const out: AddrRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end)
    } else {
      out.push({ start: r.start, end: r.end })
    }
  }
  return out
}

/** a − b：从区间集合 a 中扣除 b 覆盖的部分 */
function subtractRanges(a: AddrRange[], b: AddrRange[]): AddrRange[] {
  const cuts = mergeRanges(b)
  const out: AddrRange[] = []
  for (const ar of mergeRanges(a)) {
    let cursor = ar.start
    for (const br of cuts) {
      if (br.end < cursor) continue
      if (br.start > ar.end) break
      if (br.start > cursor) out.push({ start: cursor, end: Math.min(br.start - 1, ar.end) })
      cursor = Math.max(cursor, br.end + 1)
      if (cursor > ar.end) break
    }
    if (cursor <= ar.end) out.push({ start: cursor, end: ar.end })
  }
  return mergeRanges(out)
}

/** a ∩ b */
function intersectRanges(a: AddrRange[], b: AddrRange[]): AddrRange[] {
  const bb = mergeRanges(b)
  const out: AddrRange[] = []
  for (const ar of mergeRanges(a)) {
    for (const br of bb) {
      if (br.end < ar.start) continue
      if (br.start > ar.end) break
      out.push({ start: Math.max(ar.start, br.start), end: Math.min(ar.end, br.end) })
    }
  }
  return mergeRanges(out)
}

function occupiedOf(snap: PlanSnapshot): AddrRange[] {
  return snap.allocations
    .filter((a) => a.start !== null && a.end !== null)
    .map((a) => ({ start: a.start as number, end: a.end as number }))
}

const rangeLength = (r: AddrRange) => r.end - r.start + 1
const sumLength = (rs: AddrRange[]) => rs.reduce((acc, r) => acc + rangeLength(r), 0)

// ---------- 对比 ----------

const isAllocated = (a: AllocationSnapshot | null | undefined) => !!a && a.start !== null

export function comparePlans(base: PlanSnapshot, current: PlanSnapshot): PlanDiff {
  const baseById = new Map(base.allocations.map((a) => [a.id, a]))
  const curById = new Map(current.allocations.map((a) => [a.id, a]))

  // 顺序：先按当前录入顺序，新增的删除项追加在末尾，保持展示稳定
  const ids: string[] = []
  for (const a of current.allocations) ids.push(a.id)
  for (const a of base.allocations) if (!curById.has(a.id)) ids.push(a.id)

  const items: RequirementDiff[] = []
  const counts: PlanDiff['counts'] = {
    added: 0,
    removed: 0,
    unchanged: 0,
    migrated: 0,
    unallocated: 0,
    allocated: 0,
  }

  for (const id of ids) {
    const b = baseById.get(id) ?? null
    const c = curById.get(id) ?? null
    const ref = c ?? b
    const item: RequirementDiff = {
      id,
      name: ref?.name ?? id,
      kind: (ref?.kind ?? 'auto') as RequirementDiff['kind'],
      status: 'unchanged',
      capacityDelta: c && b ? c.capacity - b.capacity : 0,
      moved: false,
      oldSnap: b,
      newSnap: c,
    }

    if (!c) {
      item.status = 'removed'
    } else if (!b) {
      // 新增 ID：当前若也未能分配，仍归入新增并携带失败原因
      item.status = 'added'
    } else if (!isAllocated(b) && !isAllocated(c)) {
      item.status = 'unallocated'
    } else if (!isAllocated(b) && isAllocated(c)) {
      item.status = 'allocated' // 恢复分配
    } else if (isAllocated(b) && !isAllocated(c)) {
      item.status = 'unallocated' // 未分配
    } else if (b.start === c.start && b.end === c.end) {
      item.status = 'unchanged'
    } else {
      // 网段 CIDR / 地址区间改变即迁移；容量同时变化时附带扩缩容标记
      item.status = 'migrated'
      item.moved = true
    }

    counts[item.status] += 1
    items.push(item)
  }

  const baseOcc = occupiedOf(base)
  const curOcc = occupiedOf(current)
  const newlyOccupied = subtractRanges(curOcc, baseOcc)
  const released = subtractRanges(baseOcc, curOcc)
  const stillOccupied = intersectRanges(baseOcc, curOcc)

  const newlyOccupiedCount = sumLength(newlyOccupied)
  const releasedCount = sumLength(released)

  return {
    items,
    address: {
      newlyOccupied,
      released,
      stillOccupied,
      newlyOccupiedCount,
      releasedCount,
      stillOccupiedCount: sumLength(stillOccupied),
      netChange: newlyOccupiedCount - releasedCount,
    },
    counts,
  }
}

// ---------- 展示辅助 ----------

export function formatRange(r: AddrRange): string {
  if (r.start === r.end) return intToIp(r.start)
  return `${intToIp(r.start)} – ${intToIp(r.end)}`
}

export function formatRanges(ranges: AddrRange[], limit = 6): string {
  if (ranges.length === 0) return '—'
  const head = ranges.slice(0, limit).map(formatRange)
  if (ranges.length > limit) head.push(`等 ${ranges.length} 段`)
  return head.join('、')
}

// ---------- 会话级持久化（仅当前浏览器会话） ----------

export function saveBaseline(snapshot: PlanSnapshot): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // 隐私模式 / 配额受限时静默失败，调用方仍可在内存中持有
  }
}

export function loadBaseline(): PlanSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PlanSnapshot
    if (!parsed || !Array.isArray(parsed.allocations)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearBaselineStorage(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}
