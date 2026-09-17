import { plan } from '../src/lib/planner'
import { prefixForHosts } from '../src/lib/ip'
import type { PlannerInput } from '../src/lib/types'

let failures = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    console.log(`PASS  ${name}`)
  } else {
    failures++
    console.log(`FAIL  ${name} ${extra}`)
  }
}

// 1) 容量换算
check('2 台主机 -> /30', prefixForHosts(2) === 30)
check('3 台主机 -> /29', prefixForHosts(3) === 29)
check('100 台主机 -> /25', prefixForHosts(100) === 25)
check('254 台主机 -> /24', prefixForHosts(254) === 24)
check('255 台主机 -> /23', prefixForHosts(255) === 23)

// 2) 示例场景：保留 0/28，固定 64/28；自动 100/40/25/2
const demo: PlannerInput = {
  parentCidr: '192.168.10.0/24',
  reservations: [{ id: 'r1', name: '保留', cidr: '192.168.10.0/28' }],
  requirements: [
    { id: 'q1', name: '办公', hosts: 100, cidr: '' },
    { id: 'q2', name: '机房', hosts: 40, cidr: '' },
    { id: 'q3', name: '监控', hosts: 25, cidr: '192.168.10.32/27' },
    { id: 'q4', name: '管理', hosts: 2, cidr: '' },
  ],
}
const r = plan(demo)
check('示例无输入错误', r.inputErrors.length === 0, JSON.stringify(r.inputErrors))
check('示例无失败需求', r.failures.length === 0, JSON.stringify(r.failures))
const auto = r.segments.filter((s) => s.kind === 'auto').map((s) => s.cidr)
check(
  '自动分配结果正确（按地址顺序）',
  JSON.stringify(auto) === JSON.stringify(['192.168.10.16/30', '192.168.10.64/26', '192.168.10.128/25']),
  JSON.stringify(auto),
)
check('总地址守恒 256', r.summary.reserved + r.summary.fixed + r.summary.auto + r.summary.free === 256)
check('示例浪费量=53', r.summary.waste === 53, String(r.summary.waste))
check('示例空闲=12（20–31 + 192–255）', r.summary.free === 12, String(r.summary.free))

// 2b) 回归：保留 0/28、固定 64/28，/26 需求必须推进到 128（不能压在固定段上）
const reg: PlannerInput = {
  parentCidr: '192.168.10.0/24',
  reservations: [{ id: 'r1', name: '保留', cidr: '192.168.10.0/28' }],
  requirements: [
    { id: 'f', name: '固定', hosts: 2, cidr: '192.168.10.64/28' },
    { id: 'a', name: '自动', hosts: 40, cidr: '' },
  ],
}
const rr = plan(reg)
check(
  '对齐推进不侵占固定段',
  rr.segments.find((s) => s.kind === 'auto')?.cidr === '192.168.10.128/26',
  JSON.stringify(rr.segments.map((s) => [s.kind, s.cidr])),
)
check(
  '占用段之间无重叠',
  (() => {
    const occ2 = rr.segments.filter((s) => s.kind !== 'free').sort((a, b) => a.start - b.start)
    for (let i = 1; i < occ2.length; i++) if (occ2[i].start <= occ2[i - 1].end) return false
    return true
  })(),
)

// 3) 同规模按录入顺序：/28 保留外，3 个 /30 需求依次落到 16、20、24
const tie: PlannerInput = {
  parentCidr: '10.0.0.0/27',
  reservations: [{ id: 'r1', name: 'res', cidr: '10.0.0.0/28' }],
  requirements: [
    { id: 'a', name: 'A', hosts: 2, cidr: '' },
    { id: 'b', name: 'B', hosts: 2, cidr: '' },
    { id: 'c', name: 'C', hosts: 2, cidr: '' },
  ],
}
const rt = plan(tie)
check(
  '同规模按录入顺序分配',
  JSON.stringify(rt.segments.filter((s) => s.kind === 'auto').map((s) => s.cidr)) ===
    JSON.stringify(['10.0.0.16/30', '10.0.0.20/30', '10.0.0.24/30']),
  JSON.stringify(rt.segments),
)

// 4) 放不下：父 /30，需求 100 台，应给出原因
const tooBig: PlannerInput = {
  parentCidr: '192.168.0.0/30',
  reservations: [],
  requirements: [{ id: 'x', name: 'X', hosts: 100, cidr: '' }],
}
const rb = plan(tooBig)
check('超大需求失败且有原因', rb.failures.length === 1 && /最大连续空闲块/.test(rb.failures[0].reason), rb.failures[0]?.reason)

