/**
 * 模拟一步（BACKLOG M2-3）。
 *
 * ## 六段固定顺序
 *
 * ```
 * ingest → scheduler → movement → interaction → mailbox → emit
 * ```
 *
 * 顺序是语义的一部分，不是风格：
 * - `ingest` 在最前，所以"这一 tick 收到的命令"立刻影响这一 tick 的世界；
 * - `scheduler` 在 `movement` 前，所以刚被派出去的人**这一 tick 就开始走**；
 * - `interaction` 在 `movement` 后，所以**到站当 tick 就能开始干活**；
 * - `emit` 在最后，所以它看到的是这一 tick 的最终状态。
 *
 * `scheduler` 段的第一件事是 `recomputeReady()`——调度器的输入必须是"依赖已求值"的状态，
 * 而这个求值全世界只有那一处实现（见 `ready.ts`）。
 *
 * ## 签名里没有 `dt`，这是刻意的
 *
 * 原计划是 `step(world, dt, commands)`。但**这是定步长模拟**：一次调用 = 前进一个 tick，
 * `dt` 永远等于 `tickMs`，收到它却不用它只会让人以为"传别的值会改变结果"。
 * 步长属于编排层（`runtime` 决定多久调一次 `step`），不属于模拟内核。
 *
 * ## 模拟内核不认识内容库，所以有些命令它做不了
 *
 * `reset` / `dispatch` / `hire` 都需要**内容**（场景布局、任务集、花名册），
 * 而 `sim/` 按边界规则不许 import `content/`。所以 `step()` 把它们**转交**出去，
 * 放在 `StepResult.requests` 里由编排层执行。
 *
 * 这不是权宜之计，而是那条边界规则在起作用：模拟内核只认装配好的 `World`。
 * 顺带的好处是 `step()` 可以在**没有任何内容注册表**的情况下被测试。
 *
 * ## "纯"的含义
 *
 * `step()` **就地修改传入的 world 并返回它**（同一个引用）。"纯"指的是：
 * 不碰 IO、不用未注入的随机与时间。调用方要么拥有这个世界，要么先克隆一份。
 */
import type {
  WorldEventType, AgentRole, World, WorldEvent } from '../domain/types.js'
import type { WorldCommand } from '../protocol/wire/commands.js'
import { advanceMovement } from './movement.js'
import { advanceWork } from './interaction.js'
import { advanceIdle } from './idle.js'
import { recoverStalledTasks } from './recovery.js'
import type { StepContext } from '../protocol/idle.js'
import { dispatchComms } from './comms.js'
import type { CommsOutcome } from './comms.js'
import type { DeliverOutcome } from './mailbox.js'
import { deliverMessages } from './mailbox.js'
import { runHeartbeats } from './heartbeat.js'
import { emitPhaseEvents } from './emit.js'
import { emitEvent } from './journal.js'
import { recomputeReady } from './ready.js'
import { claimTasks, occupancyOf } from './scheduler.js'
import { findPath } from './pathfind.js'
import { stationSlot } from '../domain/geometry.js'
import type { Claim, Stalled } from './scheduler.js'

/**
 * 模拟内核做不了、要转交给编排层的动作。
 *
 * 每一项都需要内容注册表（`sim/` 按边界规则不许 import `content/`）。
 */
export interface StepRequests {
  /** 要重开一局（需要场景与内容）。 */
  reset: { name: string | null } | null
  /** 要用任务库派进世界的任务集 id。 */
  dispatch: string[]
  /** 要招募的角色（需要花名册）。 */
  hire: { role: AgentRole; name: string | null }[]
  /** 要设置的真实时间倍速（编排层的事，不影响模拟结果）。 */
  setSpeed: number | null
  /**
   * 外部（agent-teams）对工单的裁决（D41，R39）。
   *
   * **这些就地改世界，与 `dispatch`/`hire` 不同**——那两个要内容库才能落（由编排层完成），
   * 而"某张单被派给谁 / 做完了 / 失败了"是纯粹的既有事实，模拟内核自己能落。
   * 而且它们必须**在同一 tick 内生效**：否则面板上会出现"人还在工位上忙，但单已经完成"的一帧。
   */
  external: ExternalTaskCommand[]
}

/** 外部裁决一条工单（D41）。 */
export type ExternalTaskCommand =
  | { readonly kind: 'taskAssign'; readonly taskId: string; readonly agentId: string; readonly attemptId: string }
  | { readonly kind: 'taskComplete'; readonly taskId: string; readonly attemptId: string; readonly output: string | null }
  | { readonly kind: 'taskFail'; readonly taskId: string; readonly attemptId: string; readonly reason: string }
  | { readonly kind: 'taskLink'; readonly taskId: string; readonly externalId: string }

