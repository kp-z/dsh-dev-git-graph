/**
 * 世界状态的**文本排版**（BACKLOG M1.6-5）。
 *
 * ## 为什么排版住在契约层
 *
 * 因为**两处消费**：host 的工具输出（模型与用户读）与浏览器的 HUD（用户读）。
 * 而浏览器侧只许 import `protocol/`（决策 D16）。所以排版要么放契约层，要么被复制两份。
 * 复制的下场是"工具说『进行中』、HUD 说『运行中』"这种同义异形——两边都看起来合理，
 * 所以最难被发现。
 *
 * 这些函数只读 `World` 的**类型**（不 import 世界模型的任何代码），所以不构成运行时依赖。
 */
import type { World, WorldSummary } from '../domain/types.js'
import type { ContentIssue } from './ports/content.js'
import { roleLabel, stateLabel, taskLabel } from './format.js'

/** 数一个数组里每个取值各出现几次。与 `domain/summary.ts` 的同名工具刻意分开：这边只服务排版。 */
function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of values) out[v] = (out[v] ?? 0) + 1
  return out
}

/** 从世界算出摘要。与 `domain/summary.ts` 的口径一致——那份是权威，这份只是排版时的兜底入口。 */
export function summarizeForDisplay(world: World): WorldSummary {
  return {
    id: world.id,
    name: world.name,
    tick: world.tick,
    paused: world.paused,
    mode: world.mode,
    agents: { total: world.agents.length, byState: tally(world.agents.map((a) => a.state)) },
    tasks: { total: world.tasks.length, byStatus: tally(world.tasks.map((t) => t.status)) },
    stations: {
      total: world.stations.length,
      occupied: new Set(world.agents.filter((a) => a.station !== null).map((a) => a.station)).size,
    },
    districts: world.districts.length,
    messages: world.messages.length,
  }
}

/** 把世界渲染成一段摘要文本。工具输出与诊断都用它。 */
export function formatSummary(world: World, summary?: WorldSummary): string {
  const s = summary ?? summarizeForDisplay(world)
  const lines: string[] = []
  lines.push(`世界「${s.name}」(${s.id}) · 模式=${s.mode} · tick=${s.tick}${s.paused ? ' · 已暂停' : ''}`)
  lines.push(`小镇：${s.districts} 个地块 / ${s.stations.total} 个站点（${s.stations.occupied} 个被占）`)
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

/** "谁在哪、在干什么"——HUD 花名册与工具输出共用。 */
export function formatRoster(world: World): string {
  if (world.agents.length === 0) return '（还没有角色）'
  return world.agents
    .map((a) => {
      const where = a.station
        ? stationName(world, a.station)
        : a.targetStation
          ? `→ ${stationName(world, a.targetStation)}`
          : '广场'
      const what = a.carrying ? `《${taskTitle(world, a.carrying)}》` : '—'
      return `· ${a.name}（${roleLabel(a.role)}）${stateLabel(a.state)} @ ${where} · 手头：${what}`
    })
    .join('\n')
}

/** 工单板。 */
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

/** 内容问题的完整清单（工具里给全量，不能只给日志里的前几条）。 */
export function formatIssues(issues: readonly ContentIssue[]): string {
  if (issues.length === 0) return '（没有内容问题）'
  return issues.map((i) => `· [${i.level === 'error' ? '错误' : '警告'}][${i.where}] ${i.message}`).join('\n')
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