// 5) 碎片化：/30 块被保留区切碎，大网段找不到对齐空间
const frag: PlannerInput = {
  parentCidr: '10.1.0.0/26',
  reservations: [
    { id: 'r1', name: 'r1', cidr: '10.1.0.16/30' },
    { id: 'r2', name: 'r2', cidr: '10.1.0.32/30' },
    { id: 'r3', name: 'r3', cidr: '10.1.0.48/30' },
  ],
  requirements: [{ id: 'x', name: '大块', hosts: 20, cidr: '' }], // 需要 /27
}
const rf = plan(frag)
check('碎片场景 /27 无法分配', rf.failures.length === 1, JSON.stringify(rf.failures))
check('失败后其余段仍正常输出', rf.segments.filter((s) => s.kind === 'reserved').length === 3)

// 6) 固定网段超出父网段 -> 输入错误
const outside: PlannerInput = {
  parentCidr: '192.168.1.0/24',
  reservations: [],
  requirements: [{ id: 'x', name: 'X', hosts: 2, cidr: '192.168.2.0/30' }],
}
check('固定网段越界报错', plan(outside).inputErrors.some((e) => /不在父网段/.test(e)))

// 7) 保留区与固定网段重叠 -> 输入错误
const overlap: PlannerInput = {
  parentCidr: '192.168.1.0/24',
  reservations: [{ id: 'r', name: 'R', cidr: '192.168.1.0/28' }],
  requirements: [{ id: 'x', name: 'X', hosts: 2, cidr: '192.168.1.8/30' }],
}
check('保留与固定重叠报错', plan(overlap).inputErrors.some((e) => /重叠/.test(e)))

// 8) 固定网段容量不足 -> 报错并显示实际可用数
const small: PlannerInput = {
  parentCidr: '192.168.1.0/24',
  reservations: [],
  requirements: [{ id: 'x', name: 'X', hosts: 20, cidr: '192.168.1.0/28' }],
}
check('固定段容量不足报错', plan(small).inputErrors.some((e) => /仅提供 14/.test(e)))

// 9) 非规范网络地址（主机位非 0）报错
const nonCanonical: PlannerInput = {
  parentCidr: '192.168.1.10/24',
  reservations: [],
  requirements: [],
}
check('非规范父网段报错并提示正确写法', plan(nonCanonical).inputErrors.some((e) => /192\.168\.1\.0\/24/.test(e)))

// 10) 自动网段绕开保留区且边界对齐：保留区位于中间 16/28，/27 需求应落到 0/27 而非 32/27？
//  最低对齐：0/27 空闲可容纳 -> 0/27
const align: PlannerInput = {
  parentCidr: '10.2.0.0/26',
  reservations: [{ id: 'r', name: 'R', cidr: '10.2.0.16/28' }],
  requirements: [{ id: 'x', name: 'X', hosts: 25, cidr: '' }], // /27
}
const ra = plan(align)
check(
  '最低对齐原则（跳过保留区取 32/27）',
  ra.segments.find((s) => s.kind === 'auto')?.cidr === '10.2.0.32/27',
  JSON.stringify(ra.segments.map((s) => s.cidr)),
)

// 11) 浪费量统计：100 台在 /25 浪费 26；广播/网络/可用范围正确
const w = plan({
  parentCidr: '192.168.10.0/24',
  reservations: [],
  requirements: [{ id: 'x', name: 'X', hosts: 100, cidr: '' }],
})
const seg0 = w.segments.find((s) => s.kind === 'auto')!
check('浪费量=26', seg0.waste === 26, String(seg0.waste))
check('网络地址', seg0.network === '192.168.10.0')
check('广播地址', seg0.broadcast === '192.168.10.127')
check('可用范围', seg0.firstUsable === '192.168.10.1' && seg0.lastUsable === '192.168.10.126')
check('容量 128 / 可用 126', seg0.capacity === 128 && seg0.usable === 126)

// 12) 排序：录入小需求在前、大需求在后，大需求仍先分且不会被小需求挡住最低地址
const order: PlannerInput = {
  parentCidr: '172.16.0.0/24',
  reservations: [],
  requirements: [
    { id: 's', name: '小', hosts: 2, cidr: '' },
    { id: 'b', name: '大', hosts: 100, cidr: '' },
  ],
}
const ro = plan(order)
check(
  '大需求优先占最低对齐地址',
  JSON.stringify(ro.segments.filter((s) => s.kind === 'auto').map((s) => s.cidr)) ===
    JSON.stringify(['172.16.0.0/25', '172.16.0.128/30']),
  JSON.stringify(ro.segments.map((s) => s.cidr)),
)

console.log(failures === 0 ? '\n全部测试通过 ✅' : `\n${failures} 个测试失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
