/**
 * 世界摘要（**只算数据，不排版**）。
 *
 * `summarize()` 返回结构化的 `WorldSummary`，给工具、HTTP 快照头、HUD 状态条共用同一份口径。
 * 这是本仓库的一条经验：同一个数字在两处各算一遍，早晚会不一致，而不一致的时候你根本不知道信哪个。
 *
 * **文本排版不在这一层**——`formatSummary` / `formatRoster` / `formatTaskBoard` 已经搬到
 * `protocol/format-text.ts`，因为工具（host）与 HUD（浏览器）都要用它们，
 * 而浏览器侧只许 import 契约层（决策 D16）。世界模型只负责"数字是多少"。
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
      byStatus: tally(world.tasks.map((t) => t.status)),
    },
    stations: {
      total: world.stations.length,
      // 被占用的定义：至少有一个角色"人在站点上"（不含在路上）。与调度器的口径一致。
      occupied: new Set(world.agents.filter((a) => a.station !== null).map((a) => a.station)).size,
    },
    districts: world.districts.length,
    messages: world.messages.length,
  }
}
