/**
 * 内容 → 世界对象的实例化（BACKLOG M1-5）。
 *
 * 这一层是**内容库与模拟内核之间唯一的翻译层**。
 *
 * 它的存在本身就是解耦的证据：内容库里的 `StationEntry`（相对坐标、能力枚举、皮肤 token）
 * 到这里变成模拟真正消费的 `Station`（绝对锚点、算好的 slot）。模拟内核从头到尾不知道
 * "内容包"是什么东西，也不知道 Kenney 是谁——它只看见一座已经摆好的小镇。
 *
 * ## 分层
 *
 *   domain/  （纯类型 + 纯函数，不认识内容）
 *      ↑
 *   content/ （内容库：类型、校验、注册表、内置包、本文件的实例化）
 *      ↑
 *   world/   （createWorld：把内容装配成一个可 step() 的 World）
 *
 * 依赖**单向向上**，没有环。加新东西时按这个方向放。
 */
import type { Agent, District, Station, Task, Vec2 } from '../domain/types.js'
import type { Rng } from '../domain/rng.js'
import { slotsFor } from '../domain/constants.js'
import type { DistrictEntry, RosterEntry, StationEntry, TaskSetEntry } from './kinds.js'

/** 矩形中心。 */
export function districtCenter(bounds: { min: Vec2; max: Vec2 }): Vec2 {
  return { x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2 }
}

/** 内容条目 → District。基本是直通，只是把 bounds 深拷贝一份，避免实例之间共享引用。 */
export function instantiateDistrict(entry: DistrictEntry): District {
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    bounds: { min: { ...entry.bounds.min }, max: { ...entry.bounds.max } },
    ground: entry.ground,
  }
}

/**
 * 内容条目 → Station。
 *
 * 解析 `relativeTo`：给了就是"相对该地块中心的偏移"，否则坐标按绝对值用。
 * 地块不存在时**抛错**而不是悄悄按绝对值处理——那样站点会跑到地图外面，
 * 而报错里能直接说清是哪个地块没找到。
 */
export function instantiateStation(entry: StationEntry, districts: ReadonlyMap<string, District>): Station {
  let anchor: Vec2 = { ...entry.anchor }
  if (entry.relativeTo !== null) {
    const home = districts.get(entry.relativeTo)
    if (!home) {
      throw new Error(
        `站点 "${entry.id}" 声明 relativeTo="${entry.relativeTo}"，但这个地块不在场景里。` +
          `场景中的地块：${[...districts.keys()].join(' / ') || '（无）'}`,
      )
    }
    const c = districtCenter(home.bounds)
    anchor = { x: c.x + entry.anchor.x, z: c.z + entry.anchor.z }
  }
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    district: entry.district,
    anchor,
    capacity: entry.capacity,
    capabilities: [...entry.capabilities],
    slots: slotsFor(entry.capacity),
  }
}

/** 内容条目 → 一队 Agent。 */
export function instantiateAgents(
  roster: RosterEntry,
  spawn: Vec2,
  maxAgents: number,
  rng: Rng,
): Agent[] {
  const seats = roster.seats.slice(0, Math.max(0, maxAgents))
  return seats.map((seat, i) => ({
    id: `agent-${i + 1}`,
    name: seat.name,
    role: seat.role,
    palette: seat.palette,
    state: 'idle' as const,
    position: { ...spawn },
    // 初始朝向来自 rng：同一个 seed 得到同一个朝向，可复现。
    facing: rng.range(0, Math.PI * 2),
    station: null,
    targetStation: null,
    path: [],
    carrying: null,
    llm: seat.model ?? { provider: '', model: '', reasoningEffort: null },
    boundAgentId: null,
  }))
}

/**
 * 任务集 → 一组 Task。
 *
 * 两段映射，容易写错，所以集中在这里：
 * 1. `key` → 全局实例 id（`task-<n>`），保证不同任务集之间也不会撞 id；
 * 2. `dependsOn: ['design']` → `blockedBy: ['task-3']`。
 *
 * 一律落 `status: 'pending'`——**只有 `sim/ready.ts` 能把它变成 `ready`**。
 * 建世界时不做依赖求值，避免出现第二个判断依赖的地方。
 */
export function instantiateTasks(
  set: TaskSetEntry,
  startIndex: number,
  tick: number,
): Task[] {
  const idOf = new Map<string, string>()
  set.tasks.forEach((t, i) => idOf.set(t.key, `task-${startIndex + i}`))

  return set.tasks.map((t, i) => ({
    id: `task-${startIndex + i}`,
    key: t.key,
    set: set.id,
    ordinal: startIndex + i,
    suggestedRole: t.role,
    title: t.title,
    description: t.description,
    status: 'pending' as const,
    owner: null,
    station: null,
    requires: [...t.requires],
    blockedBy: t.dependsOn.map((k) => idOf.get(k)).filter((v): v is string => v !== undefined),
    progress: 0,
    attemptId: null,
    acceptance: t.acceptance,
    estimateTicks: t.estimateTicks,
    createdAtTick: tick,
    finishedAtTick: null,
  }))
}
