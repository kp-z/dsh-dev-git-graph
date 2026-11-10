/**
 * 洞察页纯函数的离线单测（node test/insightView.mjs）。
 *
 * 覆盖：空数据 / 单任务 / 大量任务 / 坏数据不崩 / 百分比和恰好 100 /
 * Top N 截断（项目 Top8 + 其他、阻塞榜 Top5、最近动态 Top5）/ 互斥状态桶 /
 * 依赖链深度（含环）/ 百分比最大余数法。
 */

import assert from 'node:assert/strict'
import {
  buildInsight,
  bucketOf,
  sharePct,
  longestDepChain,
  formatAgo,
  startOfDay,
  TONES,
} from '../src/client/insightView.js'

let passed = 0
const failed = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed.push({ name, error })
    console.log(`  FAIL ${name}`)
    console.log(`       ${error && error.message}`)
  }
}

const task = (id, extra) => Object.assign({
  id,
  no: 1,
  title: `任务 ${id}`,
  done: false,
  workspaceKey: 'wA',
  workspaceTitle: '项目A',
  blocked: false,
  ready: true,
  started: false,
  suspended: false,
  sessionId: `s-${id}`,
  running: false,
  sessionTurn: 0,
  predecessors: [],
  successors: [],
  sourceTasks: [],
  derivedTasks: [],
  blockedBy: [],
}, extra || {})

/* ---------------- 纯工具 ---------------- */

check('sharePct：三份相等时和恰好 100（最大余数法，不是 33+33+33）', () => {
  const pcts = sharePct([1, 1, 1])
  assert.equal(pcts.reduce((a, b) => a + b, 0), 100)
  assert.deepEqual([...pcts].sort(), [33, 33, 34])
})

check('sharePct：全 0 时返回全 0（不制造 NaN / 不硬凑 100）', () => {
  assert.deepEqual(sharePct([0, 0, 0, 0]), [0, 0, 0, 0])
  assert.deepEqual(sharePct([]), [])
})

check('sharePct：0 值桶不会被余数法「抬高」（避免 0% 变成 1%）', () => {
  const pcts = sharePct([9, 1, 0, 0])
  assert.equal(pcts[2], 0)
  assert.equal(pcts[3], 0)
  assert.equal(pcts.reduce((a, b) => a + b, 0), 100)
})

check('bucketOf：完成优先于阻塞；挂起在阻塞之后判断', () => {
  assert.equal(bucketOf({ done: true, blocked: true, blockedBy: [{}] }), 'done')
  assert.equal(bucketOf({ done: false, blocked: true, blockedBy: [{}], suspended: true }), 'blocked')
  assert.equal(bucketOf({ done: false, blocked: false, suspended: true }), 'suspended')
  assert.equal(bucketOf({ done: false }), 'ready')
  assert.equal(bucketOf(null), 'ready', '坏输入不崩')
})

check('longestDepChain：链式依赖算出真实深度', () => {
  const relations = [
    { from: 'a', to: 'b', kind: 'depends_on' },
    { from: 'b', to: 'c', kind: 'depends_on' },
    { from: 'c', to: 'd', kind: 'depends_on' },
    { from: 'a', to: 'd', kind: 'derived_from' },
  ]
  assert.equal(longestDepChain(relations), 4)
})

check('longestDepChain：有环不栈溢出，退回一个有限值', () => {
  const relations = [
    { from: 'a', to: 'b', kind: 'depends_on' },
    { from: 'b', to: 'a', kind: 'depends_on' },
  ]
  const depth = longestDepChain(relations)
  assert.ok(Number.isFinite(depth) && depth >= 2, `环上深度 ${depth}`)
})

check('longestDepChain：没有依赖边 → 0', () => {
  assert.equal(longestDepChain([]), 0)
  assert.equal(longestDepChain([{ from: 'a', to: 'b', kind: 'derived_from' }]), 0)
})

/* ---------------- 空 / 坏数据 ---------------- */

