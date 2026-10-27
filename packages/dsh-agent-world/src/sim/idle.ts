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
import { findPath, cellOf, isWalkable } from './pathfind.js'
import { angleTo, distance, stepToward } from '../domain/geometry.js'
import { idleSlotAt, paceGoal } from './idle-behavior.js'
import type { IdleBehaviorPlan } from '../protocol/idle.js'
import type { World } from '../domain/types.js'
import { holdsUnfinishedTask } from './recovery.js'

/** 一次待命走动的结果。 */
export interface IdleOutcome {
  /** 本 tick 挪动过的角色 id（要并进帧事件）。 */
  advanced: string[]
  /** 本 tick 刚好走到歇脚点的角色 id（诊断用，不发事件）。 */
  settled: string[]
  /**
   * 本 tick **行为上发生了变化**的角色 id（换了朝向）。
   *
   * 为什么与 `advanced` 分开：`advanced` 的语义是"位置动了"，帧事件按它发。
   * 换朝向不动位置，但也必须让渲染器知道"这一帧他和上一帧不一样"。
   */
  acted: string[]
  /**
   * 本 tick **状态变过**的角色 id（坐下 / 站起来 / 开始踱步 / 踱步停下）。
   *
   * 状态是**离散量**，而 `world.tick` 帧事件带的是 `[id, x, z, facing]`——不带 `state`。
   * 所以每一次状态转换都必须单独发 `agent.state`，否则只收增量的客户端会显示他上一个状态，
   * 而两边的世界看起来都"正常"（R68 真的踩到过：`world-update.test.js` 的往返比对抓出来的）。
   */
  stateChanged: string[]
  /**
   * 本 tick 被**收成 idle** 的"自称在走路、却推不动"的角色 id。
   *
   * 这是 movement.ts 原来那条守卫搬过来的：那种角色本来由 movement 修，
   * 但 R69 起 movement 只认领**有目标工位**的走路（见那边的两个主人表），
   * 于是"连歇脚点都没有的 walking"没人管——不收就是**静默卡死**，最难查的一类。
   */
  repaired: string[]
}

/**
 * 推进一 tick 的待命走动 + 待命行为。
 *
 * **会就地修改 `world.agents` 的位置、朝向与状态。**
 *
 * @param world - 世界（就地修改）。
 * @param behaviors - 待命行为目录（来自内容库 `actions`；空数组 = 不编排，退回老行为）。
 */
