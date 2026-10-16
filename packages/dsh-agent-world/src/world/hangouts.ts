/**
 * 待命落点的分配（R47 P0-1 的修复；BACKLOG M2.5-1 的延伸）。
 *
 * ## 它修的是什么
 *
 * 原来的 `hangoutsFor(districts, count)` 只按**地块几何**摊了一个栅格，
 * **签名里根本没有站点**——所以它不可能知道"那儿有个沙发/桌子"。
 * 家具位置来自场景内容（`StationEntry.anchor`），两者各算各的，必然可能撞上。
 *
 * 现在把**几何事实**喂进来：一组"被占的位置 + 需要空出的半径"。
 * 刻意**不收 `StationEntry`**（决策 D37 的同一条理由）：机制不该认识内容条目——
 * 它只需要知道"这块地方被占了、半径多大"。半径怎么来的由装配层决定
 * （见下面 `STATION_CLEARANCE` 的测量依据）。
 *
 * ## 约束的优先级（"放不下"时的策略）
 *
 * **家具是硬约束，人际间距是软目标。**
 *
 * 理由：撞进家具是**穿模**——一眼可见的错误，而且是"世界说角色站在那儿"这种
 * 状态层面的错；人挤一点只是不好看。所以：
 *
 * 1. 候选点先过家具滤网（`dist ≥ radius`），此后**任何**返回值都满足它；
 * 2. 人挤不下时**逐个放弃** `minGap`（1 → 0.75 → 0.5 → 0.25 → 0），
 *    而不是放弃家具约束；
 * 3. 只有当"零间距也放不下 `count` 个人"（病态内容：整块地都被家具占了）时，
 *    才退到**最不坏**的落点（离家具最远的那些）。这时仍然**返回 `count` 个点**：
 *    返回少了会让调用方 `hangouts[i % length]` 把两个人分到同一格——
 *    那是比"贴着家具"更糟的画面。
 *
 * 与 lead 的倾向一致（"宁可挤也不叠进家具里"），但把"挤"的量化顺序写死在这里，
 * 而不是留给调用方猜。
 *
 * ## 确定性
 *
 * 纯函数、无 `Math.random()`、无 `Date.now()`：候选点顺序固定，
 * 排序用 `(clearance 降序, 候选序号升序)` 做全序 tie-break，所以**同输入必同输出**。
 * 这一条是模拟内核的硬要求（同 seed 重开一局必须长出同一个世界）。
 */
import type { Bounds, District, Station, StationKind, Vec2 } from '../domain/types.js'

/**
 * 一个**已被人身占住**的几何事实：中心点 + 需要空出的半径。
 *
 * `radius` 是"**人物中心至少离它多远**"（已经把人物身位算进去了），
 * 不是家具自身的半径——这样判据只有一条：`distance(落点, at) >= radius`。
 */
export interface OccupiedSpot {
  readonly at: Vec2
  readonly radius: number
}

/** 分配待命落点的输入。 */
export interface PlaceHangoutsOptions {
  /** 在哪个矩形里找落点（地块 bounds）。 */
  readonly bounds: Bounds
  /** 要放几个人。 */
  readonly count: number
  /** 被家具占住的位置。**硬约束**：任何返回值都离它们 ≥ 各自的 `radius`。 */
  readonly blocked?: readonly OccupiedSpot[]
  /**
   * 人与人之间的**目标**间距（软约束：放不下时按 {@link GAP_RELAX_STEPS} 逐个放弃）。
   * 默认 {@link DEFAULT_MIN_GAP}。
   */
  readonly minGap?: number
}

/**
 * 目标人际间距（世界单位）。
 *
 * ## 为什么是 2.2（R52 从 1.8 改上来）
 *
 * 2D 渲染之后有了一个**可算的下限**：像素精灵宽 **32 源像素**，而渲染层是
 * **16 源像素 = 1 世界单位**（`web/scene/scene2d.js` 的缩放约定）。
 * 所以一个人占 **2.0 世界单位宽**——间距小于 2.0 就会**互相压住**。
 *
 * 实测（真机，8 个角色）：1.8 时实际最小间距 **1.92**，比 2.0 差 0.08 单位 ≈ 1.3 源像素，
 * 屏幕上就是两个人叠在一起。取 **2.2** 留 0.2 的余量。
 *
 * 这条对 3D 也无害（人散开一点本来就更好看），而它是**从渲染尺寸推出来的**，
 * 不是"看着挤就调大一点"。
 */
