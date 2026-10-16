/*
 * 精灵加载与重上色缓存（R51 / M12-3）。
 *
 * ── 三条纪律 ────────────────────────────────────────────────────────────────
 *
 * 1. **按 url 缓存 Image，绝不在每帧新建**（`new Image()` + `src` 会让浏览器每帧重发请求，
 *    也会让同一个角色闪一下）。同一个 url 只建一次，失败也记住（不反复重试 + 不白屏）。
 * 2. **重上色只做一次**：把图集画进离屏 canvas，按 `recolorPlan` 逐像素改一遍（用
 *    整数查表，比字符串比较快得多），然后缓存起来。之后每帧只是 `drawImage`。
 * 3. **认不出来就退回不重上色**（返回原图），而不是画一片黑。
 *
 * 这里**不做绘制**（绘制在 `scene2d.js`）：加载、调色板提取、重上色是"资源层"的事，
 * 画面怎么摆是"渲染层"的事。分开之后这一层可以被任何 2D 渲染器复用。
 */
import { paletteOfPixels, parseHex, recolorPlan } from '../core/pixel-recolor.js'

/** 重上色缓存的条数上限（8 个角色 × 2 个 base 图，给到 64 足够，且不会无限涨）。 */
const MAX_RECOLORED = 64

/**
 * @param {{document?: Document, baseUrl?: string, crossOrigin?: string}} [options]
 */
export function createSheetLoader(options = {}) {
  const doc = options.document ?? globalThis.document
  /** 图集根路径。默认走面板自己的 vendor 路由（`./vendor/` 与 importmap 里 three 的同源）。 */
  const baseUrl = options.baseUrl ?? './vendor/'
  /** url → { image, state } */
  const images = new Map()
  /** url → ReadonlyArray<{hex, count}> */
  const palettes = new Map()
  /** `${url}|${base}` → HTMLCanvasElement（重上色结果） */
  const recolored = new Map()

  function fullUrl(url) {
    if (typeof url !== 'string' || url === '') return null
    if (/^(https?:)?\/\//.test(url) || url.startsWith('/') || url.startsWith('.')) return url
    return `${baseUrl}${url}`
  }

  function entry(url) {
    const key = fullUrl(url)
    if (key === null) return null
    const existing = images.get(key)
    if (existing !== undefined) return existing
    if (doc === undefined || typeof doc.createElement !== 'function') return null
    const image = doc.createElement('img')
    // 同源资源不需要 crossOrigin；设了反而在某些服务端会失败。
    const record = { image, key, state: 'loading', palette: null }
    image.addEventListener('load', () => {
      record.state = image.naturalWidth > 0 ? 'ready' : 'failed'
    })
    image.addEventListener('error', () => {
      record.state = 'failed'
    })
    image.src = key
    images.set(key, record)
    return record
  }

  /** 已就绪的 `<img>`；还在加载或失败 → null（调用方据此退回色块）。 */
  function image(url) {
    const record = entry(url)
    if (record === null) return null
    return record.state === 'ready' ? record.image : null
  }

  /** 把一个已就绪的图集画进离屏 canvas，顺便把调色板量出来（每个 url 只做一次）。 */
  function sourceCanvas(url) {
    const record = entry(url)
    if (record === null || record.state !== 'ready') return null
    if (record.canvas !== undefined) return record.canvas
    const canvas = doc.createElement('canvas')
    canvas.width = record.image.naturalWidth
    canvas.height = record.image.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(record.image, 0, 0)
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      record.palette = paletteOfPixels(data)
    } catch {
      // 读不到像素（极少：跨源图）→ 不重上色，但仍能画。
      record.palette = []
    }
    record.canvas = canvas
    return canvas
  }

  /** 这个图集用到了哪些色（像素数从多到少）。没就绪返回空数组。 */
  function palette(url) {
    const record = entry(url)
    if (record === null) return []
    if (record.palette !== null) return record.palette
    sourceCanvas(url)
    return record.palette ?? []
  }

  /**
   * 按角色配色重上色后的图（缓存）。返回 `HTMLCanvasElement | null`。
   *
   * 没有图集 / 读不到像素 / `baseColorHex` 认不出 → 返回 null，调用方用原图。
   */
  function recoloredImage(url, baseColorHex, variant = 0) {
    const key = `${fullUrl(url)}|${baseColorHex ?? ''}|${variant}`
    if (recolored.has(key)) return recolored.get(key)
    const source = sourceCanvas(url)
    if (source === null || parseHex(baseColorHex) === null) {
      recolored.set(key, null)
      return null
    }
    const plan = recolorPlan(record2Palette(url), baseColorHex, { variant })
    const canvas = doc.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(source, 0, 0)
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data
      // 查表：RGB 打包成整数当键（比每像素拼十六进制字符串快两个数量级）。
      const lookup = new Map()
      for (const [from, to] of Object.entries(plan)) {
        const a = parseHex(from)
        const b = parseHex(to)
        if (a === null || b === null) continue
        lookup.set((a.r << 16) | (a.g << 8) | a.b, b)
      }
      for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] === 0) continue
        const target = lookup.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
        if (target === undefined) continue
        data[i] = target.r
        data[i + 1] = target.g
        data[i + 2] = target.b
      }
      ctx.putImageData(imageData, 0, 0)
    } catch {
      recolored.set(key, null)
      return null
    }
    if (recolored.size >= MAX_RECOLORED) {
      // 简单的 FIFO 淘汰：够用，且不会让缓存无限涨。
      const oldest = recolored.keys().next().value
      recolored.delete(oldest)
    }
    recolored.set(key, canvas)
    return canvas
  }

  function record2Palette(url) {
    const record = entry(url)
    if (record === null) return []
    if (record.palette === null) sourceCanvas(url)
    return record.palette ?? []
  }

  /**
   * 渲染层用的入口：拿到"该画的图" + "它是不是已经就绪"。
   *
   * `baseColorHex` 为 null/认不出时返回原图（**不重上色比画错色好**）。
   */
  function sprite(url, baseColorHex, variant = 0) {
    const original = image(url)
    if (original === null) return null
    const tinted = baseColorHex === null || baseColorHex === undefined ? null : recoloredImage(url, baseColorHex, variant)
    return { source: tinted ?? original, recolored: tinted !== null }
  }

  /** 载入状态（顶栏/诊断用）：一共几个 url、几个好了、几个失败。 */
  function status() {
    let ready = 0
    let failed = 0
    let loading = 0
    for (const record of images.values()) {
      if (record.state === 'ready') ready += 1
      else if (record.state === 'failed') failed += 1
      else loading += 1
    }
    return { total: images.size, ready, failed, loading, recolored: recolored.size }
  }

  return { image, sprite, palette, recoloredImage, status, fullUrl }
}
