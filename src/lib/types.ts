// 网段类型：保留区、固定网段（带固定前缀的需求）、自动分配网段、空闲区
export type SegmentKind = 'reserved' | 'fixed' | 'auto' | 'free'

export interface RequirementInput {
  id: string
  name: string
  /** 需要的可用主机数（= 总地址数 - 2） */
  hosts: number | ''
  /** 可选固定网段，形如 192.168.1.0/28 */
  cidr: string
}

export interface ReservedInput {
  id: string
  name: string
  /** 保留区 CIDR，形如 10.0.0.0/30 */
  cidr: string
}

export interface Segment {
  kind: SegmentKind
  /** 关联的需求 / 保留区稳定 ID（空闲区无），用于基线对比 */
  refId?: string
  /** 关联的需求 / 保留区名称（空闲区为“空闲”） */
  name: string
  cidr: string
  prefix: number
  network: string
  broadcast: string
  firstUsable: string
  lastUsable: string
  start: number // 起始地址（数值，含）
  end: number // 结束地址（数值，含）
  /** 地址块总容量 2^(32-prefix) */
  capacity: number
  /** 可用主机数 = capacity - 2 */
  usable: number
  /** 浪费量 = capacity - 2 - 实际需求主机数（自动网段）；保留/固定按容量统计 */
  waste: number
  requestedHosts?: number
  /** 自动分配失败时的原因 */
  reason?: string
}

export interface FailureItem {
  id: string
  name: string
  hosts: number
  reason: string
}

export interface PlanResult {
  parentCidr: string
  parentNetwork: string
  parentPrefix: number
  parentSize: number
  segments: Segment[]
  failures: FailureItem[]
  /** 输入级错误（父网段、保留区、固定网段非法等），非空时 segments 不可信 */
  inputErrors: string[]
  summary: {
    reserved: number
    fixed: number
    auto: number
    free: number
    totalCapacity: number
    usedCapacity: number
    allocatedUsable: number
    requestedHosts: number
    waste: number
    utilization: number // 已占用地址占父网段百分比
  }
}

export interface PlannerInput {
  parentCidr: string
  reservations: ReservedInput[]
  requirements: RequirementInput[]
}

// ---------- 基线对比 ----------

/** 单条需求/保留区在某次规划中的落位快照（按稳定 ID 追踪） */
export interface AllocationSnapshot {
  id: string
  name: string
  kind: Exclude<SegmentKind, 'free'>
  /** 占用区间（含端点）；分配失败时为 null */
  start: number | null
  end: number | null
  /** 网段容量（地址数）；分配失败时为 0 */
  capacity: number
  cidr: string
  /** 需求主机数（保留区无） */
  requestedHosts?: number
  /** 自动需求分配失败原因 */
  reason?: string
}

/** 一次无输入错误的规划结果快照，即“基线”的载体 */
export interface PlanSnapshot {
  createdAt: string
  parentCidr: string
  parentStart: number
  parentEnd: number
  parentSize: number
  allocations: AllocationSnapshot[]
}

/** 单条需求/保留区的对比结论 */
export interface RequirementDiff {
  id: string
  name: string
  kind: Exclude<SegmentKind, 'free'>
  status:
    | 'added' // 新增：基线中不存在
    | 'removed' // 删除：当前不存在
    | 'unchanged' // 未变
    | 'migrated' // 网段 CIDR（区间）改变；容量同时变化时 capacityDelta 非 0，即附带扩/缩容标记
    | 'allocated' // 恢复分配：基线中分配失败，当前成功
    | 'unallocated' // 未分配：基线中成功（或一直失败），当前分配失败
  /** 容量相对基线的变化：正=扩容，负=缩容，0=容量未变 */
  capacityDelta: number
  moved: boolean
  oldSnap: AllocationSnapshot | null
  newSnap: AllocationSnapshot | null
}

/** 地址区间（含端点） */
export interface AddrRange {
  start: number
  end: number
}

/** 按地址区间聚合的占用变化 */
export interface AddressChangeSummary {
  /** 新占用：当前占用但基线空闲（已按区间合并） */
  newlyOccupied: AddrRange[]
  /** 释放：基线占用但当前空闲 */
  released: AddrRange[]
  /** 仍占用：两版都占用（重叠部分只计一次） */
  stillOccupied: AddrRange[]
  newlyOccupiedCount: number
  releasedCount: number
  stillOccupiedCount: number
  /** 净地址变化 = 新占用地址数 − 释放地址数（正=净增占用） */
  netChange: number
}

export interface PlanDiff {
  items: RequirementDiff[]
  address: AddressChangeSummary
  /** 各类计数，便于面板展示 */
  counts: {
    added: number
    removed: number
    unchanged: number
    migrated: number
    unallocated: number
    allocated: number
  }
}

