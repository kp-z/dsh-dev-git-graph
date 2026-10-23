/**
 * 世界模型 —— 类型定义（BACKLOG M1-1）。
 *
 * 这一层是**纯数据**：只有类型与常量，没有 IO、没有 three、没有 cordis。
 * 之所以把它独立成 `domain/`，是因为同一份类型要同时被三处消费：
 *   1. host 的模拟内核（`src/sim/`）
 *   2. host 的工具与 HTTP 层（`src/tools/` `src/routes/`）
 *   3. 浏览器里的 3D 面板（`web/`，经 Vite 直接 import 这一份，不复制）
 * 一旦复制成两份，接线就会开始漂移——这是本仓库最容易犯也最难查的错。
 *
 * 约定：
 * - **可选字段一律用 `| null`**，不用 `?`。tsconfig 开了 `exactOptionalPropertyTypes`，
 *   用 `?` 会让「字段存在但值为 undefined」和「字段不存在」变成两种类型，纯给自己添乱，
 *   而且 JSON 序列化后两者不可区分。
 * - 所有坐标是 `Vec2`（俯视平面的 x/z），y 由渲染层自己决定（地面高度）。
 */

/** 角色职业。决定它在小镇里长什么样、能坐哪张工位。 */
export type AgentRole = 'lead' | 'engineer' | 'reviewer' | 'researcher' | 'ops' | 'docs'

/**
 * 角色状态机。**显式枚举，不许用布尔堆叠**（`isWalking && !isWorking` 那种写法
 * 会在三个状态以上时立刻变成组合爆炸）。
 */
export type AgentState =
  | 'idle'
  | 'walking'
  | 'working'
  | 'talking'
  | 'blocked'
  | 'celebrating'
  | 'sleeping'

/**
 * 工单状态机。
 *
 * 注意 `ready` 是**派生**状态，不是用户/模型直接设置的：所有 `blockedBy` 都 `done`
 * ⇒ `pending` 变成 `ready`。这个派生只在 `sim/ready.ts` 一处算（M1-5），
 * 别处不许自己判断依赖是否满足。
 */
export type TaskStatus = 'pending' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'failed'

/** 站点种类。决定它在场景里长什么样。 */
/**
 * **导航网格**（R64 物理）：世界里的可行走区。
 *
 * 为什么是一张**格网**而不是"一组矩形障碍"：地图本身就是格子的（37×21、一格 32px），
 * 碰撞数据也来自原版图块的物理多边形——格子是**数据的原生形状**，
 * 转成矩形再去判包含只会多一层可能算错的换算。
 *
 * `blocked[row * width + col] === true` 表示这一格**不能站**（墙、桌、电脑…）。
 * 由内容（地图）在**建世界 / 读档重算**时派生，与 `districts`、`stations` 同一条规矩：
 * 谁都能随时按当前内容重算出来，不手改。
 */
export interface NavGrid {
  /** 格数。 */
  readonly width: number
  readonly height: number
  /** 一格等于多少世界单位。 */
  readonly unitsPerCell: number
  /** 世界左上角对应的网格坐标偏移（世界坐标是**中心为 0**，网格是左上角为 0）。 */
  readonly originX: number
  readonly originZ: number
  /** 长度 = width × height；true = 走不了。 */
  readonly blocked: readonly boolean[]
}

export type StationKind = 'desk' | 'meeting' | 'server' | 'mailroom' | 'lab' | 'breakroom'

/**
 * 站点能力。**任务不直接指定工位，只声明自己需要什么能力**，由调度器挑一个
 * 空闲且能力匹配的站点。好处：任务编排与小镇布局解耦——以后加一栋楼不用改任务。
 */
export type Capability = 'code' | 'review' | 'research' | 'converse' | 'compute' | 'deliver' | 'rest'

/** 地段种类。 */
export type DistrictKind = 'engineering' | 'meeting' | 'infra' | 'commons'

/** 俯视平面上的一个点（x 向右，z 向里）。 */
export interface Vec2 {
  x: number
  z: number
}

/** 矩形范围（地段的占地）。 */
export interface Bounds {
  min: Vec2
  max: Vec2
}

