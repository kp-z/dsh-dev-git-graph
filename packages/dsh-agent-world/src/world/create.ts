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
import { createRng, seedFromString } from '../domain/rng.js'
import type { Task, World } from '../domain/types.js'
import { hangoutsForWorld } from './hangouts.js'

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
  const maxAgents = options.maxAgents ?? MAX_AGENTS

  const districts = scene.districts.map((id) =>
    instantiateDistrict(content.require('districts', id, `场景 ${scene.id} 引用的地块`)),
  )
  const districtById = new Map(districts.map((d) => [d.id, d]))
  const stations = scene.stations.map((id) =>
    instantiateStation(content.require('stations', id, `场景 ${scene.id} 引用的站点`), districtById),
  )

  const roster = content.require('rosters', scene.roster, `场景 ${scene.id} 引用的花名册`)
  const agents = instantiateAgents(roster, scene.spawn, maxAgents, rng, scene.agentModel)

  // 待命的人站哪（BACKLOG M2.5-1 + R47 P0-1）。**不给的话他们会永远叠在出生点上**——
  // 因为角色只在被派活时才移动，从没被派过活的人一步都不会走。
  //
  // R47 修的那件事：落点还必须知道**家具占了哪儿**。原来只按地块几何摊栅格，
  // 于是"沙发上的三个角色"是必然的——布局算法根本不认识站点。
  //
  // 算它的是 `hangoutsForWorld`（`hangouts.ts`）：**建世界与读档重算共用同一个函数**，
  // 否则两份实现会漂移，症状是"新开一局对、读旧档错"。
  const hangouts = hangoutsForWorld(districts, stations, agents.length)
  agents.forEach((agent, i) => {
    agent.hangout = hangouts[i % hangouts.length] ?? null
  })

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
