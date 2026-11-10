/**
 * 运行页纯函数的离线单测（node test/runsView.mjs）。
 *
 * 钉住：**状态优先级**（suspended → blocked → running → started → done → idle）、
 * 分组顺序与计数、时长排序与文本、会话活跃度分档、需要人看一眼的两类告警、
 * 空/坏数据不崩、今日完成的时间边界。
 */

import assert from 'node:assert/strict'
import {
  buildRuns,
  stateOfTask,
  formatDuration,
  turnBucket,
  startOfDay,
  STATE_ORDER,
  STATE_META,
  GROUP_ORDER,
  TURN_BUCKETS,
} from '../src/client/runsView.js'

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

const NOW = new Date('2026-11-11T10:00:00+08:00').getTime()
const HOUR = 3600 * 1000

const task = (id, extra) => Object.assign({
  id,
  no: 1,
  title: `任务 ${id}`,
  done: false,
  workspaceKey: 'wA',
  workspaceTitle: '项目A',
  workspacePath: '/x/wA',
  blocked: false,
  ready: true,
  started: false,
  suspended: false,
  sessionId: `s-${id}`,
  running: false,
  sessionTurn: 0,
  createdAt: 0,
  startedAt: 0,
  completedAt: 0,
  suspendedAt: 0,
  predecessors: [],
  successors: [],
  sourceTasks: [],
  derivedTasks: [],
  blockedBy: [],
}, extra || {})

/* ---------------- 状态优先级 ---------------- */

check('STATE_ORDER 就是口径顺序（改口径只动这张表）', () => {
  assert.deepEqual(STATE_ORDER, ['suspended', 'blocked', 'running', 'started', 'done'])
  assert.deepEqual(GROUP_ORDER, ['running', 'started', 'blocked', 'suspended', 'done', 'idle'])
})

check('优先级：全开时挂起赢', () => {
  assert.equal(stateOfTask({ suspended: true, blocked: true, blockedBy: [{}], running: true, started: true, done: true }), 'suspended')
})

check('优先级：去掉挂起后阻塞赢（显式 blocked 或 blockedBy 非空都算）', () => {
  assert.equal(stateOfTask({ blocked: true, running: true, started: true }), 'blocked')
  assert.equal(stateOfTask({ blockedBy: [{ id: 'x' }], running: true }), 'blocked')
})

check('优先级：去掉阻塞后运行中赢（哪怕已完成也先按运行中）', () => {
  assert.equal(stateOfTask({ running: true, started: true, done: true }), 'running')
})

check('优先级：started 在 done 之前（口径顺序，别自己改）', () => {
  assert.equal(stateOfTask({ started: true, done: true }), 'started')
  assert.equal(stateOfTask({ done: true }), 'done')
})

check('优先级：什么都没有 → 未开始', () => {
  assert.equal(stateOfTask({}), 'idle')
  assert.equal(stateOfTask(null), 'idle')
})

check('每个状态都有元信息（label/tone/breathing/dashed），运行中才会呼吸', () => {
  for (const key of [...STATE_ORDER, 'idle']) {
    const meta = STATE_META[key]
    assert.ok(meta, `缺 ${key}`)
    assert.ok(meta.label && meta.tone, `${key} 缺 label/tone`)
    assert.equal(meta.breathing, key === 'running', `${key} 的呼吸标记不对`)
  }
  assert.equal(STATE_META.idle.dashed, true)
  assert.equal(STATE_META.done.tone, 'success')
  assert.equal(STATE_META.done.breathing, false, '已完成是静态绿色，不呼吸')
})

/* ---------------- 时长 / 分档 ---------------- */

check('formatDuration：秒/分/小时/天，0 与负数给 —', () => {
  assert.equal(formatDuration(0), '—')
  assert.equal(formatDuration(-5), '—')
  assert.equal(formatDuration(45 * 1000), '45 秒')
  assert.equal(formatDuration(80 * 1000), '1 分')
  assert.equal(formatDuration(45 * 60 * 1000), '45 分')
  assert.equal(formatDuration(HOUR), '1 小时')
  assert.equal(formatDuration(HOUR + 12 * 60 * 1000), '1 小时 12 分')
  assert.equal(formatDuration(26 * HOUR), '1 天 2 小时')
  assert.equal(formatDuration(48 * HOUR), '2 天')
})