/** 地段：把站点分组，也是配色与地面材质的单位。 */
export interface District {
  /** 地面图（`models` 库的 id）；null = 只用 `ground` 颜色。R55。 */
  groundModel: string | null
  id: string
  name: string
  kind: DistrictKind
  bounds: Bounds
  /** 地面色（十六进制，井号开头）。渲染层直接用，不做二次推导。 */
  ground: string
}

/** 站点：工位或设施，是任务的落脚点，也是角色走路的目的地。 */
export interface Station {
  id: string
  name: string
  kind: StationKind
  district: string
  /** 站点中心（角色走向这里，然后吸附到一个 slot）。 */
  anchor: Vec2
  /** 同时能容纳几个角色。1 = 独占工位，4 = 会议桌。 */
  capacity: number
  capabilities: Capability[]
  /**
   * 这个站点用哪个模型条目（`models` 库的 id）。
   *
   * 对领域而言它是个**不透明字符串**——领域不认识内容库，只是把「内容说它长什么样」
   * 带在身上，好让场景描述层原样交给渲染器。
   */
  model: string
  /**
   * 这个站点摆出来的部件（M4-11，R48）。**至少一件**。
   *
   * 单件家具的站点这里就是一项（由 `model` 推出来）；组合站点（桌+椅+显示器）由
   * 内容的 `props` 声明。渲染器只读它——不再有"这个站点用哪个模型"这个更弱的问题。
   */
  parts: StationPart[]
  /** 角色坐下时的精确位置（相对 anchor 的偏移，已算好便于渲染层直接吸附）。 */
  slots: Vec2[]
}

/** 站点的一个部件：模型 id + 相对站点锚点的局部偏移。 */
export interface StationPart {
  modelId: string
  dx: number
  dy: number
  dz: number
  rotationY: number
}

/** 角色用的模型路由。与 DSH 真实成员的 provider/model/reasoningEffort 对齐。 */
export interface AgentLlmRoute {
  provider: string
  model: string
  reasoningEffort: string | null
}

/** 角色：一个真实 subagent 在小镇里的投影。 */
export interface Agent {
  id: string
  name: string
  role: AgentRole
  /** 角色配色（主色），渲染层用它给角色上色，保证同一个人每次都是同色。 */
  palette: string
  /**
   * 这个角色长什么样（`models` 库的 id）。
   *
   * 与 `palette` 并存而不是取代它：`palette` 是**主色**（花名册色点、看板、2D 重上色都要它），
   * 而 `modelId` 是**形象**（GLB 或像素图集）。两者由内容分别决定。
   */
  modelId: string
  state: AgentState
  /** 当前位置（俯视平面）。 */
  position: Vec2
  /** 朝向（弧度），渲染层直接用于 yaw。 */
  facing: number
  /** 当前所在站点 id；在路上时为 null。 */
  station: string | null
  /** 正在前往的站点 id；不在路上时为 null。 */
  targetStation: string | null
  /** 剩余路径点（走到就 shift 掉一个）。 */
  path: Vec2[]
  /** 手里拿着的任务 id；空闲时为 null。 */
  carrying: string | null
  /**
   * 歇脚点：没活干时待的地方（BACKLOG M2.5-1）。
   *
   * 为什么需要它：角色只在被派活时才移动，所以**从没被派过活的人会一直站在出生点**。
   * 8 个人里有 6 个待命时，画面上就是 6 个角色穿在同一格里——看起来像 bug。
   *
   * 由 `world/create.ts` 按**广场地块的几何**推出来（内容决定地块在哪，几何决定点怎么排），
   * 所以它同样是内容驱动的：把广场改大，人自然就散得更开。
   */
  hangout: Vec2 | null
  llm: AgentLlmRoute
  /** 与真实 subagent 的绑定。模拟模式下为 null。 */
  boundAgentId: string | null
}

