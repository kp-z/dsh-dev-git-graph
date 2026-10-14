/**
 * 插件配置（BACKLOG M0-2）。
 *
 * 两条本仓库的踩坑约定（见 docs/DEVELOPMENT.md §2）：
 * 1. Loader 传进来的 config 是 patch 里的**原始值**，不会自动填 schema 的 default，
 *    所以 `apply` 必须走 `resolveConfig()` 用 `??` 兜底，否则没配的字段直接读会 TypeError。
 * 2. schemastery 没有 `z.infer`，用全局命名空间 `Schemastery.TypeT`。
 */
import z from '@deepseek-ai/schemastery'

export const AgentWorldConfig = z.object({
  /** 世界状态落盘目录：`<session workspace>/<stateDir>/`。 */
  stateDir: z.string().default('.agent-world'),

  /**
   * 逻辑 tick 间隔（ms）。10Hz 足够——渲染层对位置做插值，看到的是 60fps 的平滑移动。
   * 调小它只增加 CPU 与事件量，不会让画面更顺。
   */
  tickMs: z.number().default(100),

  /** 插件加载后是否自动推进模拟。关掉时世界静止，便于调试布局。 */
  autoStart: z.boolean().default(true),

  /** 同屏角色上限。性能预算的一部分，见 docs/ARCHITECTURE.md §5.3。 */
  maxAgents: z.number().default(24),

  /** 默认世界名（也是 seed 的来源，除非另给 seed）。 */
  worldName: z.string().default('Agent World'),

  /** 默认用哪个场景（`scenes` 库的 id）。换它 = 换一座小镇，代码不动。 */
  scene: z.string().default('scene.default-town'),

  /**
   * 外部内容包目录（相对 workspace）。留空 = 只用内置内容。
   *
   * 计划在 M1-6 实现：目录下每个子目录是一个内容包（含 `pack.json`），
   * 按 `id` 与内置包合并，可用 `overrides` 顶掉内置条目。
   */
  contentDir: z.string().default(''),

  /**
   * 是否允许外部内容包隐式覆盖同 id 条目（不在 `overrides` 里声明）。
   * 默认 **false** —— "覆盖必须显式"是决策 D11 的护栏，打开它就是主动放弃它。
   */
  allowImplicitOverride: z.boolean().default(false),

  /**
   * 面板路径前缀。宿主 webServer 上挂的静态面板与 API 都在它下面。
   * 改它要同时确认与其它插件的路由不冲突。
   */
  routePrefix: z.string().default('/agent-world'),
})

export type AgentWorldConfig = Schemastery.TypeT<typeof AgentWorldConfig>

/** 兜底默认值。必须与上面的 schema 一一对应——加字段时两处一起加。 */
export function resolveConfig(config: Partial<AgentWorldConfig> = {}): AgentWorldConfig {
  return {
    stateDir: config.stateDir ?? '.agent-world',
    tickMs: config.tickMs && config.tickMs > 0 ? config.tickMs : 100,
    autoStart: config.autoStart ?? true,
    maxAgents: config.maxAgents && config.maxAgents > 0 ? config.maxAgents : 24,
    worldName: config.worldName ?? 'Agent World',
    scene: config.scene ?? 'scene.default-town',
    contentDir: config.contentDir ?? '',
    allowImplicitOverride: config.allowImplicitOverride ?? false,
    routePrefix: normalizePrefix(config.routePrefix ?? '/agent-world'),
  }
}

/** 路由前缀规范化：必须有前导 `/`，且不能以 `/` 结尾（拼路径时不会出现 `//`）。 */
function normalizePrefix(prefix: string): string {
  let p = prefix.trim()
  if (!p.startsWith('/')) p = `/${p}`
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}
