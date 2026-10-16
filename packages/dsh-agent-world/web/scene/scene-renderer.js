/*
 * 2D 渲染器的**门面**（R57）：默认 PixiJS，`?renderer=canvas` 走 canvas2D，**起不来自动退回**。
 *
 * ── 为什么要这一层 ──────────────────────────────────────────────────────────
 *
 * 1. Pixi 的 `Application.init()` 是**异步**的，而调用方拿到渲染器就立刻 `resize()`/`render()`。
 *    门面把"还没起来"这件事挡在里面（调用被记下，起来后补画），上层完全不用知道。
 * 2. WebGL 在某些环境起不来（驱动/远程桌面/被策略禁掉）。**白屏比慢糟得多**，
 *    所以 boot 失败要有一次安静的降级：换成 canvas2D 继续画，并把原因暴露在 `stats()` 里。
 * 3. `?renderer=canvas` 是给"排查到底是渲染器的问题还是别的问题"用的开关：
 *    同一条 URL 换一个参数就能对比两个渲染器。
 *
 * 对外接口与这两个渲染器**完全一致**：`resize/render/pick/anchorOf/metrics/liveActors/loader/stats`。
 */
import { createScene2d } from './scene2d.js'
import { createScenePixi } from './scene-pixi.js'

/** 这一页请求的是哪个渲染器（`?renderer=canvas|pixi`；缺省 pixi）。 */
export function requestedRenderer(search = globalThis.location?.search ?? '') {
  try {
    const value = new URLSearchParams(search).get('renderer')
    if (value === 'canvas' || value === 'canvas2d') return 'canvas2d'
    if (value === 'pixi' || value === 'webgl') return 'pixi'
    return 'pixi'
  } catch {
    return 'pixi'
  }
}

/**
 * 建一个 2D 渲染器（签名与 `createScene2d` 相同）。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{pickSlopPx?: number, assetBaseUrl?: string, renderer?: 'pixi'|'canvas2d'}} [options]
 */
export function createScene2dRenderer(canvas, options = {}) {
  const wanted = options.renderer ?? requestedRenderer()
  let active = wanted === 'canvas2d' ? createScene2d(canvas, options) : null
  let pixi = null
  let backend = wanted === 'canvas2d' ? 'canvas2d' : 'pixi'
  let fallbackReason = wanted === 'canvas2d' ? 'forced-by-url' : null
  let lastRenderInput = null
  const seen = { resize: 0, render: 0, lastRenderAt: 0 }

  function degrade(reason, error) {
    if (active !== null) return
    backend = 'canvas2d'
    fallbackReason = error === undefined ? reason : `${reason}: ${String(error?.message ?? error)}`
    active = createScene2d(canvas, options)
    active.resize()
    if (lastRenderInput !== null) active.render(lastRenderInput)
    options.onDegrade?.({ reason: fallbackReason, backend })
  }

  if (wanted !== 'canvas2d') {
    pixi = createScenePixi(canvas, {
      ...options,
      // Pixi 起不来（没有 WebGL / 上下文丢失）→ 悄悄换成 canvas2D，别让场景白屏。
      onBootError: (error) => degrade('webgl-failed', error),
    })
  }

  const target = () => active ?? pixi

  function resize() {
    seen.resize += 1
    target().resize()
  }

  function render(input = {}) {
    seen.render += 1
    seen.lastRenderAt = Date.now()
    lastRenderInput = input
    // 还没降级时，Pixi 自己会把预启动的输入存下来补画；降级之后由 canvas2D 接着画。
    target().render(input)
  }

  function pick(input) {
    return target().pick(input)
  }

  function anchorOf(input) {
    return target().anchorOf(input)
  }

  function metrics(scene) {
    return target().metrics(scene)
  }

  function liveActors(world, scene) {
    return target().liveActors(world, scene)
  }

  function stats() {
    const inner = target().stats?.() ?? {}
    return { ...inner, backend, fallbackReason, frames: seen.render }
  }

  return {
    resize,
    render,
    pick,
    anchorOf,
    metrics,
    liveActors,
    stats,
    /** loader 要**跟着当前生效的渲染器**走（诊断入口读它）。 */
    get loader() {
      return target().loader
    },
    /** 当前生效的后端（`pixi` / `canvas2d`）与降级原因。 */
    backend: () => backend,
    fallbackReason: () => fallbackReason,
    /** 给测试/诊断用：门面被调了多少次。 */
    calls: () => ({ ...seen }),
  }
}
