/**
 * 模拟内核出口（BACKLOG M2）。
 *
 * 设计：**阶段函数只返回"变了什么"，事件只从 `emit.ts` 一处产出。**
 * 阶段函数都是纯的（不碰 IO、不用未注入的随机与时间），各自可单独测。
 *
 * `step()` 把它们按固定顺序串起来，并**就地修改**传入的 `World`。
 * 模拟内核不认识内容库，所以 `reset` / `dispatch` / `hire` 会被转交出去
 * （见 `step.ts` 的 `StepRequests`）。
 */
export type { MovementOutcome } from './movement.js'
export { advanceMovement } from './movement.js'

export type { ReadyOutcome } from './ready.js'
export { isTaskReady, recomputeReady } from './ready.js'

export type { WorkOutcome } from './interaction.js'
export { advanceWork } from './interaction.js'

export type { IdleOutcome } from './idle.js'
export { advanceIdle } from './idle.js'

export type { CommsOutcome } from './comms.js'
export { dispatchComms } from './comms.js'

export type { Claim, SchedulerOutcome, Stalled } from './scheduler.js'
export { claimTasks, occupancyOf, pickStation } from './scheduler.js'

export type { DeliverOutcome, MessageDraft, SendOutcome } from './mailbox.js'
export { deliverMessages, isInFlight, sendMessages } from './mailbox.js'

export { emitEvent } from './journal.js'

export type { PhaseOutcomes } from './emit.js'
export { emitPhaseEvents } from './emit.js'

export type { StepRequests, StepResult } from './step.js'
export { step } from './step.js'
