/**
 * `agent_world_report`：官方 subagent 汇报任务状态/结果。
 *
 * 这是游戏与真实 AI 工作之间**唯一**的结构化契约：不解析正文，不靠固定文本格式。
 * 身份来自工具执行上下文 `exec.agent.id`（绑定 subagent 的会话 id），不是模型自报。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AgentReportStatus, AgentReportPort } from '../protocol/index.js'

export function registerReportTool(ctx: Context, report: AgentReportPort): void {
  ctx.tools.register(
    defineTool({
      name: 'agent_world_report',
      description:
        '向 Agent World 汇报当前任务的结构化状态（**有副作用**：会更新世界/角色经验）。' +
        '完成或阻塞任务时调用它，不要只用自然语言说“做完了”。' +
        'taskId 用世界里分给你的工单 id；status=working/done/blocked。',
      parameters: {
        taskId: { type: 'string', required: true, description: '世界工单 id，例如 task-7。' },
        status: {
          type: 'string',
          required: true,
          description: 'working=进行中，done=已完成，blocked=被阻塞。',
        },
        summary: { type: 'string', required: true, description: '一句话结论，≤ 80 字。' },
        evidence: { type: 'array', items: { type: 'string' }, description: '证据：文件、测试、命令或链接。' },
        skill: { type: 'string', description: '本次使用/增长的技能，例如 debugging。' },
        next: { type: 'string', description: '下一步，可省略。' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const agentSessionId = exec.agent?.id
        if (typeof agentSessionId !== 'string' || agentSessionId === '') {
          throw new Error('agent_world_report 只能由已绑定的 subagent 调用：执行上下文里没有 agent id。')
        }
        const status = args.status as AgentReportStatus
        if (status !== 'working' && status !== 'done' && status !== 'blocked') {
          throw new Error(`status 只能是 working/done/blocked，收到 ${String(args.status)}。`)
        }
        const result = report.report(agentSessionId, {
          taskId: args.taskId.trim(),
          status,
          summary: args.summary.trim(),
          evidence: Array.isArray(args.evidence) ? args.evidence : [],
          ...(typeof args.skill === 'string' ? { skill: args.skill } : {}),
          ...(typeof args.next === 'string' ? { next: args.next } : {}),
        })
        if (!result.accepted) throw new Error(result.reason ?? '汇报被拒绝。')
        return [
          `已记录 ${result.agentName} 对 ${result.taskId} 的汇报：${result.status}。`,
          result.xpAwarded > 0 ? `+${result.xpAwarded} XP，当前 Lv.${result.level}。` : `当前 Lv.${result.level}。`,
        ].join('\n')
      },
    }),
  )
}
