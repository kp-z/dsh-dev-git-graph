/*
 * 角色重上色（R51 / M12-3）—— **纯函数，不碰 canvas**。
 *
 * ── 要解决什么 ──────────────────────────────────────────────────────────────
 *
 * 库里的人物图是**裸模**（`base_male.png` / `base_female.png`，18×18 格、两条带一格）：
 * 整个身体只用 **3 个主色**画完——`#FFE6E2`（皮肤/浅）、`#D6A1B2`（中间调）、`#996B88`（深色），
 * 另外还有 4 个**各占 28 像素**的细节色（眼睛、鞋、工具那种点缀）。
 *
 * 与其为 8 个角色生成 8 份图，不如**按角色的配色把那 3 个主色换掉**：
 * 一次离屏重绘（缓存），之后每帧只是 drawImage。这就是这一块存在的理由。
 *
 * ── 三条规矩 ────────────────────────────────────────────────────────────────
 *
 * 1. **只动那 3 个主色**。细节色一律**原样保留**——把眼睛/工具色一起换掉，
 *    人物的"表情"就没了（而且 28 像素的小色块换色后往往和主色糊在一起）。
 * 2. **色彩阶梯是量出来的**，不是拍脑袋：源图三个主色的 HSL 明度是
 *    `0.941 / 0.734 / 0.514`，也就是"中间调 +0.21 / -0.22"。所以给任意 `baseColorHex`
 *    都按这个比例生成浅/中/深三级，**保持色相与饱和度**、只动明度。
 * 3. **阶梯必须单调**（浅 > 中 > 深，且至少差 `MIN_STEP`）：否则贴到纯白/纯黑时
 *    三级会挤成一色，人物就成了一坨。这条有测试。
 */

/** 源图三个主色的明度（从 `base_male.png` 的调色板量出来的，写在这里当**依据**）。 */
export const BASE_SKIN = { light: '#FFE6E2', mid: '#D6A1B2', dark: '#996B88' }

/** 中间调 → 浅 / 深 的明度差（照源图量出来的比例）。 */
export const LIGHT_DELTA = 0.21
export const DARK_DELTA = -0.22

/** 三级之间至少差这么多明度，保证贴到纯白/纯黑时也不会挤成一色。 */
export const MIN_STEP = 0.05

/** 主色只取前 3 个：源图就是 3 主色 + N 细节色。 */
export const MAIN_COLOR_COUNT = 3

/**
 * 同一个配色被多个角色共用时，每个多用一份就在色相上错开这么多度（R51）。
 *
 * **这是渲染层的兜底，不是正解**：`SceneActor.color` 现在按**职业**给色，于是 3 个工程师
 * 拿到同一个 `#38BDF8`，8 个人里有 3 个一模一样。协议/内容给每个角色一个色才是正解
 * （那要改 `src/**`，不在本任务范围）；在这一层按 id 稳定地错开，至少让用户能分辨。
 * `variant: 0`（第一个用这个色的角色）**完全不动**配色——兜底不该改掉内容给的原色。
 */
export const VARIANT_HUE_STEP = 14

function clamp(value, low, high) {
  if (!Number.isFinite(value)) return low
  return Math.min(Math.max(value, low), high)
}

/** `#rgb` / `#rrggbb` → `{r,g,b}`（0-255）。认不出返回 null。 */
export function parseHex(hex) {
  if (typeof hex !== 'string') return null
  const text = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(text)) return null
  const full = text.length === 3 ? text.split('').map((c) => c + c).join('') : text
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

/** `{r,g,b}` → `#rrggbb`（小写，稳定输出——map 的键要能对得上）。 */
export function rgbToHex(rgb) {
  const part = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`
}

/** `#rrggbb` → `{h,s,l}`（h 0-360，s/l 0-1）。 */
export function hexToHsl(hex) {
  const rgb = parseHex(hex)
  if (rgb === null) return null
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s, l }
}

