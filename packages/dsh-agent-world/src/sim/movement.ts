/**
 * 移动（BACKLOG M2-5）。
 *
 * 把 `walking` 的角色沿 `path` 推向目标站点，到站切 `working`。
 *
 * ## 路径由调度器给，这里不负责找路
 *
 * 调度器 claim 一张工单时就决定了"去哪个站点的哪个座位"，并把路径写进 `agent.path`。
 * 本模块只做**位置推进**。这样切分的好处是：以后换成网格 A\* 或 navmesh，
 * 改的是"路径怎么算出来"（在调度器/寻路模块里），而"怎么沿路走"一行不动。
 *
 * 当前 path 只有一个点（站点座位）。做出真正的绕障路径时，这里的循环逻辑不用改。
 *
 * ## 不在这里发事件
 *
 * 返回"谁动了、谁到了"，事件由 `step.ts` 统一产出。
 */
import { WALK_SPEED } from '../domain/constants.js'
import { angleTo, stepToward } from '../domain/geometry.js'
import type { World } from '../domain/types.js'

/** 一次移动推进的结果。 */
export interface MovementOutcome {
  /** 本 tick 位置发生变化的角色 id。 */
  advanced: string[]
  /** 本 tick 抵达站点并转入 `working` 的角色。 */
  arrived: { agentId: string; stationId: string }[]
  /**
   * 因状态自相矛盾被就地修好的角色 id。
   *
   * 判据：自称 `walking` 但没有目标、或目标站点不存在。这类角色如果不修，
   * 会永远卡在"走路"状态上不动——**静默卡死**是最难查的一类问题，宁可就地修好并报出来。
   */
  repaired: string[]
}

/**
 * 推进一 tick 的移动。
 *
 * **会就地修改 `world.agents`。**
 *
 * @param world - 世界（就地修改）。
 */
export function advanceMovement(world: World): MovementOutcome {
  const stations = new Map(world.stations.map((s) => [s.id, s]))
  const advanced: string[] = []
  const arrived: MovementOutcome['arrived'] = []
  const repaired: string[] = []

  for (const agent of world.agents) {
    if (agent.state !== 'walking') continue

    const targetId = agent.targetStation
    const station = targetId === null ? undefined : stations.get(targetId)

    if (targetId === null || station === undefined) {
      // 自称在走路却没有（有效的）目标：修好，别让它卡住。
      agent.targetStation = null
      agent.path = []
      agent.state = 'idle'
      repaired.push(agent.id)
      continue
    }

    const next = agent.path[0]
    if (next === undefined) {
      // 路径走完 = 到站。位置已经在到达最后一点时精确落位，这里只切状态。
      agent.station = station.id
      agent.targetStation = null
      agent.state = 'working'
      arrived.push({ agentId: agent.id, stationId: station.id })
      continue
    }

    const moved = stepToward(agent.position, next, WALK_SPEED)
    // 朝向只在真的移动时更新：站在原地面朝跳变看起来像抽帧。
    if (!moved.arrived) agent.facing = angleTo(agent.position, next)
    agent.position = moved.position
    advanced.push(agent.id)
    if (moved.arrived) agent.path.shift()
  }

  return { advanced, arrived, repaired }
}
