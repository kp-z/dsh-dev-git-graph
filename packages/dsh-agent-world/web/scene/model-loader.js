/*
 * GLB 模型的异步加载与缓存（BACKLOG M5-1）。
 *
 * ══ 为什么单独一个文件 ════════════════════════════════════════════════════════
 *
 * 因为它是**第一个异步的东西**：在这之前，场景里的一切都是同步造出来的
 * （`builders.build()` 立刻返回一个 Object3D）。异步带来三个只在这里能管的问题：
 *
 * 1. **同一个模型会被要很多次**（24 个角色都用同一个 GLB）。不去重就是 24 次下载。
 * 2. **失败不能每帧重试**。`applyWorld` 每帧都在跑，一个 404 会变成每秒 60 次请求。
 *    所以失败要**记住**（memoize），由人来决定什么时候重试。
 * 3. **模型到货时场景可能已经换过了**（用户重开一局 / 换快照）。所以"到货之后往哪挂"
 *    必须由调用方在回调里判断，而不是我这里替它决定。
 *
 * 这三条都能在 node 里测（注入假的 `load`），不需要 WebGL——所以这个文件不 import three。
 *
 * ══ 资源地址的约定（决策 D32）══════════════════════════════════════════════════
 *
 * 内容里的 `ModelEntry.source.url` 是**相对本插件资源根**的路径（例如
 * `kenney-mini-characters/character-male-a.glb`），由路径校验挡住协议/绝对路径/`..`。
 * 页面把它取到需要 `./vendor/` 前缀——**这一步只在这一处做**，别处不许再拼一次
 * （拼两次的典型症状是 `vendor/vendor/…` 404，而看起来像"文件没发出去"）。
 */

/** 资源根在页面里的相对前缀。 */
const ASSET_PREFIX = './vendor/'

/**
 * 把内容里的资源路径变成页面可取的 URL。
 *
 * @param {string} url - 内容里的相对路径（已过 M1.6-7 校验）。
 * @returns {string} 形如 `./vendor/kenney-mini-characters/x.glb`。
 */
export function resolveAssetUrl(url) {
  // 容忍内容里写成 `./x` 或 `/x`——两种都很自然，但不该让它们拼出 `./vendor//x` 或 `./vendor/./x`。
  const clean = String(url).replace(/^\.\//, '').replace(/^\//, '')
  return ASSET_PREFIX + clean
}

/**
 * 建一个模型缓存。
 *
 * @param {object} options
 * @param {(url: string) => Promise<any>} options.load - 真正的加载函数（收到的是**已经拼好**的 URL）。
 * @param {(info: { url: string, error: unknown }) => void} [options.onError] - 每次**首次**失败时回调一次。
 * @returns {{ get: (url: string) => Promise<any>, has: (url: string) => boolean, status: () => object, failedUrls: () => string[], retry: (url: string) => Promise<any>, clear: () => void }}
 */
export function createModelCache({ load, onError } = {}) {
  /** url → { status, promise, value, error, attempts } */
  const entries = new Map()

  const start = (url) => {
    const entry = { status: 'loading', value: null, error: null, attempts: 1, promise: null }
    entry.promise = Promise.resolve()
      .then(() => load(resolveAssetUrl(url)))
      .then((value) => {
        entry.status = 'ready'
        entry.value = value
        return value
      })
      .catch((error) => {
        entry.status = 'failed'
        entry.error = error
        // 只报**首次**失败：重试仍失败时再报一遍只会把控制台淹掉。
        if (entry.attempts === 1) onError?.({ url, error })
        throw error
      })
    entries.set(url, entry)
    return entry.promise
  }

  return {
    /**
     * 取一个模型。同一个 url 只会真的加载一次。
     *
     * **失败也会被记住**：再次调用返回同一个已失败的 promise，不会重新发请求。
     * 这是刻意的——`applyWorld` 每帧都在跑，一个 404 不能变成每秒 60 次。
     * 要重试就显式调 `retry(url)`。
     */
    get(url) {
      const hit = entries.get(url)
      if (hit !== undefined) return hit.promise
      return start(url)
    },

    has: (url) => entries.has(url),

    status() {
      const out = { total: entries.size, loading: 0, ready: 0, failed: 0 }
      for (const entry of entries.values()) out[entry.status] += 1
      return out
    },

    /** 加载失败的 url（诊断用：面板可以把它们显示出来）。 */
    failedUrls() {
      return [...entries.entries()].filter(([, e]) => e.status === 'failed').map(([url]) => url).sort()
    },

    /** 显式重试（重新发一次请求）。失败被记住之后，只有这条路能再试。 */
    retry(url) {
      entries.delete(url)
      return start(url)
    },

    clear() {
      entries.clear()
    },
  }
}
