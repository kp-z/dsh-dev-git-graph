/**
 * 模拟内核测试（BACKLOG M2-1 / M2-4 / M2-5 / M2-5b）。
 *
 * 四个阶段函数都是纯的，所以测试可以直接构造世界、调一个函数、断言结果——
 * 不用起服务器、不用 mock 时间。这正是把它们做成纯函数的目的。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { advanceMovement } from '../lib/sim/movement.js'
import { advanceWork } from '../lib/sim/interaction.js'
import { isTaskReady, recomputeReady } from '../lib/sim/ready.js'
import { claimTasks, occupancyOf, pickStation } from '../lib/sim/scheduler.js'

/** 造一个可控的世界。默认带 quick-fix 工作流（triage → patch → verify）。 */
function makeWorld({ taskSets = ['task.quick-fix'], agents } = {}) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets,
    ...(agents === undefined ? {} : { maxAgents: agents }),
  })
}

const byKey = (world, key) => {
  const found = world.tasks.find((t) => t.key === key)
  assert.ok(found, `找不到工单 ${key}`)
  return found
}
const byRole = (world, role) => {
  const found = world.agents.find((a) => a.role === role)
  assert.ok(found, `找不到角色 ${role}`)
  return found
}

// ── 依赖求值 ────────────────────────────────────────────────────────────────

test('ready：只有没有前置的工单可领取，有前置的留在 pending', () => {
  const world = makeWorld()
  const outcome = recomputeReady(world)

  assert.deepEqual(outcome.becameReady, [byKey(world, 'triage').id])
  assert.deepEqual(outcome.ready, [byKey(world, 'triage').id])
  assert.equal(byKey(world, 'patch').status, 'pending')
  assert.equal(byKey(world, 'verify').status, 'pending')
})

test('ready：前置完成后，下游才变可领取（而且一次只放一层）', () => {
  const world = makeWorld()
  recomputeReady(world)

  byKey(world, 'triage').status = 'done'
  const second = recomputeReady(world)

  assert.deepEqual(second.becameReady, [byKey(world, 'patch').id])
  assert.equal(byKey(world, 'verify').status, 'pending', 'verify 依赖 patch，这一层还不该开')
})

test('ready：依赖指向不存在的任务 → 不开工（不是"当成没依赖"）', () => {
  const world = makeWorld()
  const task = byKey(world, 'triage')
  task.blockedBy = ['task-根本不存在']

  assert.equal(isTaskReady(world, task), false)
  recomputeReady(world)
  assert.equal(task.status, 'pending', '基于"消失了的前置"判断可以开工，是更坏的结果')
})

test('ready：依赖被重新打开 → 已 ready 的单退回 pending（不留自相矛盾的状态）', () => {
  const world = makeWorld()
  recomputeReady(world)
  const triage = byKey(world, 'triage')
  triage.status = 'done'
  recomputeReady(world)
  assert.equal(byKey(world, 'patch').status, 'ready')

  // 把前置重新打开
  triage.status = 'in_progress'
  const back = recomputeReady(world)

  assert.deepEqual(back.becamePending, [byKey(world, 'patch').id])
  assert.equal(byKey(world, 'patch').status, 'pending')
})

test('ready：已经是 in_progress / done 的工单不受影响', () => {
  const world = makeWorld()
  recomputeReady(world)
  const patch = byKey(world, 'patch')
  patch.status = 'in_progress'

  recomputeReady(world)
  assert.equal(patch.status, 'in_progress', '求值不该把在做的活退回去')
})

// ── 调度器 ──────────────────────────────────────────────────────────────────

