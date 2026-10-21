/**
 * 读档时**重算派生量**（M10-12，R49）。
 *
 * ## 它修的是同一个坑的第三次露面
 *
 * 「存档里存了本可以从内容重算出来的量」已经咬了三次：
 *
 * | 轮次 | 面孔 |
 * |---|---|
 * | R47 | 待命落点修好了，但那一局是从存档接回的 → 修复**看不见** |
 * | R48 | 站点加了组合道具，旧存档的站点没有 `parts` → 计划层 `.map` 直接 **500** |
 * | R48 | 组合道具在用户那一局同样看不见（得重开一局） |
 *
 * 根因一样：**存档是"上一个版本的内容"的冻结，而世界里有两种东西被混在一起存了**。
 *
 * ## 界线：派生量 vs 历史
 *
 * - **派生量**（几何 + 当前内容就能算出来，与"发生过什么"无关）→ **重算**：
 *   `station.parts` / `station.slots` / `station.model` / `station.anchor` /
 *   `capacity` / `capabilities` / `name` / `kind`、`district.*`、`agent.hangout`。
 * - **历史**（"曾经发生过什么"的痕迹）→ **原样保留**：
 *   `tick`、`seq`、`seed`、`mode`、`createdAt`、`tasks[*]`（含进度/负责人/状态）、
 *   `messages`、`agent.position` / `state` / `path` / `station` / `targetStation` / `carrying`、
 *   `agent.llm`（角色 ↔ 模型的绑定）与 `boundAgentId`（会话绑定）。
 *
 * 一句话判据：**"把这个量删掉，世界还能不能从内容和历史重新推出来？"**
 * 能 → 它是派生量，读档时重算；不能 → 它是历史，别动。
 *
 * ## 唯一一个"两可"的量：`agent.hangout` 变了，人要不要跟着挪？
 *
 * 先说一个**反直觉的事实**（有测试盯着）：`idle` **不等于**"站在原地"。
 * `sim/idle.ts` 的 `advanceIdle()` 每 tick 把 `idle` 的人朝 `agent.hangout` 推，
 * 所以只要模拟在跑，改完 `hangout` 之后他**自己会走过去**——
 * "不挪位置就永远看不见修复"这个前提**只在世界暂停时成立**。
 *
 * 所以这里画的那条线是"位置是不是落点的函数"：
 *
 * 一个角色**同时**满足下面四条时，他的位置就是"旧落点的拷贝"，属于派生量，跟着挪：
 *   1. `state === 'idle'`（没在干活）；
 *   2. `station === null && targetStation === null && path.length === 0`
 *      （没有任何在途意图——走路中的人 `state` 也是 `idle`，所以这一条必须有）；
 *   3. 位置**就在旧落点上**（容差 {@link HANGOUT_MOVE_EPSILON}）；
 *   4. 新旧落点确实不同。
 *
 * 任何一条不满足 → **只改 `hangout`，位置一个字都不动**（历史）。
 * 容差取 0.25：`WALK_SPEED` 是 0.06/tick，0.25 ≈ 4 个 tick 的步长——
 * 也就是"他最多再走几 tick 就到旧落点了"，而不是"他在别处干别的事"；
 * 同时它远小于落点之间的最小间距（实测 1.92），所以不会误伤站在别人的落点上的人。
 *
 * 挪的时候顺手把 `path` 清成空：他已经在新的休息点上了，任何旧路径都是残渣
 * （`advanceIdle` 自己也会清，这里只是不让"已到位却还挂着路径"这个中间态存在）。
 *
 * ## 不改入参、确定性
 *
 * 返回**新的 `World`**（只新建真正变了的那些对象，其余复用引用），入参一个字节都不动。
 * 全程没有 `Date.now()` / `Math.random()`：同 `(world, content)` 必得同结果。
 * 也不需要 `rng`——重算的都是几何。
 */
import { instantiateDistrict, instantiateStation } from '../content/instantiate.js'
import type { ContentRegistry } from '../content/registry.js'
import { slotsFor } from '../domain/constants.js'
import { distance } from '../domain/geometry.js'
import type { Agent, District, Station, World } from '../domain/types.js'
import { DEFAULT_MIN_GAP, hangoutsForWorld } from './hangouts.js'
import { navFromMap, nearestWalkablePoint } from './nav.js'

