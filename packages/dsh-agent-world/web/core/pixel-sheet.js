/*
 * 像素图集的切法与选帧（R51 / M12-3）—— **纯函数，不碰 canvas**。
 *
 * 契约在 `src/protocol/scene.ts` 的 `SceneSheetSpec`：
 *
 *     { cellW, cellH, rowsPerFigure, anchor: 'bottom'|'center',
 *       animations: { 'walk.down': { col, row, frames, frameMs, layout, mirror } } }
 *
 * 三条容易搞错的，都在这里钉住：
 *
 * 1. **`row` 是"带"号**，不是像素行号。一条带高 `rowsPerFigure 格`，
 *    所以像素 y = `row * rowsPerFigure * cellH`。（写"像素行"的那版会把 18×36 的人
 *    切成一堆 18×18 的碎片。）
 * 2. 动画名是**点分**的 `动作.方向`；方向可缺省（`walk` 表示不分方向）。
 *    取名字要有一条**确定性的回退链**：没有 `walk.left` 就用 `walk`，再不行用 `idle`——
 *    而不是"没找到就什么都不画"。
 * 3. `mirror` 是**水平翻转**：朝右的图翻过来当朝左用（省一半图）。
 */

/** 四向的**固定顺序**（写死是为了"同一输入同输出"：回退链的第一项要确定）。 */
export const FOUR_DIRECTIONS = ['down', 'left', 'right', 'up']

/**
 * `facing`（弧度）量化成四向。
 *
 * 世界的角是 `angleTo = atan2(Δz, Δx)`（见 `src/domain/geometry.ts`），而屏幕的 **+z 朝下**：
 * · `0` → 东（右）· `π/2` → 南（下）· `π` → 西（左）· `-π/2` → 北（上）
 *
 * 对角线按"**横竖谁占优**"判；**正好 45° 的两可情形约定归竖向**（`TIE_EPS`）。
 * 为什么不写"平手归横向"：`cos(-3π/4)` 与 `sin(-3π/4)` 在浮点里差最后一位，
 * 于是"谁占优"变成了浮点数的运气——同一句 `facing` 在不同机器上可能给出不同方向。
 * 给竖向加一个极小的偏置，两可情形就永远落到同一侧（人物朝向本来就是两可的）。
 */
const TIE_EPS = 1e-9

export function directionOf(facing) {
  const radians = Number.isFinite(facing) ? facing : 0
  const dx = Math.abs(Math.cos(radians))
  const dz = Math.abs(Math.sin(radians)) + TIE_EPS
  if (dx > dz) return Math.cos(radians) >= 0 ? 'right' : 'left'
  return Math.sin(radians) >= 0 ? 'down' : 'up'
}

/** 角色状态 → 动作名。走 = `walk`，其余（idle/working/blocked…）都当站着。 */
export function actionOf(agentState) {
  return agentState === 'walking' ? 'walk' : 'idle'
}

/**
 * 按状态与方向挑一条动画，返回 `{name, anim}`；一条都没有返回 null。
 *
 * 回退链（**顺序写死 = 确定**）：
 *   `动作.方向` → `动作` → `idle.方向` → `idle` → 图集里第一条（按名字排序）
 * 最后那条是"有这个图集但名字对不上"的兜底：**画点什么**比空白好，
 * 而且 `pickAnimation` 会把选中的名字带出去，出了问题一眼看得出用的是哪条。
 */
export function pickAnimation(sheet, { state, direction } = {}) {
  const animations = sheet?.animations ?? {}
  const names = Object.keys(animations)
  if (names.length === 0) return null
  const action = actionOf(state)
  const dir = FOUR_DIRECTIONS.includes(direction) ? direction : null
  const candidates = [dir === null ? null : `${action}.${dir}`, action, dir === null ? null : `idle.${dir}`, 'idle', ...[...names].sort()]
  for (const name of candidates) {
    if (name === null) continue
    const anim = animations[name]
    if (anim !== undefined) return { name, anim }
  }
  return null
}

/** 按 `frameMs` 推进到第几帧（`elapsedMs` 由调用方给：这个函数**不认识时钟**）。 */
export function frameIndex(anim, elapsedMs) {
  const frames = Math.max(1, Math.floor(Number(anim?.frames) || 1))
  const frameMs = Number(anim?.frameMs) || 0
  if (frames <= 1 || frameMs <= 0) return 0
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  return Math.floor(elapsed / frameMs) % frames
}

/**
 * 一帧在**源图**里的矩形（像素盒）。
 *
 * `layout: 'row'` → 帧沿 col 方向排（`col + 帧号`）；`'column'` → 沿 row 方向排
 * （`row + 帧号`）。注意 `column` 布局下"带号"的含义会变成**逐格**，
 * 所以这里对 column 布局用的是"一格一条带"的读法（`row + i` 直接当带号），
 * 这与内容里的声明一致：column 布局本来就是给"每帧占一条带"的图准备的。
 */
export function frameRect(sheet, anim, index = 0) {
  const cellW = Math.max(1, Math.floor(Number(sheet?.cellW) || 1))
  const cellH = Math.max(1, Math.floor(Number(sheet?.cellH) || 1))
  const perBand = Math.max(1, Math.floor(Number(sheet?.rowsPerFigure) || 1))
  const frames = Math.max(1, Math.floor(Number(anim?.frames) || 1))
  const i = Math.min(Math.max(0, Math.floor(index)), frames - 1)
  const columnLayout = anim?.layout === 'column'
  const col = columnLayout ? Number(anim?.col) || 0 : (Number(anim?.col) || 0) + i
  const row = columnLayout ? (Number(anim?.row) || 0) + i : Number(anim?.row) || 0
  return { sx: col * cellW, sy: row * perBand * cellH, sw: cellW, sh: cellH * perBand }
}

/**
 * 最近的**整数**缩放倍数。
 *
 * 为什么不许小数：像素画一个源像素画成 2.5 个屏幕像素，就会出现"有的像素 2 格宽、有的 3 格宽"，
 * 整张图像素大小不一（比模糊更难看，也更难改回来）。
 *
 * @param {{viewWidth: number, viewHeight: number, worldPixelsW: number, worldPixelsH: number, fit?: number}} input
 */
export function integerZoom(input = {}) {
  const { viewWidth = 0, viewHeight = 0, worldPixelsW = 1, worldPixelsH = 1 } = input
  const fit = Number.isFinite(input.fit) && input.fit > 0 ? input.fit : 1
  const maxZoom = Number.isFinite(input.maxZoom) ? Math.max(1, Math.floor(input.maxZoom)) : 8
  const raw = Math.min(viewWidth / Math.max(1, worldPixelsW * fit), viewHeight / Math.max(1, worldPixelsH * fit))
  if (!Number.isFinite(raw)) return 1
  return Math.min(maxZoom, Math.max(1, Math.floor(raw)))
}

/**
 * 精灵的屏幕盒：`anchor` 决定"图贴哪"。
 *
 * · `bottom`（人、家具）：**底边中点**对准 (cx, groundY)
 * · `center`（地砖）：图心对准格心
 */
export function spriteBox(sheet, frame, { cx, groundY, scale }) {
  const w = frame.sw * scale
  const h = frame.sh * scale
  if (sheet?.anchor === 'center') return { x: cx - w / 2, y: groundY - h / 2, w, h }
  return { x: cx - w / 2, y: groundY - h, w, h }
}
