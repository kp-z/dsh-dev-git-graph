/**
 * R67：**"派不出去"的原因必须能被面板看到**。
 *
 * ## 为什么单独立一个文件
 *
 * `claimTasks()` 一直在算 `stalled`（`{taskId, reason, detail}`），但 R67 之前**它没有出口**——
 * 算完就丢。后果是真机上"3 张单挂着、3 个人不动"，而界面只说「待办」，
 * 用户完全不知道为什么。这个文件守的就是那个出口。
 *
 * ## 测试怎么构造"卡住"
 *
 * 不靠运气（真机那一局恰好有卡住的单，但新开一局可能没有）。这里**主动**造出两种卡法：
 * · `no-worker`：把所有角色都弄成"忙"（`state !== 'idle'` 或 `carrying !== null`）；
 * · `no-station`：把任务要求的能力换成没有任何站点提供的能力。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { createRuntime } from '../lib/runtime/index.js'
import { createPluginState } from '../lib/state.js'
import { STALLED_DIAGNOSTIC_CAP } from '../lib/protocol/index.js'

function makeRuntime(taskSet = 'task.town-inspection') {
  const service = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }))
  service.ensureWorld()
  service.dispatch(taskSet)
  const runtime = createRuntime({ service, tickMs: 100 })
  return { service, runtime }
}

test('R67：没有空闲角色时，stalled 会报出 no-worker（而不是静默不动）', () => {
  const { service, runtime } = makeRuntime()
  const world = service.currentWorld()
  assert.ok(world, '应当有世界')

  // 把所有角色都弄成"忙"——这是"没人接单"的直接原因。
  for (const agent of world.agents) agent.carrying = 'task-fake'

  runtime.advance(3)

  const stalled = runtime.diagnostics.stalled
  assert.ok(stalled.length > 0, '全员都忙时应当有"派不出去"的记录（否则面板无从解释为什么不动）')
  const reasons = new Set(stalled.map((s) => s.reason))
  assert.ok(reasons.has('no-worker'), `应当报 no-worker，实际 ${[...reasons].join('/')}`)
  // detail 是给人看的，不能是空串——面板要直接显示它。
  for (const s of stalled) {
    assert.equal(typeof s.taskId, 'string')
    assert.ok(s.taskId.length > 0)
    assert.ok(s.detail.length > 0, `${s.taskId} 的 detail 不能为空`)
  }
})

test('R67：没有能承载该能力的工位时，stalled 会报出 no-station', () => {
  const { service, runtime } = makeRuntime()
  const world = service.currentWorld()

  // 把一张 ready 的单要求一个**没有任何站点提供**的能力。
  const task = world.tasks.find((t) => t.status === 'ready') ?? world.tasks[0]
  assert.ok(task, '应当有工单')
  task.status = 'ready'
  task.requires = ['这个能力没有站点提供']

  runtime.advance(2)

  const stalled = runtime.diagnostics.stalled
  const hit = stalled.find((s) => s.taskId === task.id)
  assert.ok(hit, `${task.id} 应当出现在 stalled 里`)
  assert.equal(hit.reason, 'no-station')
  assert.ok(hit.detail.length > 0)
})

test('R67：stalled 是"最近一次调度"的快照，不是累积（派得出去之后必须消失）', () => {
  const { service, runtime } = makeRuntime()
  const world = service.currentWorld()
  for (const agent of world.agents) agent.carrying = 'task-fake'

  runtime.advance(2)
  assert.ok(runtime.diagnostics.stalled.length > 0, '前提：此刻是卡住的')

  // 让人空出来 → 下一 tick 应当能派出去 → stalled 必须清掉。
  // ⚠️ 这条是**这个字段最容易写错的地方**：累加的话，人已经在干活了面板还一直说
  // "派不出去"——数据与画面打架，比不显示更糟。
  for (const agent of world.agents) agent.carrying = null
  runtime.advance(2)

  assert.equal(runtime.diagnostics.stalled.length, 0, '人能干活之后，stalled 必须被清掉（它是快照不是日志）')
})

test('R67：stalled 有上限（不能因为"100 张单没工位"就让每帧快照背 100 条）', () => {
  const { service, runtime } = makeRuntime()
  const world = service.currentWorld()
  for (const agent of world.agents) agent.carrying = 'task-fake'
  // 造出远多于上限的 ready 单。
  const template = world.tasks[0]
  for (let i = 0; i < STALLED_DIAGNOSTIC_CAP * 3; i++) {
    world.tasks.push({ ...template, id: `task-synth-${i}`, status: 'ready', owner: null, blockedBy: [] })
  }

  runtime.advance(2)

  assert.ok(runtime.diagnostics.stalled.length <= STALLED_DIAGNOSTIC_CAP,
    `stalled 不该超过 ${STALLED_DIAGNOSTIC_CAP} 条，实际 ${runtime.diagnostics.stalled.length}`)
})
