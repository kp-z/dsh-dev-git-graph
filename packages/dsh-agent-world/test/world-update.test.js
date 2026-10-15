/**
 * 增量应用测试（BACKLOG M3-6）。
 *
 * ## 为什么这份测试值钱
 *
 * 面板从轮询改成增量推送之后，"事件够不够重建画面"**没有任何肉眼可查的手段**——
 * 缺一个字段的表现是"某个角色永远坐在桌子上"，看起来像渲染层没刷新。
 *
 * 所以这里的主测试是**往返比对**：
 * 从 tick 0 的快照出发 → 把 N 步产生的**全部事件**应用到本地副本 →
 * 与**真实世界**逐字段比对。少一个字段就红，而且指出是哪个字段。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyEvents, applyEvent, decideOnBatch, pruneMessages } from '../web/core/world-update.js'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { createPluginState } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { createEventHub, createRuntime } from '../lib/runtime/index.js'
import { step } from '../lib/sim/step.js'

function makeWorld({ taskSets = ['task.quick-fix'] } = {}) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets,
  })
}

/** 客户端拿到的起点：快照**不含**事件环形缓冲（服务端就是这么发的）。 */
function snapshotOf(world) {
  const { events: _drop, ...rest } = JSON.parse(JSON.stringify(world))
  return rest
}

/**
 * 比对用的投影。
 *
 * 只取**面板真正读的字段**：`path` 之类不在事件里、面板也不用的东西要排除，
 * 否则这条测试会对着"客户端本来就不需要的东西"发火。
 * 反过来说：**这里列出来的字段，就是增量必须能重建的全集**。
 *
 * 两类东西**刻意不在比对里**，因为它们是"采样下发"而非"逐条下发"：
 * · `tick` —— 没有变更事件的那些步不会产生任何事件，所以客户端的 tick 只能靠
 *   `sync` 帧校准 + 本地时钟推进（见 `src/routes/events.ts` 的心跳说明）；
 * · 精确 `progress` —— 进度只在里程碑发，客户端插值。
 * 把它们放进比对里只会得到一条**永远在红或永远没意义**的测试。
 */
function projection(world) {
  return {
    paused: world.paused,
    agents: [...world.agents]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((a) => ({
        id: a.id,
        state: a.state,
        position: a.position,
        facing: a.facing,
        station: a.station,
        targetStation: a.targetStation,
        carrying: a.carrying,
      })),
    tasks: [...world.tasks]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((t) => ({
        id: t.id,
        title: t.title,
        ordinal: t.ordinal,
        status: t.status,
        // **进度按里程碑比对，不比精确值**：进度事件刻意只在每 10% 发一次
        // （连续量每 tick 推 24 条是纯浪费），客户端负责插值。
        // 所以"增量能否重建"的判据在进度上是"里程碑一致"，不是"小数一致"。
        progressMilestone: Math.floor(t.progress * 10),
        owner: t.owner,
        station: t.station,
      })),
  }
}

// ── 主验证：往返比对 ────────────────────────────────────────────────────────

test('往返：从快照 + 全部增量重建出来的世界，与真实世界逐字段一致', () => {
  const world = makeWorld({ taskSets: ['task.quick-fix', 'task.software-feature'] })
  const client = snapshotOf(world)

  const allEvents = []
  for (let i = 0; i < 900; i++) allEvents.push(...step(world).events)
  assert.ok(allEvents.length > 100, `这段跑动应当产生不少事件，实际 ${allEvents.length}`)

  applyEvents(client, allEvents)

  assert.deepEqual(
    projection(client),
    projection(world),
    '增量重建的结果必须和真实世界一致——不一致说明事件漏了字段',
  )
})

test('往返：世界一直跑到有工单完工、有纸条在飞，仍然一致', () => {
  const world = makeWorld({ taskSets: ['task.quick-fix'] })
  for (const t of world.tasks) t.estimateTicks = 40
  const client = snapshotOf(world)

  const allEvents = []
  for (let i = 0; i < 1200; i++) allEvents.push(...step(world).events)

  assert.ok(world.tasks.some((t) => t.status === 'done'), '测试前提：应当有工单完工')
  assert.ok(world.messages.length > 0, '测试前提：应当产生过消息')

  applyEvents(client, allEvents)

  assert.deepEqual(projection(client), projection(world))

  // 消息是**子集**检查而不是全等：两边的裁剪策略不同（服务端裁已送达的），
  // 但**客户端不能漏掉任何一条服务端有的消息**——漏了就是"纸条凭空少一张"。
  const clientIds = new Set(client.messages.map((m) => m.id))
  for (const m of world.messages) {
    assert.ok(clientIds.has(m.id), `客户端漏了消息 ${m.id}`)
  }
})

