/*
 * Phaser 渲染器（R58）—— **唯一的** 2D 渲染器，对外接口与以前完全一致。
 *
 * ── 为什么换到 Phaser（用户原话：最好少自己创建引擎）────────────────────────
 *
 * R57 用 Pixi 只解决了"画得快"：动画、相机、平铺、输入仍然是手写的。
 * Phaser 是**游戏框架**，这些东西它全带，于是我们自己写的引擎部分全部删掉：
 *
 * | 删掉的 | 这活现在归 Phaser 的哪个 API |
 * |---|---|
 * | `web/core/pixel-sheet.js`（129 行） | `this.load.spritesheet(key, url, { frameWidth, frameHeight })` 切帧 · `this.anims.create({ frames, frameRate })` + `sprite.play(key)` 推进 · `sprite.setOrigin()` 锚点 |
 * | `web/core/scene-camera.js`（143 行） | `this.cameras.main.setZoom()/centerOn()` · `camera.getWorldPoint()` · `camera.worldView` · `sprite.setInteractive()` |
 * | `web/scene/scene2d.js`（484 行） | 手写 canvas 渲染器整个删掉（含"WebGL 起不来"的自建回退 → `type: Phaser.AUTO`） |
 * | `web/scene/scene-pixi.js`（569 行） | Pixi 渲染层整个删掉（平铺 → `this.add.tileSprite`，输入 → `setInteractive`） |
 * | `web/scene/scene-renderer.js`（117 行） | 自写门面/降级 → `type: Phaser.AUTO` 内建 canvas 回退 |
 * | `ground-tiles.js::planGroundTiles` | 自算平铺计划 → TileSprite 的 `tilePositionX/Y` |
 *
 * 留下的是"引擎不可能知道的事"（内容语义 + 产品规则），都在 `web/core/scene-layout.js`
 * （纯函数、有测试）：动画回退链、多带图集→线性帧号、重上色、整数倍缩放、气泡抬高、
 * 平铺相位，以及 `liveActors`（把"实时世界"与"内容计划"两份数据合起来）。
 *
 * ── 坐标系（一处定义，别处都从它推）────────────────────────────────────────
 *
 * **世界单位 = 纹理像素**：1 个旧世界单位 = `TILE_PX`(16) 个世界像素。
 * 相机 `zoom = TILE_PX × 整数倍`（真机 32），所以纹理像素→屏幕像素是**整数倍**、
 * 整数倍 + `pixelArt` + `roundPixels` = 像素不糊、大小一致。
 * 显示对象一律 `setScale(1)`、位置给世界像素（**不要再乘 zoom**，缩放归相机）。
 *
 * ── 两条刻意的工程决定（汇报里都交代了）────────────────────────────────────
 *
 * 1. **地面染色烘进纹理**，而不是 `setTint`：Phaser 的 **Canvas 渲染器不支持 tint**，
 *    而 `?renderer=canvas` 必须还能起、还必须四区不同色（那也是读活画布像素做证据的路）。
 *    烘纹理 = 两条渲染路径像素一致（乘算算术与 R55 完全相同）。
 * 2. **拾取用精灵自己的包围盒**（`getBounds()`，与 `setInteractive` 的命中几何同一份）：
 *    R57 的拾取是"脚下 ±16px 的圆"，实测角色的头/身体 3/4 点不中（R58 查清的死角）。
 */
import { CANVAS, Cameras, Game, Scale, Scene, WEBGL } from 'phaser'

import { parseRgb } from '../core/ground-tiles.js'
import {
  ANCHOR_LIFT_PX,
  animationCandidates,
  bandOfState,
  FIT,
  MAX_ZOOM,
  TILE_PX,
  animationFrameList,
  directionOf,
  frameRateOf,
  fitZoom,
  framesPerRow,
  integerZoom,
  keyOfAnimationName,
  liveActors as liveActorsOf,
  originOf,
  resolveAnimationKey,
  steppedZoom,
  tilePhasePx,
  worldFrame,
  zoomLevels,
} from '../core/scene-layout.js'
import { assignColorVariants } from '../core/pixel-recolor.js'
import { createSheetLoader } from './sheet-loader.js'

/**
 * 这一页请求的是哪个渲染器：`?renderer=canvas` → `type: Phaser.CANVAS`（对照/排查用），
 * 否则 `Phaser.AUTO`（WebGL 优先、**canvas 自动回退**——回退由引擎给，不是我们写的）。
 */
export function requestedRenderer(search = globalThis.location?.search ?? '') {
  try {
    return new URLSearchParams(search).get('renderer') === 'canvas' ? 'canvas' : 'auto'
  } catch {
    return 'auto'
  }
}

/** 画布里的字体**不能写 CSS 变量**（canvas 不认 `var(...)`）。与 `tokens.css` 同序。 */
const UI_FONT = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif'
const LABEL_STYLE = { fontFamily: UI_FONT, fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }

/**
 * 用哪个渲染器。
 *
 * ⚠️ Phaser 有一条硬规定：**只要你把 canvas 交给它，就不能再用 `type: AUTO`**
 * （`customEnvironment` 必须显式给 renderType），而我们的 canvas 必须由自己掌握——
 * `main.js` 的点击、CSS 尺寸都绑在 `#town` 上。所以 `AUTO` 的语义由这里**先探测一次**：
 * 能拿到 WebGL 就 WEBGL，否则 CANVAS（= 引擎自带的那条回退路径，只是把判断提前了）。
 * 运行中真的丢了上下文，见 `rebuildWithCanvas()`。
 */
function detectRendererType(preference) {
  if (preference === 'canvas') return CANVAS
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl')
    if (gl !== null && gl !== undefined) {
      gl.getExtension('WEBGL_lose_context')?.loseContext?.()
      return WEBGL
    }
  } catch {
    // 探测本身抛异常也必须能起（起不来就是白屏，比慢糟得多）
  }
  return CANVAS
}

/** 动画 key 带纹理前缀：同一套动画在"原图"和"重上色图"上各有一份（换色不能串回原图）。 */
function animKeyFor(textureKey, animName) {
  return `anim:${textureKey}::${animName}`
}

/** 画布的 CSS 像素尺寸（Phaser 的 scale manager 不接管尺寸，由我们自己驱动）。 */
function viewSize(canvas) {
  return {
    width: Math.max(1, Math.round(canvas.clientWidth || 640)),
    height: Math.max(1, Math.round(canvas.clientHeight || 480)),
  }
}

/** `#rrggbb` → Phaser 的整数色。 */
function colorOf(hex) {
  const rgb = parseRgb(hex)
  if (rgb === null) return 0xffffff
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
}

/**
 * 建 Phaser 渲染器（**同步**返回门面）。
 *
 * `new Game()` 是同步的，但 `preload()` 是异步的；门面把"还没好"挡在里面：
 * 预启动的 `resize/render` 会被记下来，`create()` 之后补画一帧。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{renderer?: 'auto'|'canvas', assetBaseUrl?: string, onActorPick?: Function, loader?: object}} [options]
 */
