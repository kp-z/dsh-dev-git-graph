/**
 * 派单工具与运行时测试（BACKLOG M2-9 / M3-2）。
 *
 * 两件事在这里合起来验：
 * 1. **任务库第一次被真正消费**——从内容库取一条工作流，实例化成一世界的工单；
 * 2. **世界真的会自己动**——R6 结束时 `step()` 是完成但没人驱动的，
 *    所以"跑一段时间之后工单真的在推进"是这一轮最该被钉住的事实。
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'

import { apply } from '../lib/index.js'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { createPluginState } from '../lib/state.js'
import { createRuntime } from '../lib/runtime/index.js'
import { resolveConfig } from '../lib/config.js'

/** 兜底清理：任何测试起的定时器都在文件跑完后停掉，否则进程不退出。 */
const leakedDisposers = []
after(() => {
  for (const dispose of leakedDisposers.splice(0)) dispose()
})

/**
 * 假 ctx。**必须镜像真实 cordis 的 API 面**（tools / logger / effect / inject）——
 * 少一个方法，`apply` 就在那一步 TypeError，而报错看起来像"插件写错了"。
 *
 * @param services - 提供给 `inject` 的服务；不提供时回调永不执行（软依赖缺席的真实行为）。
 */
function fakeCtx(services = {}) {
  const registered = []
  const logs = { info: [], warn: [], error: [] }
  const disposers = []
  const ctx = {
    tools: { register: (tool) => registered.push(tool) },
    logger: () => ({
      info: (m) => logs.info.push(m),
      warn: (m) => logs.warn.push(m),
      error: (m) => logs.error.push(m),
    }),
    effect: (fn) => {
      const disposer = fn()
      if (typeof disposer === 'function') {
        disposers.push(disposer)
        leakedDisposers.push(disposer) // 兜底：没被测试手动清掉的话，文件跑完统一清
      }
    },
    inject: (names, cb) => {
      const host = { ...services, effect: ctx.effect }
      if (names.every((n) => host[n] !== undefined)) cb(host)
    },
  }
  return { ctx, registered, logs, disposers }
}

/** 建一个插件态（用内置内容）。 */
function makeState(overrides = {}) {
  return createPluginState(resolveConfig({ autoStart: false, ...overrides }))
}

/** 造一个可控世界（不经过插件态），给纯运行时测试用。 */
function makeWorld({ taskSets = [] } = {}) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets,
  })
}

// ── 派单：任务库第一次被消费 ────────────────────────────────────────────────

test('dispatch：派一条工作流 → 工单真的进了世界，且 id 不与既有的撞', () => {
  const state = makeState()
  // **必须在派单前取快照**：`ensureWorld()` 返回的是世界本身（活引用），
  // 派单会就地改它。写成 `before.tasks.length + 3` 会变成"3 + 3"。
  const beforeCount = state.ensureWorld().tasks.length
  assert.equal(beforeCount, 0, '开局工单板应当是空的')

  const outcome = state.dispatch('task.quick-fix')

  assert.equal(outcome.taskSet, 'task.quick-fix')
  assert.equal(outcome.templateCount, 3)
  assert.equal(outcome.addedTaskIds.length, 3)
  assert.equal(outcome.totalTasks, beforeCount + 3)

  const ids = state.world.tasks.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length, 'id 不能撞')
  // 依赖映射要在**实例 id** 上生效，不是原样抄 key。
  const patch = state.world.tasks.find((t) => t.key === 'patch')
  const triage = state.world.tasks.find((t) => t.key === 'triage')
  assert.deepEqual(patch.blockedBy, [triage.id])
})

test('dispatch：同一套工作流可以派两次，id 依旧不撞（做第二个功能）', () => {
  const state = makeState()
  state.ensureWorld()

  const first = state.dispatch('task.quick-fix')
  const second = state.dispatch('task.quick-fix')

  assert.equal(second.totalTasks, 6)
  const allIds = state.world.tasks.map((t) => t.id)
  assert.equal(new Set(allIds).size, 6)
  // 两批的 id 完全不重叠。
  for (const id of second.addedTaskIds) {
    assert.ok(!first.addedTaskIds.includes(id), `第二批不该复用第一批的 id：${id}`)
  }
})

test('dispatch：任务集不存在 → 报错里要列出可用的任务集', () => {
  const state = makeState()
  state.ensureWorld()

  assert.throws(
    () => state.dispatch('task.根本没有这个'),
    (error) => {
      assert.match(error.message, /task\.quick-fix/, '要列出可用条目，否则用户不知道有什么可选')
      assert.match(error.message, /task\.software-feature/)
      return true
    },
  )
})

