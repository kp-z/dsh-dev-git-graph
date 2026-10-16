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
  const channel = (tile, base) => Math.min(255, Math.max(0, Math.round((tile * base) / 255)))
  return [channel(tileRgb[0], color[0]), channel(tileRgb[1], color[1]), channel(tileRgb[2], color[2])]
}

/** `[r,g,b]` → `#rrggbb`（核验/日志用）。 */
export function rgbToHexString(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return null
  return `#${rgb.slice(0, 3).map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}