check('空数据：empty=true，四个互斥桶全是 0，百分比全 0，不抛', () => {
  const view = buildInsight({ tasks: [], relations: [], workspaces: [] })
  assert.equal(view.empty, true)
  assert.equal(view.totals.tasks, 0)
  assert.equal(view.statusMix.length, 4)
  assert.deepEqual(view.statusMix.map((row) => row.count), [0, 0, 0, 0])
  assert.deepEqual(view.statusMix.map((row) => row.pct), [0, 0, 0, 0])
  assert.deepEqual(view.blockers, [])
  assert.deepEqual(view.workspaces, [])
  assert.equal(view.relations.maxChain, 0)
})

check('坏数据：null / undefined / 字符串 / 数组里混垃圾都不崩', () => {
  for (const bad of [null, undefined, 'x', 42, [], { tasks: 'no' }, { tasks: [null, 1, {}, []] }]) {
    const view = buildInsight(bad)
    assert.equal(typeof view.empty, 'boolean')
    assert.equal(Array.isArray(view.kpis), true)
    assert.equal(view.kpis.length, 6)
  }
})

check('坏任务行：缺 id 的被丢掉，其余照算', () => {
  const view = buildInsight({ tasks: [{ title: '没有 id' }, task('a1')] })
  assert.equal(view.totals.tasks, 1)
})

/* ---------------- 单任务 ---------------- */

check('单任务（未完成）：就绪 1、完成率 0%、KPI 五张', () => {
  const view = buildInsight({ tasks: [task('a1')] })
  assert.equal(view.empty, false)
  assert.equal(view.totals.tasks, 1)
  assert.equal(view.statusMix.find((row) => row.key === 'ready').count, 1)
  assert.equal(view.statusMix.find((row) => row.key === 'done').pct, 0)
  assert.equal(view.kpis.length, 6)
  assert.equal(view.kpis[0].text, '1')
  assert.equal(view.kpis[1].text, '0%')
})

check('单任务（已完成）：完成率 100%，状态分布 100/0/0/0', () => {
  const view = buildInsight({ tasks: [task('a1', { done: true })] })
  assert.equal(view.kpis[1].pct, 100)
  assert.deepEqual(view.statusMix.map((row) => row.pct), [100, 0, 0, 0])
  assert.deepEqual(view.recent.done.map((row) => row.id), ['a1'])
})

/* ---------------- 状态分布 / KPI ---------------- */

const MIX = [
  task('d1', { done: true, no: 1 }),
  task('d2', { done: true, no: 2 }),
  task('r1', { no: 3 }),
  task('b1', { no: 4, blocked: true, ready: false, blockedBy: [{ id: 'x', title: '等 X' }] }),
  task('s1', { no: 5, suspended: true }),
  task('run1', { no: 6, running: true, sessionTurn: 3 }),
]

check('状态分布：四桶互斥且百分比和恰好 100', () => {
  const view = buildInsight({ tasks: MIX })
  const sum = view.statusMix.reduce((acc, row) => acc + row.count, 0)
  assert.equal(sum, view.totals.tasks, '四桶覆盖全部任务（互斥）')
  assert.equal(view.statusMix.reduce((acc, row) => acc + row.pct, 0), 100)
  assert.equal(view.statusMix.find((row) => row.key === 'done').count, 2)
  assert.equal(view.statusMix.find((row) => row.key === 'blocked').count, 1)
  assert.equal(view.statusMix.find((row) => row.key === 'suspended').count, 1)
  assert.equal(view.statusMix.find((row) => row.key === 'ready').count, 2)
  assert.deepEqual(view.statusMix.map((row) => row.key), TONES)
})

check('状态分布：显式 blocked=true 但没有 blockedBy 也算阻塞（宿主口径）', () => {
  const view = buildInsight({ tasks: [task('x1', { blocked: true, blockedBy: [] })] })
  assert.equal(view.statusMix.find((row) => row.key === 'blocked').count, 1)
})

