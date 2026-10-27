/**
 * 调度器（BACKLOG M2-4）。
 *
 * 给每个空闲角色原子地 claim 一张可领取的工单，并按 `requires` 的能力挑一个**有空位**的站点。
 *
 * ## 为什么是"原子 claim"
 *
 * 一条 tick 内，一张工单最多被一个角色拿到。这不是靠"先查再改"的时序小心来保证的，
 * 而是**结构上保证**：本模块在一趟遍历里完成"挑单 + 挑人 + 挑站点 + 写状态"，
 * 中途没有任何 await、也没有第二次遍历去重复挑同一张单。
 * 一旦这里出现异步或两次遍历，"两个人抢到同一张单"就会变成偶发问题。
 *
 * ## 容量与座位
 *
 * 站点容量是硬约束。占用者包括**已经在那里的**和**正在走过去的**——
 * 只看前者会让三个人同时被派到一张单人工位上，然后到达时才发现挤不下。
 * 座位号也在 claim 时定好，写进路径；到达时不用再算（到达时再算会拿到不确定的序号）。
 *
 * ## 不在这里发事件
 *
 * 返回"谁领了什么"，事件由 `step.ts` 统一产出。
 */
import { stationSlot } from '../domain/geometry.js'
import { findPath } from './pathfind.js'
import type { Agent, Station, Task, World } from '../domain/types.js'

/** 一次派工。 */
export interface Claim {
  agentId: string
  taskId: string
  stationId: string
  /** 本轮尝试 id。重新派工时换新，旧 attempt 的汇报会被拒（M7 用）。 */
  attemptId: string
}

/** 派不出去的原因。 */
export interface Stalled {
  taskId: string
  reason: 'no-station' | 'no-worker'
  /** 给人看的说明（诊断与测试直接读它）。 */
  detail: string
}

/** 一次调度的结果。 */
export interface SchedulerOutcome {
  claims: Claim[]
  stalled: Stalled[]
}

/**
 * 站点当前被占用多少。
 *
 * **已经在那里的**与**正在过去的**都算——理由见文件头。
 */
export function occupancyOf(world: World, stationId: string): number {
  let n = 0
  for (const agent of world.agents) {
    if (agent.station === stationId) n += 1
    else if (agent.targetStation === stationId) n += 1
  }
  return n
}

/**
 * 挑一个能承载这张工单、且还有空位的站点。
 *
 * 判据是**能力包含**（`requires` ⊆ `station.capabilities`），不是"有交集"：
 * 一张要求「评审 + 讨论」的单，放在只有「评审」的桌上是不对的。
 *
 * 遍历顺序按 `world.stations` 原序（由内容库场景的站点列表决定，稳定），
 * 不排序也不随机——**同一个世界的同一 tick 必须挑到同一个站点**。
 *
 * @returns 站点与座位号；挑不到返回 null。
 */
export function pickStation(world: World, task: Task): { station: Station; slotIndex: number } | null {
  for (const station of world.stations) {
    const covers = task.requires.every((need) => station.capabilities.includes(need))
    if (!covers) continue
    const used = occupancyOf(world, station.id)
    if (used >= station.capacity) continue
    return { station, slotIndex: used }
  }
  return null
}

/** 空闲角色：状态 `idle` 且手上没有工单。 */
function idleAgents(world: World): Agent[] {
  return world.agents.filter((a) => a.state === 'idle' && a.carrying === null)
}

/**
 * 推进一 tick 的派工。
 *
 * **会就地修改 `world.tasks` 与 `world.agents`。**
 *
 * @param world - 世界（就地修改）。
 */
