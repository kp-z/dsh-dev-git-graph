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
import type { IdleBehaviorKind } from '../protocol/idle.js'
import { IDLE_BEHAVIOR_KINDS } from '../protocol/idle.js'
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
    kind: 'maps',
    layer: 'presentation',
    title: '底图库',
    idPrefix: 'map.',
    summary: '整张烘好的场景底图（R62：原版办公室就是一张图），渲染器一次画完',
  },
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
  /**
   * 这一区的地面**铺哪张图**（R55）。指向 `models` 库的条目 id；不写就只用 `ground` 那个颜色。
   *
   * 为什么是内容：2D 之后"地板长什么样"是**美术选择**（办公室木地板 / 机房防静电地板 /
   * 会议区地毯），而颜色只是它的兜底。渲染器拿到图就平铺、拿不到就退回颜色——
   * 于是"换一套地板"是加一个包，不是改渲染代码。
   */
  groundModel?: string
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
  /**
   * **人站在哪**（相对锚点的偏移，R56）。不写就按容量摊一排（`slotsFor`）。
   *
   * 为什么需要它：默认的槽位是**以锚点为中心摊开的**，而锚点通常落在家具中心——
   * 于是"干活的人站在桌子里面"（M10-13 记了很久）。家具摆在哪是内容决定的，
   * 所以"人该站哪"也必须是内容能说的：**椅子在哪，人就站哪**。
   *
   * 这两件事分开算必然对不上（和 R47 那个"落点不认识家具"是同一类错），
   * 所以写在这里、与 `props` 里的椅子偏移**写在同一个条目里**，一眼能对。
   */
  slots?: readonly { readonly x: number; readonly z: number }[]
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
  /**
   * 场景底图（引用 `maps` 库条目 id；可选）。有底图的场景（如原版办公室）家具已烘进图里，
   * 站点不需要 props；没有底图的场景（如默认小镇）靠分区铺色 + 站点 props。不写 = 没有底图。
   */
  map?: string
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
   * **这个席位长什么样**（R51）。指向 `models` 库的条目 id；不写就用场景的 `agentModel`。
   *
   * 为什么需要它：场景层只有一个 `agentModel`（"这座小镇的人默认长什么样"），
   * 而 8 个居民**应该长得不一样**——那不是场景属性，是**席位属性**。
   * 把这个决定放在这里，于是"某个人换一张脸"是改内容，不是改渲染器。
   */
  appearance?: string
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

/** 模型来源：外部文件、程序化构建器，或**像素图集**（2D，R51）。 */
export type ModelSource =
  | { kind: 'glb'; url: string; clipSource: boolean }
  | { kind: 'procedural'; builder: string }
  | { kind: 'sheet'; url: string; sheet: SheetSpec }

/**
 * 像素图集的切法（2D，R51）。
 *
 * ## 为什么"哪一格是什么"必须写在内容里
 *
 * 这些 CC0 图集**不提供名称表**（R50 实测：11 个包没有一份逐格说明），所以"第 3 行第 5 格是椅子"
 * 这件事**只能由人声明**。让渲染器去猜（按位置约定、按文件名）会在换一套图集时静默画错，
 * 而"某件家具变成了别的东西"极难归因。
 *
 * ## 单位
 *
 * 全用**格**而不是像素：`cellW/cellH` 只在切图时用一次，此后一切（第几列、跨几行）都是格。
 * 于是"把 16px 的图集换成 32px 的"不用改任何动画定义。
 */
export interface SheetSpec {
  /** 单格宽（像素）。 */
  cellW: number
  /** 单格高（像素）。 */
  cellH: number
  /**
   * 一个完整事物占几格高。
   *
   * 人物几乎总是 2（头 + 身）：`18×36` 的立绘在 `18×18` 的格子里就是跨两行。
   * 家具/地砖是 1。**跨行是从"带"的顶端往下数**（见 `SheetAnimation.row`）。
   */
  rowsPerFigure: number
  /**
   * 贴地方式：`bottom` = 图底边贴地面格（人、家具），`center` = 图心对准格心（地砖）。
   *
   * 这一条是**机制**（怎么把图对准格子），不是内容——所以放在 `SheetSpec` 里由渲染器执行，
   * 而具体某个模型选哪种仍是内容决定。
   */
  anchor: 'bottom' | 'center'
  /**
   * 动画：名字 → 在图上哪一块。
   *
   * 名字用**点分**的 `动作.方向`（`walk.down` / `idle.left`）；方向缺省表示"不分方向"。
   * 之所以不把方向做成独立字段：有些图集只画了左右（靠水平翻转省一半），
   * 有些画了四向，把它们硬塞进同一个结构会逼着内容作者填假数据。
   */
  animations: Readonly<Record<string, SheetAnimation>>
  /**
   * 要不要按角色的配色**重上色**（R58）。**默认 false —— 不染**。
   *
   * 这个默认值是刻意的，理由是一次真缺陷：重上色的实现是"把精灵**自己用得最多的前 3 个颜色**
   * 映射成角色色的明暗三档"。对**裸模**（如 OGA 那套：整个身体只有 3 个主色，本来就等着被染色）
   * 这是对的；但对**已经画完的角色**（如 Microverse：前 3 色是头发棕、衣服蓝、皮肤），
   * 它会把头发、衣服、皮肤**一起染成同一个色相**——角色变成一坨单色块。
   *
   * 所以规则是：**别人画好的美术，默认不动**。要用重上色得显式声明。
   */
  recolor?: boolean
}