check('KPI：六张卡（含今日完成），完成率是百分比、其余是条数，ratio 落在 [0,1]', () => {
  const view = buildInsight({ tasks: MIX })
  assert.equal(view.kpis.length, 6)
  assert.deepEqual(view.kpis.map((row) => row.id), ['total', 'done', 'blocked', 'ready', 'suspended', 'todayDone'])
  assert.equal(view.kpis[0].text, '6')
  assert.equal(view.kpis[1].text, '33%')
  assert.equal(view.kpis[2].text, '1')
  view.kpis.forEach((row) => {
    assert.ok(row.ratio >= 0 && row.ratio <= 1, `${row.id} ratio=${row.ratio}`)
    assert.ok(['brand', 'ok', 'danger', 'idle', 'warn'].includes(row.tone))
  })
})

check('running 计数走宿主字段，不靠猜', () => {
  const view = buildInsight({ tasks: MIX })
  assert.equal(view.totals.running, 1)
  assert.equal(view.runningTasks.length, 1)
  assert.equal(view.runningTasks[0].id, 'run1')
  assert.equal(view.runningTasks[0].turn, 3)
})

/* ---------------- 项目分布 Top N ---------------- */

check('项目分布：按任务数倒序', () => {
  const tasks = [
    ...Array.from({ length: 3 }, (_, i) => task(`a${i}`, { workspaceKey: 'wA', workspaceTitle: 'A' })),
    ...Array.from({ length: 5 }, (_, i) => task(`b${i}`, { workspaceKey: 'wB', workspaceTitle: 'B' })),
    task('c0', { workspaceKey: 'wC', workspaceTitle: 'C' }),
  ]
  const view = buildInsight({ tasks })
  assert.deepEqual(view.workspaces.map((row) => row.label), ['B', 'A', 'C'])
  assert.equal(view.workspaces[0].total, 5)
})

check('项目分布：12 个项目 → Top 8 + 「其他 4 个项目」，总数守恒', () => {
  const tasks = []
  for (let i = 0; i < 12; i += 1) {
    for (let k = 0; k <= i; k += 1) tasks.push(task(`t${i}-${k}`, { workspaceKey: `w${i}`, workspaceTitle: `P${i}` }))
  }
  const view = buildInsight({ tasks })
  assert.equal(view.workspaces.length, 9, 'Top8 + 其他')
  const other = view.workspaces[8]
  assert.equal(other.other, true)
  assert.ok(other.label.includes('4'), other.label)
  const sum = view.workspaces.reduce((acc, row) => acc + row.total, 0)
  assert.equal(sum, tasks.length, '裁剪后总数仍然守恒')
})

check('项目分布：8 个项目整时不出现「其他」', () => {
  const tasks = Array.from({ length: 8 }, (_, i) => task(`t${i}`, { workspaceKey: `w${i}`, workspaceTitle: `P${i}` }))
  const view = buildInsight({ tasks })
  assert.equal(view.workspaces.length, 8)
  assert.equal(view.workspaces.some((row) => row.other === true), false)
})

check('项目分布：条上叠加完成率（done/total）', () => {
  const tasks = [task('a1', { done: true }), task('a2'), task('a3'), task('a4')]
  const view = buildInsight({ tasks })
  assert.equal(view.workspaces[0].pct, 25)
  assert.equal(view.workspaces[0].ratio, 0.25)
})

/* ---------------- 关系概览 ---------------- */

check('关系概览：依赖边 / 来源边 / ghost 端点 / 最长链', () => {
  const tasks = [task('a1'), task('b1'), task('c1')]
  const relations = [
    { from: 'b1', to: 'a1', kind: 'depends_on' },
    { from: 'a1', to: 'c1', kind: 'derived_from' },
    { from: 'zz-missing', to: 'a1', kind: 'depends_on' },
  ]
  const view = buildInsight({ tasks, relations })
  assert.equal(view.relations.dependencyEdges, 2)
  assert.equal(view.relations.provenanceEdges, 1)
  assert.equal(view.relations.ghosts, 1)
  assert.equal(view.relations.maxChain, 2)
  assert.equal(view.relations.rows.length, 4)
  assert.deepEqual(view.relations.rows.map((row) => row.key), ['dep', 'prov', 'ghost', 'chain'])
})