/** 工单。 */
export interface Task {
  id: string
  /** 在来源任务集内的 key。回指内容库用（HUD 分组、诊断"这张单出自哪条流水线"）。 */
  key: string
  /** 来源任务集 id（内容库里的 `tasks` 条目）。 */
  set: string
  /**
   * 创建序号（1 起）。**排序一律用它，不要排序 id 字符串**——
   * `task-10` 的字符串序在 `task-2` 前面，那会让调度优先级在两位数时静默改变。
   */
  ordinal: number
  /** 内容库里建议的职业。调度器优先派给同职业的人（没人匹配就谁都行）。 */
  suggestedRole: AgentRole | null
  title: string
  description: string
  status: TaskStatus
  /** 负责人（agent id）；未分配为 null。 */
  owner: string | null
  /** 落位的站点 id；未落位为 null。 */
  station: string | null
  /** 需要的能力。调度器据此选站。 */
  requires: Capability[]
  /** 前置任务 id。全 done 才变 ready。 */
  blockedBy: string[]
  /** 0..1。到 1 且 status 仍 in_progress 时由 simulate 落为 done。 */
  progress: number
  /** 本轮尝试 id。重新分配时换新，旧 attempt 的汇报会被拒。 */
  attemptId: string | null
  /** 验收条件（给模型看的可判定的那句话）。 */
  acceptance: string
  /** 预估要多少 tick 完成；内容库没给就是 null。渲染层用它画预估进度。 */
  estimateTicks: number | null
  createdAtTick: number
  finishedAtTick: number | null
  /**
   * 这张单镜像的 agent-teams 任务 id（D41，R39）。`simulated` 世界里恒为 `null`。
   *
   * 为什么要一个显式字段而不是"两边 id 取一样"：小镇的 id 是 `task-3` 这种**创建序**，
   * 而 agent-teams 的是团队内 `t3`。硬凑成一样会让"重开一局后序号怎么排"变成两边都要协商的事；
   * 显式映射则允许任一边独立演进，也让"这张单还没接到团队"（null）成为一个可表达的状态。
   */
  externalId: string | null
  /** 成员写下的结果（live 模式下由 `taskComplete` 落进来；simulated 恒为 `null`）。 */
  output: string | null
  /** 失败原因（live 模式下由 `taskFail` 落进来）。要能让人下手。 */
  failureReason: string | null
  /**
   * 违例起点：这张单**从哪个 tick 起**"在进行中却没人推进"（R151 / task-25）。
   *
   * `null`/缺省 = 当前没有违例。`recovery.ts` 每个 tick 维护它：仍在违例且还没有起点就打上
   * `world.tick`，违例消失或回收后清回 `null`。
   *
   * 为什么存进世界状态而不是放模块级 Map：模拟必须是 `(world, commands) → world'` 的**纯函数**，
   * 重放才能逐 tick 复现。模块级计时器会随宿主重启丢失、也不进存档，等于让"什么时候回收"
   * 依赖进程寿命——那正是这份代码一直在防的不确定性。
   *
   * 可选字段：旧存档没有它也能读（缺省视为"没有违例"），所以不用升存档版本。
   */
  stalledSinceTick?: number | null
}

/** 邮箱消息。它的存在是为了**投递动画**：小镇里一张纸条从 A 飞到 B。 */
/**
 * 消息种类。
 *
 * **类型与可枚举数组放在一起**：纸条配色要按 kind 索引、校验器要遍历它们，
 * 而只写一个字面量联合类型是枚举不出来的。分成两处（一处类型、一处数组）迟早会漏一个。
 */
export const MESSAGE_KINDS = ['handoff', 'report', 'question', 'answer', 'dispatch'] as const

/** 消息种类。 */
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export interface Message {
  id: string
  from: string
  to: string
  kind: MessageKind
  body: string
  atTick: number
  /** 已送达的 tick；未送达为 null（此时会渲染成飞行中的纸条）。 */
  deliveredAtTick: number | null
}