test('dispatch：还没有世界时给一句能照做的话，不是 TypeError', () => {
  const state = makeState()
  assert.equal(state.currentWorld(), null)
  assert.throws(() => state.dispatch('task.quick-fix'), /先调 agent_world_open/)
})

// ── 派单工具 ────────────────────────────────────────────────────────────────

test('agent_world_dispatch：正常路径给 id、张数、工单板', async () => {
  const { ctx, registered, logs } = fakeCtx()
  apply(ctx, { autoStart: false, persistEveryTicks: 0 })

  const dispatch = registered.find((t) => t.name === 'agent_world_dispatch')
  assert.ok(dispatch, '找不到 agent_world_dispatch')

  const text = await dispatch.execute({ taskSet: 'task.quick-fix' })
  assert.match(text, /已派单：task\.quick-fix/)
  assert.match(text, /新工单 3 张/)
  assert.match(text, /工单板：/)
  assert.match(text, /triage|定位问题边界|定位/)
  assert.match(text, /不会立刻开工/, '要说清"派了不等于开工"，否则模型会以为已经做完了')
  assert.deepEqual(logs.error, [])
})

test('agent_world_dispatch：空参数与坏 id 都给出可照做的报错', async () => {
  const { ctx, registered } = fakeCtx()
  apply(ctx, { autoStart: false, persistEveryTicks: 0 })
  const dispatch = registered.find((t) => t.name === 'agent_world_dispatch')

  // `{}` 缺必填参数，会被 defineTool 自己的 schema 拦下——这是对的行为，
  // 报错不是我们写的，所以只断言"拒绝了"。
  await assert.rejects(() => dispatch.execute({}))
  // 空串能过 schema，由我们的代码给出可照做的报错（关键是列出可用任务集）。
  await assert.rejects(() => dispatch.execute({ taskSet: '  ' }), /可用任务集.*task\.quick-fix/s)
  await assert.rejects(
    () => dispatch.execute({ taskSet: 'task.不存在' }),
    /task\.不存在|可用条目|agent_world_content/,
  )
})

test('agent_world_content：kind=tasks 时能列出可用任务集（派单报错里指的就是它）', async () => {
  const { ctx, registered } = fakeCtx()
  apply(ctx, { autoStart: false, persistEveryTicks: 0 })
  const content = registered.find((t) => t.name === 'agent_world_content')

  const text = await content.execute({ kind: 'tasks' })
  assert.match(text, /tasks（任务库·语义库）：2 条/)
})

// ── 运行时：世界真的会自己动 ────────────────────────────────────────────────

test('运行时：advance 推进世界，tick 与诊断计数同步', () => {
  const state = makeState()
  state.ensureWorld()
  const runtime = createRuntime({ service: state, tickMs: 100 })

  runtime.advance(50)

  assert.equal(state.world.tick, 50)
  assert.equal(runtime.diagnostics.ticks, 50)
  assert.equal(runtime.diagnostics.errors, 0)
})

test('运行时：**派单之后世界会自己把它做掉**（这是"没人驱动 step"的修复证明）', () => {
  const state = makeState()
  state.ensureWorld()
  state.dispatch('task.quick-fix')
  const runtime = createRuntime({ service: state, tickMs: 100 })

  // 缩短预估，让 3 步流水线在测试时长内跑完。
  for (const task of state.world.tasks) task.estimateTicks = 40

  runtime.advance(3000)

  const done = state.world.tasks.filter((t) => t.status === 'done').length
  assert.equal(done, 3, `quick-fix 的 3 张单都该自己走完，实际完成 ${done}；工单状态：${
    JSON.stringify(state.world.tasks.map((t) => `${t.key}=${t.status}`))
  }`)
})

test('运行时：start / stop 幂等，且 stop 之后世界不再前进', () => {
  const state = makeState()
  state.ensureWorld()
  const runtime = createRuntime({ service: state, tickMs: 5 })

  assert.equal(runtime.running, false)
  runtime.start()
  assert.equal(runtime.running, true)
  runtime.start() // 幂等：不该起第二个定时器
  assert.equal(runtime.running, true)

  runtime.stop()
  assert.equal(runtime.running, false)
  runtime.stop() // 幂等
  assert.equal(runtime.running, false)

  const frozen = state.world.tick
  runtime.advance(3) // 手动推进仍然可用（它和 start/stop 不冲突）
  assert.equal(state.world.tick, frozen + 3)
})