/** `{h,s,l}` → `#rrggbb`。 */
export function hslToHex(hsl) {
  const h = ((hsl.h % 360) + 360) % 360 / 360
  const s = clamp(hsl.s, 0, 1)
  const l = clamp(hsl.l, 0, 1)
  if (s === 0) {
    const v = Math.round(l * 255)
    return rgbToHex({ r: v, g: v, b: v })
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return rgbToHex({ r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 })
}

/**
 * 从 `baseColorHex` 推一条三级明度阶梯：`[浅, 中, 深]`。
 *
 * **只动明度**（色相与饱和度保留），并且保证严格单调（见 `MIN_STEP`）。
 * 认不出的色值返回 null——调用方据此**退回不重上色**，而不是画一片黑。
 */
export function lightnessLadder(baseColorHex, options = {}) {
  const hsl = hexToHsl(baseColorHex)
  if (hsl === null) return null
  // 撞色兜底：只在同一配色的第 2、3… 个角色上错开色相（第一个保持原色）。
  const variant = Number.isFinite(options.variant) ? Math.max(0, Math.floor(options.variant)) : 0
  if (variant > 0) hsl.h += variant * VARIANT_HUE_STEP
  const light = clamp(hsl.l + LIGHT_DELTA, 0, 1)
  const dark = clamp(hsl.l + DARK_DELTA, 0, 1)
  // 中间调夹在两级之间，且与两边各留 MIN_STEP：贴顶/贴底时也能给出三级。
  const mid = clamp(hsl.l, dark + MIN_STEP, light - MIN_STEP)
  const withHue = (l) => hslToHex({ h: hsl.h, s: hsl.s, l })
  return [withHue(light), withHue(mid), withHue(dark)]
}

/**
 * 谁该用第几号变体：**同一配色的角色**按 id 排序依次拿 0、1、2…
 *
 * 两个地方都要用它（画布上的精灵、花名册上的色点），各算一份的话两边会错开——
 * 而"花名册上的小蓝和地图上的小蓝不是一个颜色"这种错，用户第一眼就会看到。
 *
 * @param {ReadonlyArray<{id: string, color?: string}>} actors
 * @returns {Map<string, number>} actorId → variant
 */
export function assignColorVariants(actors) {
  const seen = new Map()
  const out = new Map()
  const sorted = [...(Array.isArray(actors) ? actors : [])].filter((a) => a !== null && typeof a?.id === 'string')
  sorted.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const actor of sorted) {
    const key = typeof actor.color === 'string' ? actor.color.toLowerCase() : ''
    const index = seen.get(key) ?? 0
    seen.set(key, index + 1)
    out.set(actor.id, index)
  }
  return out
}

/**
 * 变体色：`variant 0` **原样返回内容给的色**，正数按 `VARIANT_HUE_STEP` 错开色相。
 *
 * 给 HTML（花名册的色点）用——画布那边走的是整张图重上色，但两边必须落在同一个色相上。
 */
export function variantColor(baseColorHex, variant = 0) {
  const parsed = parseHex(baseColorHex)
  if (parsed === null) return baseColorHex
  const index = Number.isFinite(variant) ? Math.max(0, Math.floor(variant)) : 0
  if (index === 0) return rgbToHex(parsed)
  const hsl = hexToHsl(rgbToHex(parsed))
  // 与 `lightnessLadder` 同一份阶梯：取中间调那一级（人眼最认得出的是它）。
  const ladder = lightnessLadder(rgbToHex(parsed), { variant: index })
  return ladder[1]
}

/** 调色板归一：字符串或 `{hex, count}` 都收，认不出的丢掉。 */
function normalizePalette(palette) {
  const out = []
  for (const entry of Array.isArray(palette) ? palette : []) {
    const hex = typeof entry === 'string' ? entry : entry?.hex
    const parsed = parseHex(hex)
    if (parsed === null) continue
    const normalized = rgbToHex(parsed)
    const count = Number.isFinite(entry?.count) ? entry.count : 0
    const existing = out.find((e) => e.hex === normalized)
    if (existing === undefined) out.push({ hex: normalized, count })
    else existing.count += count
  }
  return out
}

