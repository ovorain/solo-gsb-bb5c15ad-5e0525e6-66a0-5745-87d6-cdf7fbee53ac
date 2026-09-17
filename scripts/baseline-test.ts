import { comparePlans, createSnapshot, formatRange } from '../src/lib/baseline'
import { ipToInt } from '../src/lib/ip'
import { plan } from '../src/lib/planner'
import type { PlannerInput } from '../src/lib/types'

let failures = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`PASS  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name} ${extra}`)
  }
}

function snapOf(input: PlannerInput) {
  const r = plan(input)
  if (r.inputErrors.length) throw new Error('input errors: ' + JSON.stringify(r.inputErrors))
  return { r, s: createSnapshot(input, r) }
}

const ip = ipToInt

// 场景 1：基线为示例；当前 q2 扩容 40 -> 100（/26 -> /25，必然迁移），并新增一个需求
const baseInput: PlannerInput = {
  parentCidr: '192.168.10.0/24',
  reservations: [{ id: 'r1', name: '保留', cidr: '192.168.10.0/28' }],
  requirements: [
    { id: 'q1', name: '办公', hosts: 100, cidr: '' },
    { id: 'q2', name: '机房', hosts: 40, cidr: '' },
    { id: 'q3', name: '监控', hosts: 25, cidr: '192.168.10.32/27' },
    { id: 'q4', name: '管理', hosts: 2, cidr: '' },
  ],
}
const { s: base } = snapOf(baseInput)

const curInput: PlannerInput = {
  parentCidr: '192.168.10.0/24',
  reservations: [{ id: 'r1', name: '保留', cidr: '192.168.10.0/28' }],
  requirements: [
    { id: 'q1', name: '办公', hosts: 100, cidr: '' },
    { id: 'q2', name: '机房', hosts: 100, cidr: '' }, // /26 -> /25
    { id: 'q3', name: '监控', hosts: 25, cidr: '192.168.10.32/27' },
    { id: 'q4', name: '管理', hosts: 2, cidr: '' },
    { id: 'q5', name: '新需求', hosts: 2, cidr: '' }, // 新增
  ],
}
const { r: r1, s: cur } = snapOf(curInput)
const d1 = comparePlans(base, cur)
const byId = Object.fromEntries(d1.items.map((i) => [i.id, i]))

check('保留区未变', byId.r1.status === 'unchanged', byId.r1.status)
check('固定段 q3 未变', byId.q3.status === 'unchanged', byId.q3.status)
// 两个 /25 需求竞争：q1 录入在前占 128/25，q2 找不到第二个对齐 /25 -> 未分配
check('q1 未变（先占 128/25）', byId.q1.status === 'unchanged', byId.q1.status)
check('q2 未分配（放不下第二个 /25）', byId.q2.status === 'unallocated', byId.q2.status)
check('q2 新快照携带失败原因', !!byId.q2.newSnap?.reason, byId.q2.newSnap?.reason)
check('q5 新增且已分配', byId.q5.status === 'added' && byId.q5.newSnap?.start !== null, byId.q5.status)
check('规划确实报告 q2 失败', r1.failures.some((f) => f.id === 'q2'))
check(
  '计数守恒（5 条需求+1 保留=6）',
  d1.counts.added + d1.counts.removed + d1.counts.unchanged + d1.counts.migrated + d1.counts.allocated + d1.counts.unallocated === 6,
)

// 场景 1b：在更大父网段中验证“迁移 + 扩容”
const base1b: PlannerInput = {
  parentCidr: '10.0.0.0/23', // 512 地址，空间充足
  reservations: [],
  requirements: [{ id: 'q', name: 'Q', hosts: 40, cidr: '' }], // /26 @0
}
const cur1b: PlannerInput = {
  parentCidr: '10.0.0.0/23',
  reservations: [{ id: 'r', name: 'R', cidr: '10.0.0.0/27' }], // 占 0-31 迫使 /26 对齐到 64
  requirements: [{ id: 'q', name: 'Q', hosts: 100, cidr: '' }], // 扩容到 /25 @128
}
const { s: b1b } = snapOf(base1b)
const { s: c1b } = snapOf(cur1b)
const d1b = comparePlans(b1b, c1b)
const q1b = d1b.items.find((i) => i.id === 'q')!
check('扩容导致迁移', q1b.status === 'migrated' && q1b.capacityDelta === 64, `${q1b.status} ${q1b.capacityDelta}`)
check('基线段 10.0.0.0/26', q1b.oldSnap?.cidr === '10.0.0.0/26', q1b.oldSnap?.cidr)
check('当前段 10.0.0.128/25', q1b.newSnap?.cidr === '10.0.0.128/25', q1b.newSnap?.cidr)
const r1b = d1b.items.find((i) => i.id === 'r')!
check('保留区 r 为新增', r1b.status === 'added' && r1b.kind === 'reserved')

