/**
 * 场景描述的形状（BACKLOG M4-0）。
 *
 * ## 为什么类型住在协议层，而"怎么算出来"住在场景层
 *
 * 这份描述是**快照的一部分**，要跨进程给浏览器（将来还要给别的渲染器）。
 * 所以它是契约：类型归协议层（`protocol/`），派生逻辑归场景描述层（`scene/`）。
 *
 * 一开始我把类型写在 `scene/plan.ts` 里，结果协议层为了声明快照字段不得不
 * import 场景层——**反向依赖，被边界检查器当场抓住**。这不是巧合：
 * "谁被跨进程引用，类型就归谁"是一条好用的判据。
 *
 * ## 它为什么与渲染器无关
 *
 * 没有 mesh / material / draw call，只有"在哪、多大、什么色、什么模型 id"。
 * 于是"换成现成的 three.js 场景"就只是一件消费这份描述的事——
 * **模拟层与内容库一行都不用改**。这正是用户想要的"能直接用的场景"能接上的前提。
 */
import type { AgentState, DistrictKind, StationKind } from '../domain/types.js'
import type { ThemePlan } from './theme.js'

/**
 * 解析一个颜色引用。
 *
 * **为什么它在协议层**：`skin.` 前缀这个约定本身就是跨边界的——
 * 内容层写它、场景层读它、面板将来也可能用它。同一个约定有两个实现就一定会漂移，
 * 而漂移的症状是"某处少了一个颜色"，很难归因。
 *
 * 规则：`skin.xxx` 去调色板查 `xxx`；`#rrggbb` 原样用；查不到用**洋红**。
 * 洋红是刻意的：少一个 token 不该黑屏，但必须一眼看出来——
 * 静默退回灰色才是最坏的选择（看起来像"设计就这样"）。
 *
 * @param value - 待解析的引用（可能是 token、字面色值、null）。
 * @param palette - 调色板（token → 色值）。
 * @param fallback - 什么都不对时的兜底色；默认洋红。
 */
export function resolveColor(
  value: string | null | undefined,
  palette: Readonly<Record<string, string>>,
  fallback = '#FF00FF',
): string {
  if (typeof value !== 'string' || value === '') return fallback
  const bare = value.startsWith('skin.') ? value.slice('skin.'.length) : value
  return palette[bare] ?? palette[value] ?? (value.startsWith('#') ? value : fallback)
}

/** 一块地面。 */
export interface SceneGround {
  id: string
  name: string
  kind: DistrictKind
  /** 中心点（俯视平面）。 */
  x: number
  z: number
  width: number
  depth: number
  /** **已解析成色值**（不是 token）。 */
  color: string
  /**
   * 这一区的地面**平铺哪张图**（R55）；没有就只用 `color`。
   *
   * 与 `SceneProp.parts` 同一条规矩：**形状由内容声明、渲染器只执行**。
   * 渲染器拿到模型表里的 `sheet` 就按格子平铺，拿不到就退回纯色。
   */
  modelId: string | null
}

/** 一个站点（用 `models` 库的 id 指代它长什么样）。 */
export interface SceneProp {
  id: string
  name: string
  kind: StationKind
  x: number
  z: number
  /**
   * 这个站点由哪些模型**拼**出来（M4-11，R48）。**顺序有意义**：渲染器按序摆。
   *
   * 为什么是数组而不是一个 `modelId`：一个工位是"书桌 + 椅子 + 显示器"，
   * 而"这张桌子上有没有显示器"是**内容决策**（`StationEntry.props`）。
   * 从前的单数形状把一个站点锁死成一件家具，于是 R47 评估时看到的是
   * **光秃秃的桌子、人坐在空气里**，而库里躺着 25 个没人用的家具。
   *
   * 每一项的 `dx/dy/dz/rotationY` 是**相对站点锚点**的局部偏移，同样来自内容
   * （"显示器摆在桌面中间偏后"）。**"摆正、贴地"仍是机制**（`recenterOnGround`），
   * 不在内容里写"这个模型的包围盒怎么偏"。
   */
  parts: ScenePropPart[]
  color: string
  capacity: number
  /** 现在有没有人（含正在过去的）。渲染层据此画高亮。 */
  occupied: boolean
}

