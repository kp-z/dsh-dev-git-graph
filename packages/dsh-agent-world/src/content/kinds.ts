/**
 * 内容库类型定义（BACKLOG M1-1）。
 *
 * ## 为什么要有"内容库"这一层
 *
 * 游戏的架构里，**代码是机制（mechanism），内容是数据（data）**。
 * 「角色走路」是机制，「走路播哪个剪辑」是数据；「任务有依赖」是机制，
 * 「这个工作流有哪几张工单」是数据。混在一起就会出现：
 * 想换一套角色模型得改代码、想加一个任务得改代码、想换个小镇布局得改代码。
 *
 * 所以本项目的硬规矩：**凡是可以被替换的东西，一律进内容库，用稳定 id 引用。**
 * 代码里禁止出现字面量的资产名、剪辑名、任务文案、配色值。
 *
 * ## 两层库
 *
 * - **语义库（semantic）** —— 模拟需要知道的：地块、站点、场景布局、花名册、任务集。
 *   权威在 host。
 * - **表现库（presentation）** —— 只有渲染需要知道的：模型、动作、皮肤、音效、主题。
 *   权威在 web。
 *
 * 两层**共享同一套 id 契约与同一个注册表实现**——因为它们是同一个内容包的两半，
 * 拆成两套机制就会开始漂移。
 *
 * ## 解耦的关键一跳：动作库
 *
 * 模拟层只会说 `AgentState = 'walking'`。至于"walking 播哪个剪辑、多快、要不要循环"，
 * 全在动作库里。所以换一套角色包（比如从 Kenney Mini 换成 KayKit）**只改动作库 + 模型库**，
 * 模拟内核一行不动。这就是"方便替换升级和切换"的落点。
 */
import type { AgentRole, AgentState, Bounds, Capability, DistrictKind, StationKind, Vec2 } from '../domain/types.js'
import type { LibraryKind, LibraryLayer } from '../protocol/library-kinds.js'

// ── 库的种类 ────────────────────────────────────────────────────────────────
//
// `LibraryKind` / `LibraryLayer` 这两个联合类型住在**协议层**（`protocol/library-kinds.ts`），
// 因为它们同时被工具、线协议、面板消费——它们是边界类型，不是内容层的实现细节。
// 如果它们住在内容层，协议层与 web 就都得去 import 内容层，那条缝就没了。
//
// 本文件保留的是"库目录"：每个库的标题、说明、id 前缀约定。那是内容层自己的知识。

export type { LibraryKind, LibraryLayer }

/** 库的元信息。`idPrefix` 是给人和校验器看的命名约定，不是强制的运行时约束。 */
export interface LibrarySpec {
  kind: LibraryKind
  layer: LibraryLayer
  /** 中文名（报错信息与文档里用）。 */
  title: string
  /** 建议的 id 前缀，例如 `station.`。校验器只做提醒，不做拒绝。 */
  idPrefix: string
  /** 一句话说明这个库装什么。 */
  summary: string
}

