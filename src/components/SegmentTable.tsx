import type { Segment } from '../lib/types'

interface Props {
  segments: Segment[]
  selectedIndex: number | null
  onSelect: (index: number) => void
}

const KIND_LABEL: Record<Segment['kind'], string> = {
  reserved: '保留',
  fixed: '固定',
  auto: '自动',
  free: '空闲',
}

export default function SegmentTable({ segments, selectedIndex, onSelect }: Props) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
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
          {segments.map((seg, i) => (
            <tr
              key={i}
              className={`clickable${selectedIndex === i ? ' selected' : ''}`}
              onClick={() => onSelect(i)}
            >
              <td className="mono">{i + 1}</td>
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
          ))}
        </tbody>
      </table>
    </div>
  )
}