/** "他确实停在旧落点上"的容差（世界单位）。理由见文件头。 */
export const HANGOUT_MOVE_EPSILON = 0.25

/** 重算结果。 */
export interface ReconcileResult {
  /** 重算后的世界。**入参未被修改**。 */
  readonly world: World
  /** 改了什么（人话，可直接进 issue 列表）。空数组 = 内容与存档一致。 */
  readonly changes: readonly string[]
  /** 降级信息：内容里缺条目之类。**不能因此让插件起不来**。 */
  readonly warnings: readonly string[]
}

/**
 * 沿用存档里的站点时，把**派生字段补齐到渲染层能读的形状**。
 *
 * 为什么必须有这一步：旧存档（R48 之前）的站点没有 `parts`，而计划层会 `.map(parts)`——
 * 那正是当初 `/api/world` 500 的成因。所以"重算失败就沿用存档"不能是终点：
 * 沿用下来的那份也得补成同一套形状，否则**降级路径本身**会把那个 500 又放回来。
 *
 * 补法只有一种是有依据的：`model` 是"单件家具"，`parts` 就是那一件
 * （与 `instantiateStation` 里 `props` 缺省时的行为完全一致）。
 */
function salvageStation(saved: Station): Station {
  const hasParts = Array.isArray(saved.parts) && saved.parts.length > 0
  const hasSlots = Array.isArray(saved.slots) && saved.slots.length > 0
  if (hasParts && hasSlots) return saved
  return {
    ...saved,
    parts: hasParts ? saved.parts : [{ modelId: saved.model, dx: 0, dy: 0, dz: 0, rotationY: 0 }],
    slots: hasSlots ? saved.slots : slotsFor(saved.capacity),
  }
}

/** 空结果（内容不可用时原样返回）。 */
function untouched(world: World, warnings: readonly string[]): ReconcileResult {
  return { world, changes: [], warnings }
}

/**
 * 两个站点在**派生量**上是否等同。
 *
 * 注意 `parts` 用 `?? null` 兜底：**旧存档里根本没有这个字段**（R48 之前），
 * 而"存档里没有"正是这个任务要处理的输入——直接读 `.parts.length` 就是
 * 当初那个 500 的同款错误（本文件的测试真的抓到过一次）。
 */
function sameStation(a: Station, b: Station): boolean {
  const parts = (s: Station) => JSON.stringify(s.parts ?? null)
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.kind === b.kind &&
    a.district === b.district &&
    a.anchor.x === b.anchor.x &&
    a.anchor.z === b.anchor.z &&
    a.capacity === b.capacity &&
    a.model === b.model &&
    parts(a) === parts(b) &&
    JSON.stringify(a.capabilities) === JSON.stringify(b.capabilities) &&
    JSON.stringify(a.slots) === JSON.stringify(b.slots)
  )
}

/**
 * 按**当前内容**重算存档世界里的派生量。
 *
 * @param world - 从存档读出来的世界（不会被修改）。
 * @param content - 当前装载的内容注册表。
 * @returns 重算后的世界 + 改动清单 + 降级警告。
 */