/** 库目录。**加一个新库必须同时在这里登记**，否则校验器不认。 */
export const LIBRARY_SPECS: readonly LibrarySpec[] = [
  {
    kind: 'districts',
    layer: 'semantic',
    title: '地块库',
    idPrefix: 'district.',
    summary: '地段（哪块地是什么区），给站点分组、给渲染层地面材质',
  },
  {
    kind: 'stations',
    layer: 'semantic',
    title: '站点库',
    idPrefix: 'station.',
    summary: '工位与设施，声明自己的能力；任务按能力落位，不硬绑工位',
  },
  {
    kind: 'scenes',
    layer: 'semantic',
    title: '场景库',
    idPrefix: 'scene.',
    summary: '一局小镇的装配单：引用哪些地块与站点、入场点在哪、用哪个主题',
  },
  {
    kind: 'rosters',
    layer: 'semantic',
    title: '角色库',
    idPrefix: 'roster.',
    summary: '花名册模板：一队角色的职业、名字、配色、默认模型路由',
  },
  {
    kind: 'tasks',
    layer: 'semantic',
    title: '任务库',
    idPrefix: 'task.',
    summary: '任务集（工作流）：一组带依赖的工单模板，一次派出一整条流水线',
  },
  {
    kind: 'models',
    layer: 'presentation',
    title: '模型库',
    idPrefix: 'model.',
    summary: '3D 资产：glTF 文件或程序化几何构建器，含缩放与朝向修正',
  },
  {
    kind: 'actions',
    layer: 'presentation',
    title: '动作库',
    idPrefix: 'action.',
    summary: 'AgentState → 动画剪辑的映射。换角色包只改这里，模拟层不动',
  },
  {
    kind: 'skins',
    layer: 'presentation',
    title: '皮肤库',
    idPrefix: 'skin.',
    summary: '配色与材质覆盖：地面色、角色配色、强调色',
  },
  {
    kind: 'sounds',
    layer: 'presentation',
    title: '音效库',
    idPrefix: 'sound.',
    summary: '世界事件 → 音效',
  },
  {
    kind: 'themes',
    layer: 'presentation',
    title: '主题库',
    idPrefix: 'theme.',
    summary: '相机 / 光照 / 雾 / 后处理的预设（美术方向的可切换实现）',
  },
] as const

/** 按 kind 取库元信息。 */
export function librarySpec(kind: LibraryKind): LibrarySpec | undefined {
  return LIBRARY_SPECS.find((s) => s.kind === kind)
}

// ── 语义库的条目 ────────────────────────────────────────────────────────────

/** 地块条目。 */
export interface DistrictEntry {
  id: string
  name: string
  kind: DistrictKind
  bounds: Bounds
  /** 地面色。指向 `skins` 库里的 token，形如 `skin.ground.engineering`；找不到就按字面量当地色用。 */
  ground: string
}

/**
 * 站点条目。
 *
 * `relativeTo` 是**手写布局的实用妥协**：给了它，`anchor` 就是相对该地块中心的偏移；
 * 不给就是绝对坐标。游戏里做关卡数据也常这么干——不然改一次地块位置要手改十个坐标。
 */
export interface StationEntry {
  id: string
  name: string
  kind: StationKind
  /** 所属地块 id。 */
  district: string
  anchor: Vec2
  /** 非 null 时，`anchor` 是相对该地块中心的偏移。 */
  relativeTo: string | null
  capacity: number
  capabilities: Capability[]
  /**
   * 这个站点长什么样——引用 `models` 库的条目 id。
   *
   * **必须显式声明，不能靠 id 拼接猜**（R16 之前 `scene/plan.ts` 里写的是
   * `` `model.station.${kind}` ``）。拼接的坏处：内容里把某个站点换成别的模型、
   * 或者某个 kind 用了不同命名的模型时，代码会**静默指向一个不存在的模型**，
   * 而 `models` 库看起来还是「配好了」的。模型选择是内容，不是代码。
   */
  /**
   * 单件家具的模型 id。**与 `props` 二选一**（都有会被校验器判错）。
   *
   * 可选是 M4-11 带来的：组合站点没有"这一个模型"可言。
   * 校验器保证"至少有一个"，所以可选不会漏成"什么都没声明"。
   */
  model?: string
  /**
   * 这个站点由哪些模型拼出来（M4-11，R48）。**给了它就取代 `model`**。
   *
   * 一个工位是"书桌 + 椅子 + 显示器"——哪张桌子上有显示器、显示器摆在桌面哪个位置，
   * 都是**内容决策**，不是渲染器决策。`offset` 是相对站点锚点的局部偏移。
   *
   * 与 `model` 的关系：`props` 是**更完整的表达**，`model` 保留给"就一件家具"的简单站点
   * （也保证老内容包不用改）。两个都给时**报错**而不是猜——静默选一个会让内容作者
   * 以为自己的声明生效了。
   */
  props?: readonly StationPropEntry[]
}

