/**
 * 官方 subagent → 世界的结构化汇报契约（R441）。
 *
 * 为什么不解析 subagent 的自然语言：格式会漂移、字段会漏。工具调用是硬契约，
 * 参数先过 schema，再由这里落到 world/persona。
 */
export type AgentReportStatus = 'working' | 'done' | 'blocked'

/** 一次 `agent_world_report` 的入参（模型可见）。 */
export interface AgentReportInput {
  taskId: string
  status: AgentReportStatus
  summary: string
  evidence?: readonly string[]
  skill?: string
  next?: string
}

/** 落库后的结果，工具把它排成给模型/人看的文本。 */
export interface AgentReportResult {
  accepted: boolean
  agentId: string
  agentName: string
  taskId: string
  status: AgentReportStatus
  xpAwarded: number
  level: number
  reason?: string
}

/** 模型工具背后的服务端口（index 实现；工具只认这个接口）。 */
export interface AgentReportPort {
  report(agentSessionId: string, input: AgentReportInput): AgentReportResult
}
