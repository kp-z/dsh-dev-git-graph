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
  formatAgo,
  turnBucket,
  startOfDay,
  STATE_ORDER,
  STATE_META,
  GROUP_ORDER,
  KPI_KEYS,
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

check('STATE_ORDER 就是口径顺序（改口径只动这张表），分组里没有 done', () => {
  assert.deepEqual(STATE_ORDER, ['suspended', 'blocked', 'running', 'started', 'done'])
  /* 挂起任务已不上运行页，所以分组里没有 suspended */
  assert.deepEqual(GROUP_ORDER, ['running', 'started', 'blocked', 'idle'])
  assert.equal(GROUP_ORDER.includes('done'), false, '已完成不上运行页')
  assert.deepEqual(KPI_KEYS, ['running', 'started', 'blocked', 'sessions'])
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

check('空数据：empty=true、没有分组、四张 KPI 全 0，不抛', () => {
  const view = buildRuns({ tasks: [], now: NOW })
  assert.equal(view.empty, true)
  assert.deepEqual(view.groups, [])
  assert.equal(view.bubbles.length, 0)
  assert.equal(view.overview.length, 4)
  assert.deepEqual(view.overview.map((row) => row.value), [0, 0, 0, 0])
  assert.deepEqual(view.overview.map((row) => row.ratio), [0, 0, 0, 0])
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

check('分组：按 GROUP_ORDER 排，空组不出现，已完成整组不出现', () => {
  const view = buildRuns({ tasks: MIX, now: NOW })
  assert.deepEqual(view.groups.map((group) => group.key), ['running', 'started', 'blocked', 'idle'])
  assert.deepEqual(view.groups.map((group) => group.count), [2, 1, 1, 1])
  assert.equal(view.skippedDone, 1, 'MIX 里那条已完成被入口过滤掉')
  assert.equal(view.skippedSuspended, 1, 'MIX 里那条挂起也不再上页')
  assert.equal(view.groups.reduce((sum, group) => sum + group.count, 0), view.total, '每个未完成任务恰好进一个组')
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

/* ---------------- 刚做完（只上气泡墙） ---------------- */

check('刚做完：窗口内进 justDone（气泡墙），但 KPI/分组/历史/时长都不含它', () => {
  const tasks = [
    task('d1', { no: 1, done: true, completedAt: NOW - 5 * 1000 }),
    task('d2', { no: 2, done: true, completedAt: NOW - 10 * 60 * 1000 }),
    task('live', { no: 3, running: true, startedAt: NOW - HOUR }),
  ]
  const view = buildRuns({ tasks, now: NOW, recentDoneMs: 25 * 1000 })
  assert.deepEqual(view.justDone.map((b) => b.id), ['d1'], '只有 25 秒内完成的进墙')
  assert.equal(view.justDone[0].state, 'done')
  assert.equal(view.bubbles.length, 1, '未完成气泡仍只有 live 一条')
  assert.equal(view.total, 1, '分母不含刚做完的')
  assert.equal(view.overview.every((row) => row.total === 1), true)
  assert.deepEqual(view.groups.map((g) => g.key), ['running'])
  assert.equal(view.history.some((row) => row.id === 'd1'), false, '历史里不该出现')
  assert.equal(view.longest.some((row) => row.id === 'd1'), false, '时长榜里不该出现')
})

check('刚做完：即便还带着 running 标记也显示成「已完成」（不许出现蓝泡+已完成的自相矛盾）', () => {
  const tasks = [task('r9', { done: true, completedAt: NOW - 3000, running: true, started: true })]
  const view = buildRuns({ tasks, now: NOW, recentDoneMs: 25 * 1000 })
  assert.equal(view.justDone.length, 1)
  assert.equal(view.justDone[0].state, 'done')
  assert.equal(view.justDone[0].label, '已完成')
  assert.equal(view.justDone[0].breathing, false)
})

check('刚做完：不给窗口（recentDoneMs=0）时行为与旧版一致（完全不上墙）', () => {
  const tasks = [task('d1', { done: true, completedAt: NOW - 1000 })]
  const view = buildRuns({ tasks, now: NOW })
  assert.deepEqual(view.justDone, [])
  assert.equal(view.total, 0)
})

check('刚做完：没有 completedAt 的完成态不进墙（不猜完成时刻）', () => {
  const tasks = [task('d1', { done: true, completedAt: 0 })]
  const view = buildRuns({ tasks, now: NOW, recentDoneMs: 60 * 1000 })
  assert.deepEqual(view.justDone, [])
})

/* ---------------- 项目合并（旭日图的数据） ---------------- */

check('项目合并：自定义目录把多个 workspace 合成一个项目（与总览/关系同一套规则）', () => {
  const tasks = [
    task('p1', { workspaceKey: 'wk-a', workspaceTitle: 'A', running: true }),
    task('p2', { workspaceKey: 'wk-b', workspaceTitle: 'B', blocked: true }),
    task('p3', { workspaceKey: 'wk-c', workspaceTitle: 'C' }),
    task('p4', { workspaceKey: '', workspaceTitle: '' }),
  ]
  const view = buildRuns({
    tasks, now: NOW,
    groups: [{ id: 'g1', name: 'QV', members: ['wk-a', 'wk-b'] }],
    workspaces: [{ key: 'wk-a', label: 'A' }, { key: 'wk-b', label: 'B' }, { key: 'wk-c', label: 'C' }],
  })
  assert.deepEqual(view.projects.map((p) => [p.label, p.count, p.merged]), [['QV', 2, 2], ['C', 1, 1], ['未归属项目', 1, 1]])
  const qv = view.projects[0]
  assert.deepEqual(qv.states, { running: 1, started: 0, blocked: 1, suspended: 0, idle: 0 }, '外圈的状态拆分')
  assert.equal(qv.key, 'group:g1', '合并后的 key 用目录 id')
})

check('项目合并：一个 workspace 只属于一个目录（先到先得），没进目录的落未分组', () => {
  const tasks = [task('x', { workspaceKey: 'wk-a', workspaceTitle: 'A' })]
  const view = buildRuns({
    tasks, now: NOW,
    groups: [{ id: 'g1', name: '第一', members: ['wk-a'] }, { id: 'g2', name: '第二', members: ['wk-a'] }],
    workspaces: [{ key: 'wk-a', label: 'A' }],
  })
  assert.deepEqual(view.projects.map((p) => p.label), ['第一'])
})

check('项目合并：没有自定义目录时按 workspace 各自算', () => {
  const tasks = [task('x', { workspaceKey: 'wk-a', workspaceTitle: 'A' }), task('y', { workspaceKey: 'wk-b', workspaceTitle: 'B' })]
  const view = buildRuns({ tasks, now: NOW, workspaces: [{ key: 'wk-a', label: 'A' }, { key: 'wk-b', label: 'B' }] })
  assert.deepEqual(view.projects.map((p) => p.label), ['A', 'B'])
})

/* ---------------- 概览 / 活跃度 ---------------- */

check('KPI 四卡：运行中 / 等待中 / 阻塞 / 已绑会话，分母是未完成任务数', () => {
  const view = buildRuns({ tasks: MIX, now: NOW })
  assert.deepEqual(view.overview.map((row) => row.key), ['running', 'started', 'blocked', 'sessions'])
  assert.deepEqual(view.overview.map((row) => row.value), [2, 1, 1, 4])
  assert.equal(view.overview.every((row) => row.total === 5), true, '分母 = 未完成 5 条（done 与 suspended 都不算）')
  assert.equal(view.overview[0].pct, 40)
  assert.equal(view.overview[0].breathing, true)
  assert.equal(view.overview[3].pct, 80, '已绑会话 4/5')
  assert.ok(view.overview.every((row) => row.ratio >= 0 && row.ratio <= 1))
  assert.ok(view.overview.every((row) => row.eyebrow && row.eyebrow === row.eyebrow.toUpperCase()))
})

check('已完成的任务：入口过滤，KPI 分母 / 气泡 / 历史 / 时长 / 告警全都没有它', () => {
  const tasks = [
    task('d1', { done: true, completedAt: NOW - HOUR, startedAt: NOW - 5 * HOUR, sessionId: 's-d1', running: true }),
    task('d2', { done: true, completedAt: NOW - 2 * 24 * HOUR, suspended: true }),
    task('live', { running: true, startedAt: NOW - HOUR }),
  ]
  const view = buildRuns({ tasks, now: NOW })
  assert.equal(view.total, 1, '只剩未完成的 1 条')
  assert.equal(view.skippedDone, 2)
  const text = JSON.stringify(view)
  assert.equal(text.includes('"d1"'), false, '气泡/历史/告警里都不许出现 d1')
  assert.equal(text.includes('"d2"'), false, 'd2 也一样')
  assert.equal(view.bubbles.length, 1)
  assert.equal(view.history.length, 1)
  assert.deepEqual(view.longest.map((row) => row.id), ['live'])
  assert.deepEqual(view.alerts, [])
  assert.equal(view.overview.every((row) => row.total === 1), true, 'KPI 分母不含 done')
  assert.equal(view.overview[1].value, 0, 'd2 明明是 suspended，但已完成 → 不进等待/挂起')
})

check('全是已完成 → 运pages 空态（empty=true），不会假装有数据', () => {
  const view = buildRuns({ tasks: [task('d1', { done: true }), task('d2', { done: true })], now: NOW })
  assert.equal(view.empty, true)
  assert.equal(view.total, 0)
  assert.equal(view.skippedDone, 2)
  assert.deepEqual(view.bubbles, [])
  assert.deepEqual(view.history, [])
  assert.deepEqual(view.groups, [])
  assert.equal(view.overview.every((row) => row.value === 0), true)
})

check('会话活跃度：只统计已绑会话，四档计数与占比守恒', () => {
  const view = buildRuns({ tasks: MIX, now: NOW })
  assert.equal(view.boundSessions, 4, 'MIX 过滤掉 done1/stop1 后剩 5 条，其中 idle1 没有 sessionId')
  assert.deepEqual(view.activity.map((row) => row.count), [1, 1, 1, 1], '四档各 1（stop1 被过滤后剩 4 条已绑会话）')
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
  const tasks = Array.from({ length: 12 }, (_, i) => task(`s${i}`, { no: i + 1, blocked: true, blockedBy: [{ id: 'x', title: 'x', done: true }], startedAt: NOW - i * 1000 }))
  const view = buildRuns({ tasks, now: NOW })
  assert.equal(view.alerts.length, 8)
})

/* ---------------- 规模 ---------------- */

check('执行历史列表：按最近活跃倒序，带 编号 / 相对时间 / 状态', () => {
  const tasks = [
    task('old', { no: 3, started: true, startedAt: NOW - 6 * HOUR }),
    task('newest', { no: 2, running: true, startedAt: NOW - 5 * 60 * 1000 }),
    task('sus', { no: 1, suspended: true, suspendedAt: NOW - 30 * 60 * 1000 }),
    task('none', { no: 9, sessionId: '' }),
  ]
  const view = buildRuns({ tasks, now: NOW })
  /* 挂起任务（sus）已不上运行页，历史里也不出现 */
  assert.deepEqual(view.history.map((row) => row.id), ['newest', 'old', 'none'])
  assert.equal(view.history[0].agoText, '5 分钟前')
  assert.equal(view.history[1].agoText, '6 小时前')
  assert.equal(view.history[2].agoText, '时间未记录')
  assert.equal(view.history[0].noText, '#2')
  assert.equal(view.history[0].tone, 'success')
  assert.equal(view.history[0].breathing, true)
  assert.equal(view.history[2].canOpenSession, false)
})

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
  assert.equal(view.total, 291, '400 条里 80 条已完成 + 29 条挂起被入口过滤')
  assert.equal(view.skippedDone, 80)
  assert.equal(view.groups.reduce((sum, group) => sum + group.count, 0), view.total)
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
  assert.equal(view.bubbles.length, 0, '已完成的任务入口就被滤掉，气泡里没有它')
  assert.equal(view.history.length, 0)
  assert.equal(view.longest.length, 0)
  assert.equal(view.skippedDone, 1)
  assert.equal(view.empty, true)
})

console.log('')
if (failed.length) {
  console.log(`runsView.mjs: ${passed} passed, ${failed.length} failed`)
  process.exitCode = 1
} else {
  console.log(`runsView.mjs: ${passed} passed, 0 failed`)
}
