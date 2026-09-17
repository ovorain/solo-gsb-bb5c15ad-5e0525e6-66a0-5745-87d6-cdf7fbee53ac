import type { PlanDiff, PlanSnapshot, RequirementDiff } from '../lib/types'
import { formatRanges } from '../lib/baseline'

interface Props {
  baseline: PlanSnapshot | null
  /** 当前规划是否可作为基线保存（无输入错误且父网段有效） */
  canSave: boolean
  /** 输入非法时为 null（暂停对比），否则为实时对比结果 */
  diff: PlanDiff | null
  /** 当前输入是否存在错误（用于“暂停对比”提示） */
  inputInvalid: boolean
  onSave: () => void
  onClear: () => void
}

const STATUS_META: Record<RequirementDiff['status'], { label: string; cls: string }> = {
  added: { label: '新增', cls: 'added' },
  removed: { label: '删除', cls: 'removed' },
  unchanged: { label: '未变', cls: 'unchanged' },
  migrated: { label: '迁移', cls: 'migrated' },
  allocated: { label: '恢复分配', cls: 'allocated' },
  unallocated: { label: '未分配', cls: 'unallocated' },
}

const KIND_LABEL = { reserved: '保留', fixed: '固定', auto: '自动' } as const

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

function fmtAddr(n: number): string {
  return n.toLocaleString('en-US')
}

function snapCell(d: RequirementDiff, side: 'old' | 'new'): { main: string; sub: string } {
  const s = side === 'old' ? d.oldSnap : d.newSnap
  if (!s) return { main: side === 'old' ? '—（新增项）' : '—（已删除）', sub: '' }
  if (s.start === null) return { main: '未分配', sub: s.reason ? `原因：${s.reason}` : '' }
  return { main: s.cidr, sub: `${fmtAddr(s.capacity)} 地址` }
}

function capacityCell(d: RequirementDiff): { text: string; cls: string } {
  const b = d.oldSnap
  const c = d.newSnap
  if (d.status === 'added' && c && c.start !== null)
    return { text: `新增 ${fmtAddr(c.capacity)}`, cls: 'grow' }
  if (d.status === 'removed' && b && b.start !== null)
    return { text: `释放 ${fmtAddr(b.capacity)}`, cls: 'shrink' }
  if (d.status === 'allocated' && c) return { text: `分配 ${fmtAddr(c.capacity)}`, cls: 'grow' }
  if (d.status === 'unallocated' && b && b.start !== null)
    return { text: `释放 ${fmtAddr(b.capacity)}`, cls: 'shrink' }
  if (d.status === 'migrated' && b && c) {
    if (d.capacityDelta > 0)
      return { text: `${fmtAddr(b.capacity)} → ${fmtAddr(c.capacity)}（扩容 +${fmtAddr(d.capacityDelta)}）`, cls: 'grow' }
    if (d.capacityDelta < 0)
      return { text: `${fmtAddr(b.capacity)} → ${fmtAddr(c.capacity)}（缩容 −${fmtAddr(-d.capacityDelta)}）`, cls: 'shrink' }
    return { text: `${fmtAddr(b.capacity)}（容量不变）`, cls: '' }
  }
  if (b && c && b.start !== null && c.start !== null)
    return { text: fmtAddr(c.capacity), cls: '' }
  return { text: '—', cls: '' }
}

