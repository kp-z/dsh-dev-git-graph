/**
 * 事件里的"当前值补丁"（BACKLOG M3-6）。
 *
 * ## 为什么需要它
 *
 * 换成增量推送之后，事件**必须自带足够的字段**，否则只收增量的客户端重建不出画面。
 * 举例：完工时只发 `{state:'idle'}`，客户端就不知道该把人从工位上摘掉——
 * 画面上他会永远坐在那张桌子上。而全量快照是对的，所以这个 bug **只在换成增量之后
 * 才出现**，且看起来像"渲染层没刷新"，极难归因。
 *
 * 所以做法是：每条事件都**并入变更后的当前值**，而不是在每个调用点手写要带哪些字段
 * （手写迟早会漏一个，而漏的症状如上所述）。
 *
 * 这三个字段（`state` / `station` / `targetStation` / `carrying`）就是渲染与 HUD 需要的全集——
 * 判断标准很简单：**面板从快照里读的字段，增量里也必须能拿到**。
 */
import type { World } from '../domain/types.js'

/** 角色当前的渲染相关字段。 */
export function agentPatch(world: World, id: string): Record<string, unknown> {
  const a = world.agents.find((x) => x.id === id)
  if (a === undefined) return {}
  return {
    state: a.state,
    station: a.station,
    targetStation: a.targetStation,
    carrying: a.carrying,
    facing: a.facing,
  }
}

/** 工单当前的渲染相关字段。 */
export function taskPatch(world: World, id: string): Record<string, unknown> {
  const t = world.tasks.find((x) => x.id === id)
  if (t === undefined) return {}
  return {
    // 面板画工单板要用的一整组：没有 title/ordinal 的话，
    // **新派进来的工单在客户端根本建不出来**（只收增量的客户端看不到快照里的那些字段）。
    title: t.title,
    key: t.key,
    ordinal: t.ordinal,
    status: t.status,
    progress: t.progress,
    owner: t.owner,
    station: t.station,
    estimateTicks: t.estimateTicks,
  }
}