// 场景 2：删除一个需求
const cur2Input: PlannerInput = {
  parentCidr: '192.168.10.0/24',
  reservations: [{ id: 'r1', name: '保留', cidr: '192.168.10.0/28' }],
  requirements: [
    { id: 'q1', name: '办公', hosts: 100, cidr: '' },
    { id: 'q2', name: '机房', hosts: 40, cidr: '' },
    { id: 'q3', name: '监控', hosts: 25, cidr: '192.168.10.32/27' },
    // q4 删除
  ],
}
const { s: cur2 } = snapOf(cur2Input)
const d2 = comparePlans(base, cur2)
const by2 = Object.fromEntries(d2.items.map((i) => [i.id, i]))
check('q4 删除', by2.q4.status === 'removed', by2.q4.status)
check('删除 q4 后 q1 未变', by2.q1.status === 'unchanged', by2.q1.status)
check('删除 q4 后 q2 未变', by2.q2.status === 'unchanged', by2.q2.status)
check(
  '释放地址包含 16-19',
  d2.address.released.some((r) => r.start === ip('192.168.10.16') && r.end === ip('192.168.10.19')),
  d2.address.released.map(formatRange).join(','),
)
check('净变化 -4', d2.address.netChange === -4, String(d2.address.netChange))

// 场景 3：缩容（q1 主机数 100 -> 40），CIDR 改变且容量 -64
const cur3Input: PlannerInput = {
  parentCidr: '192.168.10.0/24',
  reservations: [{ id: 'r1', name: '保留', cidr: '192.168.10.0/28' }],
  requirements: [
    { id: 'q1', name: '办公', hosts: 40, cidr: '' },
    { id: 'q2', name: '机房', hosts: 40, cidr: '' },
    { id: 'q3', name: '监控', hosts: 25, cidr: '192.168.10.32/27' },
    { id: 'q4', name: '管理', hosts: 2, cidr: '' },
  ],
}
const { s: cur3 } = snapOf(cur3Input)
const d3 = comparePlans(base, cur3)
const by3 = Object.fromEntries(d3.items.map((i) => [i.id, i]))
check('q1 缩容且迁移', by3.q1.status === 'migrated' && by3.q1.capacityDelta === -64, `${by3.q1.status} ${by3.q1.capacityDelta}`)

// 场景 4：新增需求放不下 = 新增但未分配
const base4Input: PlannerInput = {
  parentCidr: '10.0.0.0/27',
  reservations: [],
  requirements: [{ id: 'a', name: 'A', hosts: 20, cidr: '' }], // /27 占满
}
const { s: base4 } = snapOf(base4Input)
const cur4Input: PlannerInput = {
  parentCidr: '10.0.0.0/27',
  reservations: [],
  requirements: [
    { id: 'a', name: 'A', hosts: 20, cidr: '' },
    { id: 'b', name: 'B', hosts: 2, cidr: '' },
  ],
}
const { r: r4, s: cur4 } = snapOf(cur4Input)
check('场景4 当前有失败需求', r4.failures.length === 1, JSON.stringify(r4.failures))
const d4 = comparePlans(base4, cur4)
const by4 = Object.fromEntries(d4.items.map((i) => [i.id, i]))
check('a 未变（仍占满）', by4.a.status === 'unchanged', by4.a.status)
check('b 新增但未分配', by4.b.status === 'added' && by4.b.newSnap?.start === null, by4.b.status)

// 场景 5：删除失败需求
const cur5Input: PlannerInput = {
  parentCidr: '10.0.0.0/27',
  reservations: [],
  requirements: [{ id: 'a', name: 'A', hosts: 20, cidr: '' }],
}
const { s: cur5 } = snapOf(cur5Input)
const d5 = comparePlans(cur4, cur5) // 基线为“b 失败”版本
const by5 = Object.fromEntries(d5.items.map((i) => [i.id, i]))
check('b 被删除（即便基线中它是失败的）', by5.b.status === 'removed')
check('a 仍未变', by5.a.status === 'unchanged')

