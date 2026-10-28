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
 * R11 起接上了落盘（`store/worldStore.ts`）：`ensureWorld()` 会**先试着把上次的世界接回来**，
 * 接不回来才新开一局。这一步是**同步**的——`apply()` 不能是 async，所以只有这一处同步读文件
 * （内容层同样是同步装载的，不是新发明）。
 *
 * **恢复绝不能是静默的**：接回一个用另一批内容包版本装出来的旧世界，用户必须看得见，
 * 否则症状是"我明明重开了，怎么还是上次的样子"。所以：
 * · 成功恢复 → 记进 `restoredFrom()`，`agent_world_status` 会打出来；
 * · 存档坏了/场景没了/版本不一致 → 写成一条 issue（`agent_world_content` 与状态工具都会显示）；
 * · 场景在当前内容里不存在 → **拒绝采用**，宁可新开一局也不要一个渲染不出场景的世界。
 *
 * 刻意**不**把它做成一个 cordis Service：世界是这个插件自己的东西，
 * 没有第二个插件需要注入它；做成 Service 只会多一层间接。
 */
import type { AgentWorldConfig } from './config.js'
import { ContentRegistry, builtinPacks } from './content/index.js'
import { contentPortOf } from './content/port.js'
import { instantiateTasks } from './content/instantiate.js'
import { loadContentPacks } from './content/load-files.js'
import { DEFAULT_TICK_MS } from './domain/constants.js'
import type { Agent, World } from './domain/types.js'
import type {
  ContentIssue,
  ContentPort,
  DispatchOutcome,
  RestoredFrom,
  WorldServicePort,
} from './protocol/index.js'
import { emitEvent, noteTasksAdded } from './sim/journal.js'
import { DEFAULT_MIN_GAP, hangoutsForWorld } from './world/hangouts.js'
import { join } from 'node:path'
import { createWorldStore, loadWorldSync } from './store/index.js'
import { reconcileWorld } from './world/reconcile.js'
import { createWorld } from './world/create.js'

/** 建插件状态的选项。 */
export interface PluginStateOptions {
  /**
   * 开局铺几个角色：`all`（默认，旧 demo/测试）或 `captain`（只放队长，R166）。
   */
  initialAgents?: 'all' | 'captain'
  /** 会话世界开局铺几个：默认 captain（R166）。 */
  sessionInitialAgents?: 'all' | 'captain'
  /**
   * 外部内容包根目录（**绝对路径**）。null / 不传 = 只加载内置内容。
   *
   * 路径解析刻意放在 `index.ts`（那里能拿配置与宿主信息），这里只接受一个已经定好的目录——
   * 这样 `state.ts` 能被测试直接喂一个临时目录，不用去 mock 文件系统之外的东西。
   */
  externalRoot?: string | null
  /**
   * 世界存档目录（**绝对路径**）。null / 不传 = 不落盘也不恢复。
   *
   * 与 `externalRoot` 同理：解析放在 `index.ts`，这里只接受一个定好的目录，
   * 于是单测可以直接喂临时目录。
   */
  storeDir?: string | null
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
  /** 当前激活的会话 id；没有激活时 null。 */
  readonly activeSessionId: string | null
  /**
   * 切到某个会话的世界（R166）：先把上一个世界同步存到它自己的目录，再载入/新建这个会话的世界。
   * 同一时刻只有一个世界在内存里，所以不存在多会话并行推进。
   */
  activateSession(sessionId: string): World
  /** 保存并卸下当前会话世界（关闭 Agent World 视图时）。 */
  deactivate(): void
  /** 把真实 subagent 子会话投影成镇上角色（R166）；返回角色是否变了。 */
  syncSubagents(sessionId: string, children: readonly { id: string; label?: string }[], leadName?: string): boolean
  /** 世界存档目录；没配就是 null。 */
  readonly storeDir: string | null
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
  const storeDir = options.storeDir ?? null
  const initialAgents = options.initialAgents ?? 'all'
  const sessionInitialAgents = options.sessionInitialAgents ?? 'captain'
  let activeSessionId: string | null = null
  /** 已恢复的世界来源；新开一局时是 null。 */
  let restored: RestoredFrom | null = null

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

