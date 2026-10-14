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
  /** 角色坐下时的精确位置（相对 anchor 的偏移，已算好便于渲染层直接吸附）。 */
  slots: Vec2[]
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
}

/** 邮箱消息。它的存在是为了**投递动画**：小镇里一张纸条从 A 飞到 B。 */
export interface Message {
  id: string
  from: string
  to: string
  kind: 'handoff' | 'report' | 'question' | 'answer' | 'dispatch'
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
  | 'message.sent'
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
  mode: WorldMode
  /** 这个世界的来源。没有它就没法"用同样的内容重开一局"。 */
  origin: WorldOrigin
  districts: District[]
  stations: Station[]
  agents: Agent[]
  tasks: Task[]
  messages: Message[]
  /** 事件环形缓冲（只保留最近 N 条，见 constants.EVENT_RING_SIZE）。 */
  events: WorldEvent[]
  /** 下一个事件序号。与 events 一起维护，不复用。 */
  seq: number
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