export const DEFAULT_MIN_GAP = 2.2

/**
 * 放弃人际间距的顺序（家具约束**不在此列**）。
 *
 * 递减的因子乘在 `minGap` 上。最后的 `0` 表示"只要求落点互不相同"。
 */
export const GAP_RELAX_STEPS: readonly number[] = [1, 0.75, 0.5, 0.25, 0]

/** 候选点相对地块内缩的比例：贴着地块边缘站，看起来像随时要走出去（沿用原实现的 20%）。 */
const INSET_RATIO = 0.2

/** 候选点数量上限。超过就放宽间距重算——世界创建是热路径，不能让它变成 N² 的灾难。 */
const MAX_CANDIDATES = 900

/**
 * 人物身位半径（世界单位）。
 *
 * 两个变体取大者：
 * - 程序化 `avatar` 构建器（`web/scene/builders.js`）：胶囊半径 **0.30**；
 * - Kenney `character-male-a.glb` × `scale 2`：XZ 包围盒 **1.534 × 0.68** → 半宽 **0.34**。
 *
 * 取 0.35（覆盖两者，留一点余量）。它**不**取包围盒的半对角线（0.84）——
 * 那是"把张开的手臂也算成实心圆柱"，会把所有站点半径整体推大约 0.5，
 * 让广场上摆不下人。这是有意的取舍，不是遗漏。
 */
export const AGENT_BODY_RADIUS = 0.35

/**
 * 站点需要空出的半径（按 `kind`），单位是世界单位，**已含人物身位**。
 *
 * ## 数字不是拍的：每一条都来自"实际会被渲染出来的几何"
 *
 * 每个站点有两种可能的外观，取**较大者**——因为它们都属于合法内容，
 * 而落点算法不该假设当前 profile 装的是哪一套：
 *
 * | kind | 程序化构建器的 XZ 半对角线 | Kenney GLB × `scale`(1.5) | 取大者 | + 身位 0.35 |
 * |---|---|---|---|---|
 * | desk | 0.575（桌板 0.95×0.65） | 0.624（`desk.glb` 0.734×0.392 ×1.5） | 0.624 | **0.98** |
 * | meeting | 0.875（桌板 1.5×0.9） | 0.714（`table.glb`） | 0.875 | **1.23** |
 * | server | 0.407（柜 0.55×0.6） | 0.628（`bookcaseClosedWide.glb` 0.8×0.25 ×1.5） | 0.628 | **0.98** |
 * | mailroom | 0.513（纸箱 0.86×0.56） | 0.321（`cardboardBoxOpen.glb`） | 0.513 | **0.87** |
 * | lab | 0.610（台 1.0×0.7） | 1.033（`deskCorner.glb` 0.974×0.974 ×1.5） | 1.033 | **1.39** |
 * | breakroom | 0.975（圆桌 r0.5 + 两只凳子 `x±0.78, z0.2, r0.17` → 最远点 `hypot(0.78,0.2)+0.17`） | 0.796（`loungeSofa.glb` 0.98×0.41 ×1.5） | 0.975 | **1.38** |
 *
 * 程序化那一列读的是 `web/scene/builders.js` 里的字面尺寸，取"从 anchor 到该构件最远点的距离"：
 * 方块类构件就是它的半对角线（`hypot(hx,hz)`，例如工位 `0.95×0.65` → 0.575），
 * 圆柱类构件是 `中心距 + 半径`（例如圆桌 `0.5`、凳子 `0.805+0.17=0.975`）。
 * ⚠️ 方块类不能用包围盒角点去套圆柱——圆桌+凳子的盒角（`hypot(0.95,0.5)=1.07`）是**空角**，
 * 拿它当半径会平白多推 0.1；反过来说，只要取值 ≥ 真实最远点，偏保守总是安全的。
 * GLB 那一列是解析文件里 POSITION 访问器的 min/max、再乘 `ModelEntry.scale` 得来的
 * （`ModelEntry.url` + `scale` 由场景计划原样给出，渲染器只做 `setScalar(scale)`，
 * 没有别的缩放；原点在角上那件事由渲染器的 `recenterOnGround` 在摆放时居中处理，
 * 所以"以 anchor 为中心、半径 R"这个模型与画面是对得上的）。
 *
 * ## 一个诚实的边界
 *
 * 半径是**按 kind 的常数**，不是从当前内容包里读出来的真实包围盒。原因很实际：
 * 世界创建发生在**宿主侧**，而 `world/` 不许 import `node:`（边界规则），
 * 所以它读不了 GLB；`StationEntry` 目前也没有尺寸字段（那是内容 schema 变更，见下）。
 * 结论：**内容里换一个明显更大的家具、且不换 kind 时，这里会偏小。**
 * 正确的下一步是把尺寸变成内容（`StationEntry.footprint` 之类），
 * 那是一次显式的内容 schema 变更（要带校验与可用取值），不在本任务的写盘范围里。
 */
