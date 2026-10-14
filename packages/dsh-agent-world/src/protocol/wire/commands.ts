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

/** 全部命令的 kind。用于校验与穷尽性检查。 */
export const WORLD_COMMAND_KINDS = ['pause', 'resume', 'reset', 'dispatch', 'hire', 'setSpeed'] as const

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
  }
}

/** 校验一个命令的形状。用于线协议解码与工具参数校验。 */
export function isWorldCommand(value: unknown): value is WorldCommand {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return typeof kind === 'string' && (WORLD_COMMAND_KINDS as readonly string[]).includes(kind)
}