/** 一步的结果。 */
export interface StepResult {
  /** 就是传进来的那个 world（就地修改）。 */
  world: World
  /** 本 tick 产生的事件（`seq` 单调，已写进 `world.events`）。 */
  events: WorldEvent[]
  /** 本 tick 派出去的工。 */
  claims: Claim[]
  /** 派不出去的原因（诊断用，**刻意不发事件**——没空闲角色时每 tick 都成立，发出来只会刷屏）。 */
  stalled: Stalled[]
  /** 转交给编排层的动作。 */
  requests: StepRequests
  /** 本 tick 新开始飞行的协作消息（M2.5-2）。 */
  messages: CommsOutcome['queued']
  /** 本 tick 送达的消息（诊断用；**不发事件**——送达时刻由 `deliverAtTick` 算得出来）。 */
  delivered: DeliverOutcome['delivered']
  /**
   * 本 tick 被**不变量修复**退回 ready 的单（R151 / task-25）。
   *
   * 放在这里而不是只发事件：真机验收要能"读到"它（`/api/world` 不含 StepResult，
   * 但测试与诊断可以拿它断言"回收确实发生了、回收了几张"）。
   */
  recovered: { taskId: string; ownerId: string | null; stalledTicks: number }[]
}

function emptyRequests(): StepRequests {
  return { reset: null, dispatch: [], hire: [], setSpeed: null, external: [] }
}

/**
 * 处理命令阶段：能就地做的就地做，需要内容的转交出去。
 *
 * @param world - 世界（就地修改 `paused`）。
 * @param commands - 本 tick 收到的命令。
 * @param requests - 要在其上累加转交项的容器（就地修改）。
 * @returns 本阶段产生的事件载荷（由调用方交给 `journal` 记账）。
 */
function ingest(
  world: World,
  commands: readonly WorldCommand[],
  requests: StepRequests,
): { type: WorldEventType; payload: Record<string, unknown> }[] {
  const out: { type: WorldEventType; payload: Record<string, unknown> }[] = []

  for (const command of commands) {
    switch (command.kind) {
      case 'pause':
        if (!world.paused) {
          world.paused = true
          out.push({ type: 'world.paused', payload: { paused: true } })
        }
        break
      case 'resume':
        if (world.paused) {
          world.paused = false
          out.push({ type: 'world.paused', payload: { paused: false } })
        }
        break
      case 'reset':
        requests.reset = { name: command.name }
        break
      case 'dispatch':
        requests.dispatch.push(command.taskSet)
        break
      case 'hire':
        requests.hire.push({ role: command.role, name: command.name })
        break
      case 'setSpeed':
        requests.setSpeed = command.speed
        break
      case 'taskAssign':
      case 'taskComplete':
      case 'taskFail':
      case 'taskLink':
        requests.external.push(command)
        break
      case 'agentActivity': {
        const agent = world.agents.find((item) => item.id === command.agentId)
        if (agent === undefined) break
        if (command.activity === 'idle') {
          agent.state = 'idle'
          agent.station = null
          agent.targetStation = null
          agent.path = []
          delete agent.activityKind
          delete agent.activityUntil
          break
        }
        const wants = command.activity === 'meet' ? ['converse'] : command.activity === 'rest' ? ['rest'] : [command.skill ?? 'code']
        const station = world.stations.find((candidate) =>
          candidate.capabilities.some((capability) => wants.includes(capability)) && occupancyOf(world, candidate.id) < candidate.capacity)
        if (station === undefined) break
        const path = findPath(world.nav, agent.position, stationSlot(station, occupancyOf(world, station.id)))
        if (path.length === 0) break
        agent.state = 'walking'
        agent.station = null
        agent.targetStation = station.id
        agent.path = path
        agent.activityKind = command.activity
        agent.activityUntil = world.tick + Math.max(5, Math.round(command.ticks))
        break
      }
      case 'moveAgent': {
        // 键盘操控落地（P4）。**服务端权威**：位置写进世界，客户端才不会被同步拽回去。
        const agent = world.agents.find((item) => item.id === command.agentId)
        if (agent === undefined) break
        // 坏坐标直接拒：NaN 一旦写进位置，寻路/渲染/快照全都会跟着坏掉。
        if (!Number.isFinite(command.x) || !Number.isFinite(command.z)) break

        // ⚠️ R229 纠正：这里**不再按 nav 格夹回**。
        //
        // R226 用"整格不可走"把手动落点夹到最近格中心。但 nav 是保守的整格网格，
        // 而墙/家具的美术只占格子的一部分（office 248 个 blocked 格里 113 个是部分覆盖），
        // 按格夹回会在视觉是地板的地方把人拽回来——用户报的"空气墙错位"。
        //
        // 物理真相是**精细几何**（客户端 Arcade 静态体，按美术轮廓建）。手动操控本来就是
        // 客户端权威；服务端只负责拒绝坏坐标（NaN/Infinity），不再用粗网格二次判定。
        const landed = { x: command.x, z: command.z }
        agent.position = { x: landed.x, z: landed.z }
        // 待命踱步以 `hangout` 为锚：不跟着走的话，下一 tick 待命逻辑会把他往旧歇脚点拽。
        agent.hangout = { x: landed.x, z: landed.z }
        // 清掉在途状态：路径、目标工位、在站标记——他现在就是"玩家放下的人"。
        agent.path = []
        agent.targetStation = null
        agent.station = null
        agent.state = 'idle'
        out.push({
          type: 'agent.moved',
          payload: { id: agent.id, x: landed.x, z: landed.z, source: 'manual' },
        })
        break
      }
    }
  }

  return out
}

