/**
 * 造一个世界（BACKLOG M1-2）。
 *
 * 纯函数：给 seed 与选项，返回一个结构完整、可立刻 step() 的 World。
 * 不读盘、不读时间（`createdAt` 由调用方传入）、不碰网络。
 * 「不读时间」是刻意的：确定性要求模拟内核里没有 `Date.now()`。
 */
import {
  AGENT_PALETTE,
  DEFAULT_DISTRICTS,
  DEFAULT_STATIONS,
  DISTRICT_GROUND,
  ROLE_COLOR,
} from './constants.js'
import { districtCenter, instantiateStation } from './constants.js'
import { createRng, seedFromString } from './rng.js'
import type { Agent, AgentRole, District, Station, Task, Vec2, World } from './types.js'

/** 默认小镇的名字池。第一项归 lead，后面按需要分配给成员。 */
const AGENT_NAMES = [
  '工头阿金',
  '小蓝',
  '小铁',
  '小绿',
  '小紫',
  '小橙',
  '小灰',
  '小青',
  '小绯',
  '小赭',
  '小黛',
  '小雯',
] as const

/** 默认角色配比：1 lead + 工程师为主 + 各有专长。 */
const DEFAULT_ROSTER: readonly AgentRole[] = [
  'lead',
  'engineer',
  'engineer',
  'engineer',
  'reviewer',
  'researcher',
  'ops',
  'docs',
] as const

/** 建世界的选项。全部可选——默认就能得到一座完整的小镇。 */
export interface CreateWorldOptions {
  /** 世界名。同时是 seed 的来源（除非显式给了 seed）。 */
  name?: string
  /** 显式种子。不给就用名字派生。 */
  seed?: number
  /** 初始角色数（上限受 maxAgents 约束）。默认为 8（DEFAULT_ROSTER 的长度）。 */
  agents?: number
  /** 创建时间（ISO8601）。由调用方注入，保持内核无时间依赖。 */
  createdAt: string
  /** 初始工单。不给就是空板——由 lead 用 dispatch 派单。 */
  tasks?: readonly TaskSeed[]
  /** 同屏角色上限。 */
  maxAgents?: number
}

/** 派单时描述一件任务的种子数据。 */
export interface TaskSeed {
  title: string
  description?: string
  requires?: readonly string[]
  blockedBy?: readonly string[]
  acceptance?: string
}

/** 世界 id 生成：名字 + 种子，保证可复现（同样输入 → 同样 id）。 */
function worldId(name: string, seed: number): string {
  return `world-${seed.toString(36)}-${name.length.toString(36)}`
}

/**
 * 建一个世界。
 *
 * @param options - 建世界选项；`createdAt` 必填（保持内核无时间依赖）。
 * @returns 可立刻 step() 的世界。
 */
export function createWorld(options: CreateWorldOptions): World {
  const name = options.name ?? 'Agent World'
  const seed = options.seed ?? seedFromString(name)
  const rng = createRng(seed)
  const maxAgents = options.maxAgents ?? 24

  const districts: District[] = DEFAULT_DISTRICTS.map((d) => ({ ...d, bounds: { min: { ...d.bounds.min }, max: { ...d.bounds.max } }, ground: d.ground || DISTRICT_GROUND[d.kind] }))

  const byId = new Map(districts.map((d) => [d.id, d]))
  const stations: Station[] = []
  for (const template of DEFAULT_STATIONS) {
    const district = byId.get(template.district)
    if (!district) continue
    stations.push(instantiateStation(template, districtCenter(district.bounds)))
  }

  const count = Math.max(1, Math.min(maxAgents, options.agents ?? DEFAULT_ROSTER.length))
  const agents: Agent[] = []
  const spawn: Vec2 = { x: 0, z: 0 } // 小镇中心广场
  const palette = rng.shuffle(AGENT_PALETTE)

  for (let i = 0; i < count; i++) {
    const role = DEFAULT_ROSTER[i % DEFAULT_ROSTER.length] ?? 'engineer'
    const fallbackName = `角色-${i + 1}`
    const color = ROLE_COLOR[role] ?? palette[i % palette.length] ?? '#e8552f'
    agents.push({
      id: `agent-${i + 1}`,
      name: AGENT_NAMES[i] ?? fallbackName,
      role,
      palette: color,
      state: 'idle',
      position: { ...spawn },
      // 初始朝向随机但**来自 rng**，所以同一个 seed 得到同一个朝向。
      facing: rng.range(0, Math.PI * 2),
      station: null,
      targetStation: null,
      path: [],
      carrying: null,
      llm: { provider: '', model: '', reasoningEffort: null },
      boundAgentId: null,
    })
  }

  const tasks: Task[] = (options.tasks ?? []).map((seedTask, i) => makeTask(seedTask, i, 0))

  return {
    id: worldId(name, seed),
    name,
    seed,
    tick: 0,
    createdAt: options.createdAt,
    paused: false,
    mode: 'simulated',
    districts,
    stations,
    agents,
    tasks,
    messages: [],
    events: [],
    seq: 1,
  }
}

/**
 * 把任务种子变成 Task。
 *
 * `status` 一律先落 `pending`——**只有 `sim/ready.ts` 能把它变成 `ready`**，
 * 建世界时不做依赖求值，避免出现第二个判断依赖的地方。
 */
export function makeTask(seed: TaskSeed, index: number, tick: number): Task {
  return {
    id: `task-${index + 1}`,
    title: seed.title,
    description: seed.description ?? '',
    status: 'pending',
    owner: null,
    station: null,
    requires: (seed.requires ?? ['code']) as Task['requires'],
    blockedBy: [...(seed.blockedBy ?? [])],
    progress: 0,
    attemptId: null,
    acceptance: seed.acceptance ?? '',
    createdAtTick: tick,
    finishedAtTick: null,
  }
}