export function advanceIdle(world: World, behaviors: readonly IdleBehaviorPlan[] = []): IdleOutcome {
  const advanced: string[] = []
  const settled: string[] = []
  const acted: string[] = []
  const stateChanged: string[] = []
  const repaired: string[] = []

  // "有单子在等人领"用的是调度器自己的口径（`status === 'ready'`）——**不重复它的角色匹配**，
  // 只要队列非空就不许有人歇着。宁可少歇一会儿，也不能让"整队人都在坐着"卡住派工：
  // 调度器只从 `state === 'idle'` 里挑人（`scheduler.ts` 的 `idleAgents`），
  // 坐着的（`sleeping`）不在候选里。
  const workWaiting = world.tasks.some((task) => task.status === 'ready')

  const tasksById = new Map(world.tasks.map((task) => [task.id, task]))
  for (const agent of world.agents) {
    // R363：主动开会/休息驻留：到点散会，清站点，回 idle。
    if (agent.activityUntil !== undefined && (agent.state === 'talking' || agent.state === 'sleeping' || (agent.state === 'working' && agent.activityKind === 'work'))) {
      if (world.tick < agent.activityUntil) continue
      agent.state = 'idle'
      agent.station = null
      agent.targetStation = null
      agent.path = []
      delete agent.activityKind
      delete agent.activityUntil
      stateChanged.push(agent.id)
      continue
    }
    // 歇会儿用的 `sleeping` 也由这一段管：它是待命行为的产物，没有别的地方设置它。
    const resting = agent.state === 'sleeping'
    // R69：**没有目标工位的 `walking` 是待命踱步**，主人是这里（判据与 `movement.ts` 成对，
    // 见那边的两个主人表）。认领它，否则刚设成 walking 的人下一 tick 就被当成坏数据修掉。
    const ambientWalking = agent.state === 'walking' && agent.targetStation === null
    /**
     * **手上押着一张还在进行中的单的人，不算空闲**（R151 第 1 条 / task-25）。
     *
     * 这是 R150 死锁的**第一个门**：`idle.ts` 的入口原先只看 `state`，于是拿着单却没在干活的人
     * （`interaction.ts` 只认 `state === 'working'`）被待命流程当成空闲的人拉去歇脚点，
     * 从此永远回不到工位——而调度器又因为 `carrying !== null` 不派新活，两头都堵死。
     *
     * 这里**只排除待命流程**，不做恢复：真正的修复由 `recovery.ts` 按不变量把单退回 ready。
     * 两条一起才闭得住：这条保证"不会再被拉走"，那条保证"已经卡住的能被收回"。
     */
    if (holdsUnfinishedTask(agent, tasksById)) continue
    if (agent.state !== 'idle' && !resting && !ambientWalking) continue

    const home = agent.hangout
    if (home === null) {
      // 待命流程连"往哪走"都不知道（没有歇脚点）→ 不能把他留在 `walking` 上：
      // 那正是 movement 原来那条守卫防的静默卡死，现在由能看见这个人的一方收尾。
      if (ambientWalking) {
        agent.state = 'idle'
        agent.path = []
        repaired.push(agent.id)
      }
      continue
    }
    const slot = home === null ? null : idleSlotAt(behaviors, world.seed, agent.id, world.tick)

    // ① 先决定"还要不要继续坐着"。三种情况要站起来：有人等活、槽位结束、
    //    或者这一槽挑中的根本不是 `rest`（比如他坐下之后内容换了）。
    if (resting) {
      const keepResting =
        !workWaiting && slot !== null && slot.behavior.kind === 'rest' && slot.active
      if (keepResting) {
        settled.push(agent.id)
        continue // 坐着不动
      }
      agent.state = 'idle'
      stateChanged.push(agent.id)
    }

    // @deprecated-note 待命的人不该还挂着**派工**路径（那是上一轮派工的残渣，
    // 玩家会看到"待命中却在走向工位"）。但 R64 起待命移动**自己也要一条绕障路径**——
    // 否则待命的人会直线穿墙走到待命点（R63 实测就是这么走的）。
    // 所以不再无脑清空，而是标记这条路径是"待命用"的。
    // 派工残渣 = **目标工位**还挂着。清它、也清那条去工位的路径——
    // 只清路径不清 targetStation 的话，调度器与渲染层都还以为他"正在去某个工位"。
    if (agent.targetStation !== null) {
      agent.targetStation = null
      agent.path = []
    }

    // ② 本 tick 的目标点。
    //
    // 踱步 = **出去一半时间、回来一半时间**（R69）。为什么不是"走到那个点就站着耗完窗口"：
    // 那个点离歇脚点只有 0.45~0.9 世界单位、一步 0.06 → 他 8~15 tick 就走到了，
    // 而窗口有 60~120 tick —— 结果 90% 的时间是站着，看起来还是"没在动"。
    // 现在整段窗口都在走，也就整段都该播走路的带。
    //
    // ⚠️ `!workWaiting` 是个**必要的闸门**，不是保守：调度器只从 `state === 'idle'` 里挑人
    //（`scheduler.ts` 的 `idleAgents`），而踱步期间他是 `walking`。若有人在等活还让他出去转，
    // 那一单就得等他回来才派得出去（最坏一整个窗口 ≈ 12 秒）。所以"有活等着就别踱步"。
    const pacing =
      slot !== null && slot.active && slot.behavior.kind === 'pace' && !workWaiting
    const paceTarget = pacing
      ? paceGoal(world.seed, agent.id, slot.index, home, slot.behavior.radius, (point) =>
          world.nav === null ? true : isWalkable(world.nav, cellOf(world.nav, point)),
        )
      : null
    const headingOut = pacing && slot !== null && slot.elapsed * 2 < slot.span
    const goal = paceTarget !== null && headingOut ? paceTarget : home

    const remaining = distance(agent.position, goal)
    if (remaining <= WALK_SPEED) {
      // 到位：精确落点（不精确的话会永远差一点点，每 tick 都判一次"还没到"）。
      if (remaining > 0) {
        agent.position = { x: goal.x, z: goal.z }
        advanced.push(agent.id)
      }
      settled.push(agent.id)

      // 停下来了：状态跟着回到 `idle`（渲染器据此从"走"的带切回"站"的带）。
      if (agent.state === 'walking') {
        agent.state = 'idle'
        stateChanged.push(agent.id)
      }

      // ③ 到位之后才谈"给自己找点事做"。走着的路上不张望——那会变成"边飘边转头"。
      //    `pacing` 的情况什么都不做：他刚到那个点，站在那儿把这一槽耗完。
      if (!pacing && slot !== null && slot.active) {
        const behavior = slot.behavior
        if (behavior.kind === 'look') {
          // R74：张望不再随机转身，而是朝房间中心（0,0）回正。站定的人该有一个稳定的朝向；
          // 踱步会把它带走（出去/折返两次 180°），所以"张望"的职责变成"踱完步后转回中心"。
          // 确定性、可设计，不再像随机抽签那样原地转圈（用户："还是会旋转 / 不要搞得很随机"）。
          const turned = angleTo(agent.position, { x: 0, z: 0 })
          if (turned !== agent.facing) {
            agent.facing = turned
            acted.push(agent.id)
          }
        } else if (behavior.kind === 'rest' && !workWaiting) {
          agent.state = 'sleeping'
          stateChanged.push(agent.id)
        }
      }
      continue
    }

    // 还在挪 → 该不该说自己在走路（R69 的核心一行）。
    //
    // 之前这里只推位置、不改状态，于是渲染器按 `idle` 选动画带：**人在滑动、播的是站立的带**。
    // 真机连采 6 次的状态分布是 `{'sleeping': 1, 'idle': 7}`——**从来没有 `walking`**，
    // 而"待命的人看不出在走"正是这么来的（内容里 `walking → walk` 一直是好的）。
    //
    // ⚠️ **只在"踱步槽"里改，通勤（从别处走到歇脚点）仍然保持 `idle`。** 这不是偷懒：
    // 我第一版把"只要在动就设 walking"做了，结果**派工当场坏掉**——
    // `scheduler.ts` 的 `idleAgents` 只挑 `state === 'idle'`，于是"正在走向歇脚点的人"
    // 全都不再是派工候选（7 条既有测试红：R67 的 stalled、D41 的派工）。
    // 也就是说 `walking` 在这个代码库里同时驮着两件事：「我在挪」**和**「我在派工流程里」。
    // 这个歧义值得单独修（见汇报），但**不是这一轮该顺手改的**——它会把调度语义一起动了。
    // R398：只要还在沿路径移动，就必须是 walking；否则渲染器选站立动画，
    // 表现就是“人在地上滑”。到达后再回 idle。
    const moving = agent.path.length > 0 || Math.hypot(goal.x - agent.position.x, goal.z - agent.position.z) > 0.15
    const wanted = moving ? 'walking' : 'idle'
    if (agent.state !== wanted) {
      agent.state = wanted
      stateChanged.push(agent.id)
    }

    // 没有路径就**规划一条绕障的**（只在"刚被清空 / 换了待命点"时发生一次，
    // 不是每 tick 都算——`findPath` 内部有网格缓存，但也没必要每 tick 走一遍 A*）。
    if (agent.path.length === 0) {
      const planned = findPath(world.nav, agent.position, goal)
      // 只剩终点一个点 = 直线可达，那就别挂路径，省掉每 tick 的 shift。
      if (planned.length > 1) agent.path = planned
    }

    // 有路径就沿途经点走（否则退回直走——那是 `nav === null` 的回退路径）。
    const next = agent.path[0] ?? goal
    const moved = stepToward(agent.position, next, WALK_SPEED)
    if (agent.path.length > 0 && distance(moved.position, next) <= 1e-9) agent.path.shift()
    agent.facing = angleTo(agent.position, next)
    agent.position = moved.position
    advanced.push(agent.id)
  }

  return { advanced, settled, acted, stateChanged, repaired }
}