/**
 * 把外部裁决落到世界里（D41，R39）。
 *
 * 三条纪律：
 * 1. **认 `attemptId`**：agent-teams 的执行代一变，旧的完成汇报就该被拒——
 *    否则"重新指派之后，上一个执行者的结果把新单标成完成"。空串表示对方没给代次（放行）。
 * 2. **幂等**：已经 done/failed 的单不再改（同步是轮询的，同一件事会被看到很多次）。
 * 3. **指派要连带落位**：人得从当前状态切到"去做这张单"，否则他只是站在广场上，
 *    而工单板说他在忙——那是画面与数据打架。
 *
 * @param world - 世界（就地修改）。
 * @param commands - 本 tick 收到的外部裁决。
 * @returns 要记账的事件载荷。
 */
function applyExternalTasks(
  world: World,
  commands: readonly ExternalTaskCommand[],
): { type: WorldEventType; payload: Record<string, unknown> }[] {
  const events: { type: WorldEventType; payload: Record<string, unknown> }[] = []
  const byId = new Map(world.tasks.map((t) => [t.id, t]))

  for (const command of commands) {
    const task = byId.get(command.taskId)
    if (task === undefined) continue

    // 对应关系：只在还没对应时写（幂等；同一张单不许被改接到另一张团队任务上）。
    if (command.kind === 'taskLink') {
      if (task.externalId === null && command.externalId !== '') {
        task.externalId = command.externalId
        // 一旦有单接上团队，世界就是 live：完成只认团队的裁决（D41）。
        world.mode = 'live'
        events.push({ type: 'task.changed', payload: { taskId: task.id, externalId: command.externalId } })
      }
      continue
    }

    // ① 代次不对：这条裁决属于上一代执行者，丢掉。
    const stale = command.attemptId !== '' && task.attemptId !== null && task.attemptId !== command.attemptId

    if (command.kind === 'taskAssign') {
      // 指派**不做旧代检查**：指派本身就是团队开启新一代，它的代次就是新的真相，要被采纳。
      // （R43 真机：小镇先自己派了、写下自己的代次，若对指派也做旧代检查，团队永远接管不了。）
      if (task.status === 'done' || task.status === 'failed') continue
      const agent = world.agents.find((a) => a.id === command.agentId)
      if (agent === undefined) continue
      if (task.owner === agent.id && task.status === 'in_progress') continue

      // 换人时把上一个人从这张单上摘下来（否则他永远"在忙一张不属于他的单"）。
      if (task.owner !== null && task.owner !== agent.id) {
        const previous = world.agents.find((a) => a.id === task.owner)
        if (previous !== undefined && previous.carrying === task.id) {
          previous.carrying = null
          previous.state = 'idle'
        }
      }
      const ownerChanged = task.owner !== agent.id
      task.owner = agent.id
      task.attemptId = command.attemptId === '' ? task.attemptId : command.attemptId
      // 状态交给调度器在下一 tick 领：它才知道该去哪张桌子（能力匹配在 `claimTasks` 里）。
      // 换了人的进行中单要退回 ready：原来的工位与进度属于上一个人。
      if (task.status === 'pending' || task.status === 'blocked' || (ownerChanged && task.status === 'in_progress')) {
        task.status = 'ready'
        task.station = null
        task.progress = 0
      }
      events.push({ type: 'task.assigned', payload: { taskId: task.id, agentId: agent.id } })
      continue
    }

    if (stale) continue
    if (task.status === 'done' || task.status === 'failed') continue

    const owner = task.owner === null ? undefined : world.agents.find((a) => a.id === task.owner)
    if (owner !== undefined && owner.carrying === task.id) {
      owner.carrying = null
      owner.state = 'idle'
      owner.station = null
      owner.targetStation = null
      owner.path = []
    }

    if (command.kind === 'taskComplete') {
      task.status = 'done'
      task.progress = 1
      task.finishedAtTick = world.tick
      task.station = null
      task.output = command.output
      events.push({ type: 'task.completed', payload: { taskId: task.id, agentId: task.owner, stationId: null } })
    } else {
      task.status = 'failed'
      task.failureReason = command.reason
      events.push({ type: 'task.failed', payload: { taskId: task.id, reason: command.reason } })
    }
  }
  return events
}

