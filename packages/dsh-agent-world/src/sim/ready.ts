/**
 * 依赖求值（BACKLOG M2-1）。
 *
 * ## 这是 `ready` 状态**唯一**的实现点
 *
 * `TaskStatus.ready` 是**派生**状态，不是任何人直接设置的：
 * 所有 `blockedBy` 都 `done` ⇒ `pending` 变 `ready`。
 *
 * 为什么强调"唯一"：如果调度器、HUD、工具各自判断一次"依赖满没满足"，
 * 三个地方总有一天会对同一张工单给出不同答案。而那种不一致最难查——
 * 每一处单独看都对。所以：**谁想知道一张单能不能开工，都来调 `isTaskReady()`。**
 *
 * ## 不在这里发事件
 *
 * 本函数是纯的（只读 world、改 status），把"变了什么"作为返回值交出去。
 * 事件统一由 `step.ts` 的最后一段产出——这样"事件从哪来"只有一个答案，
 * 也便于单测这个模块时不带事件噪声。
 */
import type { Task, World } from '../domain/types.js'

/** 一次依赖求值的结果。 */
export interface ReadyOutcome {
  /** 本次从 `pending` 变成 `ready` 的任务 id（按 world.tasks 顺序）。 */
  becameReady: string[]
  /**
   * 本次从 `ready` **退回** `pending` 的任务 id。
   *
   * 正常情况下不该发生；会发生是因为依赖被重新打开（例如任务被重置）。
   * 有这条兜底，世界不会卡在"依赖没了但单还是可领取"这种自相矛盾的状态上。
   */
  becamePending: string[]
  /** 求值之后处于 `ready` 的全部任务 id。 */
  ready: string[]
}

/**
 * 一张工单的前置是否都完成了。
 *
 * **依赖指向一个不存在的任务时返回 false**（不是"当成没依赖"）：
 * 宁可这张单永远不开工，也不要基于一个"消失了的前置"做出"可以开工"的判断。
 *
 * @param world - 世界。
 * @param task - 要判断的工单。
 */
export function isTaskReady(world: World, task: Task): boolean {
  for (const depId of task.blockedBy) {
    const dep = world.tasks.find((t) => t.id === depId)
    if (dep === undefined || dep.status !== 'done') return false
  }
  return true
}

/**
 * 重算全部工单的 `pending` / `ready` 状态。
 *
 * **会就地修改 `world.tasks` 的 status。** 调用方要么拥有这个世界，要么先克隆一份。
 *
 * @param world - 世界（就地修改）。
 * @returns 变了什么。
 */
export function recomputeReady(world: World): ReadyOutcome {
  const becameReady: string[] = []
  const becamePending: string[] = []
  const ready: string[] = []

  // 依赖只可能是"更早创建"的任务，所以一趟顺序遍历就够，不需要迭代到不动点。
  for (const task of world.tasks) {
    if (task.status === 'pending') {
      if (isTaskReady(world, task)) {
        task.status = 'ready'
        becameReady.push(task.id)
      }
    } else if (task.status === 'ready') {
      if (!isTaskReady(world, task)) {
        task.status = 'pending'
        becamePending.push(task.id)
      }
    }
    if (task.status === 'ready') ready.push(task.id)
  }

  return { becameReady, becamePending, ready }
}