export function createScenePhaser(canvas, options = {}) {
  const loader = options.loader ?? createSheetLoader({ baseUrl: options.assetBaseUrl ?? './vendor/' })
  let rendererType = detectRendererType(options.renderer)
  /** 当前**活着**的那块画布：上下文丢失时会换成新的一块（见 `rebuildWithCanvas`）。 */
  const live = { canvas }
  const initial = viewSize(live.canvas)

  const state = {
    world: null,
    plan: null,
    tick: 0,
    messageDeliveryTicks: 10,
    nowMs: 0,
    ready: false,
    loadError: null,
  }
  let game = null
  let activeScene = null
  /**
   * 用户选的缩放档（R65）。`null` = **跟随适配**（窗口变大变小都自动"一眼看全"）；
   * 一旦用户滚过轮/按过缩放键，就锁成具体档位，不再被窗口尺寸改掉——
   * "我放大看了半天，一拉窗口又跳回去了"是最烦人的那种交互。
   */
  let userZoom = null
  /** 相机移动控制（键盘）。Phaser 自带，不自己写积分。 */
  let keyControl = null
  /** 下一次 `applyCamera()` 是否要居中（进场与"复位"要，用户拖动后不要）。 */
  let centerOnNextApply = true
  /**
   * **默认固定档**（R72，用户修正："缩放不需要吸附到某个 agent，只需要控制缩放的力度，
   * 并且最小和最大范围要控制住"）。
   *
   * 为什么不是"适配档"（把整张图缩到看得全）：那样 8 个 32×64 的小人在 1400px 宽的舞台里
   * 只有 1 倍、**细节全糊在一起**。
   * 为什么不是最大档（6×）：只看得到几个格子，失去方位感。
   * 2× 是**能看清角色动作、又还认得出房间**的那一档。
   *
   * 它只在"用户没自己缩放过"时生效——一旦用户滚过轮/点过缩放键，`userZoom` 说了算（见 `zoomNow`）。
   */
  const DEFAULT_ZOOM = 2

  let lastRenderInput = null
  let pendingSize = null
  let assetsPlanned = false
  let assetsLoading = false
  let plannedAssets = new Map()
  let plannedImages = new Map()
  let sheetByUrl = new Map()
  const perRowByUrl = new Map()
  const textureKeyByUrl = new Map()
  /** 底图（`scene.map.url`）的纹理键。底图不是"模型"，所以单独记。 */
  const MAP_KEY = 'map:office'
  const actorNodes = new Map()
  const actorPathCounts = { sprites: 0, fallbacks: 0 }
  const groundNodes = new Map()
  const propNodes = new Map()
  const noteNodes = new Map()
  const labelNodes = new Map()
  let actorPick = typeof options.onActorPick === 'function' ? options.onActorPick : null
  let lastStats = { renderer: 'phaser', backend: rendererType === CANVAS ? 'canvas' : 'webgl', drawCalls: 0, sprites: 0, ready: false }

  // 文字（名字/区块名）挂在 **zoom=1 的 UI 相机**上，位置是"画布像素"。
  // 必须和世界里的对象用**同一套换算**（`metrics()`，它读相机真实滚动），
  // 否则名字会整体偏掉（世界比视口小时 Phaser 会夹住滚动，靠"理想居中"算就偏 108/38px）。
  const screenX = (worldX) => metrics().toX(worldX)
  const screenY = (worldZ) => metrics().toY(worldZ)

  /** 适配档："一眼看全"的最大整数倍（两个轴都算——只按短边会把横着的办公室算小）。 */
  function fitZoomNow() {
    const { width, height } = viewSize(live.canvas)
    const frame = worldFrame(state.plan)
    return fitZoom({
      viewWidth: width,
      viewHeight: height,
      worldPixelsW: frame.worldPxW,
      worldPixelsH: frame.worldPxH,
      fit: FIT,
      maxZoom: MAX_ZOOM,
    })
  }

  /** 可用档位：**从适配档往上**。比"一眼看全"更小没有意义（画面缩成一小块）。 */
  function levelsNow() {
    const fit = fitZoomNow()
    return zoomLevels(MAX_ZOOM).filter((z) => z >= Math.max(1, fit))
  }

  /**
   * **当前档位**：用户选过就用用户的，没选过用默认固定档（**夹进 [最小, 最大] 范围**）。
   *
   * 这是缩放这件事**唯一的真相**——相机、气泡锚点、拾取换算全从它读。
   * 各处自己算一份的话，会出现"画面缩放了但名字没跟着动"这类错位。
   *
   * R72：默认档也要**夹进可用档位范围**（用户："最小和最大范围要控制住"）——
   * 极小窗口下 fit 档可能 > 2，此时默认 2× 低于最小档，得抬到最小档；反之亦然。
   */
  function zoomNow() {
    if (userZoom !== null) return userZoom
    const levels = levelsNow()
    const bottom = levels[0] ?? 1
    const top = levels[levels.length - 1] ?? MAX_ZOOM
    return Math.min(top, Math.max(bottom, DEFAULT_ZOOM))
  }

  /** 世界像素 ↔ 相机（缩放归相机，显示对象一律 scale 1）。 */
  /**
   * 把相机的取景框与缩放对齐到当前状态。
   *
   * ## 顺序很重要（R65 踩到的坑）
   *
   * 我第一版按"zoom → bounds → center → scroll"写，真机上缩放会**莫名其妙掉回 1**。
   * 两个原因叠在一起：
   * ① `applyCamera()` 用**当前 zoom** 算 `setBounds` 的 padding——而缩放动画期间
   *    `camera.zoom` 是中间值（1.0 → 2.0 之间），于是边界被算成"中间档"的尺寸，
   *    动画结束后就卡在那个错的边界上（实测 `scrollX -700`，而 zoom=2 时本该是 `-942`）。
   * ② 更根本的：**边界不该依赖当前档位**。Phaser 的 `setBounds` 是"相机能走到哪"，
   *    它属于**世界**（地图多大），不属于**视口**（我这一刻看多大）。
   *    所以 padding 只在"世界比**最小**视口还小"时才有意义——用**适配档**算一次就够。
   *
   * 现在的顺序：**先定边界（只看世界与适配档）→ 再设 zoom → 最后按需居中/夹取**。
   */
  function applyCamera() {
    if (activeScene === null) return
    const { width, height } = viewSize(live.canvas)
    const camera = activeScene.cameras.main
    // ⚠️ 显示对象摆的是**世界像素**（1 旧世界单位 = 16 世界像素），所以相机只要
    // 整数倍缩放本身；写成 `integerZoom × TILE_PX` 的话，256 像素的小镇会被放大 32 倍，
    // 相机只看得到 44×23 像素的一角（R58 踩过这个坑）。
    const frame = worldFrame(state.plan)
    camera.setViewport(0, 0, width, height)
    // ⚠️⚠️ **不在这里设 zoom**（R65 查了很久的一个真 bug）。
    //
    // 我原来的写法是"每帧把 `camera.zoom` 对齐到 `zoomNow()`"。那和 Phaser 的相机**打架**：
    // 实测 `zoomEffect` 明明跑完了（`progress: 1`、`source: 1`、`destination: 2`），
    // 而 `camera.zoom` 读出来还是 1——**缓动的结果每次都被我们下一帧覆盖掉**，
    // 表现就是"点了放大没反应"。中间加 `zoomAnimating` 标志只是把症状挪了个位置
    //（动画期间不设 → 动画完成那一帧又被设回去）。
    //
    // 正确的分工（D56：相机是真相，我们只是操作它的手）：
    //   · **谁改 zoom**：只有 `applyZoomStep`（走 `zoomTo`）与 `resetView`（走 `setZoom`）；
    //   · **`applyCamera()` 只管引擎不该被我们猜的那部分**：视口尺寸、世界边界、居中。
    // 换句话说：**zoom 是相机的状态，不是我们每帧重新推导出来的量。**
    // 取景框交给引擎：`setBounds` 负责"别移出世界"，`centerOn(0,0)` 负责居中。
    // 世界坐标**中心为 0**，所以边界从 `(-halfW, -halfH)` 起、宽高各是世界像素尺寸。
    // ⚠️ 世界比视口**小**时（办公室 1184×672 vs 舞台 1400×748）边界会把滚动夹到左/上，
    // 结果整张图贴在左上角；所以要按差额**向外留 padding**，留出居中的空间。
    // 世界比视口小时留 padding 让它能居中；**比视口大时 pad=0**，
    // 否则会多出一圈空白、拖到底也看不到地图边缘。
    // ⚠️ padding 用**适配档**算，不用当前档——否则缩放动画的中间值会把边界算错，
    // 而且"放大之后边界反而变小"（越放大越走不出去）这种反直觉行为就是从这里来的。
    const fit = fitZoomNow()
    const padX = Math.max(0, (width / fit - frame.worldPxW) / 2)
    const padY = Math.max(0, (height / fit - frame.worldPxH) / 2)
    camera.setBounds(
      frame.originPxX - padX,
      frame.originPxY - padY,
      frame.worldPxW + padX * 2,
      frame.worldPxH + padY * 2,
    )
    // ⚠️ **只有请求居中时才居中**。用户拖过之后每次 `applyCamera()` 都 `centerOn(0,0)`
    // 会把他拖到的位置一直拽回中央——那正是"拖不动"这种 bug 的成因。
    if (centerOnNextApply === true) {
      camera.centerOn(0, 0)
      centerOnNextApply = false
    }
    // **把滚动量取整**，否则半像素的相机位移会让整张图糊掉
    camera.setScroll(Math.round(camera.scrollX), Math.round(camera.scrollY))
    const ui = activeScene.uiCamera
    if (ui !== null && ui !== undefined) {
      ui.setViewport(0, 0, width, height)
      ui.setZoom(1)
      ui.setScroll(0, 0)
    }
  }

  // ── 视图控制（R65）：**缩放/平移全部交给 Phaser 的相机** ─────────────────────
  //
  // 为什么不自写：我这一轮本来准备手写"滚轮 → 改 zoom、拖拽 → 改 scroll"，
  // 用户当场拦下——"phaser.io 里有可用的相机视口引擎吧，你千万别自己开发呀"。
  // 这与 D53（少自己造引擎）是同一条，而且这已经是第三次（物理 → 寻路 → 相机）。
  //
  // Phaser 3.90 现成的（我在浏览器里逐个验过存在）：
  //   · `camera.zoomTo(zoom, ms, ease)`  —— 带缓动的缩放
  //   · `camera.pan(x, y, ms, ease)`     —— 带缓动的平移
  //   · `camera.setBounds(...)`          —— 边界夹取
  //   · `Phaser.Cameras.Controls.FixedKeyControl` —— 键盘推相机（它自己算速度与积分）
  //   · `input.on('wheel')` / `pointermove` —— 输入事件
  //
  // **我们只保留两条引擎不可能知道的产品规则**：① 像素画必须整数倍缩放（离散档位）；
  // ② 取景框按地图算（`worldFrame`）。其余一律不自己算。

  /** 键盘推相机的速度（像素/秒）。 */
  const KEY_SPEED = 420


  /**
   * 换档：`step` = +1 放大 / -1 缩小。**用 Phaser 的 `camera.setZoom()` 直接设**。
   *
   * ## 为什么不用 `zoomTo`（缓动）
   *
   * 我原来用 `camera.zoomTo(target, 180, 'Sine.easeOut')`，真机上排查了很久：
   * 特效的状态是**对的**（`progress: 1`、`source: 1`、`destination: 2`、`isRunning` 从 true
   * 变 false），但 `camera.zoom` 读出来**始终是 1**。也就是说缓动的结果没有落到相机上。
   *
   * 我没有继续往 Phaser 内部挖——因为**这一档产品需求本来就不需要缓动**：
   * "点一下放大一档"是**离散操作**（整数倍阶梯），要的是**立刻、确定**地到那一档。
   * `setZoom` 就是引擎为这件事提供的 API，行为直接、没有中间态、也不会和任何东西打架。
   *
   * 需要缓动的是**滚轮连续缩放**与相机跟随，那是另一件事（真要做，用 Phaser 的
   * `camera.pan` / 特效时再单独验一次，并且**必须在真机上确认结果落地**）。
   */
  function applyZoomStep(step) {
    if (activeScene === null) return
    const camera = activeScene.cameras.main
    // 起点用**相机真实档位**（连按两次时，"我们记住的档位"可能与相机不一致）。
    const current = camera.zoom || zoomNow()
    const target = steppedZoom(current, step, levelsNow())
    if (target === current) return
    userZoom = target
    camera.setZoom(target)
    // 档位变了 → 世界相对视口的大小变了 → 边界要重算（padding 从"留白"变成 0）。
    applyCamera()
    notifyViewChange()
  }

  /** 适配：让整张地图完整显示（= 回到适配档 + 居中）。 */
  function fitView() {
    // **看全图**：缩到适配档并居中。
    userZoom = null
    centerOnNextApply = true
    if (activeScene !== null) {
      activeScene.cameras.main.setZoom(fitZoomNow())
    }
    applyCamera()
    notifyViewChange()
  }

  /** 复位：回到默认固定档并居中（用户按住拖了半天之后想"回到开局视角"）。 */
  function resetView() {
    // R72：复位的语义 = **回到默认档 + 居中**。不再"聚焦某个人"（用户修正：缩放不吸附 agent）。
    userZoom = null
    centerOnNextApply = true
    // 用 `zoomNow()` 而不是直接 `DEFAULT_ZOOM`：默认档同样要夹进 [最小, 最大] 范围。
    if (activeScene !== null) activeScene.cameras.main.setZoom(zoomNow())
    applyCamera()
    notifyViewChange()
  }

  /** 视图变了（缩放/复位）→ 通知外壳刷新按钮禁用态与倍数。 */
  function notifyViewChange() {
    if (typeof options.onViewChange === 'function') {
      options.onViewChange(viewState())
    }
  }

  /**
   * 当前视图状态（外壳用它刷新按钮禁用态与倍数显示）。
   *
   * ⚠️ **`zoom` 一律报相机的真实档位**，不报 `userZoom`。
   *
   * 我第一版报的是 `zoomNow()`（= 我们记住的档位），真机上当场露馅：
   * **界面显示 `6×` 而相机实际在 `2`**——两个真相源，而且用户看到的倍数与画面不符。
   * 这与 D56 是同一条：**相机是真相，我们只是操作它的手**。
   * 按钮的禁用态也必须从真实档位算，否则会在"已经到顶"时还给一个能按的按钮。
   */
  function viewState() {
    const fit = fitZoomNow()
    const levels = levelsNow()
    const camera = activeScene?.cameras?.main
    const zoom = camera === undefined || camera === null ? zoomNow() : (camera.zoom || 1)
    const top = levels[levels.length - 1] ?? zoom
    const bottom = levels[0] ?? zoom
    return {
      zoom,
      fit,
      minZoom: bottom,
      maxZoom: top,
      canZoomIn: zoom < top,
      canZoomOut: zoom > bottom,
      // `fitted` = 还在"一眼看全"那一档（`fitView()` 之后为 true）。
      fitted: zoom === fit,
    }
  }

  /**
   * 接输入到 Phaser 的相机上。
   *
   * ⚠️ 用 `scene.input`（**不是 DOM 监听**）：Phaser 已经处理了画布缩放/指针坐标换算，
   * 自己挂 `canvas.addEventListener` 的话，指针位置要再算一遍设备像素比与画布偏移——
   * 而那份换算引擎已经有了（`camera.getWorldPoint`）。
   */
  function wireViewControls(scene) {
    const camera = scene.cameras.main

    // 滚轮缩放：**在档位阶梯上走一格**（不是连续的 `zoom *= 1.1`）。
    scene.input.on('wheel', (_pointer, _objects, _dx, dy) => {
      if (dy === 0) return
      applyZoomStep(dy > 0 ? -1 : 1)
    })

    // 拖拽平移：按住画布拖动相机。位移**除以 zoom**——`scrollX` 是世界像素，
    // 而指针位移是屏幕像素；不除的话放大后"拖一格跳很远"。
    let dragging = false
    let lastX = 0
    let lastY = 0
    scene.input.on('pointerdown', (pointer) => {
      // 点在角色上时不进入拖拽（否则"点人"会变成"拖地图"，选不中）。
      if (pointer.rightButtonDown()) return
      dragging = true
      lastX = pointer.x
      lastY = pointer.y
    })
    scene.input.on('pointermove', (pointer) => {
      if (dragging !== true || pointer.isDown !== true) return
      const zoom = camera.zoom || 1
      const dx = (pointer.x - lastX) / zoom
      const dy = (pointer.y - lastY) / zoom
      lastX = pointer.x
      lastY = pointer.y
      // 直接改 scroll 并立即夹取：拖拽要跟手，**不能**走 `pan()` 的缓动（那会有拖影感）。
      camera.setScroll(camera.scrollX - dx, camera.scrollY - dy)
      camera.setScroll(Math.round(camera.scrollX), Math.round(camera.scrollY))
    })
    scene.input.on('pointerup', () => {
      dragging = false
    })
    scene.input.on('pointerupoutside', () => {
      dragging = false
    })

    // 键盘推相机：**用 Phaser 自带的 FixedKeyControl**，它自己算速度与积分。
    if (scene.input.keyboard !== null && scene.input.keyboard !== undefined) {
      keyControl = new Cameras.Controls.FixedKeyControl({
        camera,
        left: scene.input.keyboard.addKey('A'),
        right: scene.input.keyboard.addKey('D'),
        up: scene.input.keyboard.addKey('W'),
        down: scene.input.keyboard.addKey('S'),
        speed: KEY_SPEED / 1000,
      })
    }
  }

  // ── Phaser 场景：装载 → 建对象 → 每帧按我们的数据对齐 ───────────────────────

  class AgentWorldScene extends Scene {
    constructor() {
      super('world')
    }

    preload() {
      // 我们的数据（世界快照）比引擎启动**晚到**，所以这里不排资产——装载由
      // `ensureAssets()` 在第一次 `render()` 里按需发起（见那里的注释）。
      this.load.on('loaderror', (file) => { state.loadError = `load-error: ${file?.key ?? '?'}` })
    }

    create() {
      // 主相机画世界（zoom = 16 × 整数倍）；文字层交给一台 **zoom=1 的 UI 相机**——
      // 否则 10px 的字会被相机放大 32 倍（这正是"手写渲染器"里没这问题、
      // 换成引擎后最容易踩的坑：缩放是全局的）。
      this.uiCamera = this.cameras.add(0, 0, viewSize(live.canvas).width, viewSize(live.canvas).height)
      this.uiCamera.setZoom(1)
      this.layers = {
        ground: this.add.container(0, 0),
        props: this.add.container(0, 0),
        actors: this.add.container(0, 0),
        notes: this.add.container(0, 0),
        // 文字层**不归主相机管**：主相机 zoom 是 32，10px 的字会被放大 32 倍
        labels: this.add.container(0, 0),
      }
      const main = this.cameras.main
      main.ignore(this.layers.labels)
      this.uiCamera.ignore([this.layers.ground, this.layers.props, this.layers.actors, this.layers.notes])
      buildAnims()
      wireViewControls(this)
      activeScene = this
      // 计数必须在**渲染器真的存在**之后装：`new Game()` 之后那一刻 renderer 还没建出来，
      // 在构造后立刻装的那一版被守卫挡掉了 —— 表现是 drawCalls 永远是 0。
      installFrameCounter(this.game)
      state.ready = true
      // R72：进场用**默认固定档**（不是适配档），居中于世界（不吸附任何 agent）。
      // `applyCamera()` 不管 zoom，所以这里显式设一次（用 `zoomNow()` 把默认档夹进范围）。
      this.cameras.main.setZoom(zoomNow())
      applyCamera()
      if (lastRenderInput !== null) render(lastRenderInput)
      if (typeof options.onReady === 'function') options.onReady()
    }

    /**
     * 每帧：推进键盘相机控制（R65）。
     *
     * `FixedKeyControl` 是 Phaser 的**有状态**控制器——它自己记按键、自己按 delta 积分，
     * 所以必须每帧喂它 delta。放在场景的 `update()` 里是引擎的标准位置
     *（`Scene.update(time, delta)` 由 Phaser 主循环调用）。
     */
    update(_time, delta) {
      if (keyControl !== null && keyControl !== undefined) keyControl.update(delta)
      // 拖拽/键盘动过相机之后把滚动量取整，否则半像素会让整张图糊掉。
      const camera = this.cameras.main
      camera.setScroll(Math.round(camera.scrollX), Math.round(camera.scrollY))
    }
  }

  /**
   * 图集就绪 → 算一次"多带 → 线性帧号"，把帧号数组喂给 `anims.create`（纯数据，不每帧算）。
   *
   * 这一步就是 R58 删掉的 `frameIndex/frameRect/frameIndex` 那 129 行的**替代**：
   * 换算还在（契约是多带的，Phaser 只认线性帧号），但"每帧算第几帧"这件事归引擎了。
   */
  function buildAnims() {
    if (activeScene === null) return
    for (const [key, url] of plannedAssets) {
      const sheet = sheetByUrl.get(url)
      if (sheet === undefined || activeScene.textures.exists(key) !== true) continue
      const image = activeScene.textures.get(key).getSourceImage()
      const perRow = framesPerRow(sheet, image?.width ?? 0)
      perRowByUrl.set(url, perRow)
      for (const [name, anim] of Object.entries(sheet.animations ?? {})) {
        const animKey = keyOfAnimationName(name)
        if (activeScene.anims.exists(animKeyFor(key, animKey)) === true) continue
        const rate = frameRateOf(anim)
        activeScene.anims.create({
          key: animKeyFor(key, animKey),
          frames: animationFrameList(sheet, anim, perRow).map((frame) => ({ key, frame })),
          // 单帧/静态动画给最小速率：`frameRate: 0` 会让引擎一直重算
          frameRate: rate > 0 ? rate : 1,
          repeat: Math.max(1, Math.floor(Number(anim?.frames) || 1)) > 1 ? -1 : 0,
        })
      }
    }
  }

  /**
   * 按需装载图集（**运行时**发起）。
   *
   * 为什么不在 `preload()` 里排：世界快照是**异步到的**，而 `preload()` 在引擎启动时就跑完了
   * ——第一版就是栽在这儿：图集没排进去，8 个角色全走了色块回退。
   * Phaser 的 loader 支持运行中追加 + `start()`，加载完回调里再建动画。
   */
  function ensureAssets(plan) {
    if (activeScene === null) return false
    const planned = planAssets(plan)
    const missing = [...planned.assets].filter(([key]) => activeScene.textures.exists(key) !== true)
    if (missing.length === 0) {
      plannedAssets = planned.assets
      sheetByUrl = planned.sheets
      assetsPlanned = true
      buildAnims()
      return false
    }
    plannedImages = planned.images
    if (assetsLoading === true) return true
    // ⚠️ 模型 url 是**相对内容目录**的（`microverse/floors/floor-office.png`），而页面在
    // `/agent-world/`：不给基址就会去请求 `/agent-world/microverse/...`（404）。
    // 动态加载时 `preload` 里设过的基址不生效，必须在这里再设一次。
    activeScene.load.setBaseURL(options.assetBaseUrl ?? './vendor/')
    for (const [key, url] of missing) {
      if (planned.images.get(key) !== undefined) {
        // 底图就是一整张图（没有帧网格）
        activeScene.load.image(key, url)
        continue
      }
      const sheet = planned.sheets.get(url)
      const cellW = Math.max(1, Math.round(Number(sheet?.cellW) || 16))
      const cellH = Math.max(1, Math.round(Number(sheet?.cellH) || cellW))
      // **切帧交给引擎**：多带图集在 Phaser 眼里就是普通 spritesheet
      activeScene.load.spritesheet(key, url, { frameWidth: cellW, frameHeight: cellH })
    }
    plannedAssets = planned.assets
    sheetByUrl = planned.sheets
    assetsLoading = true
    activeScene.load.once('complete', () => {
      assetsLoading = false
      assetsPlanned = true
      buildAnims()
    })
    activeScene.load.start()
    return true
  }

  /** 从内容计划里排出要加载的图集（一次）。 */
  function planAssets(plan) {
    const assets = new Map()
    const sheets = new Map()
    const images = new Map()
    // 底图：一整张烘好的图（不是图块网格）
    if (plan?.map !== null && plan?.map !== undefined && typeof plan.map.url === 'string' && plan.map.url !== '') {
      images.set(MAP_KEY, plan.map.url)
      assets.set(MAP_KEY, plan.map.url)
    }
    for (const model of plan?.models ?? []) {
      if (model?.sheet === null || model?.sheet === undefined || typeof model.url !== 'string') continue
      sheets.set(model.url, model.sheet)
      const key = textureKeyByUrl.get(model.url) ?? `tex:${model.url}`
      textureKeyByUrl.set(model.url, key)
      assets.set(key, model.url)
    }
    return { assets, sheets, images }
  }

  // ── 地面 ─────────────────────────────────────────────────────────────────

  /** 染色地面纹理（烘一次、缓存）：`round(砖色 × 区色 / 255)`，与 R55 的乘算同一套算术。 */
  function tintedFloorKey(url, sheet, colorHex) {
    const key = `floor:${url}|${colorHex}`
    if (activeScene.textures.exists(key) === true) return key
    const image = loader.image(url)
    if (image === null) return null
    const cellW = Math.max(1, Math.round(Number(sheet.cellW) || 32))
    const cellH = Math.max(1, Math.round(Number(sheet.cellH) || cellW))
    const anim = Object.values(sheet.animations ?? {})[0]
    const col = Math.max(0, Math.floor(Number(anim?.col) || 0))
    const row = Math.max(0, Math.floor(Number(anim?.row) || 0))
    const surface = (globalThis.document ?? {}).createElement?.('canvas')
    if (surface === undefined || surface === null) return null
    surface.width = cellW
    surface.height = cellH
    const ctx = surface.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(image, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH)
    const color = parseRgb(colorHex)
    if (color !== null) {
      const pixels = ctx.getImageData(0, 0, cellW, cellH)
      const data = pixels.data
      for (let i = 0; i + 3 < data.length; i += 4) {
        data[i] = Math.round((data[i] * color[0]) / 255)
        data[i + 1] = Math.round((data[i + 1] * color[1]) / 255)
        data[i + 2] = Math.round((data[i + 2] * color[2]) / 255)
      }
      ctx.putImageData(pixels, 0, 0)
    }
    activeScene.textures.addCanvas(key, surface)
    return key
  }

  function drawGround(plan) {
    const models = new Map((plan?.models ?? []).map((model) => [model.id, model]))
    const wanted = new Set()

    // ── 底图（R62）─────────────────────────────────────────────────────────
    // 对齐换算：图左上角 = 世界 `(-halfW, -halfH)`（`halfW = width*unitsPerCell/2`），
    // 世界坐标中心为 0、图坐标左上为 0 —— 所以位置是 `-half * TILE_PX` 的**世界像素**。
    // 图 1184×672 源像素、一个地图格 = `unitsPerCell`(2) 单位 = 32 世界像素 → **1:1，scale 1**。
    const map = plan?.map ?? null
    const frame = worldFrame(plan)
    const hasMap = map !== null && map !== undefined && typeof map.url === 'string' && activeScene.textures.exists(MAP_KEY) === true
    if (hasMap) {
      let image = groundNodes.get('map')
      if (image === undefined) {
        image = activeScene.add.image(frame.originPxX, frame.originPxY, MAP_KEY)
        image.setOrigin(0, 0)
        image.setDepth(-1)
        activeScene.layers.ground.add(image)
        groundNodes.set('map', image)
      }
      image.setTexture(MAP_KEY)
      image.setPosition(frame.originPxX, frame.originPxY)
      image.setVisible(true)
      wanted.add('map')
    }
    // 底下按分区铺色只在**没有底图**时画（有底图会盖住它，还会在图外铺出一片怪色）
    if (!hasMap) {
    for (const district of plan?.ground ?? []) {
      const model = district.modelId === null || district.modelId === undefined ? null : models.get(district.modelId)
      const sheet = model?.sheet ?? null
      const baseKey = sheet === null || typeof model?.url !== 'string' ? null : textureKeyByUrl.get(model.url) ?? null
      const usable = baseKey !== null && activeScene.textures.exists(baseKey) === true
      const tilePx = Math.max(1, Math.round(Number(sheet?.cellW) || 32))
      const tilePy = Math.max(1, Math.round(Number(sheet?.cellH) || tilePx))
      // **世界像素**：一个旧世界单位 = TILE_PX 世界像素。地面尺寸按纹理像素算。
      const leftPx = (district.x - district.width / 2) * TILE_PX
      const topPx = (district.z - district.depth / 2) * TILE_PX
      const widthPx = Math.max(1, Math.round(district.width * TILE_PX))
      const heightPx = Math.max(1, Math.round(district.depth * TILE_PX))
      const key = `ground:${district.id}`
      wanted.add(key)
      let node = groundNodes.get(key)
      const kind = usable ? 'TileSprite' : 'Rectangle'
      if (node === undefined || node.__kind !== kind) {
        node?.destroy()
        if (usable) {
          const tinted = tintedFloorKey(model.url, sheet, district.color)
          if (tinted === null) continue
          node = activeScene.add.tileSprite(0, 0, widthPx, heightPx, tinted)
          node.tilePositionX = -tilePhasePx({ leftWorld: leftPx, tileUnits: tilePx, scale: 1 })
          node.tilePositionY = -tilePhasePx({ leftWorld: topPx, tileUnits: tilePy, scale: 1 })
        } else {
          // 回退：没有图集就一块纯色（R47：缺东西要一眼看得出来，不能白屏）
          node = activeScene.add.rectangle(0, 0, widthPx, heightPx, colorOf(district.color), 1)
        }
        node.setOrigin(0, 0)
        node.setPosition(Math.round(leftPx), Math.round(topPx))
        node.__kind = kind
        node.setDepth(0)
        activeScene.layers.ground.add(node)
        groundNodes.set(key, node)
      } else {
        node.setSize(widthPx, heightPx)
        node.setPosition(Math.round(leftPx), Math.round(topPx))
      }
      node.setVisible(true)
    }
    }
    for (const [key, node] of groundNodes) if (!wanted.has(key)) node.setVisible(false)
  }

  // ── 家具 / 角色 / 纸条 ────────────────────────────────────────────────────

  function drawProps(plan) {
    const models = new Map((plan?.models ?? []).map((model) => [model.id, model]))
    const wanted = new Set()
    for (const prop of plan?.props ?? []) {
      const parts = [...(prop.parts ?? [])].sort((a, b) => (a.dz ?? 0) - (b.dz ?? 0))
      let spriteCount = 0
      parts.forEach((part, index) => {
        const model = models.get(part.modelId)
        const sheet = model?.sheet ?? null
        const key = sheet === null || typeof model?.url !== 'string' ? null : textureKeyByUrl.get(model.url) ?? null
        if (key === null || activeScene.textures.exists(key) !== true) return
        const nodeKey = `prop:${prop.id}#${index}`
        wanted.add(nodeKey)
        let node = propNodes.get(nodeKey)
        if (node === undefined) {
          node = activeScene.add.sprite(0, 0, key)
          node.setDepth(1)
          activeScene.layers.props.add(node)
          propNodes.set(nodeKey, node)
        }
        const [ox, oy] = originOf(sheet)
        node.setTexture(key)
        // 单帧模型也要显式设帧：不设就是 `__BASE`（整张图当一帧）
        const firstAnim = Object.values(sheet.animations ?? {})[0]
        if (firstAnim !== undefined) node.setFrame(animationFrameList(sheet, firstAnim, perRowByUrl.get(model.url) ?? 1)[0] ?? 0)
        node.setOrigin(ox, oy)
        node.setPosition(Math.round((prop.x + (part.dx ?? 0)) * TILE_PX), Math.round((prop.z + (part.dz ?? 0)) * TILE_PX))
        node.setVisible(true)
        spriteCount += 1
      })
      // 有底图时不给"没有外观的站点"画色块：原版这 24 把椅子的家具在**地图的图块里**，
      // 再画色块就会在地上多出一堆方块。（没有底图时保留色块回退 = 缺东西要看得见）
      if (spriteCount === 0 && plan?.map !== null && plan?.map !== undefined) continue
      if (spriteCount === 0) {
        const nodeKey = `propr:${prop.id}`
        wanted.add(nodeKey)
        let node = propNodes.get(nodeKey)
        const size = (prop.capacity > 1 ? 18 : 13)
        if (node === undefined) {
          node = activeScene.add.rectangle(0, 0, size, size, colorOf(prop.color), 1)
          node.setDepth(1)
          activeScene.layers.props.add(node)
          propNodes.set(nodeKey, node)
        }
        node.setPosition(Math.round(prop.x * TILE_PX), Math.round(prop.z * TILE_PX))
        node.setVisible(true)
      }
    }
    for (const [key, node] of propNodes) if (!wanted.has(key)) node.setVisible(false)
  }

  /** 角色：精灵 + 引擎动画（`play`）+ 名字；`setInteractive` 让**整只角色**可点。 */
  function drawActors(worldState, plan, nowMs) {
    const models = new Map((plan?.models ?? []).map((model) => [model.id, model]))
    const actors = [...liveActorsOf(worldState, plan)].sort((a, b) => a.z - b.z)
    const variants = assignColorVariants(actors)
    const wanted = new Set()
    let spriteCount = 0
    let fallbackCount = 0
    for (const actor of actors) {
      const model = actor.modelId === null ? undefined : models.get(actor.modelId)
      const sheet = model?.sheet ?? null
      const nodeKey = `actor:${actor.id}`
      wanted.add(nodeKey)
      let entry = actorNodes.get(actor.id)
      if (entry === undefined) {
        const label = activeScene.add.text(0, 0, actor.name ?? actor.id, LABEL_STYLE)
        label.setOrigin(0.5, 1)
        label.setDepth(5)
        activeScene.layers.labels.add(label)
        entry = { sprite: null, label }
        actorNodes.set(actor.id, entry)
      }
      if (entry.label.text !== (actor.name ?? actor.id)) entry.label.text = actor.name ?? actor.id
      const baseKey = sheet === null || typeof model?.url !== 'string' ? null : textureKeyByUrl.get(model.url) ?? null
      const posX = Math.round(actor.x * TILE_PX)
      const posY = Math.round(actor.z * TILE_PX)
      if (baseKey !== null && activeScene.textures.exists(baseKey) === true) {
        const textureKey = ensureTintedSheet(model.url, actor.color, variants.get(actor.id) ?? 0, sheet) ?? baseKey
        if (entry.sprite === null) {
          entry.sprite = activeScene.add.sprite(0, 0, textureKey)
          entry.sprite.setDepth(2)
          activeScene.layers.actors.add(entry.sprite)
          // **整只角色可点**（不是脚下一个小圆）——用 Phaser 自己的交互系统。
          //
          // ## 这里曾经是"两套拾取"（R66 修掉）
          //
          // 原来 `setInteractive` 只用来出手型，**真正"点了谁"走的是我手写的
          // `pick()`**（遍历精灵 `getBounds()` 做命中判定）。于是同一个问题有两套实现：
          // 引擎那套只写了个调试全局，真路径在自写的那套上——这正是 D56 要禁的形态
          //（"能用引擎现成的却自己搞"），而且两套几何一旦漂移就会"点得中但选不中"。
          //
          // 现在真路径就是引擎的：`pointerup` 只在**指针在该对象上抬起**时触发，
          // 而"忽略拖拽/长按"这两个产品规则由 **Phaser 的 Pointer 自带 API** 表达——
          // `pointer.getDistance()`（按下到抬起的位移）与 `pointer.getDuration()`（按住时长）。
          // 不需要自己记 downX/downY/downAt（那是 `main.js::bindPick` 手写的那套）。
          entry.sprite.setInteractive({ useHandCursor: true })
          entry.sprite.on('pointerup', (pointer) => {
            if (actorPick === null) return
            // 拖拽（在拖地图）不算点人：位移超过 5px 就放过。
            if (typeof pointer.getDistance === 'function' && pointer.getDistance() > 5) return
            // 长按也不算点人（700ms 以上）。
            if (typeof pointer.getDuration === 'function' && pointer.getDuration() > 700) return
            // R72：点人只开对话，**不动镜头**（缩放不吸附 agent）。
            actorPick(actor.id)
          })
        }
        entry.sprite.setTexture(textureKey)
        const [ox, oy] = originOf(sheet)
        entry.sprite.setOrigin(ox, oy)
        entry.sprite.setPosition(posX, posY)
        entry.sprite.setVisible(true)
        // `setTexture` 之后帧可能是 `__BASE`（整张图）——但**只在没有动画可播时才钉帧**。
        // ⚠️ 这里曾经**每帧都 setFrame(第一帧)**，结果动画永远冻在第一帧：
        // `currentAnim.key` 看着是对的，人却在原地滑（R64 逐个验方向时才逮到）。
        const firstAnim = Object.values(sheet?.animations ?? {})[0]
        const firstFrame = firstAnim === undefined
          ? 0
          : (animationFrameList(sheet, firstAnim, perRowByUrl.get(model.url) ?? 1)[0] ?? 0)
        // 该播哪个动画：**回退链在纯函数里**（返回候选名），`play` 交给引擎。
        // 动画按纹理分开命名（重上色纹理有它自己的一套），否则换色会串回原图。
        const animName = resolveAnimationKey((name) => activeScene.anims.exists(animKeyFor(textureKey, name)) === true, {
          // **带由内容库给**（`ScenePlan.actions`）：working → sit，其余按库里的声明。
          // 渲染器不自己编这套映射——那正是"坐着干活的人站着"那类错藏身的地方。
          band: bandOfState(plan?.actions, actor.state),
          direction: directionOf(actor.facing),
        })
        if (animName !== null) {
          const fullKey = animKeyFor(textureKey, animName)
          if (entry.sprite.anims.currentAnim?.key !== fullKey) entry.sprite.play(fullKey, true)
          // 正在播就**别碰帧**（碰了就成了"看着在走、其实是冻帧"）；没在播才钉第一帧
          else if (entry.sprite.anims.isPlaying !== true) entry.sprite.setFrame(firstFrame)
        }
        const heightPx = Math.max(1, Math.round(Number(sheet.cellH) || 16))
        entry.label.setPosition(Math.round(screenX(actor.x)), Math.round(screenY(actor.z) - heightPx - 4))
        entry.label.setVisible(true)
        spriteCount += 1
        continue
      }
      fallbackCount += 1
      if (entry.sprite === null || entry.sprite.type !== 'Rectangle') {
        entry.sprite?.destroy()
        entry.sprite = activeScene.add.rectangle(0, 0, 12, 12, colorOf(actor.color), 1)
        entry.sprite.setDepth(2)
        activeScene.layers.actors.add(entry.sprite)
      }
      entry.sprite.setPosition(posX, posY)
      entry.sprite.setVisible(true)
      entry.label.setPosition(Math.round(screenX(actor.x)), Math.round(screenY(actor.z) - 18))
      entry.label.setVisible(true)
    }
    for (const [id, entry] of actorNodes) {
      if (wanted.has(`actor:${id}`)) continue
      entry.sprite?.setVisible(false)
      entry.label.setVisible(false)
    }
    actorPathCounts.sprites = spriteCount
    actorPathCounts.fallbacks = fallbackCount
  }

  const tintedSheetKeys = new Map()

  /**
   * 重上色纹理（复用 loader 的离屏 canvas：重上色是**内容**的事，不是引擎的）。
   *
   * ⚠️ 两个坑都在这里（R58 各踩了一次）：
   * 1. `addCanvas` 只给**一整张图**（frame `__BASE`）。不补帧网格的话，精灵会把整张
   *    1792×1280 的图当一帧画出来——实测表现是"角色包围盒 1792×1280、点哪都中"。
   * 2. 帧号必须与基础图集**一一对应**（`row * perRow + col`），否则按动画播会串帧。
   * 所以这里把同一套网格补上，并给这张纹理建**它自己的**动画（key 带纹理前缀）。
   */
  function ensureTintedSheet(url, color, variant, sheet) {
    const cacheKey = `${url}|${color}|${variant}`
    const cached = tintedSheetKeys.get(cacheKey)
    if (cached !== undefined) return cached
    const canvas = loader.recoloredImage(url, color, variant)
    if (canvas === null) return null
    const key = `tint:${cacheKey}`
    if (activeScene.textures.exists(key) !== true) {
      const texture = activeScene.textures.addCanvas(key, canvas)
      const perRow = perRowByUrl.get(url) ?? framesPerRow(sheet, canvas.width)
      const cellW = Math.max(1, Math.round(Number(sheet?.cellW) || 16))
      const cellH = Math.max(1, Math.round(Number(sheet?.cellH) || cellW))
      const cols = Math.max(1, Math.min(perRow, Math.floor(canvas.width / cellW)))
      const rows = Math.max(1, Math.floor(canvas.height / cellH))
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          // 帧号与基础图集一致：`row * cols + col`（Phaser 的 spritesheet 就是这个排法）
          texture.add(row * cols + col, 0, col * cellW, row * cellH, cellW, cellH)
        }
      }
      for (const [name, anim] of Object.entries(sheet?.animations ?? {})) {
        const animKey = animKeyFor(key, keyOfAnimationName(name))
        if (activeScene.anims.exists(animKey) === true) continue
        const rate = frameRateOf(anim)
        activeScene.anims.create({
          key: animKey,
          frames: animationFrameList(sheet, anim, perRow).map((frame) => ({ key, frame })),
          frameRate: rate > 0 ? rate : 1,
          repeat: Math.max(1, Math.floor(Number(anim?.frames) || 1)) > 1 ? -1 : 0,
        })
      }
    }
    tintedSheetKeys.set(cacheKey, key)
    return key
  }

  /** 区块名（文字交给 **zoom=1 的 UI 相机**，所以位置是屏幕坐标）。 */
  function drawLabels(plan) {
    const wanted = new Set()
    for (const district of plan?.ground ?? []) {
      const key = `label:${district.id}`
      wanted.add(key)
      let label = labelNodes.get(key)
      if (label === undefined) {
        label = activeScene.add.text(0, 0, district.name, LABEL_STYLE)
        label.setDepth(3)
        activeScene.layers.labels.add(label)
        labelNodes.set(key, label)
      }
      if (label.text !== district.name) label.text = district.name
      label.setPosition(
        Math.round(screenX(district.x - district.width / 2)) + 8,
        Math.round(screenY(district.z - district.depth / 2)) + 6,
      )
      label.setVisible(true)
    }
    for (const [key, label] of labelNodes) if (!wanted.has(key)) label.setVisible(false)
  }

  /** 飞行中的纸条（Phaser 的 Rectangle；位置按插值走，引擎负责合成）。 */
  function drawNotes(worldState, plan, tick, messageDeliveryTicks) {
    if (worldState === null) return
    const actors = new Map(liveActorsOf(worldState, plan).map((a) => [a.id, a]))
    const fallbackDelay = messageDeliveryTicks ?? 10
    const wanted = new Set()
    let index = 0
    for (const message of worldState.messages ?? []) {
      if (message.deliveredAtTick !== null) continue
      const at = message.atTick ?? 0
      const deliverAt = message.deliverAtTick ?? at + fallbackDelay
      const t = (tick - at) / Math.max(1, deliverAt - at)
      if (t < 0 || t > 1) continue
      const from = actors.get(message.from)
      const to = actors.get(message.to)
      if (from === undefined || to === undefined) continue
      const key = `note:${message.id ?? index}`
      wanted.add(key)
      index += 1
      let node = noteNodes.get(key)
      if (node === undefined) {
        node = activeScene.add.rectangle(0, 0, 6, 5, colorOf(plan?.noteColors?.[message.kind] ?? '#FF00FF'), 1)
        node.setDepth(4)
        activeScene.layers.notes.add(node)
        noteNodes.set(key, node)
      }
      node.setPosition(
        Math.round((from.x + (to.x - from.x) * t) * TILE_PX - 3),
        Math.round((from.z + (to.z - from.z) * t) * TILE_PX - 2),
      )
      node.setVisible(true)
    }
    for (const [key, node] of noteNodes) if (!wanted.has(key)) node.setVisible(false)
  }

  // ── 画一帧 ───────────────────────────────────────────────────────────────

  function render(input = {}) {
    lastRenderInput = input
    const { world: worldState, scene: plan, tick, messageDeliveryTicks } = input
    if (worldState === null || worldState === undefined || plan === null || plan === undefined) return
    state.world = worldState
    state.plan = plan
    state.tick = tick ?? 0
    state.messageDeliveryTicks = messageDeliveryTicks ?? 10
    state.nowMs = Number.isFinite(input.nowMs) ? input.nowMs : (globalThis.performance?.now?.() ?? 0)

    if (state.ready !== true || activeScene === null) {
      // 还没 create：尺寸**交给 Scale Manager**（`Scale.RESIZE` 会跟着父容器走），
      // 我们不再手调 `game.scale.resize()`——R65 之前那版手调过一次，
      // 真机上漏了一拍（缓冲区 1227×409 vs CSS 1227×669）。
      // 这里只记下"想要多大"，create 之后由引擎与 `applyCamera()` 各自负责自己那半。
      pendingSize = pendingSize ?? initial
      return
    }

    // 资产按需加载（第一帧几乎一定缺图 → 先排上下载，图到了再画）
    if (assetsPlanned !== true || assetsLoading === true) {
      const stillLoading = ensureAssets(plan)
      // 我们的 loader（重上色/调色板要用同一张图）也跟着预热
      for (const url of sheetByUrl.keys()) void loader.image(url)
      if (stillLoading) return
    }

    drawGround(plan)
    drawLabels(plan)
    drawProps(plan)
    drawActors(worldState, plan, state.nowMs)
    drawNotes(worldState, plan, state.tick, messageDeliveryTicks)
    applyCamera()
    // 绘制次数不在这里数：那是**引擎自己那一帧**的事，挂在它的帧钩子上（见下），
    // 手动多渲染一遍只会让这一帧画两次。
    lastStats = {
      renderer: 'phaser',
      backend: backendName(),
      batched: backendName() === 'webgl',
      // WebGL：真实 GL 绘制次数（合批后）；canvas：每个对象一次提交 → 报对象数
      drawCalls: backendName() === 'canvas' ? countVisible() : (lastStats.drawCalls ?? 0),
      sprites: countVisible(),
      textures: activeScene.textures.getTextureKeys().length,
      actorSprites: actorPathCounts.sprites,
      actorFallbacks: actorPathCounts.fallbacks,
      anims: activeScene.anims.anims.size,
      ready: true,
      loadError: state.loadError,
    }
  }

  function backendName() {
    return game?.renderer?.type === CANVAS ? 'canvas' : 'webgl'
  }

  function countVisible() {
    let count = 0
    for (const container of Object.values(activeScene.layers)) {
      for (const node of container.list) if (node.visible !== false) count += 1
    }
    return count
  }

  // ── 绘制次数（原型级 + 自证）──────────────────────────────────────────────

  function installCounter() {
    if (globalThis.__dshGLCounter === true) return
    const prototypes = [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext].filter(Boolean)
    for (const proto of prototypes) {
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const original = proto.prototype[name]
        if (typeof original !== 'function' || original.__dshWrapped === true) continue
        const wrapped = function (...args) {
          // **无条件累加**：只按"这一帧的起止"取差值。带开关的版本要依赖
          // "开关在绘制之前置上"，一旦时序错开就永远读 0（R58 踩过）。
          globalThis.__dshTotalDraws = (globalThis.__dshTotalDraws ?? 0) + 1
          return original.apply(this, args)
        }
        wrapped.__dshWrapped = true
        proto.prototype[name] = wrapped
      }
    }
    globalThis.__dshGLCounter = true
  }

  /**
   * 数**引擎自己那一帧**提交了几次 GL 绘制。
   *
   * 挂在 Phaser 的 `prerender` / `postrender` 钩子上，所以不会为了数数而多渲染一遍；
   * 计数打在 **`WebGL2RenderingContext.prototype`**（打实例会被"引擎缓存过方法引用"绕过，
   * 那是 R57 踩过的坑）。canvas 渲染器没有 GL draw → 0。
   */
  function installFrameCounter(game_instance) {
    const renderer = game_instance.renderer
    if (typeof renderer?.preRender !== 'function' || typeof renderer?.postRender !== 'function') return
    // 每帧的边界就是渲染器的 preRender/postRender（**每个相机各调一次 render，所以只有这里
    // 是"一帧"的边界**）。包它们比猜事件名可靠。
    const preRender = renderer.preRender.bind(renderer)
    const postRender = renderer.postRender.bind(renderer)
    renderer.preRender = Object.assign((...args) => {
      globalThis.__dshFrameStart = globalThis.__dshTotalDraws ?? 0
      return preRender(...args)
    }, { __dshWrapped: true })
    renderer.postRender = Object.assign((...args) => {
      const result = postRender(...args)
      // 这一帧 = postRender 时的总数 − preRender 时的总数（两台相机的提交都算进来）
      const draws = (globalThis.__dshTotalDraws ?? 0) - (globalThis.__dshFrameStart ?? 0)
      lastStats = { ...lastStats, drawCalls: draws, totalDraws: globalThis.__dshTotalDraws ?? 0 }
      return result
    }, { __dshWrapped: true })
  }

  // ── 对外接口（与 canvas2D/Pixi 版本**逐个同名同参**）──────────────────────

  function metrics(scene) {
    const { width, height } = viewSize(live.canvas)
    const plan = scene ?? state.plan
    const frame = worldFrame(plan)
    // ⚠️ **以相机的真实 zoom 为准**，不在这里重算。
    // R65 加了用户缩放之后，"重新算一遍适配档"就成了错的——用户放大到 4 倍时
    // 这里会算出 1，于是**名字标签与气泡会留在原地、而画面已经放大**（错位得很明显）。
    // R62 已经因为"理想居中 vs 相机真实滚动"差过 108/38 像素，同一个坑不要再踩第二次：
    // **凡是相机状态，一律读相机本身**；没有相机（还没起来）才退回适配档。
    const camera = activeScene?.cameras?.main
    const zoom = camera === undefined || camera === null ? fitZoomNow() : (camera.zoom || 1)
    const scale = TILE_PX * zoom
    return {
      width,
      height,
      half: frame.halfW,
      zoom,
      scale,
      // **以相机的真实状态为准**（滚动 + 缩放）：相机可能被 `setBounds` 夹住、将来还会跟随角色，
      // 用"理想居中"的公式算出来的锚点会和画面对不上（R62 就是这样差了 108/38 像素）。
      toX: (x) => x * scale - scrollXNow(),
      toY: (z) => z * scale - scrollYNow(),
      toWorldX: (px) => (px + scrollXNow()) / scale,
      toWorldZ: (py) => (py + scrollYNow()) / scale,
    }
  }

  /** 相机当前的滚动量（画布像素）——锚点/拾取都从它推。 */
  function scrollXNow() {
    const camera = activeScene?.cameras?.main
    return camera === undefined || camera === null ? 0 : camera.scrollX * (camera.zoom || 1)
  }

  function scrollYNow() {
    const camera = activeScene?.cameras?.main
    return camera === undefined || camera === null ? 0 : camera.scrollY * (camera.zoom || 1)
  }

  function resize() {
    const size = viewSize(live.canvas)
    if (game !== null && state.ready === true) {
      // ⚠️ `Scale.RESIZE` 模式下**不要再手调 `game.scale.resize()`**（R65）。
      // 引擎已经在监听父容器、自己同步画布缓冲区；再手调一次是重复劳动，
      // 而且会走一遍引擎的 resize 流程（真机上表现为"缩放被重置"）。
      // 这里只做引擎不管的那件事：**按新视口重新取景**。
      applyCamera()
    } else {
      pendingSize = size
    }
  }

  /**
   * 点了谁（返回 agentId 或 null，签名不变）。
   *
   * 判定用 **精灵自己的包围盒**（`getBounds()`，与 `setInteractive` 同一份几何）：
   * R57 用的"脚下 ±16px 圆"实测让角色的头/身体 3/4 点不中（R58 查清的死角）。
   */
  function pick({ world: worldState, scene: plan, clientX, clientY }) {
    const sourceWorld = worldState ?? state.world
    const source = plan ?? state.plan
    if (sourceWorld === null || source === null || state.ready !== true || activeScene === null) return null
    const rect = live.canvas.getBoundingClientRect()
    // **相机的反算**（引擎自带）：客户端坐标 → 世界像素
    const point = activeScene.cameras.main.getWorldPoint(clientX - rect.left, clientY - rect.top)
    let best = null
    let bestDistance = Infinity
    for (const actor of liveActorsOf(sourceWorld, source)) {
      const entry = actorNodes.get(actor.id)
      const sprite = entry?.sprite
      if (sprite === undefined || sprite === null || sprite.visible === false) continue
      if (typeof sprite.getBounds !== 'function') continue
      const bounds = sprite.getBounds()
      if (bounds.contains(point.x, point.y) !== true) continue
      const distance = Math.hypot(point.x - bounds.centerX, point.y - bounds.centerY)
      if (distance < bestDistance) {
        best = actor.id
        bestDistance = distance
      }
    }
    return best
  }

  /** 角色头顶在**画布内**的像素位置（HTML 气泡挂钩用）。 */
  function anchorOf({ world: worldState, scene: plan, agentId }) {
    const sourceWorld = worldState ?? state.world
    const source = plan ?? state.plan
    if (sourceWorld === null || source === null) return null
    const actor = liveActorsOf(sourceWorld, source).find((a) => a.id === agentId)
    if (actor === undefined) return null
    const m = metrics(source)
    return {
      x: m.toX(actor.x),
      y: m.toY(actor.z) - ANCHOR_LIFT_PX,
      width: m.width,
      height: m.height,
      behind: false,
    }
  }

  function stats() {
    return { ...lastStats, backend: backendName(), loadError: state.loadError }
  }

  // ── 启动 ─────────────────────────────────────────────────────────────────

  installCounter()

  function startGame() {
    const size = viewSize(live.canvas)
    game = new Game({
      type: rendererType,
      canvas: live.canvas,
      width: size.width,
      height: size.height,
      // **像素画两条**：全局最近邻（pixelArt）+ 顶点取整（roundPixels）
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      banner: false,
      audio: { noAudio: true },
      // ⚠️ **`Scale.RESIZE`：让 Phaser 的 Scale Manager 跟着容器走**（R65）。
      //
      // 原来是 `Scale.NONE` + 我们自己调 `game.scale.resize()`，注释还写着"尺寸由 DOM 决定、
      // 不让 Scale Manager 接管"。那个自驱版本真机实测漏了一次：**画布的绘制缓冲区是
      // 1227×409，而 CSS 显示尺寸是 1227×669**——渲染分辨率比显示少了 40%，
      // 画面是被拉伸上去的（看着发糊就是这个原因）。R64 改了布局（多出看板行与 footer），
      // 我们的 `resize()` 没跟着跑。
      //
      // 现在交给引擎：`RESIZE` 会监听父容器尺寸并同步画布缓冲区——**"容器变了要跟着变"
      // 这件事本来就不该由业务代码维护**（这条和物理/寻路/相机是同一个道理）。
      scale: { mode: Scale.RESIZE, parent: live.canvas.parentElement ?? undefined, width: size.width, height: size.height },
      scene: AgentWorldScene,
    })
    activeScene = game.scene.getScene('world') ?? null
    game.events.once('ready', () => {
      activeScene = game.scene.getScene('world') ?? activeScene
    })
  }

  /**
   * 运行中 WebGL 上下文丢失 → **换一块画布 + 退回 canvas 渲染器**，场景接着画。
   *
   * 这一步替代了 R57 自己写的那套回退（现在删了）。为什么不能原地换后端：
   * 一块画布一旦有了 WebGL 上下文就再也拿不到 2d 上下文了，所以必须换节点；
   * 而 `main.js` 的点击监听绑在**旧节点**上，所以要把新画布上的指针事件转发过去。
   */
  function rebuildWithCanvas() {
    if (rendererType === CANVAS) return
    const previous = live.canvas
    const fresh = previous.cloneNode(false)
    previous.replaceWith(fresh)
    live.canvas = fresh
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'click']) {
      fresh.addEventListener(type, (event) => {
        previous.dispatchEvent(new PointerEvent(type, {
          clientX: event.clientX, clientY: event.clientY, bubbles: true, pointerId: 1, isPrimary: true, button: 0,
        }))
      })
    }
    rendererType = CANVAS
    state.ready = false
    state.loadError = 'webgl-context-lost → 已退回 canvas 渲染器'
    activeScene = null
    assetsPlanned = false
    try { game.destroy(true) } catch { /* 旧的已经没用了 */ }
    startGame()
    if (lastRenderInput !== null) render(lastRenderInput)
  }

  startGame()
  live.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    rebuildWithCanvas()
  })

  // 诊断入口：让核验脚本能直接问引擎（渲染器类型、计数器有没有装上、场景有几个动画）。
  // 只读，不改任何状态。
  globalThis.__agentWorldPhaser = {
    game: () => game,
    scene: () => activeScene,
    counterWrapped: () => {
      const renderer = game?.renderer
      return {
        hasPreRender: typeof renderer?.preRender === 'function',
        preRenderWrapped: renderer?.preRender?.__dshWrapped === true,
        postRenderWrapped: renderer?.postRender?.__dshWrapped === true,
        rendererClass: renderer?.constructor?.name ?? null,
        rendererType: renderer?.type ?? null,
      }
    },
  }

  return {
    resize,
    render,
    pick,
    // ── 视图控制（R65）：外壳的 − ＋ ⤢ ⌖ 四个按钮接这几个 ────────────────────
    zoomIn: () => applyZoomStep(1),
    zoomOut: () => applyZoomStep(-1),
    fitView,
    resetView,
    viewState,
    anchorOf,
    metrics,
    liveActors: liveActorsOf,
    stats,
    loader,
    /** 诊断：Phaser 到底用了哪个渲染器（webgl / canvas）。 */
    backend: backendName,
    /** 诊断：让夹具/测试能拿到 Phaser 的实例。 */
    game: () => game,
    scene: () => activeScene,
  }
}
