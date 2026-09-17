import type { RequirementDiff, Segment } from '../lib/types'

interface Props {
  segments: Segment[]
  selectedIndex: number | null
  onSelect: (index: number) => void
  /** 基线对比结论（按需求稳定 ID 索引），存在时在各行追加变化标记 */
  diffByRefId?: Map<string, RequirementDiff>
}

const KIND_LABEL: Record<Segment['kind'], string> = {
  reserved: '保留',
  fixed: '固定',
  auto: '自动',
  free: '空闲',
}

const STATUS_SHORT: Record<RequirementDiff['status'], string> = {
  added: '新增',
  removed: '删除',
  allocated: '恢复分配',
  unallocated: '未分配',
  unchanged: '未变',
  migrated: '迁移',
}

function diffTag(d: RequirementDiff): { text: string; cls: string } {
  if (d.status === 'migrated') {
    if (d.capacityDelta > 0) return { text: `迁移·扩容 +${d.capacityDelta}`, cls: 'migrated' }
    if (d.capacityDelta < 0)
      return { text: `迁移·缩容 −${-d.capacityDelta}`, cls: 'migrated' }
    return { text: '迁移', cls: 'migrated' }
  }
  return { text: STATUS_SHORT[d.status], cls: d.status }
}

export default function SegmentTable({ segments, selectedIndex, onSelect, diffByRefId }: Props) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            {diffByRefId && <th>对比基线</th>}
            <th>类型</th>
            <th>名称</th>
            <th>网段 / 区间</th>
            <th>网络地址</th>
            <th>广播地址</th>
            <th>可用范围</th>
            <th style={{ textAlign: 'right' }}>容量</th>
            <th style={{ textAlign: 'right' }}>可用主机</th>
            <th style={{ textAlign: 'right' }}>需求主机</th>
            <th style={{ textAlign: 'right' }}>浪费</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((seg, i) => {
            const d = seg.refId && diffByRefId ? diffByRefId.get(seg.refId) : undefined
            const tag = d ? diffTag(d) : undefined
            return (
              <tr
                key={i}
                className={`clickable${selectedIndex === i ? ' selected' : ''}${
                  d && d.status !== 'unchanged' ? ` diff-${d.status}` : ''
                }`}
                onClick={() => onSelect(i)}
              >
                <td className="mono">{i + 1}</td>
                {diffByRefId && (
                  <td>{tag ? <span className={`chip ${tag.cls}`}>{tag.text}</span> : '—'}</td>
                )}
                <td>
                  <span className={`badge ${seg.kind}`}>{KIND_LABEL[seg.kind]}</span>
                </td>
                <td>{seg.name}</td>
                <td className="mono">{seg.cidr}</td>
                <td className="mono">{seg.network}</td>
                <td className="mono">{seg.broadcast}</td>
                <td className="mono">
                  {seg.firstUsable === '—' ? '—' : `${seg.firstUsable} ~ ${seg.lastUsable}`}
                </td>
                <td style={{ textAlign: 'right' }} className="mono">
                  {seg.capacity}
                </td>
                <td style={{ textAlign: 'right' }} className="mono">
                  {seg.usable}
                </td>
                <td style={{ textAlign: 'right' }} className="mono">
                  {seg.requestedHosts ?? '—'}
                </td>
                <td style={{ textAlign: 'right' }} className="mono">
                  {seg.kind === 'reserved' || seg.kind === 'free' ? '—' : seg.waste}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
