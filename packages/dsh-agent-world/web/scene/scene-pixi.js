/*
 * PixiJS 渲染器（R57）—— canvas2D 的替代品，**对外接口一模一样**。
 *
 * ── 为什么换 ────────────────────────────────────────────────────────────────
 *
 * canvas2D 是"能画图"，不是游戏引擎：每个精灵一次 `drawImage`（**没有批处理**）、
 * 没有滤镜/光照/粒子、相机与瓦片全是我们手写的。用户的质疑是对的。
 * 但**不换 Phaser**：Phaser 自带场景/物理/输入框架，会和我们的模拟内核重复；
 * 这里只缺"快而好看的 2D 渲染"，PixiJS 正好只做这件事。
 *
 * ── 与 canvas2D 版本的关系 ──────────────────────────────────────────────────
 *
 * 换算（相机/拾取/锚点）与切帧、帧推进、重上色**全部复用同一批纯函数**
 * （`core/scene-camera.js` / `core/pixel-sheet.js` / `core/pixel-recolor.js`），
 * 所以"点选行为不变"是结构上成立的，不是"我小心一点"。
 * canvas2D 那一份**保留**（`?renderer=canvas` 回退：WebGL 起不来时白屏比慢更糟）。
 *
 * ── 三条像素画的纪律 ────────────────────────────────────────────────────────
 *
 * 1. `antialias: false` + `texture.source.scaleMode = 'nearest'`：像素画一插值就糊。
 * 2. **整数倍缩放**（`cameraFor` 里就取整了），位置一律 `Math.round`。
 * 3. **同层用稳定顺序、不频繁改 zIndex**：改一次 zIndex 就可能切断一次合批。
 *
 * 另外一条工程纪律：所有精灵**复用同一批 `Texture`**（同一张图集切出来的 frame 共享
 * 一个 `source`），别给每个精灵单独建纹理——那是把合批亲手拆掉。
 */
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, TilingSprite } from 'pixi.js'

import { planGroundTiles } from '../core/ground-tiles.js'
import { assignColorVariants } from '../core/pixel-recolor.js'
import { directionOf, frameIndex, frameRect, pickAnimation, spriteBox } from '../core/pixel-sheet.js'
import { ANCHOR_LIFT_PX, TILE_PX, anchorFor, cameraFor, liveActors as liveActorsOf, pickActor, tilePhasePx } from '../core/scene-camera.js'
import { createSheetLoader } from './sheet-loader.js'

const UI_FONT = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif'
const LABEL_STYLE = { fontFamily: UI_FONT, fontSize: 10, fill: 0xffffff, stroke: { color: 0x000000, width: 2 } }

/**
 * 建一个 Pixi 渲染器。**同步返回门面**：`Application.init()` 是异步的，
 * 而调用方（main.js）拿到对象就会立刻 `resize()` / `render()`。
 * 所以初始化完成之前只**记下最后一次输入**，起来之后补画一帧——
 * 这样"异步初始化"对上层完全不可见。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{pickSlopPx?: number, assetBaseUrl?: string, loader?: object}} [options]
 */