export const STATION_CLEARANCE: Readonly<Record<StationKind, number>> = {
  desk: 0.98,
  meeting: 1.23,
  server: 0.98,
  mailroom: 0.87,
  lab: 1.39,
  breakroom: 1.38,
}

/** 取某个 `kind` 的站点需要空出的半径。 */
export function stationClearance(kind: StationKind): number {
  return STATION_CLEARANCE[kind]
}

/** 两点距离。 */
function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** 把 bounds 归一化（min/max 可能给反）。 */
function normalize(bounds: Bounds): { x0: number; x1: number; z0: number; z1: number } {
  return {
    x0: Math.min(bounds.min.x, bounds.max.x),
    x1: Math.max(bounds.min.x, bounds.max.x),
    z0: Math.min(bounds.min.z, bounds.max.z),
    z1: Math.max(bounds.min.z, bounds.max.z),
  }
}

/**
 * 在地块里铺一层候选点（内缩 20%，间距 `pitch`）。
 *
 * 宁可用"细网 + 挑散点"而不是"直接算 count 个点"：滤掉家具之后，
 * 原来那几个格可能就不够了，而细网里还有别的选择。
 */
function latticeCandidates(bounds: Bounds, pitch: number): Vec2[] {
  const { x0, x1, z0, z1 } = normalize(bounds)
  const insetX = (x1 - x0) * INSET_RATIO
  const insetZ = (z1 - z0) * INSET_RATIO
  const lo = { x: x0 + insetX, z: z0 + insetZ }
  const hi = { x: x1 - insetX, z: z1 - insetZ }

  const cols = Math.max(1, Math.floor((hi.x - lo.x) / pitch) + 1)
  const rows = Math.max(1, Math.floor((hi.z - lo.z) / pitch) + 1)

  /** 只有一格/一行时取中点，否则均分（与 `latticeIn` 同套路，避免除零）。 */
  const at = (lo: number, hi: number, span: number, index: number): number =>
    span <= 1 ? (lo + hi) / 2 : lo + ((hi - lo) * index) / (span - 1)

  const out: Vec2[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ x: at(lo.x, hi.x, cols, c), z: at(lo.z, hi.z, rows, r) })
  }
  return out
}

/** 候选点按"离家具的余量"从大到小排序；并列时按候选序号（保证全序 → 确定性）。 */
function rankByClearance(points: readonly Vec2[], blocked: readonly OccupiedSpot[]): RankedPoint[] {
  const withKey = points.map((point, index) => ({
    point,
    index,
    clearance: clearanceOf(point, blocked),
  }))
  withKey.sort((a, b) => b.clearance - a.clearance || a.index - b.index)
  return withKey
}

/** 排好序的候选点：带上它离最近家具的余量。 */
interface RankedPoint {
  readonly point: Vec2
  readonly index: number
  readonly clearance: number
}

/** 落点离最近家具的余量（负数 = 落在家具需要空出的范围里）。没有家具时是 Infinity。 */
function clearanceOf(point: Vec2, blocked: readonly OccupiedSpot[]): number {
  let best = Number.POSITIVE_INFINITY
  for (const spot of blocked) {
    const gap = distance(point, spot.at) - spot.radius
    if (gap < best) best = gap
  }
  return best
}

/**
 * 从 `pool` 里挑 `count` 个点：第一个取 `pool[0]`（调用方已按余量排好），
 * 之后每次取"离已选点集最远"的那个（最远点采样）。
 *
 * @returns 按要求挑够就返回数组；某个时刻连 `gap` 都满足不了就返回 `null`（交给调用方放宽）。
 */