test('往返：中途**在 tick 之外**派单，客户端也要看得到（这是 R13 修的那个坑）', () => {
  const service = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }))
  service.ensureWorld()
  const hub = createEventHub()
  const runtime = createRuntime({ service, tickMs: 100, sink: hub })

  const client = snapshotOf(service.currentWorld())
  const seen = []
  hub.subscribe((events) => seen.push(...events))

  runtime.advance(60)
  const beforeDispatch = service.currentWorld().tasks.length

  // **工具走的正是这条路**：`state.dispatch()`，不经过 step。
  service.dispatch('task.quick-fix')
  assert.equal(service.currentWorld().tasks.length, beforeDispatch + 3)

  // 再推一步：运行时按 seq 水位线把"还没发布过的"事件推出去。
  runtime.advance(1)

  // 那三张新单必须出现在事件流里——只发布 `result.events` 的话它们会永远躺在环形缓冲里。
  const dispatched = seen.filter((e) => e.type === 'task.changed' && e.payload.reason === 'dispatched')
  assert.equal(dispatched.length, 3, '派单必须发出事件，否则只收增量的客户端永远看不到新工单')

  applyEvents(client, seen)
  const clientIds = new Set(client.tasks.map((t) => t.id))
  for (const t of service.currentWorld().tasks) {
    assert.ok(clientIds.has(t.id), `客户端漏了新工单 ${t.id}`)
  }
  assert.deepEqual(projection(client), projection(service.currentWorld()))
})

// ── 逐条语义 ────────────────────────────────────────────────────────────────

test('world.tick 帧：元组数组按位置解包，只动提到的人', () => {
  const world = makeWorld()
  const before = { ...world.agents[1].position }

  applyEvent(world, {
    seq: 1,
    tick: 7,
    type: 'world.tick',
    payload: {
      agents: [
        ['agent-1', 3, -4, 1.25],
        ['agent-999', 99, 99, 0], // 真正不存在的人：忽略，不炸
      ],
    },
  })

  assert.deepEqual(world.agents[0].position, { x: 3, z: -4 })
  assert.equal(world.agents[0].facing, 1.25)
  assert.deepEqual(world.agents[1].position, before, '没被提到的人不该动')
  assert.equal(world.tick, 8, '事件属于第 7 步，走完之后世界是第 8 步')
})

test('agent.state：直接赋值而不是猜——完工要把人从工位上摘掉', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  agent.state = 'working'
  agent.station = 'station.desk-a'
  agent.carrying = 'task-1'

  applyEvent(world, {
    seq: 1,
    tick: 10,
    type: 'agent.state',
    payload: { id: agent.id, state: 'idle', station: null, targetStation: null, carrying: null, reason: 'task-done' },
  })

  assert.equal(agent.state, 'idle')
  assert.equal(agent.station, null, '不摘工位的话，画面上他会永远坐在那张桌子上')
  assert.equal(agent.carrying, null)
})

test('task.changed：新工单能就地建出来（事件带了 title/ordinal）', () => {
  const world = makeWorld({ taskSets: [] })
  assert.equal(world.tasks.length, 0)

  applyEvent(world, {
    seq: 1,
    tick: 0,
    type: 'task.changed',
    payload: {
      id: 'task-1',
      key: 'triage',
      title: '定位问题边界',
      ordinal: 1,
      status: 'pending',
      progress: 0,
      owner: null,
      station: null,
      reason: 'dispatched',
    },
  })

  assert.equal(world.tasks.length, 1)
  assert.equal(world.tasks[0].title, '定位问题边界')
  assert.equal(world.tasks[0].status, 'pending')
})

test('task.changed：载荷不足以建出新工单时**抛错**，不静默少一张单', () => {
  const world = makeWorld({ taskSets: [] })
  assert.throws(
    () => applyEvent(world, { seq: 1, tick: 0, type: 'task.changed', payload: { id: 'task-9', status: 'pending' } }),
    /协议缺陷|不足以建出它/,
    '静默少一张单是最坏的：画面上工单数少了一张，没人会想到是事件缺字段',
  )
})

test('message.sent：带 deliverAtTick，客户端不用自己抄投递延迟', () => {
  const world = makeWorld()
  applyEvent(world, {
    seq: 5,
    tick: 20,
    type: 'message.sent',
    payload: { id: 'msg-1', from: 'agent-1', to: 'agent-2', kind: 'handoff', deliverAtTick: 30 },
  })

  assert.equal(world.messages.length, 1)
  assert.equal(world.messages[0].deliverAtTick, 30)

  // 同一条重复投递（重连补发可能带来重复）：幂等，不重复入列。
  applyEvent(world, {
    seq: 5,
    tick: 20,
    type: 'message.sent',
    payload: { id: 'msg-1', from: 'agent-1', to: 'agent-2', kind: 'handoff', deliverAtTick: 30 },
  })
  assert.equal(world.messages.length, 1)
})

test('事件类型可以向前加：不认识的类型不报错（老客户端不该被新事件弄坏）', () => {
  const world = makeWorld()
  const shape = () =>
    JSON.stringify({ agents: world.agents, tasks: world.tasks, messages: world.messages })
  const before = shape()

  applyEvent(world, { seq: 1, tick: 0, type: 'agent.celebrating', payload: { id: 'agent-1' } })

  assert.equal(shape(), before, '不认识就该什么都不动（tick 会被推进，那是**每条事件都会做**的事）')
  assert.equal(world.tick, 1, 'tick 仍然推进：不认识的类型也来自某一步，世界确实往前走了')
})

