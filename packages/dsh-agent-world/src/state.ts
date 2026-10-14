/**
 * 插件的运行期状态（BACKLOG M0-2 的最小版本）。
 *
 * 当前：世界只活在内存里，能建、能读、能重置。
 * M2-1 会在这里接上落盘（`store/worldStore.ts`），M2-2 会接上 tick 循环与订阅广播。
 *
 * 刻意**不**把它做成一个 cordis Service：世界是这个插件自己的东西，
 * 没有第二个插件需要注入它；做成 Service 只会多一层间接。
 * 真正需要跨插件共享时再抽，不为将来可能的复用预先抽象。
 */
import type { AgentWorldConfig } from './config.js'
import { DEFAULT_TICK_MS, MAX_AGENTS } from './domain/constants.js'
import { createWorld } from './domain/create.js'
import type { World } from './domain/types.js'

/** 插件状态。一个插件实例一份。 */
export interface PluginState {
  readonly config: AgentWorldConfig
  /** 逻辑 tick 间隔（ms）。渲染层用它算插值窗口，所以它必须能被读到，而不只躺在配置里。 */
  readonly tickMs: number
  /** 当前世界；`agent_world_open` 之前为 null。 */
  world: World | null
  /** 没有世界就建一个（幂等）。 */
  ensureWorld(): World
  /** 丢掉当前世界，按给定名字重建。 */
  resetWorld(name?: string): World
}

/**
 * 建插件状态。
 *
 * @param config - 已 resolve 过的配置（default 已填好）。
 */
export function createPluginState(config: AgentWorldConfig): PluginState {
  const tickMs = config.tickMs > 0 ? config.tickMs : DEFAULT_TICK_MS

  const state: PluginState = {
    config,
    tickMs,
    world: null,

    ensureWorld(): World {
      if (state.world) return state.world
      state.world = buildWorld(config.worldName)
      return state.world
    },

    resetWorld(name?: string): World {
      // 注意：这里**不**保留旧世界的任何东西。归档是 M7 的事；
      // 现在丢掉就是丢掉，避免"以为还在"的错觉。
      state.world = buildWorld(name ?? config.worldName)
      return state.world
    },
  }

  return state
}

/**
 * 造一个世界的唯一入口。
 *
 * `createdAt` 在这里注入（而不是在 domain 里读日期），保持内核无时间依赖、可确定性测试。
 */
function buildWorld(name: string): World {
  return createWorld({
    name,
    createdAt: new Date().toISOString(),
    maxAgents: MAX_AGENTS,
  })
}
