/**
 * 事件产出（BACKLOG M2-7）。
 *
 * **整个模拟内核的事件只从这一处产出。** 四个阶段函数都只返回"变了什么"，
 * 不发事件——如果它们各自顺手 emit，那"事件从哪来"就会变成四个答案，
 * 而顺序、去重、采样策略都没人统一管。
 *
 * ## 事件量：先定策略，再写代码
 *
 * R5 留下的最大不确定性就是"位置每 tick 都变，事件会不会把缓冲冲爆"。
 * 定的策略（写在这里，也写在 `domain/types.ts` 的事件类型注释里）：
 *
 * | 事件 | 频率 | 为什么 |
 * |---|---|---|
 * | `world.tick` | 每 tick 一条（**只在有位移时**） | 位置是连续量。一条"帧"事件带全部有位移的角色，而不是每人一条——后者 24 角色 ≈ 240 条/秒，环形缓冲只有 500 条 |
 * | `task.changed` | 状态变化 + **每 10% 的里程碑** | 进度条自己插值；每 tick 推 24 条进度是纯浪费 |
 * | `agent.state` | 离散（状态机转换时） | 本来就稀疏 |
 * | `message.sent` | 离散（一封一条） | 本来就稀疏 |
 *
 * **`stalled` 刻意不发事件**：它是"为什么现在派不出去"的诊断信息，
 * 没空闲角色时每 tick 都会成立，发出来只会刷屏。它由 `step()` 的返回值交给编排层，
 * 工具要展示时去读。
 */
import { PROGRESS_MILESTONES } from '../domain/constants.js'
import type { World, WorldEvent } from '../domain/types.js'
import type { ReadyOutcome } from './ready.js'
import type { SchedulerOutcome } from './scheduler.js'
import type { MovementOutcome } from './movement.js'
import type { WorkOutcome } from './interaction.js'
import type { IdleOutcome } from './idle.js'
import type { CommsOutcome } from './comms.js'
import { emitEvent } from './journal.js'
import { agentPatch, taskPatch } from './patches.js'

/** 本 tick 各阶段的产出（`emit.ts` 的输入）。 */
export interface PhaseOutcomes {
  ready: ReadyOutcome
  scheduler: SchedulerOutcome
  movement: MovementOutcome
  /** 待命角色的走动（M2.5-1）。它与 movement 一样产出位移，要一起并进帧事件。 */
  idle: IdleOutcome
  work: WorkOutcome
  /** 本 tick 新产生的协作消息（M2.5-2）。 */
  comms: CommsOutcome
}

/** 进度已跨过的里程碑编号（0..PROGRESS_MILESTONES）。 */
function milestoneOf(progress: number): number {
  return Math.floor(progress * PROGRESS_MILESTONES)
}

/**
 * 把各阶段的产出翻成事件，并写进 `world.events`。
 *
 * **会就地修改 `world.seq` 与 `world.events`。**
 *
 * @param world - 世界（就地修改）。
 * @param outcomes - 各阶段产出。
 * @returns 本 tick 产生的事件（按发生顺序，`seq` 单调）。
 */