/** 站点的一个组成部分（M4-11）。 */
export interface ScenePropPart {
  /** `models` 库里的条目 id，形如 `model.station.desk`。 */
  modelId: string
  /** 相对站点锚点的局部偏移（世界单位）。缺省 0。 */
  dx: number
  dy: number
  dz: number
  /** 额外绕 Y 轴旋转（弧度）。缺省 0；与模型条目自己的 `rotationY` 相加。 */
  rotationY: number
}

/**
 * 像素图集的切法（渲染就绪的形态，2D / R51）。
 *
 * 与内容层的 `SheetSpec` 是两个类型而不是复用同一个：协议层**不许 import 内容层**
 * （边界检查器会拦）。所以这里是"渲染器需要什么就放什么"的精简形状。
 */
export interface SceneSheetSpec {
  cellW: number
  cellH: number
  rowsPerFigure: number
  anchor: 'bottom' | 'center'
  animations: Readonly<
    Record<string, { col: number; row: number; frames: number; frameMs: number; layout: 'row' | 'column'; mirror: boolean }>
  >
  /**
   * 要不要按角色配色重上色（R58）。**默认 false**——见内容层 `SheetSpec.recolor` 的说明：
   * 对"已经画完的角色"重上色会把头发/衣服/皮肤染成一色。
   */
  recolor: boolean
}

/** 一个角色。 */
/**
 * 一个模型的**渲染就绪**描述（`models` 库条目的投影）。
 *
 * 为什么要把它放进 `ScenePlan`：渲染器要按 `SceneProp.modelId` 查出"它长什么样"，
 * 而渲染器**不该去内容库里找**（那是 host 的事，且面板拿不到内容库）。
 * 所以计划里带一张**只含本场景用到的**模型表——自足、且不重复携带。
 *
 * `builder` 与 `url` 恰好有一个非 null：程序化模型给构建器名，GLB 给包内相对路径。
 */
export interface SceneModel {
  id: string
  /** 程序化构建器的名字（渲染器按它查自己的构建器注册表）；GLB 模型为 null。 */
  builder: string | null
  /** GLB 的**包内相对路径**（已过路径校验）；程序化模型为 null。 */
  url: string | null
  /**
   * 像素图集的切法（2D，R51）。GLB 与程序化模型为 null。
   *
   * 与 `parts` 同一条规矩：**形状由内容声明**，渲染器只执行。
   * "第几格是椅子""走路有几帧"都在这里，所以换一套图集不用改渲染代码。
   */
  sheet: SceneSheetSpec | null
  scale: number
  rotationY: number
  anchorY: number
}

export interface SceneActor {
  id: string
  name: string
  role: string
  x: number
  z: number
  /** 朝向（弧度）。 */
  facing: number
  state: AgentState
  color: string
  /** 手头的工单 id；空闲为 null。 */
  carryingTaskId: string | null
  /** 角色用哪个模型条目（`models` 库的 id，由场景条目声明）。 */
  modelId: string
}

/**
 * 一份渲染就绪的场景描述。
 *
 * 渲染器**只需要它**就能把画面画出来；HUD 的列表类内容（花名册、工单板）走 `world`，
 * 那是文本，与场景无关。
 */
/**
 * **状态 → 动作**的一条映射（渲染就绪，R60）。
 *
 * 为什么要下发：2D 渲染器原先**硬编码** `walking ? 'walk' : 'idle'`，内容库里的
 * `action.work` / `action.talk` 完全没用上——而"表现是内容"是我们的红线（D31）。
 * 现在渲染器只做一件事：**按状态筛出候选、按权重挑一个、用 `band.方向` 找帧**。
 *
 * `band` 为 null 表示这个动作在 2D 图集里没有对应带——渲染器**退回上一档**（通常是 `idle`），
 * 不要硬播一个错的。
 */