/**
 * 挑出 3 个主色，并**按明度从浅到深**排好。
 *
 * 优先用调用方显式给的 `options.main`（内容最清楚）；否则按**像素数**取前 3
 * （裸模的真实形状就是"3 个主色占绝大多数 + 4 个小色块各 28 像素"）。
 * 同票时按色值排序，保证同一份输入永远给同一份输出。
 */
function pickMainColors(entries, explicitMain) {
  const explicit = Array.isArray(explicitMain)
    ? explicitMain.map((hex) => parseHex(hex)).filter((rgb) => rgb !== null).map(rgbToHex)
    : []
  const candidates =
    explicit.length >= MAIN_COLOR_COUNT
      ? explicit.slice(0, MAIN_COLOR_COUNT)
      : [...entries]
          .sort((a, b) => (b.count === a.count ? (a.hex < b.hex ? -1 : 1) : b.count - a.count))
          .slice(0, MAIN_COLOR_COUNT)
          .map((e) => e.hex)
  const lightness = (hex) => hexToHsl(hex)?.l ?? 0
  return [...candidates].sort((a, b) => lightness(b) - lightness(a))
}

/**
 * 重上色计划：`源色 → 目标色`。
 *
 * **纯函数、确定性**：同一份调色板 + 同一个 base 色，永远给同一张表。
 * 不在主色里的（也就是细节色）**原样映射**——保留它们正是为了不把眼睛/工具一起换掉。
 *
 * @param {ReadonlyArray<string|{hex: string, count?: number}>} sourcePalette - 源图用到的色
 * @param {string} baseColorHex - 这个角色自己的配色（`SceneActor.color`）
 * @param {{main?: string[]}} [options] - 显式指定哪 3 个是主色（不常用，但内容可以钉死）
 * @returns {Record<string, string>} 键是**小写**源色，值是小写目标色
 */
export function recolorPlan(sourcePalette, baseColorHex, options = {}) {
  const entries = normalizePalette(sourcePalette)
  const plan = {}
  // 先把所有源色映射成自己：细节色走的就是这条路（**不是"漏掉"，是刻意的保留**）。
  for (const entry of entries) plan[entry.hex] = entry.hex
  const ladder = lightnessLadder(baseColorHex, options)
  if (ladder === null) return plan
  const mains = pickMainColors(entries, options.main)
  mains.forEach((hex, index) => {
    const target = ladder[index]
    if (target !== undefined) plan[hex] = target
  })
  return plan
}

/**
 * 一张图集里"用到了哪些色、各多少像素"——重上色的输入。
 *
 * 放在这里（而不是 loader）是因为它是**纯逻辑**：给 RGBA 数组就出结果，可以单测。
 */
export function paletteOfPixels(rgba, options = {}) {
  const counts = new Map()
  const alphaThreshold = Number.isFinite(options.alphaThreshold) ? options.alphaThreshold : 8
  const data = rgba ?? []
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < alphaThreshold) continue
    const hex = rgbToHex({ r: data[i], g: data[i + 1], b: data[i + 2] })
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => (b.count === a.count ? (a.hex < b.hex ? -1 : 1) : b.count - a.count))
}


/**
 * 角色该用**原图**还是**重上色图**（R160 真机回归）。
 *
 * `SceneSheetSpec.recolor` 的缺省是 **false**，含义是"别人画好的美术默认不动"——
 * 把已经画完的角色按角色色整张重染，会把头发/脸/衣服染成一色，看起来像一块**彩色的框**。
 * 所以只有内容**显式**声明 `recolor: true` 且重染成功时才用重染纹理；
 * 其余（包括 `false`、`undefined`、重染失败返回 null）一律回原图。
 *
 * @param {{baseKey: string|null, tintedKey: string|null, sheet: object|null|undefined}} input
 * @returns {string|null}
 */
export function actorTextureKey({ baseKey, tintedKey, sheet }) {
  if (sheet !== null && sheet !== undefined && sheet.recolor === true && typeof tintedKey === 'string' && tintedKey !== '') {
    return tintedKey
  }
  return baseKey ?? null
}
