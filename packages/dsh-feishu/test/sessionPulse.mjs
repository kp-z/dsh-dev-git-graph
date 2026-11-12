/**
 * 「状态对话气泡」的纯逻辑单测（node test/sessionPulse.mjs）。
 *
 * 钉住用户口径：只看状态、运行中与运行完都显示、**没有新消息自动消失**、
 * 阻塞/挂起不消失、同一条状态不重置计时。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PULSE_TTL,
  pulseForTask,
  derivePulses,
  prunePulses,
  toneColor,
  subscribeActivity,
} from '../src/client/sessionPulse.js'

let passed = 0
const failed = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed.push([name, error])
    console.log(`  FAIL ${name}`)
    console.log(`       ${error.message.split('\n')[0]}`)
  }
}

const T = (id, extra) => Object.assign({ id, sessionId: '', done: false, blocked: false, suspended: false, running: false, started: false }, extra || {})
const S = (id, extra) => Object.assign({ id, alive: true, phase: 'idle', turn: 0 }, extra || {})

/* ---------------- 状态词 ---------------- */

check('运行中：带轮次文案（只给无障碍用）+ dots 标记（画面渲染三点动画）', () => {
  assert.deepEqual(pulseForTask(T('a'), S('s', { phase: 'running', turn: 12 })), { text: '运行中 · 第 12 轮', tone: 'brand', sticky: false, dots: true })
  assert.deepEqual(pulseForTask(T('a'), S('s', { phase: 'running' })), { text: '刚开工', tone: 'brand', sticky: false, dots: true })
})

check('只有「运行中」用三点动画；终态/阻塞/挂起仍是文字', () => {
  assert.equal(pulseForTask(T('a', { done: true }), null).dots, undefined)
  assert.equal(pulseForTask(T('a', { blocked: true }), null).dots, undefined)
  assert.equal(pulseForTask(T('a', { suspended: true }), null).dots, undefined)
})

check('快照里的 running 也算在跑（活动流还没到）', () => {
  const p = pulseForTask(T('a', { running: true }), null)
  assert.equal(p.text, '刚开工')
  assert.equal(p.tone, 'brand')
  assert.equal(p.dots, true)
})

check('已完成 = 绿、不粘（运行完也要显示，然后自动消失）', () => {
  const p = pulseForTask(T('a', { done: true }), S('s', { phase: 'running', turn: 3 }))
  assert.deepEqual(p, { text: '已完成', tone: 'ok', sticky: false })
})

check('被阻塞 = 黄且 sticky（要人看，不自动消失）', () => {
  const p = pulseForTask(T('a', { blocked: true }), null)
  assert.deepEqual(p, { text: '被阻塞', tone: 'warn', sticky: true })
})

check('已挂起 = 黄且 sticky', () => {
  const p = pulseForTask(T('a', { suspended: true }), null)
  assert.deepEqual(p, { text: '已挂起', tone: 'warn', sticky: true })
})

check('优先级：终态 > 阻塞 > 运行中', () => {
  assert.equal(pulseForTask(T('a', { done: true, blocked: true, running: true }), S('s', { phase: 'running' })).text, '已完成')
  assert.equal(pulseForTask(T('a', { blocked: true, running: true }), S('s', { phase: 'running' })).text, '被阻塞')
})

check('既没在跑也没终态 → 不显示状态泡', () => {
  assert.equal(pulseForTask(T('a'), null), null)
  assert.equal(pulseForTask(T('a'), S('s', { phase: 'idle' })), null)
})

check('等待中的任务不显示状态泡（否则每个泡都挂一句，气泡墙变成列表）', () => {
  assert.equal(pulseForTask(T('a', { started: true }), S('s', { phase: 'idle' })), null)
  assert.equal(pulseForTask(T('a', { started: true }), null), null)
})

/* ---------------- 一轮结算 ---------------- */

check('derivePulses：按会话把活动流接到任务上', () => {
  const tasks = [T('t1', { sessionId: 's1', running: true }), T('t2', { sessionId: 's2', running: true })]
  const { map } = derivePulses(tasks, [S('s1', { phase: 'running', turn: 7 }), S('s2', { phase: 'running', turn: 2 })], new Map(), 1000)
  assert.equal(map.get('t1').text, '运行中 · 第 7 轮')
  assert.equal(map.get('t2').text, '运行中 · 第 2 轮')
  assert.equal(map.get('t1').at, 1000)
})

check('同一条状态不重置计时（否则永远不消失）', () => {
  const tasks = [T('t1', { sessionId: 's1', running: true })]
  const first = derivePulses(tasks, [S('s1', { phase: 'running', turn: 7 })], new Map(), 1000)
  const second = derivePulses(tasks, [S('s1', { phase: 'running', turn: 7 })], first.map, 5000)
  assert.equal(second.map.get('t1').at, 1000, '时刻应该还是第一次到达的 1000')
  assert.equal(second.echoed, 1, '这一轮是「回显」不是新消息')
})

check('文案变了 = 新消息 → 重置计时', () => {
  const tasks = [T('t1', { sessionId: 's1', running: true })]
  const first = derivePulses(tasks, [S('s1', { phase: 'running', turn: 7 })], new Map(), 1000)
  const second = derivePulses(tasks, [S('s1', { phase: 'running', turn: 8 })], first.map, 5000)
  assert.equal(second.map.get('t1').at, 5000)
  assert.equal(second.map.get('t1').text, '运行中 · 第 8 轮')
  assert.equal(second.echoed, 0)
})