/**
 * 推进一 tick。
 *
 * @param world - 世界（**就地修改**）。
 * @param commands - 本 tick 收到的命令；默认空。
 * @param context - 本 tick 的内容上下文（待命行为目录）；默认空 = 老行为。
 * @returns 本 tick 的事件、派工、诊断与转交动作。
 */
export function step(
  world: World,
  commands: readonly WorldCommand[] = [],
  context: StepContext = {},
): StepResult {
  const requests = emptyRequests()
  const events: WorldEvent[] = []

  // ── 1. ingest ──
  // 先处理命令：暂停时**也要**能收到 resume，所以这一段在暂停判断之前。
  for (const item of ingest(world, commands, requests)) {
    events.push(emitEvent(world, item.type, item.payload))
  }

  // 外部裁决在**同一 tick 内**落地（见 `StepRequests.external` 的说明）。
  // 放在暂停判断之前：暂停是"模拟不推进"，不是"外部事实不算数"——
  // 团队里的活不会因为我们按了暂停就停下来，单完成了就该显示完成。
  for (const item of applyExternalTasks(world, requests.external)) {
    events.push(emitEvent(world, item.type, item.payload))
  }

  // 暂停时世界不推进。**注意 `world.tick` 也不加**——tick 是"世界前进了多少"，
  // 暂停期间它不该动，否则 HUD 上会出现"暂停了但时间还在走"。
  if (world.paused) {
    return { world, events, claims: [], stalled: [], requests, messages: [], delivered: [], recovered: [] }
  }

  // ── 2. scheduler ──
  // 输入必须是"依赖已求值"的状态，而这个求值全世界只有 ready.ts 一处实现。
  const ready = recomputeReady(world)
  const scheduled = claimTasks(world)

  // ── 3. movement ──
  const movement = advanceMovement(world)

  // ── 3.5 idle ──
  // 待命角色走向歇脚点（M2.5-1）。**放在 movement 之后**：movement 只处理 `walking`，
  // 而这一步只处理 `idle`，两者互不重叠；但刚被派工的人这一 tick 已经是 `walking` 了，
  // 所以不会被这里再挪一次。
  const idle = advanceIdle(world, context.idleBehaviors ?? [])

  // ── 4. interaction ──
  const work = advanceWork(world)

  // ── 4.5 comms ──
  // 产生协作消息（M2.5-2）。放在 interaction 之后，才能把"本 tick 刚完工的单"报出去。
  // 注意：这里只是**入队**，真正的送达由下面的 mailbox 段按延迟推进。
  const comms = dispatchComms(world, scheduled.claims, work.completed)

  // ── 5. mailbox ──
  const mailbox = deliverMessages(world)
  const heartbeat = runHeartbeats(world, mailbox.delivered)
  const allMessages = { queued: [...comms.queued, ...heartbeat.sent] }
  const intentEvents = heartbeat.intents.map((intent) => emitEvent(world, 'agent.intent', { ...intent }))

  // ── 5.5 不变量修复（R151 / task-25）──
  // **放在所有阶段之后、`world.tick += 1` 之前**：此时本 tick 的状态已经定格，
  // "这个人到底在不在推进那张单"才是最终答案（放在中间会被后续阶段改写，造成假报）。
  //
  // 这一段的职责是把"在进行中却没人推进"的单**退回 ready**（理由见 `recovery.ts` 头注释）。
  // 它和 `idle.ts` 入口那条"押着单的人不算空闲"是一对：那条防再犯，这条收已经卡住的。
  const recovery = recoverStalledTasks(world)

  // ── 6. emit ──
  events.push(...intentEvents, ...emitPhaseEvents(world, { ready, scheduler: scheduled, movement, idle, work, comms: allMessages }))

  // tick 在最后自增：上面所有阶段的 `world.tick` 读到的都是"这一步的编号"，
  // 事件的时间戳也因此一致。放在开头加会让事件落在下一个 tick 上，差一帧。
  world.tick += 1

  return {
    world,
    events,
    claims: scheduled.claims,
    stalled: scheduled.stalled,
    requests,
    messages: allMessages.queued,
    delivered: mailbox.delivered,
    recovered: recovery.recovered,
  }
}