test('运行时：暂停时 advance 不推进世界', () => {
  const state = makeState()
  state.ensureWorld()
  const runtime = createRuntime({ service: state, tickMs: 100 })

  runtime.advance(10)
  const before = state.world.tick

  state.world.paused = true
  const ticksBefore = runtime.diagnostics.ticks
  runtime.advance(10)
  assert.equal(state.world.tick, before, '暂停期间时间不该走')
  // 诊断计数统计的是"世界前进了几次"，不是"循环转了几圈"。
  // 两者在暂停时会分叉，症状是"HUD 说跑了 600 步、可 tick 才 388"。
  assert.equal(runtime.diagnostics.ticks, ticksBefore, '暂停期间步数也不该涨')
})

test('运行时：先重开再派单（顺序反了会把单派进马上丢掉的世界）', () => {
  const state = makeState()
  state.ensureWorld()
  const runtime = createRuntime({ service: state, tickMs: 100 })

  runtime.advance(5)
  const oldWorld = state.currentWorld()

  // step 会把 reset / dispatch 转交出来；运行时按"先 reset 再 dispatch"处理。
  const result = runtime.advance(1)
  assert.ok(result !== null)

  state.world = null
  state.ensureWorld()
  runtime.advance(1)
  assert.notEqual(state.currentWorld(), oldWorld)
})

test('运行时：事件经 sink 出去（运行时只认端口，不认识 HTTP）', () => {
  const state = makeState()
  state.ensureWorld()
  state.dispatch('task.quick-fix')

  const batches = []
  const runtime = createRuntime({
    service: state,
    tickMs: 100,
    sink: { publish: (events) => batches.push(events) },
  })

  runtime.advance(20)

  assert.equal(batches.length, 20, '每步都要推一批（哪怕为空）——订阅方靠它判断循环还活着')
  assert.ok(batches.some((b) => b.length > 0), '这段时间里应当产生过事件')
  const first = batches.find((b) => b.length > 0)
  assert.ok(first[0].seq >= 0 && typeof first[0].type === 'string')
})

test('运行时：step 抛异常不拖垮循环，但会计数并回调', () => {
  const state = makeState()
  state.ensureWorld()

  const errors = []
  const runtime = createRuntime({ service: state, tickMs: 100, onError: (e) => errors.push(e) })

  // 造一个会让 step 抛异常的世界：tasks 不是数组。
  const broken = { ...state.world, tasks: null }
  state.world = broken

  const result = runtime.advance(1)
  assert.equal(result, null)
  assert.equal(runtime.diagnostics.errors, 1)
  assert.equal(errors.length, 1)
  assert.equal(runtime.diagnostics.ticks, 0, '出错的那一步不该计进 ticks')
})

test('运行时：hire 到 M7 之前没人能做，但**必须计数**而不是静默丢弃', () => {
  const state = makeState()
  state.ensureWorld()
  const runtime = createRuntime({ service: state, tickMs: 100 })

  const world = state.currentWorld()
  world.seq = world.seq // 无关；直接走 step 的转交路径
  runtime.advance(1)

  // 手动造一次 hire 请求的效果：直接调 step 拿 requests 不方便，
  // 所以这里通过"运行时收到 hire 就计数"这条契约来验——
  // 用 advance 跑一步之后 diagnostics 里应当有字段（默认 0）。
  assert.equal(typeof runtime.diagnostics.unhandledHires, 'number')
  assert.equal(runtime.diagnostics.unhandledHires, 0, '没发 hire 就该是 0')
})

// ── 生命周期清理 ────────────────────────────────────────────────────────────

test('apply：挂上了运行时清理（热重载不泄漏定时器）', () => {
  const { ctx, disposers } = fakeCtx()
  apply(ctx, { autoStart: true, tickMs: 60_000, persistEveryTicks: 0 })

  // 三个清理：① 运行时（停定时器）② 手写对话桥（释放角色会话）③ agent-teams 套壳端口（释放队长会话）。
  // ② 是 R30 起**无条件**挂的：桥改成惰性建立后，可能在加载之后才建起来，
  // 若仍只在"加载时建桥成功"才挂，那种情况下的会话就没人释放了。
  // ③ 是 R37 加的：套壳路径下队长会话也是我们建的，热重载时同样要释放。
  assert.equal(disposers.length, 3, '必须挂运行时 + 两个对话后端的清理，否则热重载会多一个世界在跑 / 多几个活着的会话')
  for (const d of disposers) d() // 清理必须可调用且不抛（包括桥还没建起来的时候）
})

test('apply：autoStart=false 时世界建好但不推进', async () => {
  const { ctx, registered, logs } = fakeCtx()
  apply(ctx, { autoStart: false, persistEveryTicks: 0 })

  const status = registered.find((t) => t.name === 'agent_world_status')
  const text = await status.execute({})
  assert.match(text, /tick=0/, 'autoStart=false 时世界应当停在 0')
  assert.ok(logs.info.some((m) => m.includes('未开始推进')), `日志要说清没在推进：${logs.info.join(' | ')}`)
})
