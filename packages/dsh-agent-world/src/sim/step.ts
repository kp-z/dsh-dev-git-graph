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
import type { AgentRole, World, WorldEvent } from '../domain/types.js'
import type { WorldCommand } from '../protocol/wire/commands.js'
import { advanceMovement } from './movement.js'
import { advanceWork } from './interaction.js'
import { advanceIdle } from './idle.js'
import { dispatchComms } from './comms.js'
import type { CommsOutcome } from './comms.js'
import type { DeliverOutcome } from './mailbox.js'
import { deliverMessages } from './mailbox.js'
import { emitPhaseEvents } from './emit.js'
import { emitEvent } from './journal.js'
import { recomputeReady } from './ready.js'
import { claimTasks } from './scheduler.js'
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
}

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
}

function emptyRequests(): StepRequests {
  return { reset: null, dispatch: [], hire: [], setSpeed: null }
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
): { type: 'world.paused'; payload: Record<string, unknown> }[] {
  const paused: { type: 'world.paused'; payload: Record<string, unknown> }[] = []

  for (const command of commands) {
    switch (command.kind) {
      case 'pause':
        if (!world.paused) {
          world.paused = true
          paused.push({ type: 'world.paused', payload: { paused: true } })
        }
        break
      case 'resume':
        if (world.paused) {
          world.paused = false
          paused.push({ type: 'world.paused', payload: { paused: false } })
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
    }
  }

  return paused
}

/**
 * 推进一 tick。
 *
 * @param world - 世界（**就地修改**）。
 * @param commands - 本 tick 收到的命令；默认空。
 * @returns 本 tick 的事件、派工、诊断与转交动作。
 */
export function step(world: World, commands: readonly WorldCommand[] = []): StepResult {
  const requests = emptyRequests()
  const events: WorldEvent[] = []

  // ── 1. ingest ──
  // 先处理命令：暂停时**也要**能收到 resume，所以这一段在暂停判断之前。
  for (const item of ingest(world, commands, requests)) {
    events.push(emitEvent(world, item.type, item.payload))
  }

  // 暂停时世界不推进。**注意 `world.tick` 也不加**——tick 是"世界前进了多少"，
  // 暂停期间它不该动，否则 HUD 上会出现"暂停了但时间还在走"。
  if (world.paused) {
    return { world, events, claims: [], stalled: [], requests, messages: [], delivered: [] }
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
  const idle = advanceIdle(world)

  // ── 4. interaction ──
  const work = advanceWork(world)

  // ── 4.5 comms ──
  // 产生协作消息（M2.5-2）。放在 interaction 之后，才能把"本 tick 刚完工的单"报出去。
  // 注意：这里只是**入队**，真正的送达由下面的 mailbox 段按延迟推进。
  const comms = dispatchComms(world, scheduled.claims, work.completed)

  // ── 5. mailbox ──
  const mailbox = deliverMessages(world)

  // ── 6. emit ──
  events.push(...emitPhaseEvents(world, { ready, scheduler: scheduled, movement, idle, work, comms }))

  // tick 在最后自增：上面所有阶段的 `world.tick` 读到的都是"这一步的编号"，
  // 事件的时间戳也因此一致。放在开头加会让事件落在下一个 tick 上，差一帧。
  world.tick += 1

  return {
    world,
    events,
    claims: scheduled.claims,
    stalled: scheduled.stalled,
    requests,
    messages: comms.queued,
    delivered: mailbox.delivered,
  }
}