test('sync：按权威时间校准，且**不 +1**（它报的是"已经走到哪"）', () => {
  const world = makeWorld()
  applyEvent(world, { seq: 1, tick: 500, type: 'sync', payload: { tick: 500, seq: 321, paused: true } })
  assert.equal(world.tick, 500, 'sync 报的是当前 tick，不是"某一步之内"')
  assert.equal(world.paused, true)

  // 校准不该让时间倒流。
  applyEvent(world, { seq: 2, tick: 400, type: 'sync', payload: { tick: 400 } })
  assert.equal(world.tick, 500, '迟到的旧 sync 不该把时钟拉回去')
})

test('pruneMessages：还在飞的纸条一张都不能丢，落地的最多留 N 条', () => {
  const world = makeWorld()
  world.tick = 100
  for (let i = 0; i < 50; i++) {
    world.messages.push({ id: `msg-${i}`, from: 'a', to: 'b', kind: 'report', atTick: i, deliveredAtTick: 10, deliverAtTick: 10 })
  }
  world.messages.push({ id: 'msg-flying', from: 'a', to: 'b', kind: 'handoff', atTick: 99, deliveredAtTick: null, deliverAtTick: 109 })

  pruneMessages(world, 5)
  assert.ok(world.messages.some((m) => m.id === 'msg-flying'), '在飞的纸条不能被裁掉')
  assert.equal(world.messages.filter((m) => m.id !== 'msg-flying').length, 5)
})

test('decideOnBatch：接得上就应用，缺一段或**倒退**都重拉快照', () => {
  // `nextSeq` 是「**下一个期望**的号」——这条语义是 R21 修掉一个真 bug 的关键。
  assert.equal(decideOnBatch(11, 11), 'apply', '严丝合缝：下一个期望的就是它')
  assert.equal(decideOnBatch(15, 11), 'resync', '中间缺了：硬接会静默丢一段历史')
  // 倒退是**重开一局**的典型特征：seq 从头开始。跳过「重复的」继续应用是错的——
  // 那些 seq 属于另一个世界。
  assert.equal(decideOnBatch(1, 500), 'resync', 'seq 倒退（重开一局）必须重拉快照')
  assert.equal(decideOnBatch(500, 501), 'resync', '已经消费过的也重拉，不做猜测')
  assert.equal(decideOnBatch(Number.NaN, 11), 'apply', '异常批不该触发重拉风暴')
})

test('回归：快照的 seq 是「下一个要分配的号」，所以下一条事件**恰好等于它** → 必须 apply', () => {
  // 这是 R21 修掉的那个 bug 的最小复现。
  //
  // 协议事实（实测）：`GET /api/world` 返回的 `seq` 与 SSE 的 `hello.seq` 都是 `world.seq`，
  // 含义是「**下一个要分配的号**」；而事件自身的 `seq` 就是它被分配到的号。
  // 所以「快照 seq = N」之后，**第一条事件就是 N**。
  //
  // 旧写法把快照的 N 当成「已经消费到 N 了」，于是 `decideOnBatch(N, N)` 判成 resync →
  // **每来一批事件就重拉一次快照**。症状不是画面错（快照是新的，看起来完全正常），
  // 而是每秒约 10 次快照请求 + 每次重建场景泄漏约 6 个 GPU 纹理——**量了才知道**。
  const worldSeq = 496 // 快照给的「下一个要分配的号」
  assert.equal(decideOnBatch(worldSeq, worldSeq), 'apply', '这条红 = 面板会开始每秒重拉十次快照')
})

// ── 反例：证明这条测试真的会红 ──────────────────────────────────────────────

test('反例：故意漏掉 agent.state 里的 station，往返比对必须失败（证明它抓得住）', () => {
  const world = makeWorld({ taskSets: ['task.quick-fix'] })
  for (const t of world.tasks) t.estimateTicks = 30
  const client = snapshotOf(world)

  const allEvents = []
  // **要停在世界"正在干活"的时刻**：如果跑到最后所有人都空闲，
  // 客户端的陈旧值恰好等于真值（都是 null），反例就抓不出来了。
  // 第一版跑了 600 步，就是这么假通过的。
  let guard = 0
  while (!world.agents.some((a) => a.station !== null) && guard++ < 3000) {
    allEvents.push(...step(world).events)
  }
  assert.ok(world.agents.some((a) => a.station !== null), '测试前提：应当有人正占着工位')

  // 模拟"协议漏了字段"：把 `station` 这个**键整个删掉**。
  // 第一版我写的是 `station: undefined`，那骗不过测试——键还在，客户端照样赋值。
  // 真实的漏字段是"键根本不在载荷里"，那时客户端会**保留陈旧值**（人永远坐在工位上）。
  const damaged = allEvents.map((e) => {
    if (e.type !== 'agent.state') return e
    const { station: _omit, ...rest } = e.payload
    return { ...e, payload: rest }
  })
  applyEvents(client, damaged)

  assert.notDeepEqual(
    projection(client),
    projection(world),
    '这条反例就是为了证明上面的往返比对不是摆设：漏一个字段它必须红',
  )
})