function spread(pool: readonly Vec2[], count: number, gap: number): Vec2[] | null {
  if (pool.length < count) return null

  const remaining = [...pool]
  const chosen: Vec2[] = []
  while (chosen.length < count) {
    let bestIndex = 0
    let bestScore = Number.NEGATIVE_INFINITY
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      if (candidate === undefined) continue
      let nearest = Number.POSITIVE_INFINITY
      for (const done of chosen) {
        const d = distance(candidate, done)
        if (d < nearest) nearest = d
      }
      // 第一个点没有"已选点"，分数记 Infinity，于是它取 pool[0]（已按家具余量排好）。
      const score = Number.isFinite(nearest) ? nearest : Number.POSITIVE_INFINITY
      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }

    if (chosen.length > 0 && bestScore < gap) return null
    const [taken] = remaining.splice(bestIndex, 1)
    if (taken === undefined) return null
    chosen.push(taken)
  }
  return chosen
}

/**
 * 在 `bounds` 里给 `count` 个待命角色找落点。
 *
 * @param options - 见 {@link PlaceHangoutsOptions}。
 * @returns 恰好 `count` 个落点（`count <= 0` 时是空数组）。
 *   只要存在足够多的"不撞家具"的候选点，返回值就**全部**满足
 *   `distance(落点, blocked[i].at) >= blocked[i].radius`；
 *   人际间距尽力满足，放不下时按 {@link GAP_RELAX_STEPS} 放宽。
 */
export function placeHangouts(options: PlaceHangoutsOptions): Vec2[] {
  const { bounds, count } = options
  const blocked = options.blocked ?? []
  const minGap = options.minGap !== undefined && options.minGap > 0 ? options.minGap : DEFAULT_MIN_GAP
  if (count <= 0) return []

  // 候选点：先按目标间距铺；点太多（大地块 + 小间距）或太少（小地块）时换个间距重来。
  let all: Vec2[] = []
  for (const factor of [0.5, 0.25, 0.125, 0.0625]) {
    all = latticeCandidates(bounds, Math.max(0.05, minGap * factor))
    if (all.length >= count) break
  }

  const safe = rankByClearance(
    all.filter((point) => clearanceOf(point, blocked) >= 0),
    blocked,
  ).map((entry) => entry.point)

  // ① 家具约束硬性成立的前提下，逐个放弃人际间距。
  for (const factor of GAP_RELAX_STEPS) {
    const picked = spread(safe, count, minGap * factor)
    if (picked !== null) return picked
  }

  // ② 退化：连"零间距"都放不下 count 个安全点 → 整块地基本被家具占了。
  //    这时**只从"余量最好的那一档"里挑**（第 count 名的余量作为下限），再在其中尽量散开：
  //    先按余量挑、再谈间距。**不能**在这张排序表上直接"最远点采样"——
  //    那样第二个点会因为"离第一个点最远"而跳到场地另一头，很可能正落在家具里
  //    （这是本函数第一版真的写错过的地方，见 test/hangouts.test.js 的病态用例）。
  const ranked = rankByClearance(all, blocked)
  const floorEntry = ranked[Math.min(count, ranked.length) - 1]
  const best = floorEntry === undefined ? ranked : ranked.filter((entry) => entry.clearance >= floorEntry.clearance)
  return spread(best.map((entry) => entry.point), count, 0) ?? best.slice(0, count).map((entry) => entry.point)
}

/**
 * 待命角色该待在哪个地块：优先 `commons`（广场）——它本来就是"没活在干的人待的地方"；
 * 没有广场就退到最大的地块，再没有就退回原点附近的一小块。
 *
 * 退回而不是报错，是因为"这个场景没有广场"是合法的（一个纯机房的场景）。
 */
export function hangoutArea(districts: readonly District[]): Bounds {
  const commons = districts.find((d) => d.kind === 'commons')
  if (commons !== undefined) return commons.bounds
  const biggest = [...districts]
    .sort(
      (a, b) =>
        Math.abs(b.bounds.max.x - b.bounds.min.x) * Math.abs(b.bounds.max.z - b.bounds.min.z) -
        Math.abs(a.bounds.max.x - a.bounds.min.x) * Math.abs(a.bounds.max.z - a.bounds.min.z),
    )[0]
  return biggest?.bounds ?? { min: { x: -2, z: -2 }, max: { x: 2, z: 2 } }
}

/**
 * **装配层唯一该调用的那个**：给一组地块 + 一组站点，算待命落点。
 *
 * 存在的理由是"不许有两份"：建世界（`create.ts`）与读档重算（`reconcile.ts`）
 * 都要算落点，而两份实现一定会在某次改动里漂移——那时的症状是
 * "新开一局站位对、读旧档站位错"，且只在旧档上复现（正是 R47/R48 那个坑的形状）。
 * 所以半径怎么来、用哪块地、间距多少，全部收在这一个函数里。
 */