test('调度：派单时同时定好站点与座位，并把角色转入 walking', () => {
  const world = makeWorld()
  recomputeReady(world)
  const outcome = claimTasks(world)

  assert.equal(outcome.claims.length, 1, '只有 triage 可领取')
  const claim = outcome.claims[0]
  const triage = byKey(world, 'triage')
  const researcher = byRole(world, 'researcher')

  assert.equal(claim.taskId, triage.id)
  assert.equal(claim.agentId, researcher.id, 'triage 建议 researcher，应当优先派给他')
  assert.equal(claim.stationId, 'station.lab-bench', '只有实验台有 research 能力')

  assert.equal(triage.status, 'in_progress')
  assert.equal(triage.owner, researcher.id)
  assert.equal(triage.station, 'station.lab-bench')
  assert.equal(triage.attemptId, `attempt-0-${triage.id}`)

  assert.equal(researcher.state, 'walking')
  assert.equal(researcher.carrying, triage.id)
  assert.equal(researcher.targetStation, 'station.lab-bench')
  assert.equal(researcher.station, null, '在路上时不算"人在站点上"')
      // ⚠️ R64 起 `path` 是**绕障路径**（一串途经点），不能再断言"只有一个点"——
      // 那正是穿墙的成因。这条测试真正要守的是"**座位在 claim 时就定好了**"，
      // 所以改断言**路径终点就是那个座位**（寻路只补上"怎么走过去"，"去哪"没变）。
      const bench = world.stations.find((st) => st.id === 'station.lab-bench')
      assert.ok(bench, '找不到 station.lab-bench')
      const slot = bench.slots[0]
      assert.deepEqual(
        researcher.path[researcher.path.length - 1],
        { x: bench.anchor.x + (slot?.x ?? 0), z: bench.anchor.z + (slot?.z ?? 0) },
        '路径终点必须是 claim 时定好的那个座位',
      )
})

test('调度：一张单只被派一次（同一 tick 内不会两个人抢到同一张）', () => {
  const world = makeWorld()
  recomputeReady(world)
  const outcome = claimTasks(world)

  const taskIds = outcome.claims.map((c) => c.taskId)
  assert.equal(new Set(taskIds).size, taskIds.length)
  const agentIds = outcome.claims.map((c) => c.agentId)
  assert.equal(new Set(agentIds).size, agentIds.length, '同一个人不能被派两张单')
})

test('调度：站点容量是硬约束，超了要 stalled 而不是硬塞', () => {
  // 两条工作流同时派 → 两个 research 根任务，但实验台只有 1 个座位。
  const world = makeWorld({ taskSets: ['task.quick-fix', 'task.software-feature'] })
  recomputeReady(world)
  const outcome = claimTasks(world)

  assert.equal(outcome.claims.length, 1, 'lab-bench 只有一个座位')
  const stalled = outcome.stalled.find((s) => s.reason === 'no-station')
  assert.ok(stalled, `应当有 no-station 的 stalled，得到 ${JSON.stringify(outcome.stalled)}`)
  assert.match(stalled.detail, /research/, '说明里要指出缺的是什么能力')
})

test('调度：没空闲角色时 stalled 而不是空派', () => {
  const world = makeWorld({ agents: 1 }) // 只有 lead 一个人
  recomputeReady(world)
  const first = claimTasks(world)
  assert.equal(first.claims.length, 1, '唯一的角色接了第一张单')

  // 把这张单放回去，让他变成"非 idle"（模拟他正在忙）
  byKey(world, 'triage').status = 'ready'
  byKey(world, 'triage').owner = null
  byKey(world, 'triage').station = null
  byKey(world, 'triage').attemptId = null
  const lead = world.agents[0]
  lead.carrying = null
  lead.state = 'working' // 非 idle

  const second = claimTasks(world)
  assert.equal(second.claims.length, 0)
  assert.equal(second.stalled[0].reason, 'no-worker')
  assert.match(second.stalled[0].detail, /空闲角色/)
})

test('调度：优先级按创建序号，不按 id 字符串（task-10 不该插队）', () => {
  const world = makeWorld()

  // 造 12 张可领取的单。**必须是 code 能力**——三个工位 = 3 个座位，
  // 这样一次能观察到一个有序的前缀（research 只有 1 个座位，看不到顺序）。
  const base = byKey(world, 'triage')
  world.tasks = Array.from({ length: 12 }, (_, i) => ({
    ...base,
    id: `task-${i + 1}`,
    key: `k${i + 1}`,
    ordinal: i + 1,
    status: 'ready',
    owner: null,
    station: null,
    blockedBy: [],
    requires: ['code'],
    suggestedRole: null,
  }))

  const order = claimTasks(world).claims.map((c) => c.taskId)

  // 字符串序会把 task-10 / task-11 / task-12 排到 task-2 前面。ordinal 序不会。
  assert.deepEqual(order, ['task-1', 'task-2', 'task-3'], `得到 ${order.join(', ')}`)
})