export interface SceneAction {
  id: string
  name: string
  /** 服务哪个状态。 */
  state: string
  /** 2D 图集里的动作带名（`idle` / `walk` / `sit`）；null = 2D 没有这个动作。 */
  band: string | null
  /** 相对权重（同一个状态下按它挑）。 */
  weight: number
  speedScale: number
  fadeMs: number
}

/**
 * 场景的**底图**（R62）。
 *
 * 为什么是"一整张烘好的图"而不是"图块网格"：原版场景有 1322 格、跨 8 个图集。
 * 第一次接通时**先把图烘成一张 PNG**，渲染器只需一次 `drawImage`——
 * 少一个协议（网格 + 多图集 + 分块剔除），能更快看到"小人在真办公室里"。
 * 代价是**单格不可寻址**（不能只染某一块地板、不能高亮某个房间）。
 * 真要那些能力时再升级成 tilemap，那是一条独立的升级路径，不影响现在的契约形状。
 */
export interface SceneMap {
  /** 底图 URL（相对 vendor 根）；null = 这一局没有底图，渲染器退回按分区铺色。 */
  url: string | null
  /** 地图格数。 */
  width: number
  height: number
  /** 一格多少源像素（图里的实际尺寸 = width×cellPx）。 */
  cellPx: number
  /** 一格等于多少世界单位（渲染器据此把图缩放到世界坐标）。 */
  unitsPerCell: number
  /** 美术占位格（`row*width+col`）：画面上是家具、但原版物理多边形漏掉的格子。 */
  occupancy?: readonly number[]
  /** 小而独立的美术连通块整块外接矩形（地图像素），让碰撞体包住整件物体。 */
  occupancyRects?: readonly (readonly [number, number, number, number])[]
}

/**
 * 世界单位下的一个矩形（x/z 是左上角，w/h 是宽高；z 对应屏幕 y）。
 *
 * 为什么统一用**世界单位**而不是像素：渲染器、寻路、审计三方都要读，
 * 像素只在最后一刻（乘 `TILE_PX`）出现。两套单位混着用，就是"差 16 倍"这类错。
 */
export interface SceneRect {
  x: number
  z: number
  w: number
  h: number
}

/**
 * 一个物理障碍（R227 统一实体模型）。
 *
 * 来源两种，**都对应画面上真实存在的东西**：
 * - `fine`：从美术 alpha 轮廓算出的精细碰撞体（与底图同源）；
 * - `art`：美术占位格（家具层下半部分明显有东西，但原版物理多边形漏了），整格。
 *
 * R229 删除过 `cell`（按 nav 整格补）——那种"画面上没东西"的补格会造出看不见的墙。
 * 渲染器**只认这一份**：不再自己去 fetch `*-colliders.json`，也不再拿 nav 二次拼。
 */
export interface SceneObstacle extends SceneRect {
  source: 'fine' | 'art'
}

/** 一个会挡路/有占地的实体（站点/家具），用于审计与调试。 */
export interface SceneSpaceEntity {
  id: string
  kind: 'station'
  /** 占地：一格（站点锚点所在格）。 */
  footprint: SceneRect
  /** 深度基准：底边的世界 z（渲染器据此排序，不再按"类别"给固定深度）。 */
  base: number
  /** 可站立的吸附点（必须都在可走格里）。 */
  slots: readonly { x: number; z: number }[]
}