/* ---------------- 自动消失 ---------------- */

check('无新消息 → 到点消失（默认 8 秒）', () => {
  const tasks = [T('t1', { sessionId: 's1', running: true })]
  const { map } = derivePulses(tasks, [S('s1', { phase: 'running', turn: 1 })], new Map(), 0)
  assert.equal(prunePulses(map, PULSE_TTL - 1).size, 1, '还没到点要留着')
  assert.equal(prunePulses(map, PULSE_TTL).size, 0, '到点消失')
})

check('有待确认的姿态（阻塞/挂起）不消失', () => {
  const tasks = [T('t1', { blocked: true }), T('t2', { suspended: true })]
  const { map } = derivePulses(tasks, [], new Map(), 0)
  const later = prunePulses(map, 24 * 3600 * 1000)
  assert.equal(later.size, 2, 'sticky 必须留存')
})

check('已完成到点也会消失（运行完也要显示，但不需要一直占位）', () => {
  const tasks = [T('t1', { done: true })]
  const { map } = derivePulses(tasks, [], new Map(), 0)
  assert.equal(prunePulses(map, PULSE_TTL).size, 0)
})

check('任务从列表里消失时，状态泡跟着消失', () => {
  const withTask = derivePulses([T('t1', { blocked: true })], [], new Map(), 0)
  const without = derivePulses([], [], withTask.map, 1000)
  assert.equal(without.map.size, 0)
})

check('坏数据不崩：null / 字符串 / 缺 id', () => {
  for (const bad of [null, 'x', 42, {}, [null, 1, {}]]) {
    const r = derivePulses(bad, bad, null, 0)
    assert.equal(r.map.size, 0)
  }
  assert.equal(prunePulses(null, 0).size, 0)
  assert.equal(pulseForTask(null, null), null)
})

/* ---------------- 颜色与订阅 ---------------- */

check('状态色：运行蓝 / 完成绿 / 待处理黄，未知回落蓝', () => {
  assert.equal(toneColor('brand'), '#3b82f6')
  assert.equal(toneColor('ok'), '#22c55e')
  assert.equal(toneColor('warn'), '#f59e0b')
  assert.equal(toneColor('什么鬼'), '#3b82f6')
})

check('没有 EventSource 的环境（单测/老宿主）订阅返回 null，不抛', () => {
  assert.equal(subscribeActivity('/dsh-feishu/api/sessions/activity', {}), null)
})

check('订阅：收到 activity 事件就回调 sessions，退订会 close', () => {
  const listeners = {}
  let closed = false
  class FakeES {
    constructor(url) { this.url = url }
    addEventListener(name, fn) { listeners[name] = fn }
    close() { closed = true }
  }
  const origin = globalThis.EventSource
  globalThis.EventSource = FakeES
  try {
    let got = null
    const off = subscribeActivity('/x', { onSessions: (rows) => { got = rows } })
    assert.ok(typeof off === 'function')
    listeners.activity({ data: JSON.stringify({ sessions: [{ id: 's1', phase: 'running', turn: 4 }] }) })
    assert.deepEqual(got, [{ id: 's1', phase: 'running', turn: 4 }])
    listeners.activity({ data: '不是 JSON' })
    assert.deepEqual(got, [{ id: 's1', phase: 'running', turn: 4 }], '坏帧不该覆盖上一次的好数据')
    off()
    assert.equal(closed, true, '退订必须 close')
  } finally {
    if (origin === undefined) delete globalThis.EventSource
    else globalThis.EventSource = origin
  }
})

/* ---------------- 客户端↔宿主的接线契约 ---------------- */

check('客户端订阅的就是宿主注册的那条 SSE 路由（改名/改路径必须两边一起改）', () => {
  const client = readFileSync(new URL('../src/client/RunsFeature.js', import.meta.url), 'utf8')
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const used = client.match(/subscribeActivity\('([^']+)'/)
  assert.ok(used, '客户端应该显式写出订阅地址')
  const path = used[1]
  /* 客户端写的是对外路径（/dsh-feishu/...），宿主内部注册的是去掉插件前缀的那一段
     （前缀由宿主的插件路由层负责），所以比对时要把 /dsh-feishu 去掉。 */
  const hostPath = path.replace(/^\/dsh-feishu/, '')
  assert.ok(host.includes(`route === '${hostPath}'`), `宿主没有注册 ${hostPath}（对外 ${path}）：气泡的状态会永远不更新`)
  assert.ok(host.includes('activityFeed.open'), '这条路由必须交给 activityFeed 处理')
})

check('客户端读的就是宿主推的字段（phase / turn）', () => {
  const pulse = readFileSync(new URL('../src/client/sessionPulse.js', import.meta.url), 'utf8')
  const feed = readFileSync(new URL('../activity.js', import.meta.url), 'utf8')
  /* 宿主 activity.js 的 packet 是 { generation, revision, sessions }，每项 { id, alive, phase, turn, unread } */
  assert.ok(feed.includes('revison') === false && feed.includes('revision'), '宿主帧里应有 revision')
  assert.ok(pulse.includes("f.phase") && pulse.includes('f.turn'), '客户端要读 phase 与 turn')
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.ok(host.includes("return { id, alive: true, phase: item.kind, turn: item.turn"), '宿主的 sessions 项形状变了')
})

console.log(`\nsessionPulse.mjs: ${passed} passed, ${failed.length} failed`)
if (failed.length) process.exitCode = 1