check('turnBucket：0 / 1-2 / 3-9 / 10+ 四档边界', () => {
  assert.equal(turnBucket(0), 'none')
  assert.equal(turnBucket(1), 'low')
  assert.equal(turnBucket(2), 'low')
  assert.equal(turnBucket(3), 'mid')
  assert.equal(turnBucket(9), 'mid')
  assert.equal(turnBucket(10), 'high')
  assert.equal(turnBucket(999), 'high')
  assert.equal(TURN_BUCKETS.length, 4)
})

check('startOfDay 用本地时区取 0 点', () => {
  const d = new Date(startOfDay(NOW))
  assert.equal(d.getHours(), 0)
  assert.equal(d.getMinutes(), 0)
  assert.ok(startOfDay(NOW) <= NOW)
})

/* ---------------- 空 / 坏数据 ---------------- */

check('空数据：empty=true、没有分组、四个概览卡全 0，不抛', () => {
  const view = buildRuns({ tasks: [], now: NOW })
  assert.equal(view.empty, true)
  assert.deepEqual(view.groups, [])
  assert.equal(view.bubbles.length, 0)
  assert.equal(view.overview.length, 4)
  assert.deepEqual(view.overview.map((row) => row.value), [0, 0, 0, 0])
  assert.equal(view.activity.length, 4)
  assert.deepEqual(view.longest, [])
  assert.deepEqual(view.alerts, [])
})

check('坏数据：null / 字符串 / 数组里混垃圾都不崩', () => {
  for (const bad of [null, undefined, 'x', 42, [], { tasks: 'no' }, { tasks: [null, 1, {}, []] }]) {
    const view = buildRuns(bad)
    assert.equal(typeof view.empty, 'boolean')
    assert.equal(Array.isArray(view.groups), true)
    assert.equal(view.overview.length, 4)
  }
})

check('坏任务行：缺 id 的丢掉', () => {
  const view = buildRuns({ tasks: [{ title: '没有 id' }, task('a1')], now: NOW })
  assert.equal(view.total, 1)
})

/* ---------------- 分组 ---------------- */

const MIX = [
  task('run1', { no: 1, running: true, started: true, startedAt: NOW - 3 * HOUR, sessionTurn: 12 }),
  task('run2', { no: 2, running: true, started: true, startedAt: NOW - 30 * 60 * 1000, sessionTurn: 4 }),
  task('wait1', { no: 3, started: true, startedAt: NOW - 2 * HOUR, sessionTurn: 2 }),
  task('block1', { no: 4, blocked: true, ready: false, blockedBy: [{ id: 'run1', title: '任务 run1', done: false }] }),
  task('stop1', { no: 5, suspended: true, suspendedAt: NOW - HOUR, sessionTurn: 1 }),
  task('done1', { no: 6, done: true, completedAt: NOW - 2 * HOUR, sessionId: '' }),
  task('idle1', { no: 7, sessionId: '' }),
]

check('分组：按 GROUP_ORDER 排，空组不出现，计数对', () => {
  const view = buildRuns({ tasks: MIX, now: NOW })
  assert.deepEqual(view.groups.map((group) => group.key), ['running', 'started', 'blocked', 'suspended', 'done', 'idle'])
  assert.deepEqual(view.groups.map((group) => group.count), [2, 1, 1, 1, 1, 1])
  assert.equal(view.groups.reduce((sum, group) => sum + group.count, 0), MIX.length, '每个任务恰好进一个组')
  assert.equal(view.groups[0].label, '运行中')
  assert.equal(view.groups[0].breathing, true, '运行中的组要呼吸')
})

check('分组：没有某状态时该组整组不出现', () => {
  const view = buildRuns({ tasks: [task('a1', { running: true })], now: NOW })
  assert.deepEqual(view.groups.map((group) => group.key), ['running'])
})

check('气泡字段：编号/标题/项目/状态/是否呼吸/会话可用性/时长', () => {
  const view = buildRuns({ tasks: MIX, now: NOW })
  const run1 = view.bubbles.find((bubble) => bubble.id === 'run1')
  assert.equal(run1.no, 1)
  assert.equal(run1.title, '任务 run1')
  assert.equal(run1.workspaceTitle, '项目A')
  assert.equal(run1.state, 'running')
  assert.equal(run1.tone, 'success')
  assert.equal(run1.breathing, true)
  assert.equal(run1.canOpenSession, true)
  assert.equal(run1.elapsed, 3 * HOUR)
  assert.equal(run1.elapsedText, '3 小时')
  const idle1 = view.bubbles.find((bubble) => bubble.id === 'idle1')
  assert.equal(idle1.canOpenSession, false, '没有 sessionId → 跳会话按钮要 disabled')
  assert.equal(idle1.dashed, true)
})