export function createScenePixi(canvas, options = {}) {
  const pickSlopPx = Number.isFinite(options.pickSlopPx) ? options.pickSlopPx : 16
  const loader = options.loader ?? createSheetLoader({ baseUrl: options.assetBaseUrl ?? './vendor/' })
  const layer = {
    ground: new Container(),
    props: new Container(),
    actors: new Container(),
    notes: new Container(),
    labels: new Container(),
  }
  /** url → Texture（Pixi 侧按 url 去重） */
  const textures = new Map()
  /** `${url}|${color}|${variant}` → Texture（重上色结果，走 loader 的离屏 canvas） */
  const tintedTextures = new Map()
  /** 池子：按 id 复用对象，避免每帧 new（GC 抖动会直接吃掉批处理的收益） */
  const actors2 = new Map()
  const props2 = new Map()
  const notes2 = new Map()
  const districtLabels = new Map()
  const propFallbacks = new Map()

  let app = null
  let booted = false
  let bootError = null
  let pending = null
  let lastWorld = null
  let lastScene = null
  let lastInput = null
  let lastStats = { renderer: 'pixi', batched: true, drawCalls: 0, sprites: 0, textures: 0, ready: false }
  /** 这一帧有多少角色走的是**精灵**、多少走的是**回退色块**（"看起来在跑"不等于走对了路）。 */
  let actorPaths = { sprites: 0, fallbacks: 0 }
  /** 每帧 GL 提交次数（自己数，见 `countDrawCalls`）。 */
  let glDraws = 0

  const groundTiles = new Map()

  /** 用图集里的某一格建（或取）一张 `Texture`。同一张图集的所有 frame 共享 `source` → 能合批。 */
  function frameTexture(url, sx, sy, sw, sh) {
    const key = `${url}#${sx},${sy},${sw},${sh}`
    const cached = textures.get(key)
    if (cached !== undefined) return cached
    const source = baseTexture(url)
    if (source === null) return null
    const texture = new Texture({ source, frame: new Rectangle(sx, sy, sw, sh) })
    textures.set(key, texture)
    return texture
  }

  function baseTexture(url) {
    const key = `base:${url}`
    const cached = textures.get(key)
    if (cached !== undefined) return cached
    const image = loader.image(url)
    if (image === null) return null
    const texture = Texture.from(image)
    // **像素画的关键一行**：最近邻采样，不然放大就糊。
    if (texture.source !== undefined) texture.source.scaleMode = 'nearest'
    textures.set(key, texture)
    return texture
  }

  /**
   * 按角色配色重上色后的**整图纹理**（复用 loader 的离屏 canvas + 查表缓存）。
   *
   * 重上色是"每个 url × 每个配色"做一次的事；帧是在这之上切的：
   * 同一张重上色图的所有帧**共享一个 `source`**，所以它们仍然能合批。
   */
  function tintedBase(url, color, variant) {
    const key = `${url}|${color}|${variant}`
    const cached = tintedTextures.get(key)
    if (cached !== undefined) return cached
    const canvas = loader.recoloredImage(url, color, variant)
    if (canvas === null) return null
    const texture = Texture.from(canvas)
    if (texture.source !== undefined) texture.source.scaleMode = 'nearest'
    tintedTextures.set(key, texture)
    return texture
  }

  /** 重上色图上的某一帧（`frame` 是源图坐标）。 */
  function tintedFrameTexture(url, color, variant, frame) {
    const base = tintedBase(url, color, variant)
    if (base === null) return null
    const key = `tint:${url}|${color}|${variant}#${frame.sx},${frame.sy},${frame.sw},${frame.sh}`
    const cached = textures.get(key)
    if (cached !== undefined) return cached
    const texture = new Texture({ source: base.source, frame: new Rectangle(frame.sx, frame.sy, frame.sw, frame.sh) })
    textures.set(key, texture)
    return texture
  }

  /**
   * 数**真实**的 GL 提交次数。
   *
   * Pixi 8 没有对外暴露"这一帧合了几批"，所以直接把它用的 WebGL 上下文上的
   * `drawElements*` / `drawArrays*` 包一层——数到的就是驱动真正收到几次绘制，
   * 也就是"合批到底有没有生效"的唯一硬证据（引擎换了、版本升了都还成立）。
   */
  function countDrawCalls() {
    // **打在原型上**，不是打在上下文实例上：引擎只要缓存过 `gl.drawElements` 的引用
    // （`const draw = gl.drawElements`），打实例就会被绕过去、数出个假的"只有 3 批"。
    // 原型上装一次，进程内所有 WebGL 上下文都数得到；计不计数由 `counting` 那面旗决定。
    if (globalThis.__dshGLCounter === true) return
    const prototypes = [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext].filter(Boolean)
    if (prototypes.length === 0) return
    for (const proto of prototypes) {
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const original = proto.prototype[name]
        if (typeof original !== 'function' || original.__dshWrapped === true) continue
        const wrapped = function (...args) {
          if (globalThis.__dshCounting === true) globalThis.__dshDraws = (globalThis.__dshDraws ?? 0) + 1
          return original.apply(this, args)
        }
        wrapped.__dshWrapped = true
        proto.prototype[name] = wrapped
      }
    }
    globalThis.__dshGLCounter = true
  }

  /** 这一帧真实提交了几次 GL 绘制（走全局旗子，见上）。 */
  function measureDrawCalls() {
    globalThis.__dshDraws = 0
    globalThis.__dshCounting = true
    app.renderer.render(app.stage)
    globalThis.__dshCounting = false
    const draws = globalThis.__dshDraws ?? 0
    globalThis.__dshDraws = 0
    return draws
  }

  /**
   * 理论最小批次数：把可见节点按 **纹理 source** 分组。
   *
   * 这是"合批到底有没有生效"的独立参照：GL 实际绘制次数应当**接近**它
   * （同 source 且状态一致才能合批）。两个数一起看，才能区分
   * "真的只画了 3 次" 和 "计数器被绕过去了"。
   */
  function theoreticalBatches() {
    const groups = new Set()
    let visible = 0
    for (const container of app.stage.children) {
      for (const node of container.children) {
        if (node.visible === false) continue
        visible += 1
        const texture = node.texture
        if (texture?.source === undefined) { groups.add(`__nogroup:${node.constructor?.name ?? 'node'}`); continue }
        groups.add(texture.source.uid ?? texture.source.uid)
      }
    }
    return { visible, groups: groups.size }
  }

  async function boot() {
    try {
      app = new Application()
      await app.init({
        canvas,
        preference: 'webgl',
        // 像素画必须关抗锯齿；`roundPixels` 让顶点落在整像素上。
        antialias: false,
        roundPixels: true,
        autoDensity: true,
        resolution: Math.max(1, Math.floor(globalThis.devicePixelRatio || 1)),
        backgroundAlpha: 0,
        width: Math.max(320, canvas.clientWidth || 640),
        height: Math.max(320, canvas.clientHeight || 480),
      })
      // 分层：顺序即前后（地面 → 家具 → 角色 → 纸条 → 文字）。
      for (const container of Object.values(layer)) app.stage.addChild(container)
      countDrawCalls()
      // **运行中**上下文丢失（GPU 进程崩、显卡驱动重置、远程桌面切换）不会抛异常，
      // 只会让画布从此一片空白。这条降级必须有，否则表现就是"白屏且没有报错"。
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault()
        bootError = new Error('webgl context lost')
        if (typeof options.onBootError === 'function') options.onBootError(bootError)
      })
      booted = true
      resize()
      if (lastInput !== null) render(lastInput)
      else render()
    } catch (error) {
      bootError = error
      // 起不来就**别装作在跑**：调用方（scene-renderer.js）会据此退回 canvas2D。
      if (typeof options.onBootError === 'function') options.onBootError(error)
    }
  }

  function resize() {
    if (!booted || app === null) return
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    app.renderer.resize(width, height)
  }

  /** 地面：每区一个 `TilingSprite`（引擎自带平铺，一次提交铺满整区）+ `tint`（GPU 上的乘算）。 */
  function drawGround(scene, camera) {
    const models = new Map((scene?.models ?? []).map((model) => [model.id, model]))
    const wanted = new Set()
    for (const district of scene?.ground ?? []) {
      const model = district.modelId === null || district.modelId === undefined ? null : models.get(district.modelId)
      const sheet = model?.sheet ?? null
      const art = sheet === null || typeof model?.url !== 'string' ? null : baseTexture(model.url)
      if (art === null || sheet === null) continue
      const anim = pickAnimation(sheet, { state: 'idle', direction: null })
      const still = anim?.anim ?? Object.values(sheet.animations ?? {})[0]
      const tilePx = Math.max(1, Math.round(Number(sheet.cellW) || 32))
      const tilePy = Math.max(1, Math.round(Number(sheet.cellH) || tilePx))
      const texture = frameTexture(model.url, (still?.col ?? 0) * tilePx, (still?.row ?? 0) * tilePy, tilePx, tilePy)
      if (texture === null) continue
      // 相位按**世界网格**算（不是各从自己的角起）：跨区花纹才能对齐。
      const leftWorld = district.x - district.width / 2
      const topWorld = district.z - district.depth / 2
      const phaseX = tilePhasePx({ leftWorld, tileUnits: tilePx / TILE_PX, scale: camera.scale })
      const phaseY = tilePhasePx({ leftWorld: topWorld, tileUnits: tilePy / TILE_PX, scale: camera.scale })
      const key = district.id
      wanted.add(key)
      let sprite = groundTiles.get(key)
      if (sprite === undefined) {
        sprite = new TilingSprite({ texture, width: 1, height: 1 })
        groundTiles.set(key, sprite)
        layer.ground.addChild(sprite)
      }
      sprite.texture = texture
      sprite.width = Math.max(1, Math.round(district.width * TILE_PX * camera.zoom))
      sprite.height = Math.max(1, Math.round(district.depth * TILE_PX * camera.zoom))
      sprite.x = Math.round(camera.toX(leftWorld))
      sprite.y = Math.round(camera.toY(topWorld))
      // 纹理整体平移 -phase：让"格线"落在世界网格上。
      sprite.tilePosition.set(-phaseX, -phaseY)
      // `tint` 就是乘算（GPU 上做），语义与 canvas2D 的 `multiply` 一致：
      // 图给纹理、色给色调——**所以"暗"这个结论不会因为换引擎而变**。
      sprite.tint = Number.parseInt(district.color.replace('#', ''), 16)
    }
    for (const [key, sprite] of groundTiles) if (!wanted.has(key)) sprite.visible = false
    for (const key of wanted) groundTiles.get(key).visible = true
  }

  /** 区块名（地面之上、家具之下）。 */
  function drawDistrictLabels(scene, camera) {
    const wanted = new Set()
    for (const district of scene?.ground ?? []) {
      let label = districtLabels.get(district.id)
      if (label === undefined) {
        label = new Text({ text: district.name, style: LABEL_STYLE })
        districtLabels.set(district.id, label)
        layer.labels.addChild(label)
      }
      if (label.text !== district.name) label.text = district.name
      label.x = Math.round(camera.toX(district.x - district.width / 2)) + 8
      label.y = Math.round(camera.toY(district.z - district.depth / 2)) + 6
      label.visible = true
      wanted.add(district.id)
    }
    for (const [id, label] of districtLabels) if (!wanted.has(id)) label.visible = false
  }

  /** 家具：`parts` 逐件画（有图集画精灵，没有退回色块）。 */
  function drawProps(scene, camera) {
    const models = new Map((scene?.models ?? []).map((model) => [model.id, model]))
    const wanted = new Set()
    for (const prop of scene?.props ?? []) {
      const parts = [...(prop.parts ?? [])].sort((a, b) => (a.dz ?? 0) - (b.dz ?? 0))
      let spriteCount = 0
      parts.forEach((part, index) => {
        const model = models.get(part.modelId)
        const sheet = model?.sheet ?? null
        if (sheet === null || typeof model?.url !== 'string') return
        const texture = frameTexture(model.url, 0, 0, Math.max(1, Math.round(Number(sheet.cellW) || 16)), Math.max(1, Math.round(Number(sheet.cellH) || 16)))
        if (texture === null) return
        const key = `${prop.id}#${index}`
        let sprite = props2.get(key)
        if (sprite === undefined) {
          sprite = new Sprite({ texture })
          props2.set(key, sprite)
          layer.props.addChild(sprite)
        }
        sprite.texture = texture
        const sw = Math.round(texture.width * camera.zoom)
        const sh = Math.round(texture.height * camera.zoom)
        sprite.width = sw
        sprite.height = sh
        sprite.x = Math.round(camera.toX(prop.x + (part.dx ?? 0)) - sw / 2)
        // `anchor: bottom` = 底边贴地（世界的 +z 朝屏幕下方）
        sprite.y = Math.round(camera.toY(prop.z + (part.dz ?? 0)) - sh)
        sprite.visible = true
        wanted.add(key)
        spriteCount += 1
      })
      // 回退：没有图集就画一块色块（R47：缺东西要一眼看得出来）
      if (spriteCount === 0) {
        const key = `fallback:${prop.id}`
        let block = propFallbacks.get(key)
        const size = prop.capacity > 1 ? 18 : 13
        if (block === undefined) {
          block = new Graphics()
          propFallbacks.set(key, block)
          layer.props.addChild(block)
        }
        block.clear()
        block.rect(0, 0, size, size).fill({ color: Number.parseInt(String(prop.color).replace('#', ''), 16) || 0x888888 })
        if (prop.occupied) block.rect(0, 0, size, size).stroke({ color: 0xffffff, width: 2 })
        block.x = Math.round(camera.toX(prop.x) - size / 2)
        block.y = Math.round(camera.toY(prop.z) - size / 2)
        block.visible = true
        wanted.add(key)
      }
    }
    for (const [key, node] of props2) if (!wanted.has(key)) node.visible = false
    for (const [key, node] of propFallbacks) if (!wanted.has(key)) node.visible = false
  }

  /** 角色：精灵（按朝向选动画 + 按角色配色重上色）+ 名字。 */
  function drawActors(world, scene, camera, nowMs) {
    const models = new Map((scene?.models ?? []).map((model) => [model.id, model]))
    let spriteActors = 0
    let fallbackActors = 0
    const actors = [...liveActorsOf(world, scene)].sort((a, b) => a.z - b.z)
    const variants = assignColorVariants(actors)
    const wanted = new Set()
    for (const actor of actors) {
      const model = actor.modelId === null ? undefined : models.get(actor.modelId)
      const sheet = model?.sheet ?? null
      let entry = actors2.get(actor.id)
      if (entry === undefined) {
        const sprite = new Sprite()
        const label = new Text({ text: actor.name ?? actor.id, style: LABEL_STYLE })
        entry = { sprite, label, textureKey: null }
        actors2.set(actor.id, entry)
        layer.actors.addChild(sprite)
        layer.labels.addChild(label)
      }
      const key = `${actor.id}`
      wanted.add(key)

      let placed = false
      if (sheet !== null && typeof model?.url === 'string') {
        const variant = variants.get(actor.id) ?? 0
        const picked = pickAnimation(sheet, { state: actor.state, direction: directionOf(actor.facing) })
        if (picked !== null) {
          const frame = frameRect(sheet, picked.anim, frameIndex(picked.anim, nowMs))
          // 优先用**重上色**的那一份（8 个人各不相同靠它）；取不到就用原图。
          // **只有内容显式要求重上色时才染**（R58）。
          //
          // 默认不染是刻意的：重上色是把精灵**自己用得最多的前 3 色**换成角色色的明暗三档。
          // 对裸模（OGA 那套：全身就 3 个主色）是对的；对**已经画完的角色**
          //（Microverse：前 3 色是头发棕、衣服蓝、皮肤）会把头发/衣服/皮肤**染成同一个色相**，
          // 角色变成一坨单色块——真机上就是这么发现的。
          const wantRecolor = model.sheet?.recolor === true
          const spriteTexture =
            (wantRecolor ? tintedFrameTexture(model.url, actor.color, variant, frame) : null) ??
            frameTexture(model.url, frame.sx, frame.sy, frame.sw, frame.sh)
          if (spriteTexture === null) {
            // 图还没加载好：这一帧先不画（下一帧起来就有了），不要拿错纹理凑。
          } else {
          const box = spriteBox(sheet, frame, { cx: camera.toX(actor.x), groundY: camera.toY(actor.z), scale: camera.zoom })
          entry.sprite.texture = spriteTexture
          entry.sprite.width = Math.round(box.w)
          entry.sprite.height = Math.round(box.h)
          entry.sprite.x = Math.round(box.x)
          entry.sprite.y = Math.round(box.y)
          entry.sprite.visible = true
          entry.label.x = Math.round(camera.toX(actor.x) - 24)
          entry.label.y = Math.round(camera.toY(actor.z) - Math.round(box.h) - 14)
          entry.label.visible = true
          placed = true
          spriteActors += 1
          }
        }
      }
      if (!placed) {
        fallbackActors += 1
        // 回退：白纹理小方块 + 角色色（canvas2D 的回退是圆点；这里等价表达）
        const color = Number.parseInt(String(actor.color).replace('#', ''), 16) || 0xffffff
        entry.sprite.texture = Texture.WHITE
        entry.sprite.tint = color
        entry.sprite.width = 12
        entry.sprite.height = 12
        entry.sprite.x = Math.round(camera.toX(actor.x) - 6)
        entry.sprite.y = Math.round(camera.toY(actor.z) - 6)
        entry.sprite.visible = true
        entry.label.x = Math.round(camera.toX(actor.x) - 24)
        entry.label.y = Math.round(camera.toY(actor.z) - 24)
        entry.label.visible = true
      }
    }
    for (const [id, entry] of actors2) {
      if (wanted.has(id)) continue
      entry.sprite.visible = false
      entry.label.visible = false
    }
    actorPaths = { sprites: spriteActors, fallbacks: fallbackActors }
  }

  /** 飞行中的纸条（白纹理小方块 + 虚线）。 */
  function drawNotes(world, scene, tick, messageDeliveryTicks, camera) {
    if (world === null) return
    const actors = new Map(liveActorsOf(world, scene).map((a) => [a.id, a]))
    const fallbackDelay = messageDeliveryTicks ?? 10
    const wanted = new Set()
    let index = 0
    for (const message of world.messages ?? []) {
      if (message.deliveredAtTick !== null) continue
      const at = message.atTick ?? 0
      const deliverAt = message.deliverAtTick ?? at + fallbackDelay
      const t = (tick - at) / Math.max(1, deliverAt - at)
      if (t < 0 || t > 1) continue
      const from = actors.get(message.from)
      const to = actors.get(message.to)
      if (from === undefined || to === undefined) continue
      const offsetX = (index % 3) * 5 - 5
      const offsetY = Math.floor(index / 3) * 5 - 2
      index += 1
      const key = `note:${message.id ?? index}`
      let sprite = notes2.get(key)
      if (sprite === undefined) {
        sprite = new Sprite({ texture: Texture.WHITE })
        notes2.set(key, sprite)
        layer.notes.addChild(sprite)
      }
      sprite.texture = Texture.WHITE
      sprite.tint = Number.parseInt(String(scene?.noteColors?.[message.kind] ?? '#FF00FF').replace('#', ''), 16)
      sprite.width = 6
      sprite.height = 5
      sprite.x = Math.round(camera.toX(from.x + (to.x - from.x) * t) - 3 + offsetX)
      sprite.y = Math.round(camera.toY(from.z + (to.z - from.z) * t) - 2 + offsetY)
      sprite.visible = true
      wanted.add(key)
    }
    for (const [key, sprite] of notes2) if (!wanted.has(key)) sprite.visible = false
  }

  /** 画一帧（与 canvas2D 版本同名同参）。 */
  function render(input = {}) {
    lastInput = input
    const { world, scene, tick, messageDeliveryTicks } = input
    if (world === null || world === undefined || scene === null || scene === undefined) return
    lastWorld = world
    lastScene = scene
    if (!booted || app === null) return // 还没起来：`boot()` 起来后会补画
    const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : (globalThis.performance?.now?.() ?? 0)
    const camera = cameraFor({ viewWidth: canvas.clientWidth, viewHeight: canvas.clientHeight, half: scene?.extent?.half ?? 8 })
    drawGround(scene, camera)
    drawDistrictLabels(scene, camera)
    drawProps(scene, camera)
    drawActors(world, scene, camera, nowMs)
    drawNotes(world, scene, tick ?? 0, messageDeliveryTicks, camera)

    const batches = measureDrawCalls()
    const theoretical = theoreticalBatches()
    glDraws = batches
    lastStats = {
      renderer: 'pixi',
      batched: true,
      drawCalls: glDraws,
      sprites: app.stage.children.reduce((sum, container) => sum + container.children.filter((c) => c.visible !== false).length, 0),
      textures: textures.size,
      /** 精灵路径 vs 回退路径（诊断：8 个角色都该走精灵）。 */
      actorSprites: actorPaths.sprites,
      actorFallbacks: actorPaths.fallbacks,
      /** 这一帧真实的 GL 绘制次数（= 实际合批数）。 */
      batches,
      /** 按纹理 source 分组算出的**理论最小**批次数（独立参照，用来验证计数器没被绕过）。 */
      theoreticalBatches: theoretical.groups,
      countedVisible: theoretical.visible,
      ready: true,
    }
  }

  function metrics(scene) {
    return cameraFor({ viewWidth: canvas.clientWidth, viewHeight: canvas.clientHeight, half: scene?.extent?.half ?? 8 })
  }

  function pick({ world, scene, clientX, clientY }) {
    const source = scene ?? lastScene
    const sourceWorld = world ?? lastWorld
    if (sourceWorld === null || source === null) return null
    // 与 canvas2D **同一份**换算（core/scene-camera.js）：点选行为不因换引擎而变。
    return pickActor({
      world: sourceWorld,
      scene: source,
      camera: metrics(source),
      clientX,
      clientY,
      rect: canvas.getBoundingClientRect(),
      pickSlopPx,
    })
  }

  function anchorOf({ world, scene, agentId }) {
    const source = scene ?? lastScene
    const sourceWorld = world ?? lastWorld
    if (source === null || sourceWorld === null) return null
    return anchorFor({ world: sourceWorld, camera: metrics(source), agentId, liftPx: ANCHOR_LIFT_PX })
  }

  function stats() {
    return { ...lastStats, bootError: bootError === null ? null : String(bootError?.message ?? bootError) }
  }

  void boot()

  return {
    resize,
    render,
    pick,
    anchorOf,
    metrics,
    liveActors: liveActorsOf,
    loader,
    stats,
    /** 供门面判断：Pixi 到底起没起来（`bootError` 非 null 就要退回 canvas2D）。 */
    whenReady: () => (booted ? Promise.resolve(true) : new Promise((resolve) => {
      const timer = globalThis.setInterval?.(() => {
        if (booted) { globalThis.clearInterval?.(timer); resolve(true) }
        else if (bootError !== null) { globalThis.clearInterval?.(timer); resolve(false) }
      }, 30)
    })),
    get ready() { return booted },
    get failed() { return bootError }
  }
}