export function claimTasks(world: World): SchedulerOutcome {
  const claims: Claim[] = []
  const stalled: Stalled[] = []

  // 可领取的工单，按（创建 tick, 创建序号）排序——**不用 id 字符串排序**：
  // `task-10` 的字符串序在 `task-2` 前面，那会让优先级在两位数时静默改变。
  const ready = world.tasks
    .filter((t) => t.status === 'ready')
    .sort((a, b) => a.createdAtTick - b.createdAtTick || a.ordinal - b.ordinal)

  if (ready.length === 0) return { claims, stalled }

  // R369：游戏模式下，新一批任务开工前先全体去会议室。
  // 会议期间不派工，避免“人在会议室、单已经派给工位”的错位。
  if (world.gameMode === true) {
    if (world.briefingUntil !== undefined && world.tick < world.briefingUntil) return { claims, stalled }
    const newest = ready.reduce((max, task) => Math.max(max, task.createdAtTick), -1)
    if (world.briefingForTick !== newest) {
      const meeting = world.stations.find((station) => station.kind === 'meeting' && occupancyOf(world, station.id) < station.capacity)
      if (meeting !== undefined) {
        // 开工会议是全员同步，不受 meeting capacity 限制；座位按顺序吸附，超出容量的会靠近最后一席。
        const attendees = world.agents.filter((agent) => agent.state === 'idle' && agent.carrying === null)
        for (const [index, agent] of attendees.entries()) {
          const slot = stationSlot(meeting, index)
          const path = findPath(world.nav, agent.position, slot)
          if (path.length === 0) continue
          agent.state = 'walking'
          agent.station = null
          agent.targetStation = meeting.id
          agent.path = path
          agent.activityKind = 'meet'
          agent.activityUntil = world.tick + 40
        }
        world.briefingUntil = world.tick + 40
        world.briefingForTick = newest
        return { claims, stalled }
      }
    }
  }

  // 本次调度里已经被占用的角色，避免一张单派给同一个人两次。
  const taken = new Set<string>()
  const available = idleAgents(world)

  for (const task of ready) {
    const free = available.filter((a) => !taken.has(a.id))
    if (free.length === 0) {
      stalled.push({
        taskId: task.id,
        reason: 'no-worker',
        detail: '没有空闲角色了。等有人干完手上的活，或招募更多角色。',
      })
      continue
    }

    const chosen = pickStation(world, task)
    if (chosen === null) {
      stalled.push({
        taskId: task.id,
        reason: 'no-station',
        detail:
          `没有任何站点能承载能力 [${task.requires.join(', ')}] 且还有空位。` +
          `可以加一个带这些能力的站点，或等占着的人干完。`,
      })
      continue
    }

    // ── 外部已经指派了人（D41，R39）：**必须尊重它**，不许调度器自己挑 ──────────
    //
    // R39 的测试当场抓到：调度器原本无视外部指派，按职业自己挑人并覆写 `owner`，
    // **还覆写 `attemptId`**——后者是致命的：agent-teams 的完成汇报带的是它自己的代次，
    // 被覆写之后每一次真实的完成都会被 `applyExternalTasks` 当成"旧代"拒掉，
    // 于是 live 世界里**没有任何一张单能真正完成**，而且不会有任何报错。
    // live 下接上团队、但团队还没指派的单：**小镇不许自己挑人**（R43 真机抓到）。
    // 否则小镇先派给小青、写下自己的代次，随后团队派给小紫——小镇的代次让团队的指派与完成全被当成"旧代"拒掉，
    // 结果是团队已经做完，小镇这边永远卡在"进行中"。
    if (world.mode === 'live' && task.externalId !== null && task.owner === null) {
      stalled.push({ taskId: task.id, reason: 'no-worker', detail: '等团队指派：这张单接在团队任务上，由团队决定谁来做。' })
      continue
    }

    const externallyOwned = task.externalId !== null && task.owner !== null
    const assigned = externallyOwned ? free.find((a) => a.id === task.owner) : undefined
    if (externallyOwned && assigned === undefined) {
      // 指派的人此刻不空闲（还在忙别的）：等他，而不是把单塞给别人。
      stalled.push({
        taskId: task.id,
        reason: 'no-worker',
        detail: '团队把这张单派给了一个此刻还在忙的角色：等他忙完再开工。',
      })
      continue
    }

    // 优先同职业；没有就把这张单给任何空闲的人——**不要因为职业不匹配就不派**，
    // 否则一个小队里只要缺某个职业，整条流水线就停在那里。
    const matching = free.find((a) => task.suggestedRole !== null && a.role === task.suggestedRole)
    const agent = assigned ?? matching ?? free[0]
    if (agent === undefined) continue

    const slot = stationSlot(chosen.station, chosen.slotIndex)
    // 外部指派的单保留外部代次；只有小镇自己派的单才用自己的代次。
    const attemptId = externallyOwned && task.attemptId !== null ? task.attemptId : `attempt-${world.tick}-${task.id}`

    task.status = 'in_progress'
    task.owner = agent.id
    task.station = chosen.station.id
    task.attemptId = attemptId
    task.progress = 0

    agent.carrying = task.id
    agent.targetStation = chosen.station.id
    agent.station = null
    // R64 物理：**绕障路径**，不再是一个终点（那会直线穿墙）。
    // `findPath` 返回一串途经点；`movement.ts` 的循环逐个 shift，逻辑一行没改。
    agent.path = findPath(world.nav, agent.position, slot)
    agent.state = 'walking'

    taken.add(agent.id)
    claims.push({ agentId: agent.id, taskId: task.id, stationId: chosen.station.id, attemptId })
  }

  return { claims, stalled }
}