// 场景 6：恢复分配（基线失败 -> 当前成功）
const base6Input: PlannerInput = {
  parentCidr: '10.0.0.0/28', // 16 地址放不下 /27
  reservations: [],
  requirements: [{ id: 'a', name: 'A', hosts: 20, cidr: '' }],
}
const { r: rb6, s: base6 } = snapOf(base6Input)
check('场景6 基线 a 失败', rb6.failures.some((f) => f.id === 'a'))
const cur6Input: PlannerInput = {
  parentCidr: '10.0.0.0/26', // 换成大父网段，放得下
  reservations: [],
  requirements: [{ id: 'a', name: 'A', hosts: 20, cidr: '' }],
}
const { s: cur6 } = snapOf(cur6Input)
const d6 = comparePlans(base6, cur6)
const by6 = Object.fromEntries(d6.items.map((i) => [i.id, i]))
check('a 恢复分配', by6.a.status === 'allocated', by6.a.status)

// 反向：基线成功 -> 当前失败 = 未分配
const d7 = comparePlans(cur6, base6)
const by7 = Object.fromEntries(d7.items.map((i) => [i.id, i]))
check('a 未分配', by7.a.status === 'unallocated', by7.a.status)

// 场景 8：区间汇总不重复计数
const base8Input: PlannerInput = {
  parentCidr: '192.168.0.0/24',
  reservations: [{ id: 'r', name: 'R', cidr: '192.168.0.0/28' }],
  requirements: [{ id: 'f', name: 'F', hosts: 20, cidr: '192.168.0.32/27' }],
}
const cur8Input: PlannerInput = {
  parentCidr: '192.168.0.0/24',
  reservations: [{ id: 'r', name: 'R', cidr: '192.168.0.0/28' }],
  requirements: [{ id: 'f', name: 'F', hosts: 50, cidr: '' }], // /26 -> 64/26
}
const { s: b8 } = snapOf(base8Input)
const { s: c8 } = snapOf(cur8Input)
const d8 = comparePlans(b8, c8)
check('仍占用 = [0,15]（16）', d8.address.stillOccupiedCount === 16, String(d8.address.stillOccupiedCount))
check(
  '释放 = 32-63（32）',
  d8.address.releasedCount === 32 && d8.address.released[0].start === ip('192.168.0.32') && d8.address.released[0].end === ip('192.168.0.63'),
  JSON.stringify(d8.address.released),
)
check('新占用 = 64-127（64）', d8.address.newlyOccupiedCount === 64, String(d8.address.newlyOccupiedCount))
check('净变化 +32', d8.address.netChange === 32, String(d8.address.netChange))

// 场景 9：纯迁移（容量不变、位置改变）
// 9a) 保留区占据 a 原位置：地址层面 0-15 仍被占用（换了主人），不得重复计为释放
const base9Input: PlannerInput = {
  parentCidr: '10.9.0.0/24',
  reservations: [],
  requirements: [{ id: 'a', name: 'A', hosts: 10, cidr: '' }], // /28 @0
}
const cur9Input: PlannerInput = {
  parentCidr: '10.9.0.0/24',
  reservations: [{ id: 'r', name: 'R', cidr: '10.9.0.0/28' }],
  requirements: [{ id: 'a', name: 'A', hosts: 10, cidr: '' }], // /28 @16
}
const { s: b9 } = snapOf(base9Input)
const { s: c9 } = snapOf(cur9Input)
const d9 = comparePlans(b9, c9)
const by9 = Object.fromEntries(d9.items.map((i) => [i.id, i]))
check('a 迁移且容量不变', by9.a.status === 'migrated' && by9.a.capacityDelta === 0)
check('r 新增', by9.r.status === 'added')
check('9a 释放 0（0-15 被保留区接手，仍占用）', d9.address.releasedCount === 0, String(d9.address.releasedCount))
check('9a 新占用 16-31（16）', d9.address.newlyOccupiedCount === 16, String(d9.address.newlyOccupiedCount))
check('9a 仍占用 0-15（16，换主人不重复计数）', d9.address.stillOccupiedCount === 16, String(d9.address.stillOccupiedCount))
check('9a 净变化 +16', d9.address.netChange === 16, String(d9.address.netChange))

