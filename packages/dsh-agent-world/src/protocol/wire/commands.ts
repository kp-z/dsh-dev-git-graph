/**
 * 世界命令（BACKLOG M1.6-4）。
 *
 * ## 为什么命令住在协议层，而不在 `domain/`
 *
 * 命令是**边界类型**：它由命令行、HTTP、面板、测试这些"外部世界"产生，往模拟内核里送。
 * 它既不属于世界模型（世界模型只描述"状态是什么"），也不属于模拟内核（内核只描述"怎么变"）。
 * 它属于两者之间，所以住契约层。
 *
 * 于是 `sim/step.ts` 从 protocol import 它（sim 可以 import protocol），
 * 而外部产生方也只认这一份定义——**没有第二处定义可以漂移**。
 *
 * ## 一律用 `| null` 而不是 `?`
 *
 * `tsconfig` 开了 `exactOptionalPropertyTypes`。在联合类型里用可选属性，
 * "字段不存在"和"字段存在但是 undefined"会变成两种类型，而它们过一遍 JSON 就不可区分了。
 * 用 `| null` 显式表达"这个字段这次没给值"。
 */
import type { AgentRole } from '../../domain/types.js'

/** 一条世界命令。`kind` 是判别式。 */
export type WorldCommand =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'reset'; name: string | null }
  /** 从任务库派一条工作流进世界。 */
  | { kind: 'dispatch'; taskSet: string }
  /** 招募一个角色（M7 会把它映射到真实 subagent 生成）。 */
  | { kind: 'hire'; role: AgentRole; name: string | null }
  /** 调整模拟倍速（渲染层用，不影响确定性——它只改真实时间到 tick 的换算）。 */
  | { kind: 'setSpeed'; speed: number }
  /**
   * 外部（agent-teams）把一张单派给了某个角色（D41，R39）。
   *
   * **只在 `live` 世界里有意义**：这是"谁做什么"的真相从 agent-teams 流进小镇的入口。
   * 小镇据此把角色走向合适的站点、显示他在忙——那是它的投影职责。
   * `attemptId` 来自 agent-teams 的执行代：旧代的完成汇报会被拒，与 agent-teams 自己的
   * 「stale attempt」语义一致，避免"重新指派后旧结果把新单标成完成"。
   */
  | { kind: 'taskAssign'; taskId: string; agentId: string; attemptId: string }
  /**
   * 外部确认一张单**真的做完了**（D41）。`output` 是成员写下的结果（agent-teams 的 `output`）。
   * live 模式下这是 `done` 的**唯一**来源——tick 涨满进度不再算完成。
   */
  | { kind: 'taskComplete'; taskId: string; attemptId: string; output: string | null }
  /** 外部确认一张单失败（D41）。`reason` 要能让人下手，与其它失败原因同一条规矩。 */
  | { kind: 'taskFail'; taskId: string; attemptId: string; reason: string }

/** 全部命令的 kind。用于校验与穷尽性检查。 */
export const WORLD_COMMAND_KINDS = [
  'pause',
  'resume',
  'reset',
  'dispatch',
  'hire',
  'setSpeed',
  'taskAssign',
  'taskComplete',
  'taskFail',
] as const

/** 命令的 kind 类型。 */
export type WorldCommandKind = (typeof WORLD_COMMAND_KINDS)[number]

/** 人类可读的命令说明（面板、日志、错误信息共用一份口径）。 */
export function describeCommand(command: WorldCommand): string {
  switch (command.kind) {
    case 'pause':
      return '暂停世界'
    case 'resume':
      return '恢复世界'
    case 'reset':
      return command.name === null ? '重开一局' : `重开一局（名为「${command.name}」）`
    case 'dispatch':
      return `派单：${command.taskSet}`
    case 'hire':
      return `招募 ${command.role}${command.name === null ? '' : `（${command.name}）`}`
    case 'setSpeed':
      return `设置倍速 ${command.speed}×`
    case 'taskAssign':
      return `派给 ${command.agentId}：${command.taskId}`
    case 'taskComplete':
      return `完成：${command.taskId}`
    case 'taskFail':
      return `失败：${command.taskId}（${command.reason}）`
  }
}

/** 校验一个命令的形状。用于线协议解码与工具参数校验。 */
export function isWorldCommand(value: unknown): value is WorldCommand {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return typeof kind === 'string' && (WORLD_COMMAND_KINDS as readonly string[]).includes(kind)
}
