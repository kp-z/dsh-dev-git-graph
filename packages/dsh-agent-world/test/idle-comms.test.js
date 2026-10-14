/**
 * 两个"从真实输出里发现的缺口"的测试（BACKLOG M2.5-1 / M2.5-2）。
 *
 * 它们的共同点：**链路/结构早就建好了，但没有任何东西在使用它**。
 * 所以测试的重点不是"函数算得对"，而是"这件事真的会发生"——
 * 前者容易假通过（构造一个理想输入即可），后者才是当初漏掉的东西。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { MESSAGE_DELIVERY_TICKS, MESSAGE_RING_SIZE } from '../lib/domain/constants.js'
import { distance, latticeIn } from '../lib/domain/geometry.js'
import { step } from '../lib/sim/step.js'
import { advanceIdle } from '../lib/sim/idle.js'
import { dispatchComms } from '../lib/sim/comms.js'
import { sendMessages, deliverMessages, isInFlight } from '../lib/sim/mailbox.js'
import { claimTasks } from '../lib/sim/scheduler.js'
import { advanceWork } from '../lib/sim/interaction.js'
import { recomputeReady } from '../lib/sim/ready.js'

function makeWorld({ taskSets = ['task.quick-fix'], estimate = null } = {}) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets,
  })
  if (estimate !== null) for (const t of world.tasks) t.estimateTicks = estimate
  return world
}

const lead = (world) => world.agents.find((a) => a.role === 'lead')

// ── M2.5-1：待命角色散开 ────────────────────────────────────────────────────

test('歇脚点：每个角色都有，且**互不重叠**（这就是"6 个人叠在一格"的修复）', () => {
  const world = makeWorld()

  const seen = new Set()
  for (const agent of world.agents) {
    assert.ok(agent.hangout !== null, `${agent.name} 没有歇脚点`)
    const key = `${agent.hangout.x.toFixed(6)},${agent.hangout.z.toFixed(6)}`
    assert.ok(!seen.has(key), `歇脚点重叠了：${key}——叠在一起就是原来的 bug`)
    seen.add(key)
  }
  assert.equal(seen.size, world.agents.length)
})

test('歇脚点：落在广场地块里（所以"把广场改大"就能让人散得更开）', () => {
  const world = makeWorld()
  const commons = world.districts.find((d) => d.kind === 'commons')
  assert.ok(commons, '内置场景应当有广场')

  for (const agent of world.agents) {
    const h = agent.hangout
    assert.ok(
      h.x >= Math.min(commons.bounds.min.x, commons.bounds.max.x) &&
        h.x <= Math.max(commons.bounds.min.x, commons.bounds.max.x) &&
        h.z >= Math.min(commons.bounds.min.z, commons.bounds.max.z) &&
        h.z <= Math.max(commons.bounds.min.z, commons.bounds.max.z),
      `${agent.name} 的歇脚点 ${h.x},${h.z} 跑到广场外面了`,
    )
  }
})

test('latticeIn：确定性、单点、单行单列都不除零', () => {
  const box = { min: { x: 0, z: 0 }, max: { x: 10, z: 10 } }
  assert.deepEqual(latticeIn(box, 0), [])
  assert.equal(latticeIn(box, 1).length, 1)
  assert.deepEqual(latticeIn(box, 1)[0], { x: 5, z: 5 }, '一个点时取中点')

  const nine = latticeIn(box, 9)
  assert.equal(nine.length, 9)
  assert.equal(new Set(nine.map((p) => `${p.x},${p.z}`)).size, 9, '九宫格应当互不重叠')

  // 确定性：同输入必须同输出（模拟内核不许随机）。
  assert.deepEqual(latticeIn(box, 9), nine)
})

test('待命走动：人会走到歇脚点，**到了就停**（不能每 tick 都判"还没到"）', () => {
  // 用**没有工单**的世界来单测这个机制：有活干的世界里，人被派走又回来，
  // "最终都到位"就不是一个确定成立的性质了（第一版这么写，果然红在一个被反复派活的角色上）。
  const world = makeWorld({ taskSets: [] })
  const idle = world.agents.filter((a) => a.state === 'idle')
  assert.equal(idle.length, world.agents.length, '没有工单时所有人都是待命')

  // 先让他们走到位。
  let guard = 0
  while (idle.some((a) => distance(a.position, a.hangout) > 1e-9) && guard++ < 2000) step(world)

  for (const a of idle) {
    assert.ok(distance(a.position, a.hangout) < 1e-9, `${a.name} 还没到歇脚点`)
  }

  // 到位之后不该再有位移。
  const outcome = advanceIdle(world)
  assert.deepEqual(outcome.advanced, [], '到位之后再挪动会表现为画面里的抖动')
  assert.equal(outcome.settled.length, idle.length)
})

test('待命走动：不动正在走路/干活的人，也**不碰**它们的路径', () => {
  const world = makeWorld()
  const worker = world.agents[0]
  worker.state = 'walking'
  worker.targetStation = world.stations[0].id
  worker.path = [{ x: 1, z: 1 }]
  const snapshotPath = JSON.stringify(worker.path)

  const outcome = advanceIdle(world)

  assert.ok(!outcome.advanced.includes(worker.id), '走路的人该由 movement 管，不该被 idle 再推一次')
  assert.equal(JSON.stringify(worker.path), snapshotPath)
})

test('待命走动：清掉待命者身上的派工路径残渣（否则会看到"待命中却在走向工位"）', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  agent.state = 'idle'
  agent.path = [{ x: 3, z: 3 }]

  advanceIdle(world)
  assert.deepEqual(agent.path, [], '待命的人不该还挂着派工路径')
})

test('待命走动：没有歇脚点时安全跳过（不崩、不动）', () => {
  const world = makeWorld()
  const before = JSON.stringify(world.agents.map((a) => a.position))
  for (const a of world.agents) a.hangout = null

  const outcome = advanceIdle(world)
  assert.deepEqual(outcome.advanced, [])
  assert.equal(JSON.stringify(world.agents.map((a) => a.position)), before)
})

test('长跑：待命的人不再叠在一起（原来的现象是 6 个人同一个坐标）', () => {
  const world = makeWorld({ taskSets: ['task.quick-fix', 'task.software-feature'] })
  for (let i = 0; i < 400; i++) step(world)

  const positions = new Set(world.agents.map((a) => `${a.position.x},${a.position.z}`))
  assert.equal(positions.size, world.agents.length, `${world.agents.length} 个角色占了 ${positions.size} 个坐标`)
})

// ── M2.5-2：邮箱真的有发送方了 ──────────────────────────────────────────────

test('协作消息：跑起来真的会有消息（原来跑 700 步是 0 条）', () => {
  const world = makeWorld({ taskSets: ['task.quick-fix'], estimate: 30 })

  for (let i = 0; i < 1500; i++) step(world)

  assert.ok(world.messages.length > 0, '邮箱还是没有数据源——整条投递链路等于没用上')
  assert.ok(world.messageSeq > 1, '序号也要跟着走')
})

test('协作消息：领到有前置的单 → 完成前置的那个人发来 handoff', () => {
  const world = makeWorld({ estimate: 10 })
  // 手工把前置标成完成，由某个具体角色完成。
  const [triage, patch] = world.tasks
  const finisher = world.agents.find((a) => a.role === 'researcher') ?? world.agents[0]
  triage.status = 'done'
  triage.owner = finisher.id
  triage.finishedAtTick = 5

  patch.status = 'ready'
  recomputeReady(world)
  const scheduled = claimTasks(world)
  const claim = scheduled.claims.find((c) => c.taskId === patch.id)
  assert.ok(claim, '应当有人领到 patch')
  assert.notEqual(claim.agentId, finisher.id, '测试前提：交接双方不是同一个人')

  const comms = dispatchComms(world, [claim], [])

  assert.equal(comms.queued.length, 1)
  const message = world.messages[0]
  assert.equal(message.kind, 'handoff')
  assert.equal(message.from, finisher.id)
  assert.equal(message.to, claim.agentId)
  assert.match(message.body, new RegExp(triage.title), '正文要带上前一张单的标题（内容是内容的活）')
  assert.match(message.body, new RegExp(patch.title))
})

test('协作消息：自己做的前置不发给自己（一个人给自己递纸条是纯噪声）', () => {
  const world = makeWorld({ estimate: 10 })
  const [triage, patch] = world.tasks
  const solo = world.agents[0]
  triage.status = 'done'
  triage.owner = solo.id
  triage.finishedAtTick = 5
  patch.status = 'in_progress'
  patch.owner = solo.id
  patch.blockedBy = [triage.id]

  dispatchComms(world, [{ agentId: solo.id, taskId: patch.id, stationId: 'x', attemptId: 'a' }], [])
  assert.deepEqual(world.messages, [], '不该出现自己发给自己的纸条')
})

test('协作消息：完工报给 lead；lead 自己干的活不报给自己', () => {
  const world = makeWorld({ estimate: 10 })
  const boss = lead(world)
  assert.ok(boss, '内置花名册应当有 lead')

  const worker = world.agents.find((a) => a.id !== boss.id)
  dispatchComms(world, [], [{ taskId: world.tasks[0].id, agentId: worker.id }])

  assert.equal(world.messages.length, 1)
  assert.equal(world.messages[0].kind, 'report')
  assert.equal(world.messages[0].from, worker.id)
  assert.equal(world.messages[0].to, boss.id)

  dispatchComms(world, [], [{ taskId: world.tasks[0].id, agentId: boss.id }])
  assert.equal(world.messages.length, 1, 'lead 自己干的活不该再发一条')
})

test('协作消息：没有可发的就不入队（不产生空消息）', () => {
  const world = makeWorld({ estimate: 10 })
  const comms = dispatchComms(world, [], [])
  assert.deepEqual(comms.queued, [])
  assert.deepEqual(world.messages, [])
})

test('协作消息：入队时就带上送达时刻（渲染层据此画飞行，不用自己抄延迟常量）', () => {
  const world = makeWorld({ estimate: 10 })
  world.tick = 100
  const comms = dispatchComms(world, [], [{ taskId: world.tasks[0].id, agentId: world.agents[1].id }])

  assert.equal(comms.queued.length, 1)
  assert.equal(comms.queued[0].deliverAtTick, 100 + MESSAGE_DELIVERY_TICKS)

  // 从入队那一刻起就"在飞"，渲染层这一 tick 就能开始画。
  assert.equal(isInFlight(world.messages[0], 100), true)
})

// ── 消息序号与裁剪（接上发送方之后才成为问题） ──────────────────────────────

test('消息发号：用独立计数器，**不用 messages.length**（裁剪后会重复发号）', () => {
  const world = makeWorld()

  // 塞满并裁剪一轮。
  for (let i = 0; i < MESSAGE_RING_SIZE + 30; i++) {
    sendMessages(world, [{ from: 'a', to: 'b', kind: 'report', body: 'x' }])
    world.tick += MESSAGE_DELIVERY_TICKS
    deliverMessages(world)
  }

  assert.ok(world.messages.length <= MESSAGE_RING_SIZE + 1, `邮箱应当被裁剪，实际 ${world.messages.length}`)
  const ids = world.messages.map((m) => m.id)
  assert.equal(new Set(ids).size, ids.length, '裁剪之后 id 不该重复——用 length 发号就会重复')
})

test('消息裁剪：只丢**已送达**的旧消息，还在飞的一张都不能少', () => {
  const world = makeWorld()

  // 先做出 MESSAGE_RING_SIZE 条已送达的。
  for (let i = 0; i < MESSAGE_RING_SIZE; i++) {
    sendMessages(world, [{ from: 'a', to: 'b', kind: 'report', body: 'old' }])
    world.tick += MESSAGE_DELIVERY_TICKS
    deliverMessages(world)
  }
  // 再放几条还在飞的。
  const flying = sendMessages(world, [
    { from: 'a', to: 'b', kind: 'handoff', body: 'f1' },
    { from: 'a', to: 'b', kind: 'handoff', body: 'f2' },
  ])
  assert.equal(world.messages.filter((m) => m.deliveredAtTick === null).length, 2)

  // 再挤几条已送达的，触发裁剪。
  for (let i = 0; i < 5; i++) {
    sendMessages(world, [{ from: 'a', to: 'b', kind: 'report', body: 'new' }])
    world.tick += MESSAGE_DELIVERY_TICKS
    deliverMessages(world)
  }

  for (const id of flying.queued) {
    assert.ok(world.messages.some((m) => m.id === id), `还在飞的 ${id} 被裁掉了——画面上会凭空少一张纸条`)
  }
})

test('消息与事件：两者序号互不影响（混用会让"事件序号不跳号"失效）', () => {
  const world = makeWorld({ estimate: 10 })
  const seqBefore = world.seq

  const comms = dispatchComms(world, [], [{ taskId: world.tasks[0].id, agentId: world.agents[1].id }])

  assert.equal(world.seq, seqBefore, '发消息不该动事件序号')
  assert.equal(comms.queued.length, 1)
  assert.equal(world.messageSeq, 2)
})