check('关系概览：没有 ghost 时 tone 是 ok（不留红色噪音）', () => {
  const view = buildInsight({ tasks: [task('a1'), task('b1')], relations: [{ from: 'b1', to: 'a1', kind: 'depends_on' }] })
  assert.equal(view.relations.rows.find((row) => row.key === 'ghost').tone, 'ok')
})

/* ---------------- 阻塞榜 ---------------- */

check('阻塞榜：按「等几个」倒序，最多 5 条，带「等谁」', () => {
  const tasks = [
    task('one', { no: 1, blocked: true, blockedBy: [{ id: 'x', title: '等 X' }] }),
    task('three', { no: 2, blocked: true, blockedBy: [{ id: 'x', title: '等 X' }, { id: 'y', title: '等 Y' }, { id: 'z', title: '等 Z' }] }),
    ...Array.from({ length: 5 }, (_, i) => task(`b${i}`, { no: 10 + i, blocked: true, blockedBy: [{ id: `q${i}`, title: `等 Q${i}` }] })),
  ]
  const view = buildInsight({ tasks })
  assert.equal(view.blockers.length, 5, 'Top 5 截断')
  assert.equal(view.blockers[0].id, 'three', '等 3 个的排第一')
  assert.equal(view.blockers[0].count, 3)
  assert.ok(view.blockers[0].waitingText.includes('等 X'))
  assert.deepEqual(view.blockers.map((row) => row.rank), [1, 2, 3, 4, 5])
})

check('阻塞榜：「等谁」缺标题时退回任务表里的标题或 id', () => {
  const view = buildInsight({
    tasks: [task('x1', { blocked: true, blockedBy: [{ id: 'a1' }] }), task('a1', { title: '真正的标题' })],
  })
  assert.equal(view.blockers[0].waiting[0].title, '真正的标题')
})

check('阻塞榜：真正删掉的前置退回 id，不显示「undefined」', () => {
  const view = buildInsight({ tasks: [task('x1', { blocked: true, blockedBy: [{ id: 'zz-missing' }] })] })
  assert.equal(view.blockers[0].waiting[0].title, 'zz-missing')
})

/* ---------------- 最近动态 ---------------- */

const NOW = new Date('2026-11-11T10:00:00+08:00').getTime()
const MIN = 60 * 1000

check('最近动态：三列各 Top 5，按真实时间戳倒序（completedAt / startedAt / suspendedAt）', () => {
  const tasks = [
    task('d-old', { no: 1, done: true, completedAt: NOW - 3 * 60 * MIN }),
    task('d-new', { no: 2, done: true, completedAt: NOW - 5 * MIN }),
    task('d-mid', { no: 3, done: true, completedAt: NOW - 40 * MIN }),
    task('s-new', { no: 9, started: true, suspended: true, suspendedAt: NOW - 2 * MIN, startedAt: NOW - 90 * MIN }),
    task('s-old', { no: 8, started: true, suspended: true, suspendedAt: NOW - 300 * MIN, startedAt: NOW - 600 * MIN }),
  ]
  const view = buildInsight({ tasks, now: NOW })
  assert.equal(view.recent.orderBy, '完成 / 开始 / 挂起时间倒序')
  assert.deepEqual(view.recent.done.map((row) => row.id), ['d-new', 'd-mid', 'd-old'], '完成时间新的在前')
  assert.deepEqual(view.recent.suspended.map((row) => row.id), ['s-new', 's-old'], '挂起时间新的在前')
  assert.ok(view.recent.done[0].atText.includes('分钟前'), view.recent.done[0].atText)
  assert.equal(view.recent.done[0].at, NOW - 5 * MIN)
})