  const build = (name: string, seeded: 'all' | 'captain' = initialAgents): World => {
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
      initialAgents: seeded,
    })
  }

  /**
   * 试着把上次的世界接回来。接不回来返回 null（**不抛**——一个坏存档不该让插件起不来）。
   *
   * 三道关，顺序有讲究：
   * 1. 文件能不能读、格式对不对；
   * 2. **场景还在不在**当前内容里（不在就拒绝：一个没有场景的世界渲染不出来，
   *    接回来只会得到一块空画布加一堆问号）；
   * 3. 内容包版本变没变（变了**照常采纳**，但要说出来——见下面的注释）。
   */
  const tryRestore = (): World | null => {
    if (storeDir === null) return null

    let loaded: ReturnType<typeof loadWorldSync>
    try {
      loaded = loadWorldSync(storeDir)
    } catch (error) {
      issueList.push({
        level: 'error',
        pack: null,
        where: 'store/world.json',
        message: `读存档失败：${error instanceof Error ? error.message : String(error)}。已改为新开一局。`,
      })
      return null
    }

    if (loaded === null) return null // 没有存档，正常情况
    if ('failure' in loaded) {
      issueList.push({
        level: 'warning',
        pack: null,
        where: 'store/world.json',
        message: `存档没被采用：${loaded.failure.reason}`,
      })
      return null
    }

    const { world, content, savedAtTick } = loaded.ok

    if (registry.get('scenes', world.origin.scene) === undefined) {
      const available = registry.list('scenes').map((e) => e.id)
      issueList.push({
        level: 'warning',
        pack: null,
        where: 'store/world.json',
        message:
          `存档用的场景 "${world.origin.scene}" 在当前内容里不存在，已改为新开一局。` +
          `可用场景：${available.length > 0 ? available.join(' / ') : '（没有）'}`,
      })
      return null
    }

    // R75：配置里的场景**换了** → 整局重开。场景决定地图/地块/站点/歇脚点，换场景 = 换世界。
    // 之前只查"场景还在不在"，不查"是不是同一座"——于是把默认场景从 default-town 换成 office 后，
    // 旧存档（origin.scene=default-town）仍被照单全收，用户看到的还是 16×16 小镇叠在 office 背景上
    // （"很多元素位置放的不对"正是这个）。这里检测到场景不一致就直接重开，别再让旧存档兜底。
    if (world.origin.scene !== config.scene) {
      issueList.push({
        level: 'warning',
        pack: null,
        where: 'store/world.json',
        message:
          `存档场景是 "${world.origin.scene}"，当前配置场景是 "${config.scene}"——场景换了，整局重开。`,
      })
      return null
    }

    // 内容包版本对不上：**照常采纳**。内容升级本来就该改变表现（这正是"内容可替换"的意义），
    // 但要把差异写出来——不然"旧存档为什么变样了"只能靠猜。
    const current = registry.packs.map((p) => ({ id: p.id, version: p.version }))
    const before = content.map((p) => `${p.id}@${p.version}`).sort().join('、')
    const now = current.map((p) => `${p.id}@${p.version}`).sort().join('、')
    if (before !== now) {
      issueList.push({
        level: 'warning',
        pack: null,
        where: 'store/world.json',
        message:
          `存档是用 ${before} 装的，现在是 ${now}——世界已按新内容继续（这是可接受的：内容升级本来就该改变表现）。`,
      })
    }

    // ── 重算派生量（M10-12 / R49）──
    //
    // 存档是**上一个版本的内容**的冻结，而世界里的量分两种：
    // **派生量**（`station.parts`/`slots`、`agent.hangout`、地块几何——内容和几何的函数）
    // 与**历史**（tick、工单进度、消息、位置/状态/路径）。前者读档时按当前内容重算，
    // 后者原样保留。不重算的话，改内容只对新开的局生效——R47/R48 连吃两次。
    //
    // **必须降级而不是抛**：重算出问题（内容不自洽、站点被删）不能把插件卡在启动上。
    // 所以整段包在 try 里，出错就沿用存档那份，并把原因写进 issue 列表。
    let reconciled = world
    try {
      const result = reconcileWorld(world, registry)
      reconciled = result.world
      for (const message of result.warnings) {
        issueList.push({ level: 'warning', pack: null, where: 'store/world.json', message })
      }
      if (result.changes.length > 0) {
        issueList.push({
          level: 'warning',
          pack: null,
          where: 'store/world.json',
          message: `这一局的外观已按当前内容重算（历史不变）：${result.changes.join('；')}`,
        })
      }
    } catch (error) {
      issueList.push({
        level: 'warning',
        pack: null,
        where: 'store/world.json',
        message:
          `重算存档里的派生量时出错（已按存档原样继续，不影响运行）：` +
          `${error instanceof Error ? error.message : String(error)}`,
      })
    }

    restored = { savedAtTick, packVersions: content }
    return reconciled
  }


  /** 某会话自己的存档目录（base `storeDir` 下按会话编码分目录）。 */
  const sessionDir = (sessionId: string): string | null =>
    storeDir === null ? null : join(storeDir, 'sessions', encodeURIComponent(sessionId))

  /** 载入某个会话自己的世界；没有/坏了就返回 null，由调用方新开一局。 */
  function loadSession(sessionId: string): World | null {
    const dir = sessionDir(sessionId)
    if (dir === null) return null
    const loaded = loadWorldSync(dir)
    if (loaded === null || !('ok' in loaded)) return null
    try {
      return reconcileWorld(loaded.ok.world, registry).world
    } catch {
      return loaded.ok.world
    }
  }

  /** 把当前激活的世界同步写回它自己的目录。 */
  function saveActive(): void {
    if (storeDir === null || activeSessionId === null || state.world === null) return
    const dir = sessionDir(activeSessionId)
    if (dir === null) return
    try {
      createWorldStore(dir).saveWorldSync(state.world, contentPort.view().packs)
    } catch {
      // 关视图时存不下不能挡切换；诊断留给下次启动的 issue。
    }
  }

  const state: PluginState = {
    config,
    tickMs,
    registry,
    externalRoot,
    storeDir,
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

    dispatch(taskSet: string): DispatchOutcome {
      const world = state.world
      if (!world) {
        throw new Error('还没有世界。先调 agent_world_open 建一个，再派单。')
      }
      // `require` 的报错里已经带了可用条目列表，所以这里不必再自己拼一遍。
      const set = registry.require('tasks', taskSet, '派单时指定的任务集')

      // 序号接在**既有工单的最大 ordinal** 之后，而不是 `tasks.length + 1`：
      // 后者只在序号连续时等价，而将来一旦有归档/删除，它就会撞 id。
      const nextIndex = world.tasks.reduce((max, t) => Math.max(max, t.ordinal), 0) + 1
      // 第几批：数一下这个任务集**在日志/世界里已经出现过几次**（用 ordinal 之外的既有单数）。
      // 用途只有一个——让重复派单的标题不重名（M6-15）。
      const batch = world.tasks.filter((t) => t.set === set.id).length / Math.max(1, set.tasks.length) + 1
      const created = instantiateTasks(set, nextIndex, world.tick, Math.floor(batch))
      world.tasks.push(...created)
      // **必须进日志**：派单发生在 tick 之外，而只收增量的客户端（SSE 的面板）
      // 全靠事件才能知道有新工单。工具调用者自己看得到（拿的是同步返回值），
      // 这种"我这里有、你那里没有"的分叉极难查。
      noteTasksAdded(
        world,
        created.map((t) => t.id),
      )

      return {
        taskSet,
        addedTaskIds: created.map((t) => t.id),
        templateCount: set.tasks.length,
        totalTasks: world.tasks.length,
      }
    },

    content: () => contentPort,
    issues: () => issueList,

    // ── 会话世界（R166）──────────────────────────────────────────────────
    get activeSessionId(): string | null {
      return activeSessionId
    },
    activateSession(sessionId: string): World {
      if (sessionId.trim() === '') throw new Error('activateSession: sessionId 不能为空')
      if (activeSessionId === sessionId && state.world !== null) return state.world
      saveActive()
      activeSessionId = sessionId
      state.world = loadSession(sessionId) ?? build(config.worldName, sessionInitialAgents)
      const captain = state.world.agents[0]
      if (captain !== undefined) {
        // R171：队长的显示名固定为 `captain`，不继承内容花名册的人名（工头阿金等），
        // 避免内容换一版 / 多份花名册时同一个队长出现两个名字。
        // ⚠️ R165 试过改成 `leader`，但 agent-teams 里 `captain` 是**保留名**，
        // 改成 leader 后成员名对不上、加成员直接报
        // `member name "captain" is reserved for the captain` —— 所以维持 `captain`。
        captain.name = 'captain'
        // 队长是 UI 的代理角色；agent-teams 的 captain 是另一个派生会话。
        // 因此这里**不绑定**会话 id，点它说话时会按普通成员 ensureMember/发送。
        captain.boundAgentId = null
      }
      return state.world
    },
    deactivate(): void {
      saveActive()
      activeSessionId = null
      state.world = null
    },
    syncSubagents(sessionId: string, children: readonly { id: string; label?: string }[], leadName?: string): boolean {
      const world = state.world
      if (world === null || activeSessionId !== sessionId) return false
      const scene = registry.require('scenes', config.scene, '同步 subagent 花名册时取场景')
      const roster = registry.require('rosters', scene.roster, '同步 subagent 花名册时取花名册')
      const seatAt = (index: number) => roster.seats[index % Math.max(1, roster.seats.length)]
      // R436：subagents.listChildren 的 label 不保证带 `agent-teams:` 前缀；
      // 以前只收带前缀的，普通 subagent 全被丢掉，world 永远只有 captain。
      const members = children
        .map((child, index) => {
          const raw = typeof child.label === 'string' ? child.label.trim() : ''
          const name = raw === ''
            ? `subagent-${index + 1}`
            : raw.startsWith('agent-teams:') ? raw.slice(raw.lastIndexOf(':') + 1).trim() : raw
          if (name === '') return null
          return { id: child.id, name }
        })
        .filter((m): m is { id: string; name: string } => m !== null)

      const existing = new Map(world.agents.filter((a) => a.boundAgentId !== null).map((a) => [a.boundAgentId as string, a]))
      const wanted: Agent[] = []
      // 队长 = 当前会话本身；外观取花名册第一席。
      const captainSeat = seatAt(0)
      // 强制名只作为旧后端兜底；experimental 由主对话成员的真实 name 覆盖。
      const wantedName = typeof leadName === 'string' && leadName.trim() !== '' ? leadName.trim() : 'captain'
      const previousLeader = world.agents.find((a) => a.boundAgentId === null) ?? world.agents[0]
      const captain = previousLeader
      if (captain === undefined) {
        wanted.push({
          id: 'agent-1',
          name: wantedName,
          role: captainSeat?.role ?? 'lead',
          palette: captainSeat?.palette ?? '#f2c14e',
          modelId: captainSeat?.appearance ?? scene.agentModel,
          state: 'idle', position: { ...scene.spawn }, facing: Math.PI / 2,
          station: null, targetStation: null, path: [], carrying: null, hangout: null,
          llm: captainSeat?.model ?? { provider: '', model: '', reasoningEffort: null },
          boundAgentId: null,
        })
      } else {
        wanted.push(
          captain.name === wantedName && captain.boundAgentId === null
            ? captain
            : { ...captain, name: wantedName, boundAgentId: null },
        )
      }
      for (const member of members) {
        if (member.name === wantedName) continue
        const prior = existing.get(member.id)
        if (prior !== undefined) {
          wanted.push(prior.name === member.name ? prior : { ...prior, name: member.name })
          continue
        }
        const index = wanted.length
        const seat = seatAt(index)
        wanted.push({
          id: `agent-${index + 1}`,
          name: member.name,
          role: seat?.role ?? 'engineer',
          palette: seat?.palette ?? '#5aa9e6',
          modelId: seat?.appearance ?? scene.agentModel,
          state: 'idle', position: { ...scene.spawn }, facing: Math.PI / 2,
          station: null, targetStation: null, path: [], carrying: null, hangout: null,
          llm: seat?.model ?? { provider: '', model: '', reasoningEffort: null },
          boundAgentId: member.id,
        })
      }
      const before = world.agents.map((a) => `${a.id}:${a.name}:${a.boundAgentId ?? ''}`).join('|')
      const after = wanted.map((a) => `${a.id}:${a.name}:${a.boundAgentId ?? ''}`).join('|')
      if (before === after) return false
      const hangouts = hangoutsForWorld(world.districts, world.stations, wanted.length, DEFAULT_MIN_GAP, world.nav)
      wanted.forEach((agent, i) => {
        if (agent.hangout === null && hangouts[i] !== undefined) {
          agent.hangout = hangouts[i]
          agent.position = { ...hangouts[i] }
        }
      })
      world.agents = wanted
      emitEvent(world, 'world.reset', { reason: 'roster', agents: wanted.length })
      return true
    },

    // ── 组合根用的额外能力 ──
    ensureWorld(): World {
      if (state.world) return state.world
      state.world = tryRestore() ?? build(config.worldName)
      return state.world
    },

    restoredFrom: () => restored,
  }

  return state
}
