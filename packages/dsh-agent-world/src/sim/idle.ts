/**
 * 待命角色的走动（BACKLOG M2.5-1）。
 *
 * ## 它修的是一个"看起来像 bug"的现象
 *
 * 角色只在被派活时才移动。所以**从没被派过活的人一步都不会走**——8 个人里 6 个待命时，
 * 6 个角色全叠在出生点上。俯视图里只看得到一个字符（其余被完全盖住），
 * 3D 场景里就是 6 个人穿在同一格里。
 *
 * 这不是设计疏漏，是设计**没覆盖到这里**：当初只写了"怎么去做工"，没写"没工可做时干嘛"。
 *
 * ## 为什么不给一个 `wandering` 状态
 *
 * `AgentState` 是显式枚举，加一个取值就要连带加一条 `actions` 内容（校验器要求
 * 每个状态都有动作，否则角色会僵在上一帧）。而这里要做的事其实很轻：
 * **朝歇脚点走**，不需要新状态、不需要计时器、不需要渲染层区分。
 * 所以复用的是 `idle` + 位置推进，改动面最小。
 *
 * 代价说清楚：`idle` 的语义变成了"没活干（可能正在走去歇脚点）"。
 * 渲染层按 `idle` 播"站立/等待"是对的——走动的姿态差异属于 M5 的动画层。
 *
 * ## 不发事件
 *
 * 返回"谁挪了"，帧事件由 `emit.ts` 统一合并产出（与其他阶段一样）。
 */
import { WALK_SPEED } from '../domain/constants.js'
import { angleTo, distance, stepToward } from '../domain/geometry.js'
import type { World } from '../domain/types.js'

/** 一次待命走动的结果。 */
export interface IdleOutcome {
  /** 本 tick 挪动过的角色 id（要并进帧事件）。 */
  advanced: string[]
  /** 本 tick 刚好走到歇脚点的角色 id（诊断用，不发事件）。 */
  settled: string[]
}

/**
 * 推进一 tick 的待命走动。
 *
 * **会就地修改 `world.agents` 的位置与朝向。**
 *
 * @param world - 世界（就地修改）。
 */
export function advanceIdle(world: World): IdleOutcome {
  const advanced: string[] = []
  const settled: string[] = []

  for (const agent of world.agents) {
    if (agent.state !== 'idle') continue
    const goal = agent.hangout
    if (goal === null) continue

    // 待命的人不该还挂着派工路径。真出现了就清掉——否则玩家会看到一个人
    // "待命中却在走向工位"，而那是上一轮派工留下的残渣。
    if (agent.path.length > 0) agent.path = []

    const remaining = distance(agent.position, goal)
    if (remaining <= WALK_SPEED) {
      // 到位：精确落点（不精确的话会永远差一点点，每 tick 都判一次"还没到"）。
      if (remaining > 0) {
        agent.position = { x: goal.x, z: goal.z }
        advanced.push(agent.id)
      }
      settled.push(agent.id)
      continue
    }

    const moved = stepToward(agent.position, goal, WALK_SPEED)
    agent.facing = angleTo(agent.position, goal)
    agent.position = moved.position
    advanced.push(agent.id)
  }

  return { advanced, settled }
}
