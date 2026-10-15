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
import { boundsCenter } from '../domain/geometry.js'
import type { DistrictEntry, RosterEntry, StationEntry, TaskSetEntry } from './kinds.js'

/**
 * 矩形中心。
 *
 * 实现已归位到 `domain/geometry.ts` 的 `boundsCenter`——那里才是它的家
 * （纯几何，不该让调用方为了一个中心点去 import 内容层）。这里保留名字，
 * 因为内容层内部读起来"地块中心"比"边界中心"更顺。
 */
export const districtCenter = boundsCenter

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
    model: entry.model,
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
    // 歇脚点在 `world/create.ts` 里按广场地块的几何分配——**内容层不认识布局**，
    // 它只负责"有哪些角色"。这里给 null，装配层再填。
    hangout: null,
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
  /**
   * 这是第几批（1 起）。第二批起标题会带上批次号（M6-15，R45）。
   *
   * R36 真机：小铁自己指出"同一套流水线派两次，新旧工单标题一模一样，靠标题认工单会认错"
   * （task-11/12/13 vs task-1/2/3）。**内容库里的标题不变**——批次是实例的属性，
   * 不是内容的属性；改内容会让"同一套活"在不同批次里看起来是两套活。
   */
  batch = 1,
): Task[] {
  const idOf = new Map<string, string>()
  set.tasks.forEach((t, i) => idOf.set(t.key, `task-${startIndex + i}`))
  const suffix = batch <= 1 ? '' : ` #${batch}`

  return set.tasks.map((t, i) => ({
    id: `task-${startIndex + i}`,
    key: t.key,
    set: set.id,
    ordinal: startIndex + i,
    suggestedRole: t.role,
    title: `${t.title}${suffix}`,
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
      // D41：内容库实例化出来的单还没接到团队；live 模式下由同步把 externalId 补上。
      externalId: null,
      output: null,
      failureReason: null,
  }))
}
