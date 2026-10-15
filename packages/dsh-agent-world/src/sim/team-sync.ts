/**
 * agent-teams → 小镇的同步策略（D41，R39）。
 *
 * 契约（`TeamTaskView` / `TeamSyncInput`）住协议层；**决定发哪些命令**是模拟内核的事，住这里。
 * 调用方是应用层（`src/index.ts`）：它从套壳端口读出 agent-teams 的任务，交给这里算命令，
 * 再把命令送进世界——命令照旧进 journal，所以回放仍然确定（D41 ③）。
 */
import type { TeamSyncInput, WorldCommand } from '../protocol/index.js'

/**
 * 算出"要让小镇追上 agent-teams，需要发哪些命令"。
 *
 * **纯函数**：同样的输入永远得到同样的输出，没有时钟、没有随机数。所以它能被穷举测试，
 * 也能在回放里被复现——这正是 D41 那条"外部结果以命令形式进入世界"的实现。
 *
 * 只做三件事，多一件都不做：
 * - agent-teams 说"派给某人了" → `taskAssign`
 * - agent-teams 说"完成了" → `taskComplete`
 * - agent-teams 说"失败/取消了" → `taskFail`
 *
 * **不生成** `dispatch`：建单是另一条路（内容库 → 团队任务），不该在同步里做。
 *
 * @returns 命令列表；顺序稳定（按小镇任务的创建序），所以日志可比对。
 */
export function planTeamSync(input: TeamSyncInput): WorldCommand[] {
  const byExternal = new Map<string, TeamSyncInput['worldTasks'][number]>()
  for (const task of input.worldTasks) {
    if (task.externalId !== null && task.externalId !== '') byExternal.set(task.externalId, task)
  }

  const commands: WorldCommand[] = []
  // 按小镇任务自己的顺序遍历（不是按 agent-teams 返回的顺序）：命令序列才稳定。
  for (const local of input.worldTasks) {
    if (local.externalId === null || local.externalId === '') continue
    const team = input.tasks.find((t) => t.id === local.externalId)
    if (team === undefined) continue

    // 小镇的代次与团队不同（比如团队派活这件事被小镇错过了），先补一条指派把代次对齐，
    // 否则下面的完成/失败会被当成"旧代"拒掉（R43 真机抓到）。同一 tick 内按顺序生效。
    const terminal = team.status === 'completed' || team.status === 'failed' || team.status === 'cancelled'
    if (terminal && local.status !== 'done' && local.status !== 'failed' && team.attemptId !== undefined && team.attemptId !== '' && local.attemptId !== team.attemptId) {
      const agentId = team.assignee === undefined || team.assignee === '' ? null : input.agentIdForMember(team.assignee)
      if (agentId !== null) commands.push({ kind: 'taskAssign', taskId: local.id, agentId, attemptId: team.attemptId })
    }

    // 完成：只在"小镇还没认为它完成"时发。已经 done 的不重复发（幂等）。
    if (team.status === 'completed' && local.status !== 'done') {
      commands.push({
        kind: 'taskComplete',
        taskId: local.id,
        attemptId: team.attemptId ?? '',
        output: team.output ?? null,
      })
      continue
    }

    if ((team.status === 'failed' || team.status === 'cancelled') && local.status !== 'failed') {
      commands.push({
        kind: 'taskFail',
        taskId: local.id,
        attemptId: team.attemptId ?? '',
        reason:
          team.status === 'cancelled'
            ? '这张单在团队里被取消了'
            : `这一轮没做成${team.output === undefined || team.output === '' ? '（成员没写原因）' : `：${team.output}`}`,
      })
      continue
    }

    // 指派：agent-teams 说派给谁了，而小镇还不知道（没人、或派给了别人）。
    if (team.assignee !== undefined && team.assignee !== '') {
      const agentId = input.agentIdForMember(team.assignee)
      if (agentId !== null && local.owner !== agentId && local.status !== 'done' && local.status !== 'failed') {
        commands.push({ kind: 'taskAssign', taskId: local.id, agentId, attemptId: team.attemptId ?? '' })
      }
    }
  }
  return commands
}