/* ---------------- 概览 / 活跃度 ---------------- */

check('运行概览四卡：运行中 / 等待 / 挂起 / 今日完成', () => {
  const view = buildRuns({ tasks: MIX, now: NOW })
  assert.deepEqual(view.overview.map((row) => row.key), ['running', 'started', 'suspended', 'todayDone'])
  assert.deepEqual(view.overview.map((row) => row.value), [2, 1, 1, 1])
  assert.equal(view.overview[0].breathing, true)
})

check('今日完成：只有完成时间落在今天 0 点之后才算', () => {
  const tasks = [
    task('d1', { done: true, completedAt: NOW - HOUR }),
    task('d2', { done: true, completedAt: NOW - 2 * 24 * HOUR }),
  ]
  const view = buildRuns({ tasks, now: NOW })
  assert.equal(view.todayDone, 1)
  assert.equal(view.hasCompletionTime, true)
  assert.equal(view.overview[3].label, '今日完成')
  assert.equal(view.overview[3].value, 1)
})

check('今日完成：一个完成时间都没有时退化为「累计已完成」并改标题', () => {
  const view = buildRuns({ tasks: [task('d1', { done: true }), task('d2', { done: true })], now: NOW })
  assert.equal(view.hasCompletionTime, false)
  assert.equal(view.overview[3].label, '已完成')
  assert.equal(view.overview[3].value, 2)
})

check('会话活跃度：只统计已绑会话，四档计数与占比守恒', () => {
  const view = buildRuns({ tasks: MIX, now: NOW })
  assert.equal(view.boundSessions, 5, 'MIX 里 done1/idle1 没有 sessionId（7 条里 5 条已绑会话）')
  assert.deepEqual(view.activity.map((row) => row.count), [1, 2, 1, 1], '未开始 1 / 1-2 轮 2 / 3-9 轮 1 / 10+ 轮 1')
  const sum = view.activity.reduce((acc, row) => acc + row.count, 0)
  assert.equal(sum, view.boundSessions)
  assert.ok(view.activity.every((row) => row.ratio >= 0 && row.ratio <= 1))
})

/* ---------------- 时长 Top5 ---------------- */

check('运行时长 Top5：按 startedAt 越早越靠前，已完成不进榜，没时间戳的垫底', () => {
  const view = buildRuns({ tasks: MIX, now: NOW })
  const timedIds = view.longest.filter((bubble) => !bubble.untimed).map((bubble) => bubble.id)
  assert.deepEqual(timedIds, ['run1', 'wait1', 'run2'], '有开始时间的按降序')
  assert.equal(view.longest[0].elapsedText, '3 小时')
  assert.equal(view.longest.every((bubble) => bubble.state !== 'done'), true)
  const tail = view.longest.filter((bubble) => bubble.untimed)
  assert.equal(tail.every((bubble) => bubble.elapsedText === '未记录开始时间'), true, '没时间戳的排在最后并标注')
})

check('运行时长：没 startedAt 的排在最后，标「未记录开始时间」（不猜轮次）', () => {
  const tasks = [
    task('timed', { started: true, startedAt: NOW - HOUR }),
    task('untimed', { started: true, sessionTurn: 40 }),
  ]
  const view = buildRuns({ tasks, now: NOW })
  assert.deepEqual(view.longest.map((bubble) => bubble.id), ['timed', 'untimed'])
  assert.equal(view.longest[1].untimed, true)
  assert.equal(view.longest[1].elapsedText, '未记录开始时间')
  assert.equal(view.longestUntimed, 1)
})

check('运行时长 Top5：超过 5 个只取 5 个，且严格按降序', () => {
  const tasks = Array.from({ length: 8 }, (_, i) => task(`t${i}`, { no: i + 1, running: true, startedAt: NOW - (i + 1) * HOUR }))
  const view = buildRuns({ tasks, now: NOW })
  assert.equal(view.longest.length, 5)
  assert.deepEqual(view.longest.map((bubble) => bubble.id), ['t7', 't6', 't5', 't4', 't3'])
  for (let i = 1; i < view.longest.length; i += 1) {
    assert.ok(view.longest[i - 1].elapsed >= view.longest[i].elapsed, '必须降序')
  }
})

/* ---------------- 需要人看一眼 ---------------- */

check('需要人看一眼：挂起中的列出来并带原因/时长', () => {
  const view = buildRuns({ tasks: MIX, now: NOW })
  const row = view.alerts.find((alert) => alert.id === 'stop1')
  assert.ok(row)
  assert.equal(row.reason, 'suspended')
  assert.equal(row.reasonText, '挂起中')
  assert.ok(row.detail.includes('挂起于'), row.detail)
})