/** 站点的一个组成部分。 */
export interface StationPropEntry {
  /** `models` 库里的条目 id。 */
  model: string
  /** 相对站点锚点的局部偏移（世界单位）；方向按世界坐标，与 `anchor` 同一套。 */
  offset?: { readonly x?: number; readonly y?: number; readonly z?: number }
  /** 额外绕 Y 轴旋转（弧度）。 */
  rotationY?: number
}

/** 场景条目：一局小镇的装配单。 */
export interface SceneEntry {
  id: string
  name: string
  /** 引用地块 id。 */
  districts: string[]
  /** 引用站点 id。 */
  stations: string[]
  /** 角色的入场点（"招募门"）：新角色从这里走进小镇。 */
  spawn: Vec2
  /** 小镇半边长（世界坐标范围 [-groundSize, groundSize]）。 */
  groundSize: number
  /** 引用主题 id（表现库）；host 不消费，交给 web。 */
  theme: string
  /** 引用花名册 id。 */
  roster: string
  /** 角色长什么样——引用 `models` 库的条目 id（同理，不在代码里写死）。 */
  agentModel: string
  /**
   * 这座小镇里**所有居民共同遵守的规矩**（R42，M7-13），逐条写进每个角色的人设末尾。
   *
   * 以前这几条写死在 `src/bridge/persona-prompt.ts` 里，违反"台词进内容库"那条红线；
   * 而且换一座小镇（比如一个只能说英文的场景、一个不许动手的观光场景）规矩本来就该不同。
   * 可选：不写就没有"规矩"那一节。
   */
  residentRules?: string[]
}

/** 花名册里的一个席位。 */
export interface RosterSeat {
  role: AgentRole
  name: string
  /** 配色。指向 `skins` 库的 token（`skin.role.lead`）或字面色值。 */
  palette: string
  /** 建议的模型路由；null = 用宿主默认模型。 */
  model: { provider: string; model: string; reasoningEffort: string | null } | null
  /**
   * **这个人是谁**：身份、性格、在意什么、怕什么。
   *
   * 这是**内容**（决策 D37）——代码里不许出现角色名、性格描述或台词。
   * 它会被拼成该角色的 DSH Agent 的 system prompt，所以写得越具体，
   * 角色之间越不会"听起来是同一个人"。
   */
  persona: string
  /**
   * **他怎么说话**：语气、句子长短、口头禅、以及**不说什么**。
   *
   * 与 `persona` 分开是有意的：*是谁* 与 *怎么说* 是两件事，
   * 而实践里后者对"像不像这个人"的影响更大（一个说话方式写清楚的角色，
   * 比一个人格形容词堆得很多的角色更像人）。
   */
  speechStyle: string
}

/** 角色库条目。 */
export interface RosterEntry {
  id: string
  name: string
  seats: RosterSeat[]
}

/** 任务集里的一张工单模板。`key` 只在集合内唯一，实例化后才分配全局 `task-N`。 */
export interface TaskTemplate {
  key: string
  title: string
  description: string
  /** 需要的能力，调度器据此选站。 */
  requires: Capability[]
  /** 依赖同集合内的其它模板 key。 */
  dependsOn: string[]
  acceptance: string
  /** 预估要多少 tick 完成（不填用默认）。渲染层用它画进度条预估。 */
  estimateTicks: number | null
  /** 建议由什么职业做；null = 谁都行。 */
  role: AgentRole | null
}

/** 任务库条目：一个任务集 = 一条工作流。 */
export interface TaskSetEntry {
  id: string
  name: string
  description: string
  tasks: TaskTemplate[]
}

// ── 表现库的条目 ────────────────────────────────────────────────────────────

