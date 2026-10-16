/**
 * **绕障寻路**（R64 物理）—— 薄适配层，算法用 vendored 的 **EasyStar.js**。
 *
 * ## 为什么不自己写 A*
 *
 * 我第一版手搓了一个 A*，被用户当场指出来："**物理引擎应该是现成的吧，不要自己搞一个
 * 物理碰撞引擎**"。这与 D53（"少自己创建引擎，用成熟的方案"）是同一条。
 * 判断标准还是那句：**"这东西我换个游戏项目会重写吗？"**——会，那就该用现成的。
 *
 * 现在用 `src/vendor/easystar/easystar.cjs`（MIT，0.4.4，2012 年起的老牌格子寻路库）。
 * 本文件只做三件事：**形状换算、参数固定、异步回调收成同步**。
 *
 * ## 它取代的是什么
 *
 * R63 真机实测：阿金从 `(-1.14, 4.10)` 走到 `(-32.00, -16.50)`，中间采样
 * `-6.13 / -11.12 / -16.06 / -21.05 / -26.04 / -31.03`——**严格等距**，
 * 也就是 `agent.path` 只有终点一个点，`movement.ts` 每 tick 朝它直线挪一步 → **穿墙**。
 * `movement.ts` 的注释早就写了"做出真正的绕障路径时，这里的循环逻辑不用改"——
 * 现在返回的是一串途经点，移动逻辑照旧逐个 shift。
 *
 * ## 碰撞数据是现成的
 *
 * 不猜"哪张图看着像墙"：原版 Godot 场景里每个图块挂不挂 `physics_layer_0/polygon_0`
 * 就是权威答案（见 `scripts/convert-microverse-map.mjs`）。走路绕的是**原版的物理形状**。
 *
 * ## 确定性
 *
 * 不许 `Math.random()`、不许 `Date.now()`（模拟内核硬要求）。EasyStar 的堆序由插入顺序
 * 决定，同输入必同输出；而且它的"分帧计算"我们一次 `calculate()` 跑完，不掺时间。
 */
import type { NavGrid, Vec2 } from '../domain/types.js'
import EasyStar from '../vendor/easystar/index.mjs'

/**
 * EasyStar 实例的形状（垫片导出的是上游那个 `js` 类）。
 *
 * 手写这份而不是用上游的 `index.d.ts`：上游 d.ts 描述的是**异步**用法
 * （回调 + `calculate()`），而我们走 `enableSync()` 的同步形态；
 * 直接照抄会在"回调什么时候被调用"这件事上给出错误的类型保证。
 */
interface EasyStarInstance {
  setGrid(grid: number[][]): void
  setAcceptableTiles(tiles: number[]): void
  enableDiagonals(): void
  disableCornerCutting(): void
  enableSync(): void
  findPath(sx: number, sy: number, ex: number, ey: number, cb: (path: Array<{ x: number; y: number }> | null) => void): void
  calculate(): void
}

/** 一格的网格坐标。 *//** 一格的网格坐标。 */
interface Cell {
  readonly col: number
  readonly row: number
}

/** 把世界坐标换成网格坐标（格中心最近的一格）。 */
export function cellOf(nav: NavGrid, p: Vec2): Cell {
  return {
    col: Math.round((p.x - nav.originX) / nav.unitsPerCell - 0.5),
    row: Math.round((p.z - nav.originZ) / nav.unitsPerCell - 0.5),
  }
}

/** 一格中心的世界坐标。 */
export function centerOf(nav: NavGrid, cell: Cell): Vec2 {
  return {
    x: nav.originX + (cell.col + 0.5) * nav.unitsPerCell,
    z: nav.originZ + (cell.row + 0.5) * nav.unitsPerCell,
  }
}

/** 这一格能站吗？越界一律当成走不了。 */
export function isWalkable(nav: NavGrid, cell: Cell): boolean {
  if (cell.col < 0 || cell.col >= nav.width || cell.row < 0 || cell.row >= nav.height) return false
  return nav.blocked[cell.row * nav.width + cell.col] !== true
}

// ── 网格缓存 ────────────────────────────────────────────────────────────────
//
// `setGrid` 要把整张 `blocked` 翻成 EasyStar 的 0/1 二维数组，77×777 格每 tick 建一次
// 就是白烧 CPU（角色一多、tick 一密就看得出来）。缓存按**内容指纹**失效：
// 长度 + 前若干格的哈希——不用深比较整张表，也不用担心"换了地图还拿旧网格"。

let cachedKey = ''
let cachedGrid: number[][] | null = null

function gridKey(nav: NavGrid): string {
  let h = 2166136261
  for (let i = 0; i < nav.blocked.length; i++) {
    h ^= nav.blocked[i] === true ? 1 : 0
    h = Math.imul(h, 16777619)
  }
  return `${nav.width}x${nav.height}:${h >>> 0}`
}

