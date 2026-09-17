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
