/*
 * 地面平铺（R55 / M13-3）—— **纯函数，不碰 canvas**。
 *
 * ── 这件事为什么值得单独一块 ──────────────────────────────────────────────────
 *
 * 地砖是 32×32 源像素，而世界的换算里 **1 单位 = 16 源像素**，所以**一格地板 = 2×2 世界单位**。
 * 于是"平铺"不是"从这一区的左上角开始贴"——那样四个区各自从自己的角起算，
 * 相邻两区的花纹相位就会错开半格，接缝处会出现一条明显的缝（比色差显眼得多）。
 *
 * 正确做法：**相位对齐到世界格**（第一个砖的起点向下取整到 tileUnits 的整数倍），
 * 于是四个区共用同一套网格，跨区也对得上。区边界上多出来的那一部分砖**裁掉**——
 * 裁在源图侧（`sx/sy` 偏移 + 缩小 `sw/sh`），而不是先画出去再靠容器裁：
 * 后者在子画布上看起来是对的，但一旦有人改了画布尺寸，缝就会出现在别处。
 *
 * ── 一条算术（渲染层用 GPU 做，这里用来核验）─────────────────────────────────
 *
 * 染色是 `multiply`：`结果 = round(砖色 × 区色 / 255)`。地砖是浅色（`rgb(184,194,212)`），
 * 乘上深区色得到深色调——**图给纹理、色给色调**。这条算术在这里也实现一份，
 * 好让测试与汇报能直接算出"四个区实际是什么颜色"，而不是只能靠肉眼看截图。
 */

/** 一格的边长（源像素）缺省值；实际值从契约的 `sheet.cellW` 来。 */
export const DEFAULT_TILE_PX = 32

function clampInt(value, low, high) {
  return Math.min(Math.max(Math.round(value), low), high)
}

/**
 * 一区的平铺计划（**区局部坐标**，供渲染层画进一块区大小的子画布）。
 *
 * @param {object} input
 * @param {{x: number, z: number, width: number, depth: number}} input.district
 * @param {number} input.half - 世界半径（半边长，单位）
 * @param {number} input.unitPx - 一个世界单位多少源像素（本项目 = 16）
 * @param {number} [input.tilePx] - 一格地砖的源像素边长（= `sheet.cellW`）
 * @param {number} [input.tilePy] - 一格地砖的源像素高度（= `sheet.cellH`；默认同宽）
 * @param {{col?: number, row?: number, frames?: number}} [input.cell] - 图集里用哪一格
 * @returns {{width: number, height: number, tileUnits: number, placements: ReadonlyArray<{dx: number, dy: number, sx: number, sy: number, sw: number, sh: number}>}}
 */
export function planGroundTiles(input = {}) {
  const district = input.district ?? { x: 0, z: 0, width: 0, depth: 0 }
  const unitPx = Number.isFinite(input.unitPx) && input.unitPx > 0 ? input.unitPx : 16
  const tilePx = Number.isFinite(input.tilePx) && input.tilePx > 0 ? Math.round(input.tilePx) : DEFAULT_TILE_PX
  const tilePy = Number.isFinite(input.tilePy) && input.tilePy > 0 ? Math.round(input.tilePy) : tilePx
  const cell = input.cell ?? {}
  const col = Number.isFinite(cell.col) ? Math.round(cell.col) : 0
  const row = Number.isFinite(cell.row) ? Math.round(cell.row) : 0

  const width = Math.max(0, Math.round((Number(district.width) || 0) * unitPx))
  const height = Math.max(0, Math.round((Number(district.depth) || 0) * unitPx))
  const tileUnitsX = tilePx / unitPx
  const tileUnitsZ = tilePy / unitPx

  const leftWorld = (Number(district.x) || 0) - (Number(district.width) || 0) / 2
  const topWorld = (Number(district.z) || 0) - (Number(district.depth) || 0) / 2
  // **相位对齐到世界格**：起点向下取整到整格（分区起点不是整格时，第一块砖要裁）。
  const startWorldX = Math.floor(leftWorld / tileUnitsX) * tileUnitsX
  const startWorldZ = Math.floor(topWorld / tileUnitsZ) * tileUnitsZ

  const placements = []
  for (let worldZ = startWorldZ; (worldZ - topWorld) * unitPx < height; worldZ += tileUnitsZ) {
    for (let worldX = startWorldX; (worldX - leftWorld) * unitPx < width; worldX += tileUnitsX) {
      // 目标位置（区局部像素，可为负 = 这块砖有一部分在区外）
      const dxFull = Math.round((worldX - leftWorld) * unitPx)
      const dyFull = Math.round((worldZ - topWorld) * unitPx)
      // 与区矩形求交 → 只画交集那部分，并在源图上做同样的裁剪。
      const left = Math.max(0, dxFull)
      const top = Math.max(0, dyFull)
      const right = Math.min(width, dxFull + tilePx)
      const bottom = Math.min(height, dyFull + tilePy)
      if (right <= left || bottom <= top) continue
      const cutLeft = left - dxFull
      const cutTop = top - dyFull
      placements.push({
        dx: left,
        dy: top,
        sx: col * tilePx + cutLeft,
        sy: row * tilePy + cutTop,
        sw: right - left,
        sh: bottom - top,
      })
    }
  }
  return { width, height, tileUnits: tileUnitsX, placements }
}

/** `#rrggbb` → `[r,g,b]`（认不出返回 null）。 */
export function parseRgb(hex) {
  if (typeof hex !== 'string') return null
  const text = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return null
  return [Number.parseInt(text.slice(0, 2), 16), Number.parseInt(text.slice(2, 4), 16), Number.parseInt(text.slice(4, 6), 16)]
}

/**
 * `multiply` 的算术版本：`round(砖色 × 区色 / 255)`。
 *
 * 渲染层用的是 `globalCompositeOperation = 'multiply'`（同一条公式，在 GPU 上做），
 * 这里这一份是给测试与汇报用的：**"四个区实际是什么颜色"要能算出来**，
 * 不然就只能盯着截图说"好像不一样"。
 */
export function tintRgb(tileRgb, districtHex) {
  const color = parseRgb(districtHex)
  if (color === null || !Array.isArray(tileRgb) || tileRgb.length < 3) return null
  return [
    clampInt((tileRgb[0] * color[0]) / 255, 0, 255),
    clampInt((tileRgb[1] * color[1]) / 255, 0, 255),
    clampInt((tileRgb[2] * color[2]) / 255, 0, 255),
  ]
}

/** `[r,g,b]` → `#rrggbb`（核验/日志用）。 */
export function rgbToHexString(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return null
  return `#${rgb.slice(0, 3).map((v) => clampInt(v, 0, 255).toString(16).padStart(2, '0')).join('')}`
}