/** 一段动画在图上的位置（单位：格）。 */
export interface SheetAnimation {
  /** 起始列（0 起）。 */
  col: number
  /** 起始**带**（0 起）。一条带高 `rowsPerFigure` 格，所以实际像素行 = `row * rowsPerFigure * cellH`。 */
  row: number
  /** 帧数。 */
  frames: number
  /** 每帧时长（ms）。 */
  frameMs: number
  /** 帧沿什么方向排。缺省 `row`（同一带里向右排）。 */
  layout?: 'row' | 'column'
  /**
   * 这一段的第 `n` 帧是**水平翻转**得到的（省一半画面）。
   *
   * 例：只画了朝左的走路，朝右就是同一批帧翻过来。声明在这里而不是让渲染器猜，
   * 因为"翻转是不是对"取决于图（有些图正面朝左、有些朝右）。
   */
  mirror?: boolean
}

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
 * 待命时"给自己找点事做"的行为种类（R68）。
 *
 * 只有三种，不是设计保守，而是**图集只有三条带**：`idle` / `walk` / `sit`，各四向 6 帧。
 * 没有打字、喝咖啡、伸懒腰的姿势。所以取值表达的是"**用现有三条带 + 移动 + 朝向能组合出什么**"，
 * 不是"想让他在干嘛"。要加第四种，先得有美术。
 */
// `IdleBehaviorKind` / `IDLE_BEHAVIOR_KINDS` 住在**协议层**（`protocol/idle.ts`）：
// 内容与 sim 都要用它，而只有"内容 import 协议"这一个方向是允许的。
// 这里重新导出，是为了让内容包与校验器继续从 `kinds.js` 拿到它们（少改一处 import）。

/**
 * 一条动作在**待命编排**里的参数（R68）。
 *
 * 为什么挂在 `ActionEntry` 上、而不是新起一个库：`actions` 库本来就是"状态 → 表现"的内容目录，
 * 而待命行为恰恰就是"待命时播哪条带、播多久、要不要挪个地方"——同一个主语。
 * 另起一个库要么得动协议层的 `LIBRARY_KINDS`（共享契约，且 `LIBRARY_KINDS` 与内容层的
 * `LIBRARY_SPECS` 有测试钉着必须一一对应），要么在内容层造一个只有 sim 认识的概念。
 *
 * `null` = 这条动作**不参与**待命编排（它只在对应状态被渲染时用）。
 */
export interface IdleBehaviorSpec {
  readonly kind: IdleBehaviorKind
  /**
   * 这一段持续多少个 tick。
   *
   * **用 tick 不用毫秒**：模拟是定步长的，用毫秒就要在 sim 里做时间换算，
   * 而"同一 seed 同一段行为"这条确定性会立刻被挂钟时间污染。
   */
  readonly ticksMin: number
  readonly ticksMax: number
  /** `pace` 用：离歇脚点最远挪多少世界单位。其它 kind 忽略（写 0）。 */
  readonly radius: number
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
  /**
   * **2D 图集里的动作带名**（R60）：`idle` / `walk` / `sit`。
   *
   * 与 `clip` 分工：`clip` 是 3D 的 GLB 动画剪辑名，`band` 是像素图集里的那一条带
   *（`SheetSpec.animations` 的键前缀，渲染器按 `band.方向` 去找帧）。
   * 两者都可以是 null——**null 表示这条路走不了**，渲染器要退回而不是硬播一个错的。
   *
   * 为什么要有它：在此之前 2D 渲染器把"状态→动作"**硬编码**成
   * `walking ? 'walk' : 'idle'`，内容库里的 `action.work` / `action.talk` 全是摆设——
   * 而"表现是内容"是我们自己的红线（D31）。
   */
  band: string | null
  /**
   * 同一个状态下**相对权重**（挑一个动作时用）。
   *
   * 为什么要有：`actions` 库的注释早写了"同一个状态可以有多个动作（随机挑一个，
   * 避免所有角色同步得像机器人）"，但没有权重就只能等概率——而"偶尔伸个懒腰"
   * 和"大部分时间只是站着"显然不该等概率。缺省 1。
   */
  weight: number
  loop: boolean
  speedScale: number
  /** 切换到这个动作的淡入时长（ms）。 */
  fadeMs: number
  /**
   * 待命编排参数（R68）：`null` = 这条动作不参与"待命的人找点事做"。
   *
   * ⚠️ **这一个字段被两边读，语义不同**：
   * - `sim` 在这些条目之间按 `weight` **加权挑一个**——"他此刻在干什么"；
   * - `web` 的 `bandOfState` 取该状态下**权重最大**的那条来决定播哪条带。
   *
   * 后者拿不到"sim 挑了谁"（`SceneActor` 上没有"本 tick 的动作"这个字段），
   * 所以**权重最大的那条待命动作必须带 `idle`**，否则全体待命角色的表现都会被换掉。
   * 改权重前先读这条。
   */
  idle: IdleBehaviorSpec | null
}

/**
 * 底图库条目（R62）：一整张烘好的场景底图。
 *
 * `width`/`height` 是**格数**，`cellPx` 是一格多少源像素——渲染器据此把图对齐到世界坐标。
 */
export interface MapEntry {
  id: string
  name: string
  /** 底图 URL（相对 vendor 根）。 */
  url: string
  width: number
  height: number
  cellPx: number
  /** 一格等于多少世界单位。 */
  unitsPerCell: number
  /**
   * **可行走网格**（R64 物理），长度 = width × height，`false` = 走不了。
   *
   * 由原版图块的物理多边形解出（不是"看图猜哪张像墙"）。
   * 可选：没有它就没有碰撞（退回直线走），那是老内容的回退路径。
   */
  walkable?: readonly boolean[]
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
  maps: MapEntry
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

export type { IdleBehaviorKind }
export { IDLE_BEHAVIOR_KINDS }