function gridOf(nav: NavGrid): number[][] {
  const key = gridKey(nav)
  if (cachedGrid !== null && cachedKey === key) return cachedGrid
  const grid: number[][] = []
  for (let r = 0; r < nav.height; r++) {
    const row: number[] = []
    for (let c = 0; c < nav.width; c++) row.push(nav.blocked[r * nav.width + c] === true ? 1 : 0)
    grid.push(row)
  }
  cachedKey = key
  cachedGrid = grid
  return grid
}

/** 从 `cell` 出发按环形扩散找最近的可行走格（确定性：按格子序号取最小）。 */
function nearestWalkable(nav: NavGrid, cell: Cell): Cell | null {
  if (isWalkable(nav, cell)) return cell
  const maxR = Math.max(nav.width, nav.height)
  for (let radius = 1; radius < maxR; radius++) {
    let best: Cell | null = null
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
        const c: Cell = { col: cell.col + dc, row: cell.row + dr }
        if (!isWalkable(nav, c)) continue
        if (best === null || c.row * nav.width + c.col < best.row * nav.width + best.col) best = c
      }
    }
    if (best !== null) return best
  }
  return null
}

/**
 * 找一条从 `from` 到 `to` 的可行走路径（**不含起点，含终点**）。
 *
 * - 终点不可走（家具上方/墙里）时**退化到最近的可走格**——"走不到"不该让角色卡死，
 *   那比走近一点更糟（而且 `working` 需要他真的到岗）。
 * - `nav === null`（这一局没有地图）返回 `[to]`：**退回 R63 的老行为**。
 * - 真的无路可走时也返回 `[to]`，**不返回空数组**——空路径会让角色永远停在原地、
 *   而工单板说他在去工位的路上（画面与数据打架）。
 */
export function findPath(nav: NavGrid | null, from: Vec2, to: Vec2): Vec2[] {
  if (nav === null) return [to]

  const start = cellOf(nav, from)
  let goal = cellOf(nav, to)
  if (!isWalkable(nav, goal)) {
    const near = nearestWalkable(nav, goal)
    if (near === null) return [to]
    goal = near
  }
  const fromCell = isWalkable(nav, start) ? start : (nearestWalkable(nav, start) ?? start)
  if (fromCell.col === goal.col && fromCell.row === goal.row) return [to]

  const es = new EasyStar.js() as EasyStarInstance
  es.setGrid(gridOf(nav))
  // EasyStar 的约定：**在 acceptable 列表里的才是能走的**，所以我们传 [0]（可走）。
  es.setAcceptableTiles([0])
  // 八方向 + **禁止切墙角**：对角移动要求两侧正交都可走。
  // 不关的话角色会从两面墙的夹角里"切"过去，视觉上是半个身子穿墙——
  // 这是俯视格子游戏里最常见的那个疏漏。
  es.enableDiagonals()
  es.disableCornerCutting()

  // ⚠️ **必须 `enableSync()`，否则回调永远读不到结果。**
  //
  // EasyStar 的 `findPath` 是异步队列（上游为"分帧算、不卡渲染帧"设计的）：
  // 它把请求排进队列、返回一个 instanceId，要 `calculate()` 才真正算。
  // 而在**默认（异步）模式**下，它的回调外面包了一层 `setTimeout`：
  //
  // ```js
  // var callbackWrapper = function(result) {
  //     if (syncEnabled) { callback(result) }
  //     else { setTimeout(function() { callback(result) }, 0) }   // ← 就是这里
  // }
  // ```
  //
  // 所以"`findPath` 之后紧接着 `calculate()`、然后读回调结果"拿到的是 **null**——
  // 回调还在下一个宏任务里排队。（我第一版就是这样，路径悄悄退回成 `[to]` 直线，
  // 也就是**穿墙照旧**，而且不报错。这类"降级路径看起来正常"的错误最难发现。）
  es.enableSync()
  let result: Array<{ x: number; y: number }> | null = null
  es.findPath(fromCell.col, fromCell.row, goal.col, goal.row, (path) => { result = path })
  // 同步模式下 `calculate()` 里就把回调调完了。
  es.calculate()

  const points = (result as Array<{ x: number; y: number }> | null)
  if (points === null || points.length === 0) return [to]

  // 去掉起点（角色已经在那一格），其余换成世界坐标。
  const out = points.slice(1).map((c) => centerOf(nav, { col: c.x, row: c.y }))
  // 最后一个点用**真实目标**而不是格中心：到站判定按座位坐标算，
  // 换成格中心会让"到站"永远差半个格。
  if (out.length > 0) out[out.length - 1] = to
  else out.push(to)
  return out
}
