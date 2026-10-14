/**
 * 插件的运行期状态（BACKLOG M1.5-2 / M1.6-5）。
 *
 * 它管两样东西：**内容注册表**（装载一次，全局共用）与**当前世界**（可以重开）。
 * 这个划分本身就是"内容 vs 存档"的划分：内容包是只读的、可替换的；世界是一局游戏的状态。
 *
 * ## 它是 `WorldServicePort` 的实现
 *
 * 组合根（`index.ts`）把这个对象交给工具，但工具看到的是**接口**（`WorldServicePort`），
 * 不是这个类。于是"换一套状态管理"不需要动工具，"给工具写单测"塞个假端口就行。
 * `test/boundaries.test.js` 保证这条不会被后人悄悄破坏。
 *
 * 当前世界只活在内存里，能建、能读、能重置。
 * M3-1 会接上落盘（`store/worldStore.ts`），M3-2 会接上 tick 循环与订阅广播。
 *
 * 刻意**不**把它做成一个 cordis Service：世界是这个插件自己的东西，
 * 没有第二个插件需要注入它；做成 Service 只会多一层间接。
 */
import type { AgentWorldConfig } from './config.js'
import { ContentRegistry, builtinPacks } from './content/index.js'
import { contentPortOf } from './content/port.js'
import { loadContentPacks } from './content/load-files.js'
import { DEFAULT_TICK_MS } from './domain/constants.js'
import type { World } from './domain/types.js'
import type { ContentIssue, ContentPort, WorldServicePort } from './protocol/index.js'
import { createWorld } from './world/create.js'

/** 建插件状态的选项。 */
export interface PluginStateOptions {
  /**
   * 外部内容包根目录（**绝对路径**）。null / 不传 = 只加载内置内容。
   *
   * 路径解析刻意放在 `index.ts`（那里能拿配置与宿主信息），这里只接受一个已经定好的目录——
   * 这样 `state.ts` 能被测试直接喂一个临时目录，不用去 mock 文件系统之外的东西。
   */
  externalRoot?: string | null
}

/**
 * 插件状态。**对外是 `WorldServicePort`**，下面是它自己的额外东西。
 */
export interface PluginState extends WorldServicePort {
  readonly config: AgentWorldConfig
  /** 内容注册表。装载一次，`agent_world_open` 之间共用（内容不该跟着世界一起重建）。 */
  readonly registry: ContentRegistry
  /** 实际读取的外部内容目录；没配就是 null。 */
  readonly externalRoot: string | null
  /** 世界对象本身；没建就是 null。工具走 `currentWorld()`，这个给组合根用。 */
  world: World | null
  /** 没有世界就建一个（幂等）。内容有问题时抛错，错误信息可直接给用户看。 */
  ensureWorld(): World
}

/**
 * 建插件状态。
 *
 * @param config - 已 resolve 过的配置（default 已填好）。
 * @param options - 外部内容根目录等。
 */
export function createPluginState(config: AgentWorldConfig, options: PluginStateOptions = {}): PluginState {
  const tickMs = config.tickMs > 0 ? config.tickMs : DEFAULT_TICK_MS
  const externalRoot = options.externalRoot ?? null

  const registry = new ContentRegistry()

  // 外部内容先**解析**（拿包与解析期问题），再和内置包一起**装载**。
  // 顺序很重要：内置在前、外部在后，于是外部包默认排在提供方链首 ——
  // 但链首不等于可以乱覆盖：没在 overrides 里声明的撞 id 仍然是错误（决策 D11）。
  const external = externalRoot === null ? { packs: [], issues: [] as ContentIssue[] } : loadContentPacks(externalRoot)

  const issueList: ContentIssue[] = [
    ...external.issues,
    ...registry.loadAll([...builtinPacks(), ...external.packs], {
      allowImplicitOverride: config.allowImplicitOverride,
    }),
  ]

  const contentPort: ContentPort = contentPortOf(registry, issueList, externalRoot)

  const build = (name: string): World => {
    const errors = registry
      .validate()
      .concat(
        registry.packIds.length === 0
          ? [{ level: 'error' as const, pack: null, where: 'content', message: '没有任何内容包被装载。' }]
          : [],
      )
      .filter((i) => i.level === 'error')

    if (errors.length > 0) {
      const lines = errors.slice(0, 5).map((e) => `· [${e.where}] ${e.message}`)
      const more = errors.length > 5 ? `\n…还有 ${errors.length - 5} 条` : ''
      throw new Error(`内容有 ${errors.length} 个错误，建不了世界：\n${lines.join('\n')}${more}`)
    }

    return createWorld({
      content: registry,
      scene: config.scene,
      name,
      createdAt: new Date().toISOString(),
      maxAgents: config.maxAgents,
      // 默认不预置工单：让 lead 显式派单，世界开局是干净的。
      // 这一步也让"任务库"立刻有真实消费者（下一轮的 agent_world_dispatch 用它）。
      taskSets: [],
    })
  }

  const state: PluginState = {
    config,
    tickMs,
    registry,
    externalRoot,
    world: null,

    // ── WorldServicePort ──
    currentWorld: () => state.world,

    open(name?: string): World {
      // 注意：这里**不**保留旧世界的任何东西。归档是 M7 的事；
      // 现在丢掉就是丢掉，避免"以为还在"的错觉。
      state.world = build(name ?? config.worldName)
      return state.world
    },

    describeContent(): string {
      const errors = issueList.filter((i) => i.level === 'error')
      const warnings = issueList.filter((i) => i.level === 'warning')
      const head = registry.describe()
      const extra = externalRoot === null ? '' : ` · 外部目录 ${externalRoot}`
      if (errors.length === 0 && warnings.length === 0) return `${head}${extra}`
      return `${head}${extra} · ${errors.length} 个错误 / ${warnings.length} 个警告`
    },

    content: () => contentPort,
    issues: () => issueList,

    // ── 组合根用的额外能力 ──
    ensureWorld(): World {
      if (state.world) return state.world
      state.world = build(config.worldName)
      return state.world
    },
  }

  return state
}