/**
 * 世界事件类型。渲染层只认这些，不认 domain 的其余内部结构。
 *
 * ## 事件量是设计过的（R6 定的策略）
 *
 * - `world.tick` —— **每 tick 一条**，载荷里带本 tick 有位移的角色
 *   `[id, x, z, facing][]`。位置是连续量，**不给每个角色单独发事件**：
 *   24 个角色 ≈ 每秒 240 条，会把环形缓冲（500 条）冲爆，客户端也会被淹。
 *   一条"帧"事件既省又正好是渲染层要的东西。
 * - `task.changed` —— 状态变化，以及**每 10% 的进度里程碑**（`PROGRESS_MILESTONES`）。
 *   进度条自己插值，不需要每帧推送。
 * - `agent.state` / `message.sent` —— 离散事件，本来就稀疏。
 * - `agent.moved` —— **暂时保留但不再使用**（见上：位置走 `world.tick` 的帧事件）。
 *   留着是为了不删协议里的取值（删枚举取值要 bump 版本），也留一个"单个角色的大跨度
 *   移动"（比如将来瞬移/传送机制）的位置。
 */
export type WorldEventType =
  | 'world.reset'
  | 'world.tick'
  | 'agent.state'
  | 'agent.moved'
  | 'task.changed'
  | 'task.assigned'
  | 'task.completed'
  | 'task.failed'
  | 'message.sent'
  | 'agent.intent'
  | 'world.paused'

/**
 * 世界事件。`seq` 单调递增，是**客户端 gap 自愈**的依据：
 * 发现 seq 不连续（丢包 / 断线重连）就丢掉本地状态重新拉快照，
 * 绝不在 gap 状态下继续增量应用——那会造成静默的状态漂移。
 */
export interface WorldEvent {
  seq: number
  tick: number
  type: WorldEventType
  payload: Record<string, unknown>
}

/** 世界运行模式。`simulated` = 假数据驱动（M1–M5）；`live` = 接真实 subagent（M6）。 */
export type WorldMode = 'simulated' | 'live'

/** 世界的来源（由哪些内容装配出来）。落盘后据此复现同一座小镇。 */
export interface WorldOrigin {
  /** 场景条目 id。 */
  scene: string
  /** 装配时装载的内容包 id（按装载顺序）。 */
  packs: string[]
  /** 派进世界的任务集 id。 */
  taskSets: string[]
}

/** 一个世界实例。这是唯一的权威真相，落盘为 world.json。 */
export interface World {
  id: string
  name: string
  seed: number
  /** 已推进的逻辑 tick 数。真实时间 = tick * tickMs。 */
  tick: number
  /** 创建时间（ISO8601）。 */
  createdAt: string
  /** 是否暂停。暂停时 step() 不推进世界，但仍可接受命令。 */
  paused: boolean
  /** 角色用哪个模型条目（`models` 库的 id，由场景条目声明）。 */
  agentModel: string
  mode: WorldMode
  /** 这个世界的来源。没有它就没法"用同样的内容重开一局"。 */
  origin: WorldOrigin
  districts: District[]
  stations: Station[]
  /** 导航网格（R64 物理）。**派生量**：由内容的地图在建世界/读档时算出。null = 没有地图（退回直线走）。 */
  nav: NavGrid | null
  agents: Agent[]
  tasks: Task[]
  messages: Message[]
  /** 事件环形缓冲（只保留最近 N 条，见 constants.EVENT_RING_SIZE）。 */
  events: WorldEvent[]
  /** 下一个事件序号。与 events 一起维护，不复用。 */
  seq: number
  /**
   * 下一个消息序号。**独立于 `seq`，也独立于 `messages.length`。**
   *
   * 与 `seq` 分开：消息不是事件，混用会让"事件序号不跳号"这条保证失效（有测试钉着）。
   * 与 `messages.length` 分开：邮箱会**裁剪**已送达的旧消息（见 `MESSAGE_RING_SIZE`），
   * 用长度当序号就会在裁剪后重复发号。
   */
  messageSeq: number
}

/** 世界的一句话摘要（工具输出与 HUD 都用它，保证口径一致）。 */
export interface WorldSummary {
  id: string
  name: string
  tick: number
  paused: boolean
  mode: WorldMode
  agents: { total: number; byState: Record<string, number> }
  tasks: { total: number; byStatus: Record<string, number> }
  stations: { total: number; occupied: number }
  districts: number
  messages: number
}
