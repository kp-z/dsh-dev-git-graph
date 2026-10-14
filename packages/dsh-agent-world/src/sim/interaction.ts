/**
 * 干活推进（BACKLOG M2-5b）。
 *
 * `working` 的角色推进手头工单的 `progress`，到 1 就完工。
 *
 * ## 进度按内容库声明的 `estimateTicks` 走
 *
 * 任务在内容库里可以声明"预估要多少 tick"。既然声明了，就让它**真的有意义**：
 * 每一步推进 `1 / estimateTicks`。没声明的用 `DEFAULT_TASK_TICKS` 兜底。
 * 不然 `estimateTicks` 就只是个给 HUD 看的装饰数字，而"显示 3 分钟、实际 25 秒"
 * 比不显示还糟。
 *
 * ## 完工后角色会**离开站点**
 *
 * 这是刻意的：站点容量是稀缺资源（4 张能写代码的工位）。如果完工的角色赖在工位上，
 * 高峰期会死锁——所有工位被"已经干完活的人"占着，新工单永远派不出去。
 * 所以完工即释放：清 `station`，角色就地站住（位置不动），状态回 `idle`。
 *
 * "走回休息区"是表现层的事（M6），不入模拟状态——**庆祝同理**：
 * `celebrating` 这个状态留给渲染层对完工事件做反应，不必让模拟内核多维护一个计时器。
 */
import { DEFAULT_TASK_TICKS } from '../domain/constants.js'
import type { World } from '../domain/types.js'

/** 一次干活推进的结果。 */
export interface WorkOutcome {
  /** 本 tick 有推进的（任务, 角色）。 */
  progressed: { taskId: string; agentId: string; progress: number }[]
  /** 本 tick 完工的（任务, 角色）。 */
  completed: { taskId: string; agentId: string; stationId: string | null }[]
}

/**
 * 推进一 tick 的干活进度。
 *
 * **会就地修改 `world.tasks` 与 `world.agents`。**
 *
 * @param world - 世界（就地修改）。
 */
export function advanceWork(world: World): WorkOutcome {
  const tasks = new Map(world.tasks.map((t) => [t.id, t]))
  const progressed: WorkOutcome['progressed'] = []
  const completed: WorkOutcome['completed'] = []

  for (const agent of world.agents) {
    if (agent.state !== 'working') continue
    const taskId = agent.carrying
    if (taskId === null) continue

    const task = tasks.get(taskId)
    // 状态自相矛盾（任务没了 / 不是他的 / 不在进行中）：把人放回 idle，别让他僵着。
    if (task === undefined || task.status !== 'in_progress' || task.owner !== agent.id) {
      agent.carrying = null
      agent.state = 'idle'
      continue
    }

    const ticks = task.estimateTicks !== null && task.estimateTicks > 0 ? task.estimateTicks : DEFAULT_TASK_TICKS
    task.progress = Math.min(1, task.progress + 1 / ticks)
    progressed.push({ taskId, agentId: agent.id, progress: task.progress })

    if (task.progress >= 1) {
      const stationId = task.station
      task.status = 'done'
      task.progress = 1
      task.finishedAtTick = world.tick
      task.station = null

      agent.carrying = null
      agent.state = 'idle'
      agent.station = null
      agent.targetStation = null
      agent.path = []

      completed.push({ taskId, agentId: agent.id, stationId })
    }
  }

  return { progressed, completed }
}