export function hangoutsForWorld(
  districts: readonly District[],
  stations: readonly Station[],
  count: number,
  minGap: number = DEFAULT_MIN_GAP,
): Vec2[] {
  // ⚠️ **`blocked` 的顺序也必须确定**：`rankByClearance` 在余量相等时按候选序号 tie-break，
  // 而候选点的余量取决于最近的家具——家具表的顺序一变，同分项的次序就变，落点跟着变。
  // 第一版只按 id 排了分区、没排站点，`reconcile.test.js` 仍然抓到落点差一个象限。
  const blocked = [...stations]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((station) => ({
      at: station.anchor,
      radius: stationClearance(station.kind),
    }))

  // ── R62：**按房间分配**，而不是全塞进一块地 ────────────────────────────────
  //
  // 原来的做法是 `placeHangouts({ bounds: hangoutArea(districts), ... })`，
  // 而 `hangoutArea` 取的是"第一个 commons 分区"。在只有一个公共区的 16×16 小镇里这没问题；
  // 换成**原版办公室的 9 个房间**之后，"第一个 commons" 是健身房——
  // 于是 8 个人**全站在健身房里**（真机实测，一格不差）。
  //
  // 而且把全世界的包围盒当候选区还有个更糟的后果：**房间里是有墙的**，
  // 而 `blocked` 只知道家具、不知道墙，所以人会落进墙里。
  // 按房间分配同时解决这两件事：人一定在某个房间内部。
  //
  // 份额按房间面积分（大房间多站几个人），用最大余数法保证**总和恰好等于 count**
  //（用四舍五入会多一个或少一个）。同样确定性：无 `Math.random()`、无 `Date.now()`。
  if (districts.length === 0 || count <= 0) return []
  // ⚠️ **按 id 排序**再分名额，不依赖调用方给的顺序。
  // 第一版直接用传入顺序，而 `createWorld` 与 `reconcileWorld` 产出的分区顺序不一定相同
  //（reconcile 会把"场景里没有的旧分区"追加在后面）→ 两条路径算出的落点不一样，
  // `reconcile.test.js` 当场抓到（小绿的落点 (6.4,-6.4) vs (-6.4,6.4)）。
  // 排序之后"同内容必同落点"不再取决于谁调用。
  const ordered = [...districts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const area = (d: District): number =>
    Math.max(0.0001, (d.bounds.max.x - d.bounds.min.x) * (d.bounds.max.z - d.bounds.min.z))
  const total = ordered.reduce((sum, d) => sum + area(d), 0)
  const exact = ordered.map((d) => (count * area(d)) / total)
  const quota = exact.map((v) => Math.floor(v))
  let left = count - quota.reduce((a, b) => a + b, 0)
  // `noUncheckedIndexedAccess` 下 `exact[i]` / `quota[i]` 是 `number | undefined`——
  // 索引进安全数组也要显式兜底，不能因为"我知道它在范围内"就省掉（tsc 会拦，而且拦得对）。
  const at = (arr: readonly number[], i: number): number => arr[i] ?? 0
  const order = ordered
    .map((_, i) => i)
    .sort((a, b) => (at(exact, b) - at(quota, b)) - (at(exact, a) - at(quota, a)) || a - b)
  for (const i of order) {
    if (left <= 0) break
    quota[i] = (quota[i] ?? 0) + 1
    left -= 1
  }

  const out: Vec2[] = []
  for (let i = 0; i < ordered.length; i++) {
    const n = quota[i] ?? 0
    if (n <= 0) continue
    const d = ordered[i]
    if (d === undefined) continue
    out.push(...placeHangouts({ bounds: d.bounds, count: n, blocked, minGap }))
  }
  // 万一某些房间一个点都放不下（被家具占满），补足总数——宁可挤，也不能让
  // 调用方 `hangouts[i % length]` 把两个人分到同一格（那是更糟的画面）。
  if (out.length < count) {
    const fallback = placeHangouts({ bounds: hangoutArea(districts), count, blocked, minGap })
    for (const p of fallback) {
      if (out.length >= count) break
      out.push(p)
    }
  }
  return out.slice(0, Math.max(count, out.length))
}
