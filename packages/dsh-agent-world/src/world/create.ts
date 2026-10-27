/**
 * 造一个世界（BACKLOG M1-5）。
 *
 * 纯函数：给一个**已装载并校验过的内容注册表** + 一个场景 id，返回结构完整、可立刻 step() 的 World。
 * 不读盘、不读时间（`createdAt` 由调用方传入）、不碰网络。
 * 「不读时间」是刻意的：确定性要求内核里没有 `Date.now()`。
 *
 * 这里是**内容库与模拟内核的接缝**：本文件之上是内容（可替换的 JSON/TS 数据），
 * 之下是模拟（只认 `World` 结构，完全不知道"内容包"是什么）。
 */
import {
  instantiateAgents,
  instantiateDistrict,
  instantiateStation,
  instantiateTasks,
} from '../content/instantiate.js'
import type { ContentRegistry } from '../content/registry.js'
import { MAX_AGENTS } from '../domain/constants.js'
import { angleTo } from '../domain/geometry.js'
import { createRng, seedFromString } from '../domain/rng.js'
import type { Task, World } from '../domain/types.js'
import { DEFAULT_MIN_GAP, hangoutsForWorld } from './hangouts.js'
import { navFromMap, nearestWalkablePoint } from './nav.js'

/** 建世界的选项。 */
export interface CreateWorldOptions {
  /** 内容注册表（调用方负责先 `loadAll` 并处理掉 error 级问题）。 */
  content: ContentRegistry
  /** 用哪个场景条目（`scenes` 库的 id）。 */
  scene: string
  /** 世界名。不给就用场景名。 */
  name?: string
  /** 显式种子。不给就从「世界名 + 场景 id」派生，保证同名同场景可复现。 */
  seed?: number
  /** 创建时间（ISO8601）。由调用方注入，保持内核无时间依赖。 */
  createdAt: string
  /** 建世界时就派进去的任务集 id。不给就是空板，等 lead 用 dispatch 派单。 */
  taskSets?: readonly string[]
  /** 同屏角色上限。 */
  maxAgents?: number
  /**
   * 开局铺几个角色。
   *
   * - `all`（默认）：内容花名册全员，保持旧 demo/测试行为；
   * - `captain`：只放第一位（队长），其余等真实 subagent 出现再投影（R166）。
   */
  initialAgents?: 'all' | 'captain'
}

/** 世界 id：名字 + 种子，保证可复现（同样输入 → 同样 id）。 */
function worldId(name: string, seed: number): string {
  return `world-${seed.toString(36)}-${name.length.toString(36)}`
}

/**
 * 建一个世界。
 *
 * @param options - 建世界选项；`content` / `scene` / `createdAt` 必填。
 * @returns 可立刻 step() 的世界。
 */
export function createWorld(options: CreateWorldOptions): World {
  const { content } = options
  const scene = content.require('scenes', options.scene, '建世界时指定的场景')
  const name = options.name ?? scene.name
  const seed = options.seed ?? seedFromString(`${name}:${scene.id}`)
  const rng = createRng(seed)
  const maxAgents = options.maxAgents && options.maxAgents > 0 ? Math.floor(options.maxAgents) : Number.MAX_SAFE_INTEGER

  const districts = scene.districts.map((id) =>
    instantiateDistrict(content.require('districts', id, `场景 ${scene.id} 引用的地块`)),
  )
  const districtById = new Map(districts.map((d) => [d.id, d]))
  const stations = scene.stations.map((id) =>
    instantiateStation(content.require('stations', id, `场景 ${scene.id} 引用的站点`), districtById),
  )

  const roster = content.require('rosters', scene.roster, `场景 ${scene.id} 引用的花名册`)
  const seeded = instantiateAgents(roster, scene.spawn, maxAgents, rng, scene.agentModel)
  const agents = options.initialAgents === 'captain' ? seeded.slice(0, 1) : seeded

  // 导航网格（R64 物理）：从内容的地图派生。**必须在算歇脚点之前**——
  // 歇脚点要避开墙（R75），而墙数据来自这张网格。
  // 可行走网格也跟场景走：只有声明了 `map` 的场景才有（否则 null → 退回直线走）。
  // 之前这里取 `list('maps')[0]`，默认小镇也拿到办公室的墙/家具碰撞，走位会撞上"看不见的墙"。
  const nav = navFromMap(
    typeof scene.map === 'string'
      ? content.require('maps', scene.map, `场景 ${scene.id} 引用的底图`)
      : null,
  )

  // 待命的人站哪（BACKLOG M2.5-1 + R47 P0-1）。**不给的话他们会永远叠在出生点上**——
  // 因为角色只在被派活时才移动，从没被派过活的人一步都不会走。
  //
  // R47 修的那件事：落点还必须知道**家具占了哪儿**。原来只按地块几何摊栅格，
  // 于是"沙发上的三个角色"是必然的——布局算法根本不认识站点。
  // R75：还得知道**墙在哪**——只避家具不避墙，人会站进墙里（真机：8 人里 3 个在墙上）。
  //
  // 算它的是 `hangoutsForWorld`（`hangouts.ts`）：**建世界与读档重算共用同一个函数**，
  // 否则两份实现会漂移，症状是"新开一局对、读旧档错"。
  const hangouts = hangoutsForWorld(districts, stations, agents.length, DEFAULT_MIN_GAP, nav)
  agents.forEach((agent, i) => {
    const hangout = hangouts[i % hangouts.length] ?? null
    agent.hangout = hangout
    if (hangout !== null) {
      // 开局直接站在自己的歇脚点上（不再全部叠在出生点），并**面向房间中心**——
      // 位置与朝向都确定，不是随机开局（用户："初始化位置也不对 / 不要搞得很随机"）。
      agent.position = { ...hangout }
      agent.facing = angleTo(hangout, { x: 0, z: 0 })
    }
  })

  // R229：地图可能新增了"美术占位"格（家具/台面）。出生点若正好落在里面，
  // 先挪到最近可走格——否则人会一开局就被自己的碰撞体卡在桌子里。
  if (nav !== null) {
    for (const agent of agents) {
      const col = Math.round((agent.position.x - nav.originX) / nav.unitsPerCell - 0.5)
      const row = Math.round((agent.position.z - nav.originZ) / nav.unitsPerCell - 0.5)
      const inside = col >= 0 && col < nav.width && row >= 0 && row < nav.height
      if (inside && nav.blocked[row * nav.width + col] !== true) continue
      const near = nearestWalkablePoint(nav, agent.position)
      if (near !== null) agent.position = near
    }
  }

  // 任务集按顺序实例化。`startIndex` 接着上一批的号往下排，保证跨集合也不撞 id。
  const taskSets = [...(options.taskSets ?? [])]
  const tasks: Task[] = []
  for (const setId of taskSets) {
    const set = content.require('tasks', setId, '建世界时指定的任务集')
    tasks.push(...instantiateTasks(set, tasks.length + 1, 0))
  }

  return {
    id: worldId(name, seed),
    name,
    seed,
    tick: 0,
    createdAt: options.createdAt,
    paused: false,
    agentModel: scene.agentModel,
    mode: 'simulated',
    origin: { scene: scene.id, packs: content.packIds, taskSets },
    districts,
    stations,
    nav,
    gameMode: false,
    agents,
    tasks,
    messages: [],
    events: [],
    seq: 1,
    messageSeq: 1,
  }
}

/** 待命角色的歇脚点算法已抽到 `hangouts.ts`（R47 P0-1）：
 * 它现在要避开站点占位，所以需要"被占的位置 + 半径"这类几何事实。 */