check('最近动态：时间戳为 0 的排最后，并标「时间未记录」（atText 为空）', () => {
  const tasks = [
    task('no-time', { no: 99, done: true }),
    task('timed', { no: 1, done: true, completedAt: NOW - MIN }),
  ]
  const view = buildInsight({ tasks, now: NOW })
  assert.deepEqual(view.recent.done.map((row) => row.id), ['timed', 'no-time'])
  assert.equal(view.recent.done[1].atText, '')
})

check('今日完成 KPI：按 completedAt 落在今天 0 点之后统计', () => {
  const tasks = [
    task('t1', { done: true, completedAt: NOW - 30 * MIN }),
    task('t2', { done: true, completedAt: NOW - 2 * 24 * 60 * MIN }),
  ]
  const view = buildInsight({ tasks, now: NOW })
  assert.equal(view.hasCompletionTime, true)
  const kpi = view.kpis.find((row) => row.id === 'todayDone')
  assert.equal(kpi.label, '今日完成')
  assert.equal(kpi.value, 1)
  assert.equal(view.todayDone, 1)
})

check('今日完成 KPI：一个完成时间都没有时退化为「已完成」并标注', () => {
  const view = buildInsight({ tasks: [task('t1', { done: true }), task('t2', { done: true })], now: NOW })
  assert.equal(view.hasCompletionTime, false)
  const kpi = view.kpis.find((row) => row.id === 'todayDone')
  assert.equal(kpi.label, '已完成')
  assert.equal(kpi.value, 2)
  assert.ok(kpi.note.includes('累计'))
})

check('formatAgo / startOfDay：相对时间与今日边界', () => {
  assert.equal(formatAgo(0), '刚刚')
  assert.equal(formatAgo(30 * 1000), '刚刚')
  assert.equal(formatAgo(5 * MIN), '5 分钟前')
  assert.equal(formatAgo(3 * 60 * MIN), '3 小时前')
  assert.equal(formatAgo(3 * 24 * 60 * MIN), '3 天前')
  const d = new Date(startOfDay(NOW))
  assert.equal(d.getHours(), 0)
})

check('最近动态：已完成的不进「最近开始」（避免同一任务两处出现）', () => {
  const view = buildInsight({ tasks: [task('a1', { done: true, started: true, completedAt: NOW - MIN, startedAt: NOW - 90 * MIN })], now: NOW })
  assert.equal(view.recent.done.length, 1)
  assert.equal(view.recent.started.length, 0)
})

/* ---------------- 规模 ---------------- */

check('大量任务（500 条 / 200 条关系）也能算，且状态和守恒', () => {
  const tasks = Array.from({ length: 500 }, (_, i) => task(`t${i}`, {
    no: i + 1,
    done: i % 3 === 0,
    blocked: i % 7 === 0 && i % 3 !== 0,
    suspended: i % 11 === 0,
    workspaceKey: `w${i % 9}`,
    workspaceTitle: `P${i % 9}`,
    running: i % 37 === 0,
  }))
  const relations = Array.from({ length: 200 }, (_, i) => ({ from: `t${i}`, to: `t${i + 1}`, kind: 'depends_on' }))
  const view = buildInsight({ tasks, relations })
  assert.equal(view.totals.tasks, 500)
  assert.equal(view.statusMix.reduce((acc, row) => acc + row.count, 0), 500)
  assert.equal(view.statusMix.reduce((acc, row) => acc + row.pct, 0), 100)
  assert.equal(view.workspaces.length, 9)
  assert.equal(view.relations.maxChain, 201)
})

/* ---------------- 收尾 ---------------- */

console.log('')
if (failed.length) {
  console.log(`insightView.mjs: ${passed} passed, ${failed.length} failed`)
  process.exitCode = 1
} else {
  console.log(`insightView.mjs: ${passed} passed, 0 failed`)
}
