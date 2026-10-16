/**
 * `step()` 与事件产出测试（BACKLOG M2-3 / M2-6 / M2-7）。
 *
 * 重点在两处：
 * 1. **六段顺序是语义**，不是风格。所以直接断言顺序带来的可见后果
 *    （刚派出去的人这一 tick 就开始走；到站当 tick 就开始干活）。
 * 2. **事件量策略**是定过的，不是碰巧的。所以断言"帧事件只在有位移时发一条"、
 *    "进度只在里程碑发"，以及 stalled 不发事件。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { EVENT_RING_SIZE, MESSAGE_DELIVERY_TICKS } from '../lib/domain/constants.js'
import { step } from '../lib/sim/step.js'
import { sendMessages, deliverMessages, isInFlight } from '../lib/sim/mailbox.js'
import { emitEvent } from '../lib/sim/journal.js'

function makeWorld({ taskSets = ['task.quick-fix'], maxAgents } = {}) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets,
    ...(maxAgents === undefined ? {} : { maxAgents }),
  })
}

const byKey = (world, key) => {
  const found = world.tasks.find((t) => t.key === key)
  assert.ok(found, `找不到工单 ${key}`)
  return found
}

// ── 六段顺序的可见后果 ──────────────────────────────────────────────────────

test('step：第一 tick 就完成"求值 → 派工 → 上路"三件事', () => {
  const world = makeWorld()
  const result = step(world)

  assert.equal(result.claims.length, 1)
  assert.equal(byKey(world, 'triage').status, 'in_progress')

  const worker = world.agents.find((a) => a.carrying !== null)
  assert.ok(worker)
  // scheduler 在 movement 之前 ⇒ 刚被派出去的人**这一 tick 就开始走**，不是等下 tick。
  assert.equal(worker.state, 'walking')
  assert.ok(worker.path[0] !== undefined, '路径应当在派工时就已经定好')
  assert.equal(world.tick, 1)
})

test('step：到站当 tick 就开始干活（interaction 在 movement 之后）', () => {
  const world = makeWorld()
  // 先把人直接放到目的地旁边，让第一步就走完。
  const task = byKey(world, 'triage')
  step(world)
  const worker = world.agents.find((a) => a.carrying === task.id)
  assert.ok(worker)

  let guard = 0
  while (worker.state === 'walking' && guard++ < 500) step(world)

  assert.equal(worker.state, 'working')
  // 到达的那一 tick，interaction 就已经推过一次进度了（不是等下一 tick）。
  assert.ok(task.progress > 0, `到站当 tick 就该开始干活，得到 progress=${task.progress}`)
})

test('step：暂停时世界不前进，但 resume 仍然收得到', () => {
  const world = makeWorld()
  step(world, [{ kind: 'pause' }])
  assert.equal(world.paused, true)

  const tickBefore = world.tick
  const idle = step(world)
  assert.equal(world.tick, tickBefore, '暂停期间 tick 不该走——否则 HUD 上"暂停了时间还在动"')
  assert.deepEqual(idle.events, [])
  assert.deepEqual(idle.claims, [])

  // resume 在 ingest 段处理，处理完世界就不处于暂停了 ⇒ **这一步本身就会推进一 tick**。
  // 这是刻意的：命令影响的是它到达的那一 tick，而不是下一 tick。
  step(world, [{ kind: 'resume' }])
  assert.equal(world.paused, false)
  assert.equal(world.tick, tickBefore + 1, '恢复的那一步就应当推进世界')

  step(world)
  assert.equal(world.tick, tickBefore + 2, '之后每步推进一次')
})

test('step：重复 pause 不产生第二条事件（幂等，不刷屏）', () => {
  const world = makeWorld()
  const first = step(world, [{ kind: 'pause' }])
  assert.equal(first.events.filter((e) => e.type === 'world.paused').length, 1)
  const second = step(world, [{ kind: 'pause' }])
  assert.equal(second.events.filter((e) => e.type === 'world.paused').length, 0)
})

// ── 需要内容的命令要转交出去（sim 不认识 content）────────────────────────────

test('step：reset / dispatch / hire / setSpeed 被转交，不在内核里执行', () => {
  const world = makeWorld()
  const result = step(world, [
    { kind: 'dispatch', taskSet: 'task.software-feature' },
    { kind: 'hire', role: 'engineer', name: '新人' },
    { kind: 'setSpeed', speed: 4 },
    { kind: 'reset', name: '新的一局' },
  ])

  assert.deepEqual(result.requests.dispatch, ['task.software-feature'])
  assert.deepEqual(result.requests.hire, [{ role: 'engineer', name: '新人' }])
  assert.equal(result.requests.setSpeed, 4)
  assert.deepEqual(result.requests.reset, { name: '新的一局' })

  // 内核不认识内容库，所以它连一个任务都不该凭空造出来。
  assert.equal(world.tasks.filter((t) => t.set === 'task.software-feature').length, 0)
  assert.equal(world.agents.length, 8, 'hire 也不该在内核里发生')
})

// ── 事件量策略 ──────────────────────────────────────────────────────────────

test('事件：seq 单调递增，且与环形缓冲里的顺序一致', () => {
  const world = makeWorld()
  const seen = []
  for (let i = 0; i < 40; i++) seen.push(...step(world).events.map((e) => e.seq))

  assert.ok(seen.length > 0)
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] > seen[i - 1], `seq 必须严格递增：${seen[i - 1]} → ${seen[i]}`)
  }
  assert.equal(world.seq, seen[seen.length - 1] + 1)
})

test('事件：环形缓冲截断到 EVENT_RING_SIZE，且保留的是最近的', () => {
  const world = makeWorld()
  // 直接测 journal 的职责：走 400 tick 只有 130 多个事件（帧事件只在有人移动时发，
  // 这正是事件量策略生效的证明），填不满缓冲，所以这里必须直接压事件。
  for (let i = 0; i < EVENT_RING_SIZE * 2; i++) {
    emitEvent(world, 'world.paused', { i })
  }

  assert.equal(world.events.length, EVENT_RING_SIZE)
  const seqs = world.events.map((e) => e.seq)
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), '缓冲里要保持有序')
  assert.equal(seqs[0], world.seq - EVENT_RING_SIZE, '丢掉的是最旧的（保留 seq 最大的一段）')
  assert.equal(seqs[seqs.length - 1], world.seq - 1, '保留的是最近的')
})

test('事件：真实长跑的**速率**是有界的（而不是"总数小于缓冲上限"）', () => {
  const world = makeWorld()
  const TICKS = 2000
  for (let i = 0; i < TICKS; i++) step(world)

  const perTick = world.seq / TICKS

  // R6 时我写的断言是 `world.seq < EVENT_RING_SIZE`，它当时能过只是因为**世界半静止**
  // （只有两三个在干活的人会移动）。M2.5-1 让待命的人也走动之后它就红了——
  // 而红得对：那条断言把**速率**和**历史深度**混成了一件事。
  //
  // 真正要守的是这两条，分开断言：
  //   ① 速率有界：事件数随 tick 线性增长，斜率必须小（这里是 0.33/tick，
  //      即 10 tick/秒下约 3.3 条/秒）。按人头逐条发位置事件的话，8 个角色就是 8/tick。
  //   ② 深度够用：环形缓冲要能装下足够长的历史，客户端才有时间重连补洞。
  assert.ok(perTick < 1.5, `每 tick 事件数应当有界，实际 ${perTick.toFixed(3)}/tick（seq=${world.seq}）`)
  assert.ok(perTick > 0.02, `世界应当在动，实际 ${perTick.toFixed(3)}/tick——静止的世界会让上面那条假通过`)

  const depth = Math.floor(world.events.length / perTick)
  assert.ok(depth >= 300, `环形缓冲至少要装下 300 tick 的历史（约 30 秒），实际约 ${depth} tick`)
})

test('事件：3000 tick 里 world.tick 帧事件不会每 tick 都发（连续量的采样策略仍在）', () => {
  const world = makeWorld()
  let frames = 0
  for (let i = 0; i < 3000; i++) frames += step(world).events.filter((e) => e.type === 'world.tick').length

  assert.ok(frames > 0, '世界应当在动')
  assert.ok(frames < 3000, `帧事件不该每 tick 都发，实际 ${frames}/3000`)
})

test('事件：帧事件每 tick 最多一条，且只在真的有位移时发', () => {
  const world = makeWorld()
  let ticksWithMovement = 0
  let frames = 0
  for (let i = 0; i < 60; i++) {
    const before = world.agents.filter((a) => a.state === 'walking').length
    const result = step(world)
    const frameEvents = result.events.filter((e) => e.type === 'world.tick')
    assert.ok(frameEvents.length <= 1, `一 tick 最多一条帧事件，得到 ${frameEvents.length}`)
    frames += frameEvents.length
    if (before > 0) ticksWithMovement++
  }
  assert.ok(frames > 0, '这段时间里应当有人在走路')
  assert.ok(frames <= ticksWithMovement + 1, `帧事件不该比"有人走动"的 tick 还多：frames=${frames} walkingTicks=${ticksWithMovement}`)

  // 所有人都停下来以后，不该再有帧事件。
  //
  // 注意：M2.5-1 之后，待命的人会**自己走向歇脚点**，所以"把 state 设成 idle"并不等于
  // "没人动"。要造出真正静止的世界，得把歇脚点放在他们**现在站的地方**。
  for (const a of world.agents) {
    a.state = 'idle'
    a.path = []
    a.targetStation = null
    a.hangout = { x: a.position.x, z: a.position.z }
  }
  const quiet = step(world)
  assert.equal(quiet.events.filter((e) => e.type === 'world.tick').length, 0, '没人动就不该发帧')
})

test('事件：帧事件承载的是**本 tick 有位移的人**，含刚好到站的那位', () => {
  const world = makeWorld()
  step(world)
  const task = byKey(world, 'triage')
  const worker = world.agents.find((a) => a.carrying === task.id)
  assert.ok(worker)

  let arrivalTick = null
  for (let i = 0; i < 500 && arrivalTick === null; i++) {
    const result = step(world)
    const arrived = result.events.some(
      (e) => e.type === 'agent.state' && e.payload.id === worker.id && e.payload.state === 'working',
    )
    if (arrived) arrivalTick = result
  }

  assert.ok(arrivalTick, '应当能抓到到站那一 tick')
  // 走到最后一个点的**当 tick 就到站**。如果按 `state === 'walking'` 过滤帧，
  // 这一刻他已经切成 working，会被漏掉 —— 于是渲染层拿不到落位坐标。
  const frame = arrivalTick.events.find((e) => e.type === 'world.tick')
  assert.ok(frame, '到站那一 tick 必须带帧事件，否则渲染层拿不到他的落位坐标')
  assert.ok(
    frame.payload.agents.some((a) => a[0] === worker.id),
    '刚到站的人必须在帧里（用位移集合，不是按状态过滤）',
  )
})

test('事件：进度只在 10% 里程碑发，不是每 tick 都发', () => {
  const world = makeWorld()
  step(world)
  const worker = world.agents.find((a) => a.carrying !== null)
  while (worker.state === 'walking') step(world)

  const task = byKey(world, 'triage')
  task.estimateTicks = 20 // 20 tick 干完 → 每个里程碑刚好 2 tick

  const milestones = []
  let progressEvents = 0
  for (let i = 0; i < 8; i++) {
    const result = step(world)
    for (const e of result.events) {
      if (e.type === 'task.changed' && typeof e.payload.milestone === 'number' && e.payload.id === task.id) {
        milestones.push(e.payload.milestone)
        progressEvents++
      }
    }
  }
  assert.ok(progressEvents > 0, '应当有里程碑事件')
  assert.ok(progressEvents <= 8, `8 tick 不该产生超过 8 条进度事件（每 tick 一条就已经太多），得到 ${progressEvents}`)
  assert.deepEqual(milestones, [...new Set(milestones)], '同一个里程碑不该重复报')
})

test('事件：stalled 是诊断信息，**不发事件**（否则没空闲角色时每 tick 刷屏）', () => {
  // 只有 1 个角色 + 2 条工作流 ⇒ 必然有派不出去的单。
  const world = makeWorld({ taskSets: ['task.quick-fix', 'task.software-feature'], maxAgents: 1 })
  const result = step(world)

  assert.ok(result.stalled.length > 0, '这个构造下应当有 stalled')
  assert.equal(
    result.events.filter((e) => e.type === 'task.changed' && e.payload.reason === 'stalled').length,
    0,
  )
})

test('事件：状态矛盾被修好时要报出来（不留静默）', () => {
  // ⚠️ R69 改了这个场景的**构造**，因为"矛盾"的定义变了：
  //   · `walking` + 没有目标工位 + **有歇脚点** → 现在是**合法的待命踱步**（idle.ts 推着他走）；
  //   · `walking` + 没有目标工位 + **没有歇脚点** → 谁都推不动他，才是真矛盾
  //     （原来这条由 movement 收，现在由 idle 段收，理由见 `movement.ts` 的两个主人表）。
  // 断言本身一个字没改：**修好了就必须报出来**。
  const world = makeWorld()
  const agent = world.agents[0]
  agent.state = 'walking'
  agent.targetStation = null
  agent.hangout = null

  const result = step(world)
  const repaired = result.events.find(
    (e) => e.type === 'agent.state' && e.payload.id === agent.id && e.payload.reason === 'repaired',
  )
  assert.ok(repaired, '修好矛盾却不报出来，就变成了静默修复')
})

// ── 邮箱 ────────────────────────────────────────────────────────────────────

test('邮箱：投递有延迟，飞行中可判定', () => {
  const world = makeWorld()
  const { queued } = sendMessages(world, [{ from: 'agent-1', to: 'agent-2', kind: 'handoff', body: '交给你了' }])
  assert.equal(queued.length, 1)

  const message = world.messages[0]
  assert.equal(message.deliveredAtTick, null)
  assert.equal(isInFlight(message, world.tick), true)

  // 还没到延迟时间：不送达。**必须推进 tick**——时间不走，消息当然不会送达。
  for (let i = 0; i < 9; i++) {
    world.tick += 1
    const outcome = deliverMessages(world)
    assert.equal(outcome.delivered.length, 0)
    assert.deepEqual(outcome.inFlight, [message.id], '这段时间里它应当被算作"飞行中"')
  }
  assert.equal(message.deliveredAtTick, null)

  // 到点送达：再走一 tick 才到 MESSAGE_DELIVERY_TICKS=10。
  world.tick += 1
  const delivered = deliverMessages(world)
  assert.equal(delivered.delivered.length, 1)
  assert.equal(delivered.delivered[0].messageId, message.id)
  assert.equal(isInFlight(message, world.tick + 100), false, '送达后不再是飞行中')
})

test('邮箱：message.sent 在**开始飞的那一刻**发，并带上送达时刻（R6 的一个真实缺陷）', () => {
  const world = makeWorld()
  // 走真实路径：派一条工单 → 有人 claim → 往前走 → 完工 → 产生 report。
  world.tasks.forEach((t) => {
    t.estimateTicks = 20
  })

  let sent = null
  let tickOfSend = -1
  for (let i = 0; i < 600 && sent === null; i++) {
    const result = step(world)
    const found = result.events.find((e) => e.type === 'message.sent')
    if (found) {
      sent = found
      tickOfSend = world.tick - 1 // step 末尾才自增，所以事件属于上一步
    }
  }
  assert.ok(sent, '600 tick 内应当产生协作消息（否则邮箱还是没有数据源）')

  // 原先只在**送达**时 emit，于是渲染层要等 10 tick 才知道有纸条要飞——
  // 那时它已经在两端了，"从 A 飞到 B"这段过程根本没数据可画。
  assert.equal(sent.payload.deliverAtTick, tickOfSend + MESSAGE_DELIVERY_TICKS, '要带上预计送达 tick')
  assert.ok(sent.payload.from.length > 0 && sent.payload.to.length > 0)

  // 送达不需要单独事件：时刻已经能算出来了。再走 20 tick 不该冒出第二条。
  const before = world.seq
  const extra = []
  for (let i = 0; i < MESSAGE_DELIVERY_TICKS + 5; i++) {
    for (const e of step(world).events) {
      if (e.type === 'message.sent' && e.payload.id === sent.payload.id) extra.push(e)
    }
  }
  assert.deepEqual(extra, [], '同一条消息只该发一次')
  assert.ok(world.seq > before)
})

test('邮箱：消息 id 不从事件 seq 派生（混用会破坏"序号不跳号"）', () => {
  const world = makeWorld()
  const before = world.seq
  sendMessages(world, [{ from: 'a', to: 'b', kind: 'answer', body: 'x' }])
  assert.equal(world.seq, before, '发消息不该动事件序号')
  assert.equal(world.messages[0].id, 'msg-1')
})

// ── journal ─────────────────────────────────────────────────────────────────

test('journal：emitEvent 是唯一改 seq 的地方，返回的事件就是写进去的那条', () => {
  const world = makeWorld()
  const before = world.seq
  const event = emitEvent(world, 'world.paused', { paused: true })

  assert.equal(event.seq, before)
  assert.equal(world.seq, before + 1)
  assert.equal(world.events[world.events.length - 1], event, '缓冲里存的应当是同一个对象')
  assert.equal(event.tick, world.tick)
})

// ── D41（R39）：外部裁决进世界 + live 模式不许 tick 完成 ─────────────────────────

test('D41：taskAssign 把单派给角色；taskComplete 才真的完成（不是 tick 涨满）', () => {
  const world = makeWorld()
  const task = world.tasks[0]
  // 接上团队（live 世界的前提）。
  task.externalId = 't1'
  world.mode = 'live'
  const agent = world.agents[0]

  // 外部说"派给他了"。
  step(world, [{ kind: 'taskAssign', taskId: task.id, agentId: agent.id, attemptId: 'a1' }])
  assert.equal(task.owner, agent.id)
  assert.equal(task.attemptId, 'a1')

  // 让他开工（调度器会在下一 tick 领；这里直接推进到 in_progress，专注验完成口径）。
  task.status = 'in_progress'
  agent.carrying = task.id
  agent.state = 'working'

  // 连推**超过估算时长**的 tick：live 下仍然不许自己完成。
  // （`estimateTicks` 由内容库给，是 600；写死 500 会变成"还没到估算时长"的假绿。）
  const ticks = (task.estimateTicks ?? 600) * 2
  for (let i = 0; i < ticks; i += 1) step(world)
  assert.notEqual(task.status, 'done', 'live 模式下 tick 涨满不算完成（这正是 D41 的核心）')
  assert.ok(task.progress <= 0.95, `进度必须封顶在 1 以下，实际 ${task.progress}`)
  assert.equal(agent.state, 'working', '他还在忙——因为单还没完成')

  // 外部确认完成。
  step(world, [{ kind: 'taskComplete', taskId: task.id, attemptId: 'a1', output: '改完了' }])
  assert.equal(task.status, 'done')
  assert.equal(task.progress, 1)
  assert.equal(task.output, '改完了')
  assert.equal(agent.carrying, null, '完成时人要从单上摘下来')
  assert.equal(agent.state, 'idle')
})

test('D41：旧代次的裁决被拒（重新指派后，上一个执行者的结果不能把新单标成完成）', () => {
  const world = makeWorld()
  const task = world.tasks[0]
  task.externalId = 't1'
  world.mode = 'live'
  task.attemptId = 'a2'
  task.status = 'in_progress'

  step(world, [{ kind: 'taskComplete', taskId: task.id, attemptId: 'a1', output: '旧的' }])
  assert.notEqual(task.status, 'done', 'a1 是上一代的裁决，必须被拒')
  assert.equal(task.output, null)

  step(world, [{ kind: 'taskComplete', taskId: task.id, attemptId: 'a2', output: '新的' }])
  assert.equal(task.status, 'done')
  assert.equal(task.output, '新的')
})

test('D41：simulated 模式完全不受影响（老规矩：tick 涨满就完成）', () => {
  const world = makeWorld()
  const task = world.tasks[0]
  const agent = world.agents[0]
  // 注意：这里**故意**设了 externalId，验证判据是 mode 而不是 externalId 单独起作用。
  task.externalId = 't1'
  task.status = 'in_progress'
  task.owner = agent.id
  agent.carrying = task.id
  agent.state = 'working'

  const ticks = (task.estimateTicks ?? 600) * 2
  for (let i = 0; i < ticks && task.status !== 'done'; i += 1) step(world)
  assert.equal(task.status, 'done', 'simulated 世界里进度涨满仍然是完成——这是回放与测试的路径')
})

test('D41：taskFail 落进失败原因，且人从单上摘下来', () => {
  const world = makeWorld()
  const task = world.tasks[0]
  task.externalId = 't1'
  world.mode = 'live'
  const agent = world.agents[0]
  task.status = 'in_progress'
  task.owner = agent.id
  task.attemptId = 'a1'
  agent.carrying = task.id
  agent.state = 'working'

  step(world, [{ kind: 'taskFail', taskId: task.id, attemptId: 'a1', reason: '接口还没定' }])
  assert.equal(task.status, 'failed')
  assert.equal(task.failureReason, '接口还没定')
  assert.equal(agent.carrying, null)
  assert.equal(agent.state, 'idle')
})

test('R43：taskLink 写下对应关系并把世界切进 live；已对应的单不许被改接', () => {
  const world = makeWorld()
  const task = world.tasks[0]
  assert.equal(world.mode, 'simulated')
  step(world, [{ kind: 'taskLink', taskId: task.id, externalId: 't1' }])
  assert.equal(task.externalId, 't1')
  assert.equal(world.mode, 'live', '一旦有单接上团队，完成就只认团队的裁决')
  step(world, [{ kind: 'taskLink', taskId: task.id, externalId: 't9' }])
  assert.equal(task.externalId, 't1', '同一张单不许被改接到另一张团队任务上')
})

test('R43：live 下接了团队的单，团队还没指派时小镇不许自己挑人', () => {
  const world = makeWorld()
  const task = world.tasks[0]
  task.externalId = 't1'
  world.mode = 'live'
  for (let i = 0; i < 60; i += 1) step(world)
  assert.equal(task.owner, null, '团队还没指派，小镇自己挑人会让团队的指派与完成全被当旧代拒掉')
  assert.notEqual(task.status, 'in_progress')
})

test('R43：团队指派会采纳团队的代次；换人时进行中的单退回 ready 并清进度', () => {
  const world = makeWorld()
  const task = world.tasks[0]
  task.externalId = 't1'
  world.mode = 'live'
  task.status = 'in_progress'
  task.owner = 'agent-1'
  task.attemptId = 'attempt-local'
  task.progress = 0.5
  task.station = 'station.x'

  step(world, [{ kind: 'taskAssign', taskId: task.id, agentId: 'agent-2', attemptId: 'team-1' }])
  // 同一 tick 里：指派先把单退回 ready、清掉上一个人的工位与进度，
  // 随后调度器看到"ready + 已有 owner"，立刻按团队的指派让 agent-2 领走——所以这一 tick 结束时是他在做。
  assert.equal(task.attemptId, 'team-1', '指派就是团队开启新一代，代次要被采纳（调度器也不许覆写它）')
  assert.equal(task.owner, 'agent-2')
  assert.equal(task.status, 'in_progress', '由被指派的人重新领走')
  assert.equal(task.progress, 0, '上一个人的进度不能带过来')
  assert.notEqual(task.station, 'station.x', '上一个人的工位不能带过来')
})