check('需要人看一眼：被阻塞但前置其实都完成了 → 关系数据可能过期', () => {
  const tasks = [
    task('b1', { blocked: true, blockedBy: [{ id: 'p1', title: '前置 P1', done: true }] }),
    task('p1', { done: true }),
  ]
  const view = buildRuns({ tasks, now: NOW })
  const row = view.alerts.find((alert) => alert.id === 'b1')
  assert.ok(row, '应该被列出来')
  assert.equal(row.reason, 'stale-block')
  assert.equal(row.reasonText, '前置都已完成')
  assert.ok(row.detail.includes('前置 P1'))
})

check('需要人看一眼：正常阻塞（前置没完成）不误报', () => {
  const view = buildRuns({ tasks: MIX, now: NOW })
  assert.equal(view.alerts.some((alert) => alert.id === 'block1'), false)
})

check('需要人看一眼：最多 8 条', () => {
  const tasks = Array.from({ length: 12 }, (_, i) => task(`s${i}`, { no: i + 1, suspended: true, suspendedAt: NOW - i * 1000 }))
  const view = buildRuns({ tasks, now: NOW })
  assert.equal(view.alerts.length, 8)
})

/* ---------------- 规模 ---------------- */

check('大量任务（400 条）也稳：分组计数守恒、Top5 不越界', () => {
  const tasks = Array.from({ length: 400 }, (_, i) => task(`t${i}`, {
    no: i + 1,
    running: i % 9 === 0,
    started: i % 3 === 0,
    blocked: i % 7 === 0 && i % 3 !== 0,
    suspended: i % 11 === 0,
    done: i % 5 === 0,
    sessionId: i % 4 === 0 ? `s-${i}` : '',
    sessionTurn: i % 13,
    startedAt: i % 3 === 0 ? NOW - (i + 1) * 60 * 1000 : 0,
    completedAt: i % 5 === 0 ? NOW - HOUR : 0,
  }))
  const view = buildRuns({ tasks, now: NOW })
  assert.equal(view.total, 400)
  assert.equal(view.groups.reduce((sum, group) => sum + group.count, 0), 400)
  assert.equal(view.longest.length, 5)
  assert.ok(view.alerts.length <= 8)
})

/* ---------------- 收尾 ---------------- */

    /* ---- 运行起点：优先用宿主观察到的 runningSince，其次任务开工时间 ---- */
check('时长优先用 runningSince（观察到在跑），并标出用的是什么起点', () => {
  const view = buildRuns({
    now: 1_000_000,
    tasks: [
      { id: 'a', no: 1, title: 'A', running: true, started: true, runningSince: 400_000, startedAt: 100_000 },
      { id: 'b', no: 2, title: 'B', running: true, started: true, runningSince: 0, startedAt: 700_000 },
      { id: 'c', no: 3, title: 'C', running: true, started: true, runningSince: 0, startedAt: 0 },
    ],
  })
  const byId = Object.fromEntries(view.bubbles.map((bubble) => [bubble.id, bubble]))
  assert.equal(byId.a.startSource, 'observed')
  assert.equal(byId.a.elapsed, 600_000, '观察到运行起 400s → 已跑 600s')
  assert.equal(byId.a.elapsedText, formatDuration(600_000))
  assert.equal(byId.b.startSource, 'task')
  assert.equal(byId.b.elapsed, 300_000, '没有 runningSince 时退回 startedAt')
  assert.equal(byId.c.startSource, 'none')
  assert.equal(byId.c.elapsed, 0)
  /* Top5：有起点的按最久排前，没起点的排最后并标明 */
  assert.deepEqual(view.longest.map((row) => row.id), ['a', 'b', 'c'])
  assert.equal(view.longest[2].untimed, true)
  assert.equal(view.longest[2].elapsedText, '未记录开始时间')
})

check('已完成的任务不参与时长（不给完成的任务算「跑了多久」）', () => {
  const view = buildRuns({
    now: 1_000_000,
    tasks: [{ id: 'd', no: 9, title: 'D', done: true, runningSince: 100_000, startedAt: 100_000 }],
  })
  assert.equal(view.bubbles[0].elapsed, 0)
  assert.equal(view.longest.length, 0)
})

console.log('')
if (failed.length) {
  console.log(`runsView.mjs: ${passed} passed, ${failed.length} failed`)
  process.exitCode = 1
} else {
  console.log(`runsView.mjs: ${passed} passed, 0 failed`)
}