/** 一套空间数据的自检读数（`airWallAudit()` 直接读它）。 */
export interface SceneSpaceAudit {
  /** nav 里 blocked 的格数。 */
  blockedCells: number
  /** 精细碰撞体条数（换算到世界单位后）。 */
  fineRects: number
  /**
   * nav 说不能走、但精细几何的格中心没盖住的格数。
   *
   * **只用于审计**，不再补整格（R229 纠正：补整格会造出"看不见的墙"）。
   * 它回答的是"两份数据差多少"，不是"要补多少"。
   */
  uncoveredCells: number
  /** 最终障碍条数（fine + art）。 */
  obstacles: number
  /** 按美术占位补的整格数（画面上确实有家具）。 */
  artCells: number
  /** 是否在读手改覆盖（覆盖时自动推导全部停用）。 */
  override?: boolean
  entities: number
  slots: number
  /** 落在 blocked 格里的吸附点——**必须为 0**，否则人会被吸进墙里。 */
  slotsBlocked: number
}

/**
 * **舞台空间的单一权威**（R227）。
 *
 * 以前"能不能站 / 怎么挡 / 谁在前"由三份互不校验的数据决定：
 * `nav.blocked`（寻路）、`*-colliders.json`（物理）、站点外观 + 深度（渲染）。
 * 实测漂移：248 个 blocked 格里 55 格没有碰撞体 → 人能上墙、上桌子。
 *
 * 现在这三件事从**同一个结构**读：
 * 1. `nav.blocked` —— 能否站（寻路、手动落点、审计）；
 * 2. `obstacles` —— 物理挡什么（`fine` ∪ 按格补的缺口）；
 * 3. `entities[].base` —— 深度基准（底边世界 z）+ `slots`（可站吸附点）。
 *
 * 渲染器、服务端、调试门面都只认它；任何一处不一致都会被 `audit` 或测试抓住。
 */
export interface SceneSpace {
  nav: {
    width: number
    height: number
    unitsPerCell: number
    originX: number
    originZ: number
    blocked: readonly boolean[]
  }
  obstacles: readonly SceneObstacle[]
  entities: readonly SceneSpaceEntity[]
  audit: SceneSpaceAudit
}

export interface ScenePlan {
  /**
   * 世界的半径（半边长）。渲染器据此铺地面、定取景范围——
   * 所以"小镇多大"这件事是内容说了算，不是渲染器说了算。
   */
  extent: { half: number }
  /**
   * 这一局用的是哪个主题（渲染就绪的形状）。
   *
   * 相机/光照/雾/后期都在里面——**渲染器不该自己去内容库里找主题**。
   * 条目缺失时为 null，渲染器应当退回一组内置缺省，而不是黑屏。
   */
  theme: ThemePlan | null
  ground: SceneGround[]
  props: SceneProp[]
  actors: SceneActor[]
  /** 状态 → 动作的映射（**来自内容库**，渲染器不许自己写死）。 */
  actions: SceneAction[]
  /** 场景底图；null = 没有底图，渲染器按分区铺色（老行为）。 */
  map: SceneMap | null
  /**
   * 舞台空间（nav + 障碍 + 实体占地/吸附）。null = 没有地图/老内容。
   *
   * 可选是为了让测试与老计划继续能用；**新路径下渲染器优先读它**，
   * 读不到才退回旧的 `fetch(*-colliders.json)`。
   */
  space?: SceneSpace | null
  /**
   * 本场景引用到的模型（`SceneProp.modelId` 与 `SceneActor.modelId` 在这张表里查）。
   *
   * **只含用到的**：整本 `models` 库搬过来既浪费又会让"这局到底用了什么"变得看不清。
   * 表里查不到的 `modelId` 意味着内容与内容之间对不上（host 侧交叉校验会先报错），
   * 渲染器遇到时应当**明确报出来**，而不是退回一个方块了事。
   */
  models: SceneModel[]
  /**
   * 消息纸条的配色（按 `Message.kind` 索引），**已解析成色值**。
   *
   * 与地块/角色同理：渲染层不认识 token，也不该在代码里写字面色值
   * （那会直接违反"改内容不用改代码"）。所以要给纸条换个色，
   * 改的是 `skins` 库里 `message.*` 那几个 token。
   */
  noteColors: Record<string, string>
}