export function emitPhaseEvents(world: World, outcomes: PhaseOutcomes): WorldEvent[] {
  const events: WorldEvent[] = []
  const push = (type: Parameters<typeof emitEvent>[1], payload: Record<string, unknown>): void => {
    events.push(emitEvent(world, type, payload))
  }

  // 1) 依赖求值：可领取 / 退回可领取
  for (const id of outcomes.ready.becameReady) {
    push('task.changed', { id, ...taskPatch(world, id), reason: 'deps-done' })
  }
  for (const id of outcomes.ready.becamePending) {
    push('task.changed', { id, ...taskPatch(world, id), reason: 'deps-reopened' })
  }

  // 2) 派工：任务易主 + 角色上路
  for (const claim of outcomes.scheduler.claims) {
    push('task.changed', {
      id: claim.taskId,
      ...taskPatch(world, claim.taskId),
      attemptId: claim.attemptId,
    })
    push('agent.state', {
      id: claim.agentId,
      ...agentPatch(world, claim.agentId),
      task: claim.taskId,
      to: claim.stationId,
    })
  }

  // 3) 移动：修好的矛盾（要报出来，否则是静默卡死）+ 到站
  for (const id of outcomes.movement.repaired) {
    push('agent.state', { id, ...agentPatch(world, id), reason: 'repaired' })
  }
  for (const arrival of outcomes.movement.arrived) {
    push('agent.state', { id: arrival.agentId, ...agentPatch(world, arrival.agentId) })
  }

  // 3.5) 待命行为：状态转换（坐下 / 站起来 / 开始踱步 / 踱步停下）（R68 / R69）。
  //
  // 状态是**离散量**，而第 6 段那条帧事件带的是 `[id, x, z, facing]`——不带 `state`。
  // 所以每一次状态转换都必须在这里单独说一句，否则只收增量的客户端会一直显示他上一个状态，
  // 而两边的世界看起来都"正常"（`world-update.test.js` 的往返比对就是抓这个的）。
  //
  // R69 让这条更重要了：踱步现在会让状态在 `idle ↔ walking` 之间来回切，
  // 而"切了 walking"就是要让渲染器换到走路的带——**这条事件断了，真机上就还是站着滑**。
  for (const id of outcomes.idle.stateChanged) {
    push('agent.state', { id, ...agentPatch(world, id), reason: 'idle' })
  }
  // 自称在走路却连歇脚点都没有的人，由 idle 段收成 idle（原 movement 那条守卫，R69 换了主人）。
  for (const id of outcomes.idle.repaired) {
    push('agent.state', { id, ...agentPatch(world, id), reason: 'repaired' })
  }

  // 4) 干活：里程碑 + 完工
  for (const item of outcomes.work.progressed) {
    // 承上启下：`before` 由 after - delta 得出，所以这里不用再抄一遍 estimateTicks 的换算。
    const before = milestoneOf(item.progress - item.delta)
    const after = milestoneOf(item.progress)
    if (after > before) {
      push('task.changed', {
        id: item.taskId,
        ...taskPatch(world, item.taskId),
        milestone: after,
      })
    }
  }
  for (const done of outcomes.work.completed) {
    push('task.changed', { id: done.taskId, ...taskPatch(world, done.taskId) })
    push('agent.state', { id: done.agentId, ...agentPatch(world, done.agentId), reason: 'task-done' })
  }

  // 5) 消息：**在"开始飞"的那一刻发，而不是送达时发。**
  //
  // 这是 R6 留下的一个真实缺陷：原先只在送达时 emit，于是渲染层要等到 10 tick 之后
  // 才知道有纸条要飞——那时候它已经在两端了，"从 A 飞到 B"这段过程根本没数据可画。
  // 改成入队时发，并把 `deliverAtTick` 一起带上：渲染层据此知道飞行的起止时刻，
  // **不需要自己去抄一遍投递延迟常量**（两处真相，改一处就会让落点与"已送达"不一致）。
  // 送达因此不需要单独的事件——它的时刻是可以算出来的。
  for (const msg of outcomes.comms.queued) {
    push('message.sent', { id: msg.id, from: msg.from, to: msg.to, deliverAtTick: msg.deliverAtTick })
  }

  // 6) 帧：有位移**或朝向/坐站变化**才发。**这是唯一承载连续量的事件。**
  //
  // 客户端拿到它之后只更新这几个人（不是整个花名册）——这是"增量"的关键：
  // 一帧只带真的有变化的人，而不是 24 个角色的全量位置。
  //
  // 用 movement 返回的 `advanced` 而**不是**过滤 `state === 'walking'`：
  // 本 tick 到站的人已经切成 `working` 了，按状态过滤会把他漏掉，
  // 于是渲染层拿不到他的落位坐标，表现为"走到一半突然被吸过去"。
  //
  // `idle.acted`（R68）：**只换朝向/坐站、位置没动**的人也必须在里面。这一帧带的是
  // `[id, x, z, facing]` 四元组，位置不变、朝向我照样能带上；不发的话"张望"就永远上不了屏——
  // 而"待命的人在动"正是 R68 要解决的问题（那种漏发会长得和"功能没做"一模一样）。
  const advancedIds = [
    ...outcomes.movement.advanced,
    ...outcomes.idle.advanced,
    ...outcomes.idle.acted,
  ]
  if (advancedIds.length > 0) {
    const moved = new Set(advancedIds)
    push('world.tick', {
      agents: world.agents
        .filter((a) => moved.has(a.id))
        .map((a) => [a.id, a.position.x, a.position.z, a.facing] as const),
    })
  }

  return events
}