test('调度：占位把"正在过去的"也算进去（不要三个人同时被派到一张单人工位）', () => {
  const world = makeWorld()
  const desk = world.stations.find((s) => s.id === 'station.desk-a')
  assert.ok(desk)

  const [a1, a2] = world.agents
  a1.targetStation = desk.id
  a1.station = null
  assert.equal(occupancyOf(world, desk.id), 1, '在路上也算占用')

  a2.station = desk.id
  assert.equal(occupancyOf(world, desk.id), 2)
  assert.equal(occupancyOf(world, 'station.desk-b'), 0)
})

test('pickStation：要求"能力包含"，不是"有交集"', () => {
  const world = makeWorld()
  const reviewTable = world.stations.find((s) => s.id === 'station.review-table')
  assert.ok(reviewTable)

  // board 同时有 review + converse；review-table 只有 review。
  const task = { requires: ['review', 'converse'] }
  const picked = pickStation(world, task)
  assert.equal(picked.station.id, 'station.board', '只有告示板能同时满足两个能力')

  assert.equal(pickStation(world, { requires: ['根本没这个能力'] }), null)

  // 空要求：`every` 对空数组为真 ⇒ 任何有空位的站点都行。
  // 内容校验**禁止**任务模板不声明能力（那样调度器不知道派去哪），所以这个输入
  // 不该从内容里出现；但函数本身要有确定的行为，不能崩。
  const empty = pickStation(world, { requires: [] })
  assert.ok(empty !== null, '空要求应当能落到任何一个有空位的站点上，而不是崩')
  assert.equal(empty.station.id, world.stations[0].id, '落到站点列表的第一个（确定性）')
})

// ── 移动 ────────────────────────────────────────────────────────────────────

test('移动：沿路径推进，到站切 working 并占住站点', () => {
  const world = makeWorld()
  recomputeReady(world)
  claimTasks(world)

  const agent = world.agents.find((a) => a.state === 'walking')
  assert.ok(agent)
  const stationId = agent.targetStation

  const startedAt = { ...agent.position }
  const first = advanceMovement(world)
  assert.ok(first.advanced.includes(agent.id), '第一步应当产生位移')
  assert.notEqual(agent.position.x + agent.position.z, startedAt.x + startedAt.z)

  // 一直走到抵达。
  let arrived = first.arrived
  for (let i = 0; i < 500 && arrived.length === 0; i++) {
    arrived = advanceMovement(world).arrived
  }

  assert.ok(arrived.length > 0, '500 tick 内应当走到（小镇只有 16 单位宽）')
  assert.equal(arrived[0].agentId, agent.id)
  assert.equal(agent.state, 'working')
  assert.equal(agent.station, stationId)
  assert.equal(agent.targetStation, null)
  assert.deepEqual(agent.path, [])
  assert.equal(occupancyOf(world, stationId), 1)
})

test('移动：位置精确落在座位上（不能差一点点，否则渲染层看起来像没坐下）', () => {
  const world = makeWorld()
  recomputeReady(world)
  claimTasks(world)
  const agent = world.agents.find((a) => a.state === 'walking')
  // ⚠️ 终点是 `path` 的**最后一个点**，不是第一个：
  // R64 起 `path` 是**绕障路径**（一串途经点），`path[0]` 是第一个拐点。
  // 原来取 `path[0]` 是因为那时路径只有一个点（终点）——那条直线路径正是穿墙的成因。
  const target = { ...agent.path[agent.path.length - 1] }

  for (let i = 0; i < 500 && agent.state === 'walking'; i++) advanceMovement(world)

  assert.deepEqual(agent.position, target)
})

test('移动：没有目标工位的 walking **不归 movement 管**（R69 起它是待命踱步）', () => {
  // 语义变了，说清楚改在哪：
  //   R69 之前 —— `walking` 只有"派工走路"一种，所以"没有目标工位"必然**是坏数据**，就地修成 idle。
  //   R69 之后 —— 待命踱步也走 `walking`（否则渲染器播站立的带，人却在地板上滑），
  //                而踱步**没有目标工位**（不许占工位）。判据于是分成两个主人：
  //                `targetStation !== null` = 派工流程（movement 推）；`=== null` = 待命流程（idle.ts 推）。
  //
  // **"坏数据"那条保护没有消失**，只是换了主人：由 `advanceIdle` 收尾
  //（连歇脚点都没有、谁都推不动的那种 → 收成 idle 并报出来，见 `test/idle-behavior.test.js`）。
  // 换主人的理由：只有 idle 段知道"没有目标工位的走路"该往哪走，movement 不知道。
  const world = makeWorld()
  const agent = world.agents[0]
  agent.state = 'walking'
  agent.targetStation = null
  agent.path = []

  const outcome = advanceMovement(world)
  assert.deepEqual(outcome.repaired, [], '待命踱步不是坏数据，movement 不该认领它')
  assert.equal(agent.state, 'walking', '留给 idle 段推进')
})

