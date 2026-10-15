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

  /**
   * 每多少 tick 落一次盘（快照 + 事件）。`0` = 不落盘，世界只活在内存里。
   *
   * 默认 100（10 tick/秒下约 10 秒一次）。这是**崩溃时最多丢多少**的粒度，
   * 而 10 秒的世界在磁盘上只有几十 KB——挑大它省不了多少 IO，挑小它会变成每秒写盘。
   */
  persistEveryTicks: z.number().default(100),

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
   * 同时唤醒的角色会话上限（决策 D36：成本可见可控）。
   *
   * **与 `maxAgents` 是两件事**，不要混用：`maxAgents` 管"同屏画几个小人"（渲染预算），
   * 这个管"同时有几个 DSH Agent 会话活着"（模型成本预算）。一个角色被搭话才会占用一个名额，
   * 所以多数角色整局都不会占。
   *
   * 超限时 `/api/say` 会**拒绝并给出可下手的原因**（含当前值与上限），而不是静默排队——
   * 静默排队会让面板以为话发出去了。
   */
  maxLiveSessions: z.number().default(4),

  /**
   * 面板路径前缀。宿主 webServer 上挂的静态面板与 API 都在它下面。
   * 改它要同时确认与其它插件的路由不冲突。
   */
  routePrefix: z.string().default('/agent-world'),

  /**
   * 对话走哪个后端（R37）。
   *
   * - `'agent-teams'`（默认）：套壳 `@nanmicoder/dsh-agent-teams`。角色是它名册里的成员，
   *   会话生命周期、信箱、任务图都归它管。这是我们该走的路——用户指出之后才补上的。
   * - `'native'`：R24–R36 手写的那套（自己建会话、人设 section、工具白名单、死会话自愈）。
   *   留着做对照与回退，验证通过后删掉。
   */
  dialogueBackend: z.union([z.const('agent-teams'), z.const('native')]).default('agent-teams'),

  /** 团队名（会变成 agent-teams 的 teamId）。 */
  teamName: z.string().default('Agent World'),

  /** 团队目标，写进每个成员人设的 "Team goal"。 */
  teamDescription: z
    .string()
    .default('一座小镇：每个居民是一个角色，玩家会直接跟他们说话，并让他们把镇上的活干完。'),
})

export type AgentWorldConfig = Schemastery.TypeT<typeof AgentWorldConfig>

/** 兜底默认值。必须与上面的 schema 一一对应——加字段时两处一起加。 */
export function resolveConfig(config: Partial<AgentWorldConfig> = {}): AgentWorldConfig {
  return {
    stateDir: config.stateDir ?? '.agent-world',
    tickMs: config.tickMs && config.tickMs > 0 ? config.tickMs : 100,
    autoStart: config.autoStart ?? true,
    persistEveryTicks: config.persistEveryTicks ?? 100,
    maxAgents: config.maxAgents && config.maxAgents > 0 ? config.maxAgents : 24,
    worldName: config.worldName ?? 'Agent World',
    scene: config.scene ?? 'scene.default-town',
    contentDir: config.contentDir ?? '',
    allowImplicitOverride: config.allowImplicitOverride ?? false,
    // 与 maxAgents 同样的写法：小于 1 或非数就退回默认（0 或负数会让所有搭话都被拒）。
    maxLiveSessions:
      config.maxLiveSessions && config.maxLiveSessions > 0 ? Math.floor(config.maxLiveSessions) : 4,
    routePrefix: normalizePrefix(config.routePrefix ?? '/agent-world'),
    dialogueBackend: config.dialogueBackend === 'native' ? 'native' : 'agent-teams',
    teamName: config.teamName ?? 'Agent World',
    teamDescription:
      config.teamDescription ??
      '一座小镇：每个居民是一个角色，玩家会直接跟他们说话，并让他们把镇上的活干完。',
  }
}

/** 路由前缀规范化：必须有前导 `/`，且不能以 `/` 结尾（拼路径时不会出现 `//`）。 */
function normalizePrefix(prefix: string): string {
  let p = prefix.trim()
  if (!p.startsWith('/')) p = `/${p}`
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}
