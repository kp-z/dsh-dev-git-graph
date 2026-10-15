/**
 * agent-teams → 小镇的同步契约（D41，R39）。
 *
 * ## 为什么住在协议层
 *
 * 这份形状**跨边界**：它由宿主侧的套壳端口（`src/bridge/teams.ts`）从 agent-teams 读出来，
 * 交给模拟内核（`src/sim/team-sync.ts`）变成世界命令。两边都不该各自定义一份——
 * 与 `wire/commands.ts` 同一个理由。
 *
 * ## 与小镇 `Task` 的关系
 *
 * 小镇的 `Task` 有位置、进度、估算时长——那些是**空间与时序**，是小镇的投影职责。
 * 这里的 `TeamTaskView` 只有"谁做什么、做完没有"——那是 agent-teams 的真相。
 * 两者靠 `Task.externalId` 对应（见 `domain/types.ts`）。
 */
/** agent-teams 的任务状态（原文照抄它的 `TaskStatus`）。 */
export type TeamTaskStatus = 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

/** 从 `agent_teams_status` 读出来的一张单。只保留小镇用得上的字段。 */
export interface TeamTaskView {
  /** agent-teams 里的任务 id（团队内唯一，形如 `t1`）。 */
  readonly id: string
  readonly subject: string
  readonly status: TeamTaskStatus
  /** 负责的成员名；未分配时缺省。 */
  readonly assignee?: string
  /** 前置任务 id（agent-teams 的 id，不是小镇的）。 */
  readonly dependencies: readonly string[]
  /** 成员写下的结果（完成或失败时才有）。 */
  readonly output?: string
  /** 当前尝试的代次能力；成员每次更新都要带它，旧代会被拒。 */
  readonly attemptId?: string
}

/** 同步一次要用的全部输入。**纯数据**，所以 diff 可以被单测穷举。 */
export interface TeamSyncInput {
  /** 这一轮从 agent-teams 读到的任务（顺序无关，diff 会按 id 索引）。 */
  readonly tasks: readonly TeamTaskView[]
  /** 小镇当前的工单（用于比对状态）。 */
  readonly worldTasks: readonly {
    readonly id: string
    readonly externalId: string | null
    readonly status: string
    readonly owner: string | null
    readonly attemptId: string | null
  }[]
  /** 成员名 → 小镇角色 id。名字对不上时返回 `null`（那个成员在小镇里不存在）。 */
  readonly agentIdForMember: (memberName: string) => string | null
}
