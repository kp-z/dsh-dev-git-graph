/*
 * UI 文案（R35）—— **一处**集中放"界面上的中文"。
 *
 * ── 为什么要有这个模块 ──────────────────────────────────────────────────────
 *
 * 1. 六态标签原来有**两份**（`ui/board.js` 与 `ui/tasks.js` 各一份 `STATUS_LABEL`），
 *    代理状态还有第三、第四份（`ui/roster.js`、`ui/topbar.js`）。同一件事四份实现，
 *    改一次颜色/措辞就得记住改四个地方——这是 R32 就记下的债，这里一次还掉。
 * 2. R35 要显示"角色调了哪个工具"，而工具名是 `agent_world_dispatch` 这种代码标识符，
 *    直接铺在界面上很难看。**中文标签是 UI 文案**，所以映射表放 UI 层是对的
 *    （与 D37"人设/台词是内容"不冲突：这里说的是"按钮上写什么"，不是"角色是谁"）。
 *
 * ── 两条规矩 ────────────────────────────────────────────────────────────────
 *
 * · **未知名字原样显示**，绝不猜、也绝不隐藏：显示 `agent_world_unknown` 至少能让人去查，
 *   而"（未知操作）"会把唯一的线索抹掉。
 * · 这个文件**不碰 DOM**（可被 node 测），也不 import 任何别的东西。
 */

/** `TaskStatus` 六态 → 界面文案。看板、工单、徽章共用这一份。 */
export const TASK_STATUS_LABEL = {
  pending: '待办',
  ready: '可领取',
  in_progress: '进行中',
  blocked: '受阻',
  done: '完成',
  failed: '失败',
}

/** `AgentState` → 界面文案。 */
export const AGENT_STATE_LABEL = {
  idle: '待命',
  walking: '赶路',
  working: '干活',
  talking: '交谈',
  blocked: '受阻',
  celebrating: '庆祝',
  sleeping: '休息',
}

/**
 * `AgentState` → 徽章色调。颜色表达**含义**而不是复刻任务状态：
 * 干活=蓝、赶路/交谈=琥珀、受阻=红（同"需要人管"）、庆祝=绿、休息/待命=灰。
 */
export const AGENT_STATE_TONE = {
  working: 'in_progress',
  walking: 'ready',
  talking: 'ready',
  blocked: 'blocked',
  celebrating: 'done',
  idle: 'pending',
  sleeping: 'pending',
}

/** `AgentRole` → 界面文案。 */
export const ROLE_LABEL = {
  lead: '负责人',
  engineer: '工程师',
  reviewer: '评审',
  researcher: '调研',
  ops: '运维',
  docs: '文档',
}

/**
 * 工具名 → 动宾短语。
 *
 * 用"派单/看世界/查内容库"这种**动宾结构**，因为它要和"正在…"拼起来（`actingText`）：
 * 名词短语拼出来是"正在任务派发…"，读着别扭。
 */
export const TOOL_LABEL = {
  agent_world_dispatch: '派单',
  agent_world_status: '看世界',
  agent_world_content: '查内容库',
  agent_world_open: '打开面板',
}

/** 工具的中文名（未知 → 原样返回）。 */
export function toolLabel(name) {
  if (typeof name !== 'string' || name === '') return '未知工具'
  return TOOL_LABEL[name] ?? name
}

/** 六态文案（未知 → 原样）。 */
export function taskStatusLabel(status) {
  return TASK_STATUS_LABEL[status] ?? String(status ?? '')
}

/** 代理状态文案（未知 → 原样）。 */
export function agentStateLabel(state) {
  return AGENT_STATE_LABEL[state] ?? String(state ?? '')
}

/** 代理状态的徽章色调（未知 → 灰）。 */
export function agentStateTone(state) {
  return AGENT_STATE_TONE[state] ?? 'pending'
}

/** 角色文案（未知 → 原样）。 */
export function roleLabel(role) {
  if (role === null || role === undefined) return ''
  return ROLE_LABEL[role] ?? String(role)
}

/** 动作成功 / 失败的图标（失败也要显示——"他试过但没成"本身就是信息）。 */
export function actionIcon(action) {
  return action !== null && action !== undefined && action.ok === false ? '⚠️' : '🔧'
}

/**
 * 一条动作的可读文本，例如 `派单 task.quick-fix`。
 *
 * 参数（`detail`）**原样**跟在后面：它是 id（`task.quick-fix`）、路径或工具名，
 * 翻译它只会让人对不上宿主那边的日志。
 */
export function actionText(action) {
  if (action === null || action === undefined) return ''
  const verb = toolLabel(action.name)
  const detail = typeof action.detail === 'string' && action.detail !== '' ? ` ${action.detail}` : ''
  return `${verb}${detail}`
}

/**
 * `acting` 阶段那一行活动指示：`正在派单…`。
 *
 * 取**最后一个**动作——它才是"此刻在做的事"；前面那些会以动作行的形式留在下面。
 * 一个动作都没有（模型只是在说话/思考）时退回"他在干活…"。
 */
export function actingText(actions) {
  const list = Array.isArray(actions) ? actions : []
  const last = list[list.length - 1]
  if (last === undefined) return '他在干活…'
  return `正在${toolLabel(last.name)}…`
}

/** `N 次调用`（多个工具时显示次数——R34 真机是 3 次，用户要看得见"调了几次"）。 */
export function actionCountText(count) {
  const n = Number.isFinite(count) ? count : 0
  return n <= 0 ? '' : `${n} 次调用`
}