test('移动：目标站点不存在也要修好', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  agent.state = 'walking'
  agent.targetStation = 'station.早就拆了'
  const outcome = advanceMovement(world)
  assert.deepEqual(outcome.repaired, [agent.id])
  assert.equal(agent.state, 'idle')
})

// ── 干活 ────────────────────────────────────────────────────────────────────

test('干活：进度按内容库声明的 estimateTicks 走（预估数字要有意义）', () => {
  const world = makeWorld()
  recomputeReady(world)
  claimTasks(world)
  // 直接让角色到站。
  const agent = world.agents.find((a) => a.state === 'walking')
  agent.state = 'working'
  agent.station = agent.targetStation
  agent.targetStation = null
  agent.path = []

  const task = byKey(world, 'triage')
  assert.equal(task.estimateTicks, 600, 'quick-fix 的 triage 声明了 600 tick')

  advanceWork(world)
  assert.ok(Math.abs(task.progress - 1 / 600) < 1e-12, `第一步应当推进 1/600，得到 ${task.progress}`)
})

test('干活：没声明预估时用兜底值（不是 0、不是 NaN）', () => {
  const world = makeWorld()
  recomputeReady(world)
  claimTasks(world)
  const agent = world.agents.find((a) => a.state === 'walking')
  agent.state = 'working'
  agent.station = agent.targetStation
  agent.targetStation = null
  agent.path = []
  const task = byKey(world, 'triage')
  task.estimateTicks = null

  advanceWork(world)
  assert.ok(task.progress > 0 && task.progress < 0.02, `兜底应当约 1/250，得到 ${task.progress}`)
})

test('干活：progress 到 1 就完工，且**释放站点**（否则高峰期会死锁）', () => {
  const world = makeWorld()
  recomputeReady(world)
  claimTasks(world)
  const agent = world.agents.find((a) => a.state === 'walking')
  const stationId = agent.targetStation
  agent.state = 'working'
  agent.station = stationId
  agent.targetStation = null
  agent.path = []

  const task = byKey(world, 'triage')
  task.estimateTicks = 3 // 3 tick 干完，测试不必跑 600 次

  const first = advanceWork(world)
  assert.equal(first.completed.length, 0)
  advanceWork(world)
  const third = advanceWork(world)

  assert.equal(third.completed.length, 1, '第 3 步应当完工')
  assert.equal(task.status, 'done')
  assert.equal(task.progress, 1)
  assert.equal(task.finishedAtTick, 0)
  assert.equal(task.station, null)

  assert.equal(agent.state, 'idle')
  assert.equal(agent.carrying, null)
  assert.equal(agent.station, null, '完工即释放工位')
  assert.equal(occupancyOf(world, stationId), 0, '不释放的话，新工单永远派不出去')
})

test('干活：状态自相矛盾（任务不是他的） → 放回 idle，不僵在那里', () => {
  const world = makeWorld()
  recomputeReady(world)
  claimTasks(world)
  const agent = world.agents.find((a) => a.state === 'walking')
  agent.state = 'working'
  const task = byKey(world, 'triage')
  task.owner = 'agent-其他人'

  advanceWork(world)
  assert.equal(agent.state, 'idle')
  assert.equal(agent.carrying, null)
})

test('干活：完工后下游变可领取（四段串起来能跑通一条流水线）', () => {
  const world = makeWorld()
  recomputeReady(world)

  // 一个人力、3 tick 干完一张单，跑 30 tick 看流水线能不能推进到第二张。
  const lead = world.agents[0]
  world.agents = [lead]
  for (const t of world.tasks) t.estimateTicks = 3

  let guard = 0
  while (guard++ < 200) {
    recomputeReady(world)
    claimTasks(world)
    advanceMovement(world)
    advanceWork(world)
    if (byKey(world, 'patch').status === 'in_progress' || byKey(world, 'patch').status === 'done') break
  }

  assert.ok(
    ['in_progress', 'done'].includes(byKey(world, 'patch').status),
    `triage 完工后 patch 应当被接上，实际 status=${byKey(world, 'patch').status}`,
  )
})