export default function BaselinePanel({ baseline, canSave, diff, inputInvalid, onSave, onClear }: Props) {
  return (
    <div className="panel baseline-panel">
      <div className="header-row">
        <h2 style={{ marginBottom: 0 }}>④ 基线对比</h2>
        <div className="btn-row" style={{ margin: 0 }}>
          <button className="primary" onClick={onSave} disabled={!canSave} title="将当前规划覆盖保存为新基线">
            {baseline ? '重建基线（覆盖当前）' : '保存为基线'}
          </button>
          <button onClick={onClear} disabled={!baseline}>
            清除基线
          </button>
        </div>
      </div>

      {!baseline ? (
        <p className="subtitle" style={{ margin: '10px 0 0' }}>
          尚无敌线。当前规划无输入错误时点击「保存为基线」，之后修改父 CIDR、保留区或需求，将按需求的稳定
          ID 对比新增、删除、未变、扩缩容、迁移、未分配与恢复分配。基线仅保存在当前浏览器会话中。
        </p>
      ) : (
        <>
          <p className="baseline-meta">
            基线时间：{fmtTime(baseline.createdAt)} ｜ 基线父网段：<span className="mono">{baseline.parentCidr}</span>
            （{fmtAddr(baseline.parentSize)} 地址）
          </p>

          {inputInvalid ? (
            <div className="baseline-paused">
              当前输入存在错误，已<strong>保留基线并暂停对比</strong>；修正输入后对比自动恢复。
            </div>
          ) : !diff ? (
            <p className="subtitle" style={{ margin: '8px 0 0' }}>暂无对比数据。</p>
          ) : (
            <>
              <div className="diff-chips">
                <span className="chip added">新增 {diff.counts.added}</span>
                <span className="chip removed">删除 {diff.counts.removed}</span>
                <span className="chip migrated">迁移 {diff.counts.migrated}</span>
                <span className="chip unallocated">未分配 {diff.counts.unallocated}</span>
                <span className="chip allocated">恢复分配 {diff.counts.allocated}</span>
                <span className="chip unchanged">未变 {diff.counts.unchanged}</span>
              </div>

              <div className="addr-summary">
                <div className="addr-stat">
                  <div className="v" style={{ color: 'var(--auto)' }}>
                    +{fmtAddr(diff.address.newlyOccupiedCount)}
                  </div>
                  <div className="k">新占用地址</div>
                  <div className="ranges" title={formatRanges(diff.address.newlyOccupied, 100)}>
                    {formatRanges(diff.address.newlyOccupied)}
                  </div>
                </div>
                <div className="addr-stat">
                  <div className="v" style={{ color: 'var(--danger)' }}>
                    −{fmtAddr(diff.address.releasedCount)}
                  </div>
                  <div className="k">释放地址</div>
                  <div className="ranges" title={formatRanges(diff.address.released, 100)}>
                    {formatRanges(diff.address.released)}
                  </div>
                </div>
                <div className="addr-stat">
                  <div className="v">{fmtAddr(diff.address.stillOccupiedCount)}</div>
                  <div className="k">仍占用地址（重叠只计一次）</div>
                  <div className="ranges" title={formatRanges(diff.address.stillOccupied, 100)}>
                    {formatRanges(diff.address.stillOccupied)}
                  </div>
                </div>
                <div className="addr-stat">
                  <div
                    className="v"
                    style={{ color: diff.address.netChange > 0 ? 'var(--auto)' : diff.address.netChange < 0 ? 'var(--danger)' : undefined }}
                  >
                    {diff.address.netChange > 0 ? '+' : ''}
                    {fmtAddr(diff.address.netChange)}
                  </div>
                  <div className="k">净地址变化（新占用 − 释放）</div>
                </div>
              </div>

              <div className="table-scroll">
                <table className="diff-table">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>状态</th>
                      <th>基线段（容量）</th>
                      <th>当前段（容量）</th>
                      <th>容量变化</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.items.map((d) => {
                      const oldCell = snapCell(d, 'old')
                      const newCell = snapCell(d, 'new')
                      const cap = capacityCell(d)
                      const note =
                        d.status === 'unallocated' && d.newSnap?.reason
                          ? d.newSnap.reason
                          : d.status === 'allocated'
                            ? '该需求在基线中分配失败，现已成功分配'
                            : d.status === 'migrated'
                              ? d.capacityDelta > 0
                                ? 'CIDR 改变（迁移），同时扩容'
                                : d.capacityDelta < 0
                                  ? 'CIDR 改变（迁移），同时缩容'
                                  : 'CIDR 改变（迁移），容量不变'
                              : ''
                      return (
                        <tr key={d.id} className={`row-${d.status}`}>
                          <td>
                            {d.name}
                            <span className={`badge kind-${d.kind}`}>{KIND_LABEL[d.kind]}</span>
                          </td>
                          <td>
                            <span className={`chip ${STATUS_META[d.status].cls}`}>
                              {STATUS_META[d.status].label}
                            </span>
                          </td>
                          <td className="mono">
                            {oldCell.main}
                            {oldCell.sub && <div className="cell-sub">{oldCell.sub}</div>}
                          </td>
                          <td className="mono">
                            {newCell.main}
                            {newCell.sub && <div className="cell-sub">{newCell.sub}</div>}
                          </td>
                          <td className={`mono ${cap.cls}`}>{cap.text}</td>
                          <td className="note">{note}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
