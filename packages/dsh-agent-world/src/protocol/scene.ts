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
}

/** 一个站点（用 `models` 库的 id 指代它长什么样）。 */
export interface SceneProp {
  id: string
  name: string
  kind: StationKind
  x: number
  z: number
  /** 内容库里对应的模型条目 id，形如 `model.station.desk`。渲染器去模型库里取。 */
  modelId: string
  color: string
  capacity: number
  /** 现在有没有人（含正在过去的）。渲染层据此画高亮。 */
  occupied: boolean
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