/** 模型来源：外部文件或程序化构建器。 */
export type ModelSource =
  | { kind: 'glb'; url: string; clipSource: boolean }
  | { kind: 'procedural'; builder: string }

/** 模型库条目。 */
export interface ModelEntry {
  id: string
  name: string
  source: ModelSource
  scale: number
  rotationY: number
  /** 贴地修正（有些 GLB 原点在脚底，有些在中心）。 */
  anchorY: number
}

/**
 * 动作库条目：一个 `AgentState` 的表现。
 *
 * `clip` 为 null 表示走程序化动画（起伏/挤压/倾斜）——这是零资产、零许可风险的兜底，
 * 也是非人形站点（服务器闪灯、邮件车）的自然选择。
 */
export interface ActionEntry {
  id: string
  name: string
  /** 服务哪个状态。同一个状态可以有多个动作（随机挑一个，避免所有角色同步得像机器人）。 */
  state: AgentState
  clip: string | null
  loop: boolean
  speedScale: number
  /** 切换到这个动作的淡入时长（ms）。 */
  fadeMs: number
}

/** 皮肤库条目：一堆命名色 token。 */
export interface SkinEntry {
  id: string
  name: string
  /** token 名 → 色值。例如 `ground.engineering` → `#6f7d5a`。 */
  colors: Record<string, string>
}

/** 音效库条目。 */
export interface SoundEntry {
  id: string
  name: string
  /** 触发它的世界事件类型（`WorldEventType`）或留空表示由代码显式播放。 */
  event: string
  url: string
  volume: number
}

/** 主题库条目：美术方向的可切换实现。 */
export interface ThemeEntry {
  id: string
  name: string
  camera: {
    projection: 'orthographic' | 'perspective'
    yawDeg: number
    pitchDeg: number
    fov: number | null
    zoom: number
  }
  fog: { color: string; density: number } | null
  /** 光照与后处理是自由结构，渲染层自己解释；这里不强加 schema，避免每加一个效果就要改类型。 */
  lighting: Record<string, unknown>
  post: Record<string, unknown>
}

// ── 条目总表 ────────────────────────────────────────────────────────────────

/** kind → 条目类型的映射。加库时在这里补一行。 */
export interface LibraryEntryMap {
  districts: DistrictEntry
  stations: StationEntry
  scenes: SceneEntry
  rosters: RosterEntry
  tasks: TaskSetEntry
  models: ModelEntry
  actions: ActionEntry
  skins: SkinEntry
  sounds: SoundEntry
  themes: ThemeEntry
}

/** 取某个库的条目类型。 */
export type EntryOf<K extends LibraryKind> = LibraryEntryMap[K]

/** 一个内容包里的原始条目（还没进注册表）。 */
export interface ContentPack {
  manifest: PackManifest
  entries: { [K in LibraryKind]?: EntryOf<K>[] }
}

// ── 内容包清单 ──────────────────────────────────────────────────────────────

/** 内容包清单。**包是替换与升级的单位**——切换/升级永远以整包为粒度。 */
export interface PackManifest {
  id: string
  name: string
  /** 内容版本（semver）。改了条目内容就要 bump。 */
  version: string
  /** 清单格式版本。格式不兼容时加载器据此拒绝加载，而不是猜。 */
  schemaVersion: number
  description: string
  /** 依赖的其它包 id。加载时按拓扑序合并。 */
  requires: string[]
  /** 本包会填充哪些库（声明式，便于校验"声明了却没条目"这类不一致）。 */
  provides: LibraryKind[]
  /**
   * 显式声明要覆盖的 `kind/id`。
   *
   * **覆盖必须显式**：没有声明就撞了 id 视为冲突并报错。理由是"悄悄换掉别人的内容"
   * 是最难查的一类问题——世界看起来正常，只是某个站点变成了别的东西。
   */
  overrides: string[]
}

/** 当前支持的清单格式版本。 */
export const CONTENT_SCHEMA_VERSION = 1