export function reconcileWorld(world: World, content: ContentRegistry): ReconcileResult {
  const warnings: string[] = []
  const changes: string[] = []

  const sceneId = world.origin.scene
  const scene = content.get('scenes', sceneId)?.data
  if (scene === undefined) {
    const available = content.list('scenes').map((entry) => entry.id)
    return untouched(world, [
      `存档用的场景 "${sceneId}" 不在当前内容里，派生量没有重算（世界按存档原样继续）。` +
        `可用场景：${available.length > 0 ? available.join(' / ') : '（没有）'}`,
    ])
  }

  // ── 地块 ────────────────────────────────────────────────────────────────
  //
  // 地块也是**纯派生**（kind/bounds/ground 全来自内容）。它必须一起重算：
  // 站点锚点是"地块中心 + 偏移"算出来的，只换站点不换地块会得到
  // "几何一半新一半旧"的世界——那正是这个任务要消灭的那类 bug。
  const savedDistricts = new Map(world.districts.map((d) => [d.id, d]))
  const districts: District[] = []
  for (const id of scene.districts) {
    const entry = content.get('districts', id)?.data
    if (entry === undefined) {
      warnings.push(`场景 "${sceneId}" 引用的地块 "${id}" 不在当前内容里：这一块跳过，世界少一块地。`)
      continue
    }
    districts.push(instantiateDistrict(entry))
  }
  const currentDistrictIds = new Set(districts.map((d) => d.id))
  const droppedDistricts: string[] = []
  for (const saved of world.districts) {
    if (currentDistrictIds.has(saved.id)) continue
    // 当前场景不再声明它，但存档里有：**保留**（可能有站点/历史在引用），只报出来。
    districts.push(saved)
    droppedDistricts.push(saved.id)
  }
  const districtById = new Map(districts.map((d) => [d.id, d]))

  // ── 站点：整条记录都是派生的（parts/slots/anchor/capacity/capabilities/name/kind）──
  const savedStations = new Map(world.stations.map((s) => [s.id, s]))
  const stations: Station[] = []
  const refreshed: string[] = []
  const changedStations: string[] = []
  let partsTotal = 0
  for (const id of scene.stations) {
    const entry = content.get('stations', id)?.data
    if (entry === undefined) {
      warnings.push(`场景 "${sceneId}" 引用的站点 "${id}" 不在当前内容里：这一站跳过。`)
      continue
    }
    try {
      const fresh = instantiateStation(entry, districtById)
      stations.push(fresh)
      refreshed.push(id)
      partsTotal += fresh.parts.length
      // **只报真正变了的**：`changes` 是给用户看的"这一局哪里不一样了"。
      // 无条件报"已重算"会让它在每次启动都出现，于是没人再读它（而且幂等测试会红）。
      const saved = savedStations.get(id)
      if (saved === undefined || !sameStation(saved, fresh)) changedStations.push(id)
    } catch (error) {
      // 内容自身不自洽（例如 relativeTo 指向的地块不在场景里）：**降级**，不让插件起不来。
      warnings.push(
        `站点 "${id}" 按当前内容重算失败（沿用存档里的那份）：` +
          `${error instanceof Error ? error.message : String(error)}`,
      )
      const saved = savedStations.get(id)
      if (saved !== undefined) stations.push(salvageStation(saved))
    }
  }
  const currentStationIds = new Set(stations.map((s) => s.id))
  const droppedStations: string[] = []
  for (const saved of world.stations) {
    if (currentStationIds.has(saved.id)) continue
    // 内容里删掉了，但历史（`task.station` / `agent.station`）可能还指着它。
    // **保留**而不是删掉：删了会让调度器查到一个不存在的站点 id。
    stations.push(salvageStation(saved))
    droppedStations.push(saved.id)
  }

  if (changedStations.length > 0) {
    changes.push(
      `站点派生量已按当前内容重算：${changedStations.length} 个站点变了（共 ${refreshed.length} 站、${partsTotal} 个部件；parts/slots/锚点）`,
    )
  }
  if (droppedStations.length > 0) {
    warnings.push(
      `这些站点在当前场景里已经没有了，但存档里还在（历史可能仍引用它们，所以保留）：${droppedStations.join(' / ')}`,
    )
  }
  if (droppedDistricts.length > 0) {
    warnings.push(`这些地块在当前场景里已经没有了，但存档里还在（保留）：${droppedDistricts.join(' / ')}`)
  }

  // ── 外观：由**花名册**重算（R51）─────────────────────────────────────────
  //
  // `agent.modelId` 是"这个人长什么样"，来源是花名册席位的 `appearance`（内容），
  // 所以它是**派生量**——与 `hangout` 同一条规矩。旧存档里没有这个字段（R51 才加），
  // 不重算的话渲染层拿到 `undefined`，表现是"人不显示"或"所有人用同一个形象"。
  const rosterId = scene.roster
  const roster = rosterId === undefined ? undefined : content.get('rosters', rosterId)?.data
  const appearanceById = new Map<string, { modelId: string; palette: string }>()
  if (roster !== undefined) {
    roster.seats.forEach((seat, i) => {
      appearanceById.set(`agent-${i + 1}`, {
        modelId: seat.appearance ?? scene.agentModel,
        palette: seat.palette,
      })
    })
  }

  // ── 导航网格（派生量，与建世界同一个来源）——**在算落点之前**，落点要避开墙。──
  // 与 `createWorld` 同一条规则：只有声明了 `map` 的场景才有可行走网格（否则 null → 直线走）。
  const nav = navFromMap(
    typeof scene.map === 'string'
      ? content.require('maps', scene.map, `场景 ${scene.id} 引用的底图`)
      : null,
  )

  // ── 落点：由地块几何 + 站点占位 + 墙重算（与建世界同一个函数，保证不漂移）──
  const hangouts = hangoutsForWorld(districts, stations, world.agents.length, DEFAULT_MIN_GAP, nav)

  const agents: Agent[] = []
  const movedIdle: string[] = []
  let hangoutChanged = 0
  let appearanceChanged = 0
  world.agents.forEach((agent, index) => {
    const next = hangouts[index % Math.max(1, hangouts.length)] ?? null
    const old = agent.hangout
    const hangoutMoved = old === null || next === null ? old !== next : distance(old, next) > 1e-9
    // 外观先算（它和落点无关，两者都要落到同一个 agent 对象上）。
    const want = appearanceById.get(agent.id)
    const withLook =
      want !== undefined && (agent.modelId !== want.modelId || agent.palette !== want.palette)
        ? { ...agent, modelId: want.modelId, palette: want.palette }
        : agent
    if (withLook !== agent) appearanceChanged += 1
    if (!hangoutMoved) {
      agents.push(withLook)
      return
    }
    hangoutChanged += 1

    const inert =
      agent.state === 'idle' &&
      agent.station === null &&
      agent.targetStation === null &&
      agent.path.length === 0
    const parkedOnOld = old !== null && distance(agent.position, old) <= HANGOUT_MOVE_EPSILON
    if (inert && parkedOnOld && next !== null) {
      // 他的位置就是旧落点的拷贝 → 派生量，跟着挪。（世界在跑时本来他自己也会走过去；
      // 但暂停的世界不会，而"暂停时看起来没修好"正是这个 bug 最初的报告方式。）
      agents.push({ ...withLook, hangout: next, position: { ...next }, path: [] })
      movedIdle.push(agent.name)
      return
    }
    // 有在途意图、或不在旧落点上 → 只改落点，位置是历史。
    agents.push({ ...withLook, hangout: next })
  })

  // R229：地图新增了"美术占位"格时，存档里可能有人正站在上面。
  // 只挪**站在不可走格上**的人（其余位置是历史，不动）。
  if (nav !== null) {
    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i]
      if (agent === undefined) continue
      const col = Math.round((agent.position.x - nav.originX) / nav.unitsPerCell - 0.5)
      const row = Math.round((agent.position.z - nav.originZ) / nav.unitsPerCell - 0.5)
      const inside = col >= 0 && col < nav.width && row >= 0 && row < nav.height
      if (inside && nav.blocked[row * nav.width + col] !== true) continue
      const near = nearestWalkablePoint(nav, agent.position)
      if (near === null) continue
      agents[i] = { ...agent, position: near, hangout: agent.hangout ?? near, path: [] }
      movedIdle.push(agent.name)
    }
  }

  if (appearanceChanged > 0) {
    changes.push(`角色外观已按当前花名册重算：${appearanceChanged} 个角色换了形象或配色`)
  }

  if (hangoutChanged > 0) {
    changes.push(
      `待命落点已按当前站点重算：${hangoutChanged} 个角色换了地点` +
        (movedIdle.length > 0 ? `（其中 ${movedIdle.length} 个 idle 且正停在旧落点上的被一并挪过去：${movedIdle.join('、')}）` : ''),
    )
  }

  return {
    // ⚠️ **派生量必须在这里一次列全**（R66 补 `nav`）。
    //
    // `nav` 是导航网格（由内容的地图算出），与 `districts`/`stations` 同类。
    // R64 我加了它，但只在 `create.ts` 里接了、**reconcile 这里漏了**——
    // 于是"新开一局绕障、读旧档穿墙"，而且**我的隔离测试是绿的**：
    // 测试拿一个已经带 `nav` 的世界去 reconcile，`{...world}` 把它带过去了，
    // 而**真实存档里根本没有 `nav`**（它是派生量，从不落盘）。
    //
    // 这正是 R47/R48 那个坑的形状（"派生量漏了一处，只在旧档上复现"），
    // 所以规矩是：**加一个派生字段，就必须在 `createWorld` 与 `reconcileWorld`
    // 两处同时补上**——`{...world}` 的展开会掩盖漏掉的那一处。
    world: {
      ...world,
      districts,
      stations,
      agents,
      nav,
    },
    changes,
    warnings,
  }
}