// 9b) 无保留区，靠在 a 前面插入一个更大的需求把它挤走，原位置成为空闲 -> 真释放
const base9b: PlannerInput = {
  parentCidr: '10.9.0.0/24',
  reservations: [],
  requirements: [{ id: 'a', name: 'A', hosts: 10, cidr: '' }], // /28 @0
}
const cur9b: PlannerInput = {
  parentCidr: '10.9.0.0/24',
  reservations: [{ id: 'r', name: 'R', cidr: '10.9.0.0/26' }], // 0-63 保留
  requirements: [{ id: 'a', name: 'A', hosts: 10, cidr: '' }], // /28 @64
}
const { s: b9b } = snapOf(base9b)
const { s: c9b } = snapOf(cur9b)
const d9b = comparePlans(b9b, c9b)
check('9b a 迁移', d9b.items.find((i) => i.id === 'a')?.status === 'migrated')
check(
  '9b 释放为空（原 0-15 落在新保留区 0-63 内）',
  d9b.address.releasedCount === 0,
  String(d9b.address.releasedCount),
)
check(
  '9b 新占用 = 保留区(64) + a 新址(16) − a 原址曾占(16) = 64',
  d9b.address.newlyOccupiedCount === 64,
  String(d9b.address.newlyOccupiedCount),
)

// 9c) 父网段不变、无新增占用，仅需求改固定段移动，原址空闲
const base9c: PlannerInput = {
  parentCidr: '10.9.0.0/24',
  reservations: [],
  requirements: [{ id: 'a', name: 'A', hosts: 10, cidr: '' }], // 自动 /28 @0
}
const cur9c: PlannerInput = {
  parentCidr: '10.9.0.0/24',
  reservations: [],
  requirements: [{ id: 'a', name: 'A', hosts: 10, cidr: '10.9.0.32/28' }], // 固定 32-47
}
const { s: b9c } = snapOf(base9c)
const { s: c9c } = snapOf(cur9c)
const d9c = comparePlans(b9c, c9c)
check('9c 释放 0-15（16）', d9c.address.releasedCount === 16, String(d9c.address.releasedCount))
check('9c 新占用 32-47（16）', d9c.address.newlyOccupiedCount === 16, String(d9c.address.newlyOccupiedCount))
check('9c 仍占用 0', d9c.address.stillOccupiedCount === 0, String(d9c.address.stillOccupiedCount))
check('9c 净变化 0', d9c.address.netChange === 0)

// 场景 10：相邻区间合并：两条相邻 /30 释放应合并为一个 0-7
const base10Input: PlannerInput = {
  parentCidr: '10.10.0.0/27',
  reservations: [
    { id: 'r1', name: 'r1', cidr: '10.10.0.0/30' },
    { id: 'r2', name: 'r2', cidr: '10.10.0.4/30' },
  ],
  requirements: [],
}
const cur10Input: PlannerInput = {
  parentCidr: '10.10.0.0/27',
  reservations: [],
  requirements: [],
}
const { s: b10 } = snapOf(base10Input)
const { s: c10 } = snapOf(cur10Input)
const d10 = comparePlans(b10, c10)
check(
  '相邻释放区间合并为 0-7',
  d10.address.released.length === 1 && d10.address.released[0].start === ip('10.10.0.0') && d10.address.released[0].end === ip('10.10.0.7'),
  JSON.stringify(d10.address.released),
)
check('r1、r2 均为删除', d10.items.every((i) => i.status === 'removed'))

// 场景 11：同一需求从“自动”改为“固定”（ID 不变、CIDR 变化）= 迁移
const base11: PlannerInput = {
  parentCidr: '172.16.0.0/24',
  reservations: [],
  requirements: [{ id: 'q', name: 'Q', hosts: 10, cidr: '' }], // 自动 /28 @0
}
const cur11: PlannerInput = {
  parentCidr: '172.16.0.0/24',
  reservations: [],
  requirements: [{ id: 'q', name: 'Q', hosts: 10, cidr: '172.16.0.64/28' }], // 固定
}
const { s: b11 } = snapOf(base11)
const { s: c11 } = snapOf(cur11)
const d11 = comparePlans(b11, c11)
const q11 = d11.items[0]
check('自动转固定、CIDR 变化 = 迁移', q11.status === 'migrated' && q11.kind === 'fixed', `${q11.status} ${q11.kind}`)

console.log(failures === 0 ? '\n基线对比测试全部通过 ✅' : `\n${failures} 个测试失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
