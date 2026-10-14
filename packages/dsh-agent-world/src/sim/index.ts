/**
 * 模拟内核出口（BACKLOG M2）。
 *
 * 四个阶段函数都是**纯的（不碰 IO、不用未注入的随机/时间）**，且**不发事件**——
 * 它们返回"变了什么"，事件由 `step.ts` 的最后一段统一产出（M2-3/M2-7）。
 * 这样"事件从哪来"只有一个答案，单测各模块时也不带事件噪声。
 *
 * 每个阶段都会**就地修改传入的 `World`**。调用方要么拥有它，要么先克隆一份。
 */
export type { MovementOutcome } from './movement.js'
export { advanceMovement } from './movement.js'

export type { ReadyOutcome } from './ready.js'
export { isTaskReady, recomputeReady } from './ready.js'

export type { WorkOutcome } from './interaction.js'
export { advanceWork } from './interaction.js'

export type { Claim, SchedulerOutcome, Stalled } from './scheduler.js'
export { claimTasks, occupancyOf, pickStation } from './scheduler.js'
