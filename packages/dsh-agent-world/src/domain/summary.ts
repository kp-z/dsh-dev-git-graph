/**
 * 世界摘要（BACKLOG M0-2 的一部分）。
 *
 * 工具输出、HTTP 快照头、HUD 状态条都用**同一个** `summarize()`，
 * 保证"模型看到的"和"界面显示的"是同一个口径。这是本仓库的一条经验：
 * 同一个数字在两处各算一遍，早晚会不一致，而不一致的时候你根本不知道信哪个。
 */
import type { World, WorldSummary } from './types.js'

/** 数一个数组里每个取值各出现几次。 */
function tally<T extends string>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of values) out[v] = (out[v] ?? 0) + 1
  return out
}

/** 产出世界摘要。 */
export function summarize(world: World): WorldSummary {
  const byStatus = tally(world.tasks.map((t) => t.status))
  const done = (byStatus.done ?? 0) + (byStatus.failed ?? 0)
  return {
    id: world.id,
    name: world.name,
    tick: world.tick,
    paused: world.paused,
    mode: world.mode,
    agents: {
      total: world.agents.length,
      byState: tally(world.agents.map((a) => a.state)),
    },
    tasks: {
      total: world.tasks.length,
      byStatus,
    },
    stations: {
      total: world.stations.length,
      // 被占用的定义：至少有一个角色"人在站点上"（不含在路上）。与调度器的口径一致。
      occupied: new Set(world.agents.filter((a) => a.station !== null).map((a) => a.station)).size,
    },
    districts: world.districts.length,
    messages: world.messages.length,
    // done 参与计算是为了让"进度"这个说法有个明确的分子分母；目前只用于诊断输出。
    ...(done > 0 ? {} : {}),
  }
}

/** 把摘要渲染成给模型读的文本。工具输出与诊断都用它。 */
export function formatSummary(world: World): string {
  const s = summarize(world)
  const lines: string[] = []
  lines.push(`世界「${s.name}」(${s.id}) · 模式=${s.mode} · tick=${s.tick}${s.paused ? ' · 已暂停' : ''}`)
  lines.push(
    `小镇：${s.districts} 个地段 / ${s.stations.total} 个站点（${s.stations.occupied} 个被占）`,
  )
  const agentParts = Object.entries(s.agents.byState)
    .map(([k, v]) => `${stateLabel(k)}=${v}`)
    .join(' ')
  lines.push(`角色：共 ${s.agents.total} 人${agentParts ? `（${agentParts}）` : ''}`)
  const taskParts = Object.entries(s.tasks.byStatus)
    .map(([k, v]) => `${taskLabel(k)}=${v}`)
    .join(' ')
  lines.push(`工单：共 ${s.tasks.total} 张${taskParts ? `（${taskParts}）` : ''}`)
  lines.push(`消息：${s.messages} 条`)
  return lines.join('\n')
}

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

/** 状态英文 → 中文（工具输出给人看，不该吐枚举名）。 */
export function stateLabel(state: string): string {
  return AGENT_STATE_LABEL[state] ?? state
}

/** 工单状态英文 → 中文。 */
export function taskLabel(status: string): string {
  return TASK_STATUS_LABEL[status] ?? status
}

/** 列出张"谁在哪、在干什么"——HUD 的花名册与 agent_world_status 共用。 */
export function formatRoster(world: World): string {
  if (world.agents.length === 0) return '（还没有角色）'
  return world.agents
    .map((a) => {
      const where = a.station ? stationName(world, a.station) : a.targetStation ? `→ ${stationName(world, a.targetStation)}` : '广场'
      const what = a.carrying ? `《${taskTitle(world, a.carrying)}》` : '—'
      return `· ${a.name}（${roleLabel(a.role)}）${stateLabel(a.state)} @ ${where} · 手头：${what}`
    })
    .join('\n')
}

/** 列出工单板。 */
export function formatTaskBoard(world: World): string {
  if (world.tasks.length === 0) return '（工单板是空的）'
  return world.tasks
    .map((t) => {
      const owner = t.owner ? agentName(world, t.owner) : '无人'
      const deps = t.blockedBy.length > 0 ? ` · 依赖 ${t.blockedBy.join(', ')}` : ''
      const pct = t.status === 'in_progress' ? ` ${Math.round(t.progress * 100)}%` : ''
      return `· [${taskLabel(t.status)}${pct}] ${t.title} · 负责人：${owner}${deps}`
    })
    .join('\n')
}

function stationName(world: World, id: string): string {
  return world.stations.find((s) => s.id === id)?.name ?? id
}

function agentName(world: World, id: string): string {
  return world.agents.find((a) => a.id === id)?.name ?? id
}

function taskTitle(world: World, id: string): string {
  return world.tasks.find((t) => t.id === id)?.title ?? id
}

const ROLE_LABEL: Record<string, string> = {
  lead: 'lead',
  engineer: '工程师',
  reviewer: '评审',
  researcher: '调研',
  ops: '运维',
  docs: '文档',
}

/** 职业英文 → 中文。 */
export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role
}
