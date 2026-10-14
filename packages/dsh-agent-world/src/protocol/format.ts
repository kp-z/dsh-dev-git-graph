/**
 * 展示用词汇表（BACKLOG M1.6-5）。
 *
 * ## 为什么"英文枚举 → 中文标签"算契约
 *
 * 因为**两处以上要消费它**：工具输出（模型与用户读）与 3D 面板 HUD（用户读）。
 * 如果各自维护一份映射，迟早出现"工具说『进行中』、面板说『运行中』"这种同义异形，
 * 而那种不一致最难被发现——两边看起来都合理。
 *
 * 所以统一到这里，谁要显示谁 import。`domain/summary.ts` 也用它（domain 可以 import protocol）。
 */

const AGENT_STATE_LABEL: Record<string, string> = {
  idle: '待命',
  walking: '赶路',
  working: '干活',
  talking: '交谈',
  blocked: '受阻',
  celebrating: '庆祝',
  sleeping: '休息',
}

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '待办',
  ready: '可领取',
  in_progress: '进行中',
  blocked: '受阻',
  done: '完成',
  failed: '失败',
}

const ROLE_LABEL: Record<string, string> = {
  lead: 'lead',
  engineer: '工程师',
  reviewer: '评审',
  researcher: '调研',
  ops: '运维',
  docs: '文档',
}

/** 角色状态英文 → 中文。未知取值原样返回（不抛：宁可显示得怪，也不要因为多了个新状态就崩）。 */
export function stateLabel(state: string): string {
  return AGENT_STATE_LABEL[state] ?? state
}

/** 工单状态英文 → 中文。 */
export function taskLabel(status: string): string {
  return TASK_STATUS_LABEL[status] ?? status
}

/** 职业英文 → 中文。 */
export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role
}

/** 全部状态标签（面板要遍历时用；顺序稳定）。 */
export const AGENT_STATE_LABELS: Readonly<Record<string, string>> = AGENT_STATE_LABEL

/** 全部工单状态标签。 */
export const TASK_STATUS_LABELS: Readonly<Record<string, string>> = TASK_STATUS_LABEL
