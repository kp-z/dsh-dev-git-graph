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
// R123：头顶工单行的**文本**逻辑住在 `core/`（纯函数、能在 node 里测）。
// 为什么不能留在本文件：这个文件顶部 `import ... from 'phaser'` 指向浏览器 vendor，
// **node 加载不了它**——留在这里就等于"这条逻辑永远无法单测"，
// 而真机上恰好验不到它（真实标题最长 10 字，截断上限 14）。
import { planTaskLabelStagger, taskLabelText } from '../core/task-label.js'
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
const LABEL_STYLE = { fontFamily: UI_FONT, fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }
/**
 * 头顶**第二行**：他此刻在做哪张单（R123 / R5 收口）。
 *
 * 为什么用 `...LABEL_STYLE` 展开而不是重写一份：色值只能从**内容库**来（D31），
 * 而 `LABEL_STYLE` 里那两个色（白字 + 黑描边）是**既有的**、已经被这套深色场景验证过。
 * 展开复用 = 不新增任何字面色值，同时保证两行标签的字形/描边完全一致。
 * 真正要改的只有字号（第二行要比名字小一号，形成层次）。
 */
const TASK_LABEL_STYLE = { ...LABEL_STYLE, fontSize: '11px' }
/**
 * 两个人靠得比这个还近（**屏幕上**的像素距离）时，两行工单都藏起来（R123）。
 *
 * 取 72px 的依据：一行工单标签（`#46 调研并确定方案 #4`）实测宽约 101px、高 13px，
 * 而人名标签约 43px 宽——72px 大约是"两个人的标签一定会压在一起"的量级，
 * 同时不会把"正常并排办公"的人误伤（他们相距通常 > 100px）。
 * ⚠️ 名字**不参与**这条规则：它永远保留（"谁在哪"是底线信息）。
 */
const TASK_LABEL_MIN_GAP_PX = 72
// R77：头顶气泡的对话框底图——Kenney 像素 UI 包的 9-slice 米色面板（48×48）。
// 用引擎的 `add.nineslice()` 撑到任意尺寸（游戏引擎成熟方案），不再手画圆角矩形。
const BUBBLE_PANEL_KEY = 'ui-panel-tan'
const BUBBLE_PANEL_URL = 'pixel/ui/kenney-pixel-ui-pack/9-Slice/Ancient/tan.png'
const BUBBLE_SLICE = 3 // 9-slice 边宽：面板实际边框≈2px（1px 高光 + 1px 描边）+ 1px 圆角

/**
 * 角色移动速度（px/s）。**绑定引擎的 Arcade 物理**来移动（`physics.moveTo` 朝目标设速度），
 * 而不是手写补间/每帧 lerp——移动是引擎成熟能力，不该自己造轮子（D56）。
 *
 * 速度必须与服务端一致：`src/domain/constants.ts` 里 `WALK_SPEED`(0.06 单位/tick) × `TILE_PX`(16)
 * × 每秒 10 tick（`DEFAULT_TICK_MS`=100）= 9.6 px/s。追快了会冲过头、慢了会拖在后头。
 */
const WALK_SPEED_PX = 0.06 * TILE_PX * 10

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
  /**
   * 底图/碰撞体的**资源版本**。重烘 `office.png` 或 `office-colliders.json` 后要改这里。
   *
   * 为什么不能只靠 HTTP 缓存头：浏览器在旧响应还在 `max-age` 内时不会回源 ——
   * 改服务端 `Cache-Control` **不会**让已缓存的条目失效。表现是"文件明明换了、画面没变"，
   * 而且 curl 校验完全正常，极难归因。把版本写进 URL 才能确定性地换掉它。
   */
  const MAP_ASSET_VERSION = '2026-10-18-10'

  /** 地图对象贴图：`office-objects.json` 里的 `texture` 字段就是这里的键。 */
  /** 墙体图层（透明 PNG，只含墙格）。 */
  const WALLS_KEY = 'map:walls'

  /**
   * 原版 `Office.tscn` 的**层序**（照抄，不发明）。
   *
   * 事实依据：整个场景 `y_sort_enabled` 出现 **0 次**，只有一个 `z_index = 1`
   * 挂在 `Furniture4` 上。所以原版是**固定层序**，不是 Y 排序：
   *
   *   z_index 0（按节点顺序）：WallAndFloor → Furniture0 → Furniture1 → Furniture2
   *                            → Furniture3 → 椅子等对象 → Characters
   *   z_index 1：Furniture4 —— 画在**所有角色之上**（墙上挂件/黑板就在这层）
   *
   * 深度只是一个"排号"，层与层之间不会有穿插。
   */
  /**
   * ## 深度是怎么定的（R158 重写：原 `DRAW_ORDER` 表已删除）
   *
   * 原版 `Office.tscn` 靠**树的顺序 + `z_index`** 决定遮挡，并把椅子按组穿插在家具层之间
   * （ReceptionChair → Furniture0 … BackChairs → Characters）。我们**没有照抄那一套**：
   * 那张表最后变成了一份**没人引用的常量**，而"椅子统一压在所有家具之下"的固定深度
   * 就是从它演出来的 —— 后遗症是 24 把椅子完全不参与 Y 排序（R152 实测 506 对前后颠倒）。
   *
   * 现在只有三条规则，判据都是"可量"的：
   *
   * 1. **平铺层**只有两张（`FLAT_LAYER_DEPTHS`）：`layer0` 地板/墙兜底压最底、`layer5` 墙上挂件压最上。
   *    它们是**整张图**，不参与逐行排序。
   * 2. **其余一切（家具、墙条、角色、椅子）都在 `entities` 同一层，按"自己的底边 Y"取
   *    `depthFor(bottom)`**，每帧 `sort('depth')` 落地。这就是"靠下的人挡住靠上的人"。
   * 3. **椅子额外减 `CHAIR_BIAS`**：只为保留用户早先的要求「椅子不该盖在桌面上」。
   *
   * ⚠️ **不要再引入"某类对象统一固定深度"**。R152 的 506 对颠倒就是这么来的：
   * 固定深度与对象自己的位置无关，前后关系必然错。要让椅子沉到桌子下面，用**小偏移**，不要用固定值。
   */
  const LAYER_KEYS = ['map:layer0', 'map:layer1', 'map:layer2', 'map:layer3', 'map:layer4', 'map:layer5']
  /**
   * 只把**两类**层当整张平铺图，其余（墙 + Furniture0..3）拆成矩形做 Y 排序。
   *
   * · `0`（WallAndFloor）：地板 + 墙。地板**必须**是背景 —— 它一旦参与排序，
   *   角色会被自己脚下的那格地板盖住。墙另有 `office-walls.png` 参与排序（见 `drawWalls`）。
   * · `5`（Furniture4）：墙上挂件/黑板。原版给它 `z_index = 1`，要固定在角色**之上**，
   *   参与排序反而会被角色挡住。
   */
  const FLAT_LAYER_DEPTHS = { 0: -10000, 5: 1000 }
  /**
   * 椅子统一压在**所有家具层之下**。
   *
   * ⚠️ 这是**有意偏离原版**的一处，理由要写清楚：
   * 原版 `Office.tscn` 里 `BackChairs` 排在 `Furniture3` **之后**，而原版不做 Y 排序，
   * 所以原版会把椅子像素**盖在桌面/桌沿上**（用户截图里箭头指的就是这个）。
   * 按"参考原版"照抄反而复现了这个毛病，用户明确要求"椅子不应该在桌子上面"。
   *
   * ## R152：从"固定层级 15"改成"按自己的底边排序 + 小偏移"
   *
   * 上一版取固定的 `CHAIR_DEPTH = 15`，前提是"家具层最低是 20（Furniture0）"——
   * **这个前提早已不成立**：家具现在和角色合并进 `entities`，各自按底边取 `depthFor(...)`。
   * 于是固定 15 与椅子自己的位置**毫无关系**，真机实测（186 个实体逐个比对 `depth` 与底边 Y）：
   * 24 把椅子的底边跨度 -240…+280，却全挤在 15 ⇒ **506 对"物理上在前、却被画在更后"**。
   * 表现是两头都错：前排椅子缩到后排桌子后面（像消失），后排椅子又盖住它前面的桌子。
   *
   * 现在仍保留原诉求"椅子别盖在桌面上"：按底边取层级后**减一个小偏移** `CHAIR_BIAS`，
   * 让塞在桌下的椅子稳定落在所属桌子之下。偏移必须**明显小于一格（16px）**，
   * 否则会跨到相邻的人/家具前面——椅子本来就贴着桌子，一格之内足够把它压下去。
   */
  const CHAIR_BIAS = 8

  const MAP_OBJECT_TEXTURES = {
    'office-chair-101.png': 'microverse/single-objects/office-chair-101.png',
    'office-chair-106.png': 'microverse/single-objects/office-chair-106.png',
    'office-chair-110.png': 'microverse/single-objects/office-chair-110.png',
  }

  /** 给静态资源 URL 加版本参数（`?v=`）。已经带查询串的用 `&`。 */
  function withAssetVersion(url) {
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}v=${MAP_ASSET_VERSION}`
  }
  const actorNodes = new Map()
  const actorPathCounts = { sprites: 0, fallbacks: 0 }
  const groundNodes = new Map()
  const propNodes = new Map()
  const noteNodes = new Map()
  /** R76：头顶气泡（Phaser 对象）——agentId → { container, bg, name, text }。 */
  const bubbleNodes = new Map()
  let actorPick = typeof options.onActorPick === 'function' ? options.onActorPick : null
  /** P1：当前选中的 agent id（键盘移动 / 镜头锁定的入口）。`null` = 未选中。 */
  let selectedAgentId = null
  /** P1：选中者脚下的高亮圈（Phaser Shape，随物理精灵每帧贴位）。 */
  let selectionRing = null
  /**
   * P3：移动模式开关。由超控面板的「对话 / 移动」切换驱动——
   * 只有 `true` 时键盘（WASD/方向键）才操控选中 agent；`false` 时键盘归相机/输入框。
   */
  let movementEnabled = false
  /** P3：角色移动键（WASD + 方向键）。在 `wireViewControls` 里建、`tickManualMovement` 里读。 */
  let moveKeys = null
  /**
   * P5：墙/家具的**静态碰撞体**（Arcade StaticGroup）。
   *
   * 之前手动操控直接给物理体设速度，而世界里根本没有"墙"这个东西 → 人可以从墙里穿过去。
   * 权威的墙其实一直都在：`world.nav` 的 `blocked`（由原版 Godot 图块的物理多边形解出来）。
   * 这里把它变成引擎的碰撞体，分离与贴墙滑动交给 Arcade，不自己写碰撞响应。
   */
  let wallGroup = null
  /** 墙体由哪份 nav 建出来的（scene + 网格参数）；变了才重建。 */
  let wallKey = null
  /**
   * 精细碰撞体（与底图**同一次**生成）：`{ cellPx, rects: [[x,y,w,h]...] }`，地图像素坐标。
   *
   * 为什么需要它：`nav.blocked` 是按**整格**算的，而格子里的家具往往只占一半 ——
   * 拿整格当实心，人会在离桌子/墙还有一段距离的地方就被挡住（"墙贴不匹配"的观感来源）。
   * 这份数据是按每格美术的 alpha 轮廓算的，所以挡在人真正看得见的地方。
   */
  let fineColliders = null
  /** 精细碰撞体属于哪张底图（换场景要重取）。 */
  let fineCollidersUrl = null
  /**
   * 地图上的**对象**（椅子等）：`{ chairs: [{texture, px:[x,y]}] }`。
   *
   * 为什么不烘进底图：底图是**一整张 depth=-1 的图**，烘进去就永远压在角色下面。
   * 原版 Godot 里椅子是独立节点、和角色一起 Y 排序 —— 站到椅子背后就该被挡住。
   */
  let mapObjects = null
  let mapObjectsUrl = null
  /**
   * 可 Y 排序的家具矩形：`{ rects: [{layer, rect:[x,y,w,h]}] }`，地图像素坐标。
   * 拆矩形的理由见 `drawTiles`。
   */
  let mapTiles = null
  let mapTilesUrl = null
  const tileNodes = new Map()
  let tileNodesKey = null

  function loadMapObjects(mapUrl) {
    if (typeof mapUrl !== 'string' || mapUrl === '') return
    if (mapObjectsUrl === mapUrl && mapObjects !== null) return
    mapObjectsUrl = mapUrl
    const url = String(mapUrl).replace(/\.png$/i, '-objects.json')
    const base = options.assetBaseUrl ?? './vendor/'
    void fetch(`${base}${withAssetVersion(url)}`)
      .then((res) => (res.ok === true ? res.json() : null))
      .then((data) => {
        if (data === null || mapObjectsUrl !== mapUrl) return
        mapObjects = data
        objectNodesKey = null
        if (lastRenderInput !== null) render(lastRenderInput)
      })
      .catch(() => { /* 没有对象数据也能跑 */ })
  }

  function loadMapTiles(mapUrl) {
    if (typeof mapUrl !== 'string' || mapUrl === '') return
    if (mapTilesUrl === mapUrl && mapTiles !== null) return
    mapTilesUrl = mapUrl
    const url = String(mapUrl).replace(/\.png$/i, '-tiles.json')
    const base = options.assetBaseUrl ?? './vendor/'
    void fetch(`${base}${withAssetVersion(url)}`)
      .then((res) => (res.ok === true ? res.json() : null))
      .then((data) => {
        if (data === null || mapTilesUrl !== mapUrl) return
        mapTiles = data
        tileNodesKey = null
        if (lastRenderInput !== null) render(lastRenderInput)
      })
      .catch(() => { /* 没有拆图数据就退回整层平铺 */ })
  }

  /** 椅子精灵（按数据建一次，之后只同步深度）。 */
  const objectNodes = new Map()
  let objectNodesKey = null
  /** 墙体图层节点（每条墙一个 image，用**纹理帧**取对应块）。 */
  const wallNodes = new Map()
  let wallNodesKey = null
  let lastStats = { renderer: 'phaser', backend: rendererType === CANVAS ? 'canvas' : 'webgl', drawCalls: 0, sprites: 0, ready: false }

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
    // P2：跟随中滚动由 `startFollow` 每帧接管——这里不 centerOn / 不 setScroll，否则会跟镜头打架
    //（把跟随目标刚算好的位置又拉回中心/夹掉）。只保留上面的 viewport + bounds（边界仍要夹）。
    if (isFollowing()) return
    // ⚠️ **只有请求居中时才居中**。用户拖过之后每次 `applyCamera()` 都 `centerOn(0,0)`
    // 会把他拖到的位置一直拽回中央——那正是"拖不动"这种 bug 的成因。
    if (centerOnNextApply === true) {
      camera.centerOn(0, 0)
      centerOnNextApply = false
    }
    // **把滚动量取整**，否则半像素的相机位移会让整张图糊掉
    camera.setScroll(Math.round(camera.scrollX), Math.round(camera.scrollY))
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
   * 滚轮缩放：**累积滚动量，跨阈值才进一档**（不是逐事件进档）。
   *
   * 触控板 / 高分辨率滚轮一次轻划会连发几十个 `wheel` 事件（每个 `dy` 都很小），
   * 逐事件走一档会把"轻轻一划"放大成"一路缩到头"——这就是"放大缩小太灵敏"的根。
   * 改成累加：滚满 `WHEEL_ZOOM_STEP_DY` 像素才动一档，两次进档之间还有
   * `WHEEL_ZOOM_COOLDOWN_MS` 的冷却——两重都让缩放"慢下来"。
   *
   * 停顿超过冷却就清零累积：下一划从头算，不把上一划的余量带过来。
   * 顶部 ± 按钮**不受此限制**（点一下永远是一档）。
   */
  const WHEEL_ZOOM_STEP_DY = 90
  const WHEEL_ZOOM_COOLDOWN_MS = 250


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

    // 滚轮缩放：**累积滚动量，跨阈值才进一档**（不是连续的 `zoom *= 1.1`）。
    // 触控板一次轻划连发的事件每发 `dy` 都很小，逐发进档会"一路缩到头"（太灵敏）。
    // 这里把 `dy` 攒起来，攒满 `WHEEL_ZOOM_STEP_DY` 才走一档；停顿久了清零重算。
    let wheelAccum = 0
    let lastWheelZoomAt = 0
    scene.input.on('wheel', (_pointer, _objects, _dx, dy) => {
      if (dy === 0) return
      const now = Date.now()
      if (now - lastWheelZoomAt > WHEEL_ZOOM_COOLDOWN_MS) wheelAccum = 0
      wheelAccum += dy
      if (Math.abs(wheelAccum) < WHEEL_ZOOM_STEP_DY) return
      lastWheelZoomAt = now
      wheelAccum = 0
      applyZoomStep(dy > 0 ? -1 : 1)
    })

    // 拖拽平移：按住画布拖动相机。位移**除以 zoom**——`scrollX` 是世界像素，
    // 而指针位移是屏幕像素；不除的话放大后"拖一格跳很远"。
    let dragging = false
    let lastX = 0
    let lastY = 0
    /** 这次按下是否落在角色上（否则就是空白/家具，用来判"空白点击解锁"）。 */
    let pressedOnActor = false

    /** 指针此刻压在角色上吗？（角色精灵打了 `actorId` 标记，用引擎的 `hitTestPointer` 判。） */
    function pointerIsOnActor(pointer) {
      const hits = scene.input.hitTestPointer(pointer)
      if (!Array.isArray(hits)) return false
      return hits.some((obj) => typeof obj?.getData === 'function' && obj.getData('actorId') !== undefined)
    }

    scene.input.on('pointerdown', (pointer) => {
      if (pointer.rightButtonDown()) return
      // 点在角色上：不进入拖拽（否则"点人"会变成"拖地图"，选不中）；交给角色自己的 pointerup。
      pressedOnActor = pointerIsOnActor(pointer)
      if (pressedOnActor === true) {
        dragging = false
        return
      }
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
    scene.input.on('pointerup', (pointer) => {
      const wasDrag = typeof pointer.getDistance === 'function' && pointer.getDistance() > 5
      const wasLongPress = typeof pointer.getDuration === 'function' && pointer.getDuration() > 700
      dragging = false
      // P2：点在**空白处**（不是角色、不是拖拽、不是长按）= 取消选中 + 解锁镜头。
      if (pressedOnActor === false && wasDrag === false && wasLongPress === false) {
        clearSelection()
      }
    })
    scene.input.on('pointerupoutside', () => {
      dragging = false
    })

    // 键盘推相机：**用 Phaser 自带的 FixedKeyControl**，它自己算速度与积分。
    if (scene.input.keyboard !== null && scene.input.keyboard !== undefined) {
      // ⚠️ `addKey(键, enableCapture=false)`：默认 `addKey` 会**捕获**按键并 `preventDefault`，
      // 于是"在对话输入框里打 wasd"会被引擎吃掉（字打不出来，还会顺手推相机）。
      // 这里不捕获——键盘优先归输入框，引擎只在"没在打字"时才读（见 `isTextInputFocused`）。
      keyControl = new Cameras.Controls.FixedKeyControl({
        camera,
        left: scene.input.keyboard.addKey('A', false),
        right: scene.input.keyboard.addKey('D', false),
        up: scene.input.keyboard.addKey('W', false),
        down: scene.input.keyboard.addKey('S', false),
        speed: KEY_SPEED / 1000,
      })

      // P3：**角色移动键**（WASD + 方向键）。同样 `enableCapture=false`——
      // 引擎不抢按键，打字的字母才不会被 `preventDefault` 吃掉。
      const K = scene.input.keyboard
      const pair = (a, b) => [K.addKey(a, false), K.addKey(b, false)]
      moveKeys = {
        up: pair('W', 'UP'),
        down: pair('S', 'DOWN'),
        left: pair('A', 'LEFT'),
        right: pair('D', 'RIGHT'),
      }
    }
  }

  // ── Phaser 场景：装载 → 建对象 → 每帧按我们的数据对齐 ───────────────────────

  class AgentWorldScene extends Scene {
    constructor() {
      super('world')
    }

    preload() {
      // 我们的数据（世界快照）比引擎启动**晚到**，所以这里不排内容资产——装载由
      // `ensureAssets()` 在第一次 `render()` 里按需发起（见那里的注释）。
      // R77：气泡底图是**固定 UI 资产**（和内容无关），进引擎就载。
      this.load.on('loaderror', (file) => { state.loadError = `load-error: ${file?.key ?? '?'}` })
      this.load.setBaseURL(options.assetBaseUrl ?? './vendor/')
      this.load.image(BUBBLE_PANEL_KEY, BUBBLE_PANEL_URL)
      // 椅子（原版 prefab 的单对象贴图）。它们是**地图对象**、不进底图：
      // 底图是一整张 depth=-1 的图，烘进去就永远压在角色下面，遮挡关系会错。
      for (const [key, url] of Object.entries(MAP_OBJECT_TEXTURES)) this.load.image(key, url)
      // 原版的 6 个 TileMapLayer 各一张透明图，前端按层序摆（见 LAYER_DEPTHS）。
      LAYER_KEYS.forEach((key, index) => {
        this.load.image(key, `microverse/scene/office-layer${index}.png`)
      })
    }

    create() {
      // 全部元素都画在**主相机**上（同一套世界坐标），文字也放进世界：
      // 名字挂在 `labels` 容器（最后 add → 渲染在最上层，不被家具/墙挡住），
      // 位置用世界像素、缩放交给相机——不再用第二台 UI 相机 + 手算画布像素。
      this.layers = {
        ground: this.add.container(0, 0),
        // 家具 + 角色**合并成同一层**：遮挡必须跨这两类做 y 排序（见 `depthFor`）。
        // 拆成两个容器的话，容器之间只有"谁整体在前"，做不到"这个角色在桌后、那个在桌前"。
        entities: this.add.container(0, 0),
        notes: this.add.container(0, 0),
        labels: this.add.container(0, 0),
        // R76：头顶气泡进引擎（Phaser Text/Graphics，世界坐标，随相机缩放平移）。
        bubbles: this.add.container(0, 0),
      }
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
      // P2：跟随中键盘推相机停用（WASD 留给 P3 移 agent）；未跟随才推相机。
      // 另：焦点在文字输入上时（对话模式）引擎一律不读键盘——否则打字会顺手推相机。
      if (isFollowing() !== true && isTextInputFocused() !== true && keyControl !== null && keyControl !== undefined) keyControl.update(delta)
      // P3：键盘操控选中 agent（移动模式才生效；其余情况内部会清零速度）。
      tickManualMovement()
      // 移动由引擎的 Arcade 物理每帧推进（`moveActorTo` 里的 `physics.moveTo`），这里不再手写移动。
      // 只有"名字贴头顶"要在这同步：标签在另一个容器里（永远盖在家具上），物理动的是精灵，
      // 所以每帧把标签钉到精灵脚下 + labelDy——这不是手写物理，是"两个显示对象保持相对位置"。
      /**
       * 先摆位置、再**错开**（R123 建 / R148 改成错开）。
       *
       * ## 为什么从"藏"改成"错开"
       *
       * R123 的做法是"两人靠近就把两行都藏起来"。方向（别糊成一团）对，但**降级方式选错了**：
       * 删信息 vs 挪位置。用户看到某人头顶没有工单行，分不清**他没活**还是**被藏了**——
       * 信息无声消失。现在改成**纵向错开**，两行都在；只有极端重叠（超过错开层数）才藏，
       * 且留下的人带 `+N`，明说"这里还有人"。
       *
       * ## 分工
       *
       * **怎么错开**全在 `core/task-label.js::planTaskLabelStagger`（纯函数，可单测）；
       * 这里只做三件事：喂尺寸（屏幕像素）、把屏幕偏移按缩放折算回世界坐标、把 `+N` 写上去。
       *
       * 判据用**精灵的屏幕距离**（相机缩放已经算进去了），阈值沿用 72px。
       */
      const zoomNow = activeScene.cameras.main.zoom ?? 1
      const taskLabelSpots = []
      for (const [actorId, entry] of actorNodes) {
        const sprite = entry.sprite
        if (sprite === null || sprite === undefined || sprite.visible !== true) continue
        const label = entry.label
        if (label !== null && label !== undefined && label.visible === true) {
          label.x = sprite.x
          label.y = sprite.y + (entry.labelDy ?? -16)
        }
        // 第二行贴在**名字之上**：顺序读下来是「工单 → 人 → 角色」。
        // 位置由名字的实测高度决定（`label.height` 随字号/内容变，不能写死行高）。
        const taskLabel = entry.taskLabel
        // ⚠️ 这里**不能**要求 `taskLabel.visible === true`（R148 踩过）：错开布局是"每帧重新决定可见性"，
        // 若只把当前可见的收进来，那么被藏过一次的标签就永远进不了布局、永远回不来——**自锁**。
        // 只排除"被气泡挡住"的那些（那是另一条规则，见 `bubbleHiddenTaskLabels`）。
        if (taskLabel !== null && taskLabel !== undefined && label !== null && label !== undefined && entry.taskLabelHiddenByBubble !== true) {
          taskLabel.x = sprite.x
          taskLabel.y = (sprite.y + (entry.labelDy ?? -16)) - (label.visible === true ? label.height : 0)
          taskLabelSpots.push({ id: actorId, label: taskLabel, x: sprite.x, y: sprite.y })
        }
      }
      /**
       * 布局在**世界坐标**里算，单位自洽。
       *
       * ⚠️ R148 踩过：把位置乘 `zoom` 当"屏幕像素"、却又用世界单位的 `label.width/height`，
       * 于是步长（屏幕 px）和标签高（世界 px）**不同量纲**——真机上偏移被除以 zoom，
       * 两行只错开 8.5 世界 px，而标签高 15px，结果**仍然相交**（`getBounds()` 相交数 = 1）。
       * 正确做法：位置、尺寸、偏移全用世界单位；只有 72px 这个**阈值**是屏幕概念，
       * 把它换算成世界单位（`/ zoom`）再传进去。
       */
      const plan = planTaskLabelStagger(
        taskLabelSpots.map((spot) => ({
          id: spot.id,
          x: spot.x,
          y: spot.y,
          width: spot.label.width,
          height: spot.label.height,
        })),
        { minGapPx: TASK_LABEL_MIN_GAP_PX / zoomNow },
      )
      const planById = new Map(plan.map((p) => [p.id, p]))
      for (const spot of taskLabelSpots) {
        const decision = planById.get(spot.id)
        if (decision === undefined) continue
        spot.label.setVisible(decision.hidden !== true)
        spot.label.y += decision.offsetY
        // `+N` 只在有隐藏时出现；**基文本单独留着**（见 `updateTaskLabel` 里的 `baseText`），
        // 否则下一帧会在"已带 +N"的文本上再拼一次，越拼越长。
        // 文本变了才写：Phaser 的 `text` setter 会重新排版 + 重绘纹理，每帧写等于每帧重画 8 张贴图。
        const base = spot.label.getData('baseText')
        if (typeof base === 'string') {
          const next = decision.hiddenCount > 0 ? `${base} +${decision.hiddenCount}` : base
          if (spot.label.text !== next) spot.label.text = next
        }
      }
      // P1：高亮圈跟着选中者的物理精灵贴（和标签同一个道理：两个显示对象保持相对位置）。
      syncSelectionRing()
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
      // ⚠️ `assets` 才是**真正拿去 load 的 url**（`images` 只用于"这张是整图不是图集"的判断）。
      // 版本号必须写进 `assets`，否则 URL 不变、浏览器继续用旧缓存。
      const mapUrl = withAssetVersion(plan.map.url)
      images.set(MAP_KEY, mapUrl)
      assets.set(MAP_KEY, mapUrl)
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

  /**
   * 遮挡（y 排序）深度：**屏幕越靠下（世界 +z 越大）越画在上面**。
   *
   * 以前的深度是死的（家具 1、角色 2），于是角色**永远**盖在家具上——站在机柜
   * "后面"的人也盖住机柜，这就是"遮挡关系不对"。现在家具与角色合并进同一个容器，
   * 各自按世界 z 取深度，靠下（z 大）的排在靠上（z 小）的前面，由 `sort('depth')` 落地。
   *
   * 乘 `TILE_PX` 只是把 z 放大成整数像素，让"深度相等"的概率更低（浮点相等会让排序抖动）。
   * 负值没关系——它只在这个容器内部比大小，不跟地面/纸条的深度发生关系。
   */
  function depthFor(z) {
    return Math.round((Number.isFinite(z) ? z : 0) * TILE_PX)
  }

  /**
   * 把精灵移到目标位置——**交给引擎的 Arcade 物理**（`physics.moveTo` 朝目标设速度）。
   *
   * 不手写每帧 lerp、也不起 Tween：物理系统每帧推进、恒定速度、到达自然停，这正是引擎
   * 内置的"移动"能力（D56）。服务端 100ms 推一格、客户端 250ms 渲染一次，物理在两次渲染
   * 之间匀速追着最新目标走，角色平滑不跳。
   *
   * - 首帧 / 目标跳太远（重置、换位、fallback 矩形 ↔ 精灵切换）：`body.reset` 直接落位，别从 (0,0) 滑过去。
   * - 到达（够近）：停速度 + 精确落位，别围着目标抖。
   * - 标签在 `update()` 里每帧跟着物理移动的精灵贴（标签在另一个容器里）。
   */
  function moveActorTo(entry, tx, ty) {
    const sprite = entry.sprite
    if (sprite === null || sprite === undefined) return
    const label = entry.label
    const labelDy = entry.labelDy ?? -16
    const labelY = ty + labelDy
    const body = sprite.body ?? null

    // 3 格（48 世界像素）：正常行走 250ms 只挪 ~2.5px，跳超过这个量就是"传送"，直接落位。
    if (Math.abs(sprite.x - tx) > 48 || Math.abs(sprite.y - ty) > 48) {
      if (body !== null && body !== undefined) {
        body.reset(tx, ty)
        // ⚠️ `Body.reset` 不认 `offset`：不重算的话脚部碰撞体会被甩到帧左上角，
        // 人就整只卡进墙里（实测：脚在 y=66，body 跑到 y=2，一步都走不动）。
        body.updateFromGameObject()
      } else sprite.setPosition(tx, ty)
      if (label !== null && label !== undefined) label.setPosition(tx, labelY)
      return
    }

    // 没有物理体（fallback 矩形，无纹理的罕见路径）：直接落位。
    if (body === null || body === undefined) {
      sprite.setPosition(tx, ty)
      if (label !== null && label !== undefined) label.setPosition(tx, labelY)
      return
    }

    // 到达（已足够近）：停掉速度并精确落位，避免围着目标来回抖。
    if (Math.hypot(tx - sprite.x, ty - sprite.y) < 1) {
      body.reset(tx, ty)
      body.updateFromGameObject()
      return
    }

    // 引擎物理移动：朝目标设速度，物理世界每帧推进；到达后由上面的分支停住。
    activeScene.physics.moveTo(sprite, tx, ty, WALK_SPEED_PX)
  }

  // ── 选中（P1）：点人 / 看板定位 → 记下 selectedAgentId + 脚下高亮圈 ───────────

  /**
   * 选中一个 agent。选中态是「键盘移动 / 镜头锁定」的入口（P3 / P2 接上）。
   * 这里只做两件：记下 id + 把高亮圈挪到它脚下（高亮圈每帧跟着物理精灵贴，见 `update()`）。
   */
  function selectAgent(agentId) {
    selectedAgentId = agentId
    syncSelectionRing()
    startFollowSelection()
    return true
  }

  /** 取消选中：清 id + 藏高亮圈 + 解锁镜头。 */
  function clearSelection() {
    // 交还位置所有权前，先把落点落地：否则服务端还停在旧坐标，客户端一交还就会瞬移回去。
    if (selectedAgentId !== null) {
      // ⚠️ **解锁必须清速度**（R89 / 评审 I-2）：`tickManualMovement` 第一行是
      // `selectedAgentId === null → no-body` 早退，所以清完 id 之后**再也走不到清零那句**，
      // 物理体带着 `vx=72` 继续滑——实测按 Esc 之后精灵还会多滑 5.8px 才被服务端拽回。
      // 清零要放在**清 id 之前**，此刻还能拿到那个人的 body。
      const entry = actorNodes.get(selectedAgentId)
      entry?.sprite?.body?.setVelocity?.(0, 0)
      if (manualPositionIds.has(selectedAgentId)) {
        const moved = entry?.sprite
        if (moved !== null && moved !== undefined) {
          notifyMoveSettled(selectedAgentId, moved.x / TILE_PX, moved.y / TILE_PX)
        }
      }
      manualPositionIds.delete(selectedAgentId)
    }
    wasManualWalking = false
    selectedAgentId = null
    stopFollowSelection()
    syncSelectionRing()
  }

  /**
   * 把高亮圈挪到选中 agent 脚下（或隐藏）。
   *
   * 为什么用**引擎的 Shape**（`add.ellipse`）而不是自己画 / 贴图：高亮是一个显示对象，
   * 和精灵一样有坐标/深度/可见性，进 `entities` 层一起做 y 排序（不手写层级、不另开层）。
   * 没选中、或选中者还没建出精灵（首帧）时只藏不报错。
   */
  function syncSelectionRing() {
    const entry = selectedAgentId === null ? undefined : actorNodes.get(selectedAgentId)
    const sprite = entry === undefined ? null : entry.sprite
    if (sprite === null || sprite === undefined || sprite.visible !== true) {
      if (selectionRing !== null && selectionRing !== undefined) selectionRing.setVisible(false)
      return
    }
    if (selectionRing === null || selectionRing === undefined) {
      selectionRing = activeScene.add.ellipse(0, 0, 24, 10, 0x00e5ff, 0.18)
      selectionRing.setStrokeStyle(2, 0x00e5ff, 1)
      selectionRing.setOrigin(0.5, 1)
      activeScene.layers.entities.add(selectionRing)
    }
    selectionRing.setPosition(sprite.x, sprite.y)
    // 紧贴在角色脚下**略低一点**：让角色站在圈上（entities 按 depth 排序，圈比角色略低）。
    selectionRing.setDepth((sprite.depth ?? 0) - 0.01)
    selectionRing.setVisible(true)
  }

  // ── 镜头锁定（P2）：选中 → startFollow 跟随；取消选中 → stopFollow 解锁 ─────────

  /** P2：镜头是否正在跟随。跟随 = 选中了、且选中者有可跟的精灵。 */
  function isFollowing() {
    const entry = selectedAgentId === null ? undefined : actorNodes.get(selectedAgentId)
    const sprite = entry === undefined ? null : entry.sprite
    return sprite !== null && sprite !== undefined && sprite.visible === true
  }

  /** 点击锁定时的镜头平移动画时长（毫秒）。太短像瞬移，太长像卡住。 */
  const CAMERA_PAN_MS = 420

  /**
   * P2：镜头跟随选中的 agent（带 lerp 平滑）。
   * 用引擎的 `camera.startFollow`（D56：相机是真相，我们只是操作它的手），不手写每帧 scroll。
   * 但**不是直接贴过去**：先 `camera.pan` 平移到位（用户要的"镜头平移动画"），
   * 到位后再把跟随接上——直接 startFollow 的观感是"瞬移一格"。
   */
  function startFollowSelection() {
    if (activeScene === null) return
    const camera = activeScene.cameras.main
    const entry = selectedAgentId === null ? undefined : actorNodes.get(selectedAgentId)
    const sprite = entry === undefined ? null : entry.sprite
    if (sprite === null || sprite === undefined) return
    camera.stopFollow()
    // ⚠️ `pan()` 的第 6 个参数是**每帧**回调（内部 `_onUpdate`），**不是**"完成回调"。
    // 拿它当完成回调用，跟随会在平移的**第一帧**就接管，动画还没开始就被 follow 的
    // 每帧贴位吃掉（表现：镜头"啪"地贴过去，没有平移）。真正的完成信号是 `pancomplete` 事件。
    camera.off('camerapancomplete')
    camera.once('camerapancomplete', () => {
      // 平移途中可能已经取消/换人：只按**当前**选中态接管（换人就跟着新的人）。
      if (selectedAgentId === null) return
      const cur = actorNodes.get(selectedAgentId)?.sprite
      if (cur !== null && cur !== undefined) camera.startFollow(cur, true, 0.12, 0.12)
    })
    camera.pan(sprite.x, sprite.y, CAMERA_PAN_MS, 'Sine.easeInOut', true)
  }

  /** P2：解除镜头跟随（点空白 / 点解锁按钮 / Esc 走这条）。 */
  function stopFollowSelection() {
    if (activeScene === null) return
    const camera = activeScene.cameras.main
    camera.stopFollow()
    // 平移还没走完也要停：否则解锁后镜头仍会飘到那个人身上。
    camera.off('camerapancomplete')
    camera.panEffect?.reset?.()
  }

  /**
   * P3：开关"键盘操控选中 agent"。由超控面板的模式切换驱动（对话 → 关，移动 → 开）。
   * 这里只记状态；真正的键位处理在 `update()` 里（见 P3）。
   */
  function setMovementEnabled(enabled) {
    movementEnabled = enabled === true
    return movementEnabled
  }

  /**
   * 焦点此刻是否在**文字输入**上（textarea / input / contenteditable）。
   *
   * 这是「对话 / 移动」互斥的判据：只要用户在打字，引擎就**不该**读键盘——
   * 否则 WASD 一边进输入框、一边推相机/推角色，就是两套在抢同一批按键。
   */
  function isTextInputFocused() {
    const el = globalThis.document?.activeElement
    if (el === null || el === undefined) return false
    const tag = String(el.tagName ?? '').toUpperCase()
    return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable === true
  }

  // ── 键盘操控角色（P3）─────────────────────────────────────────────────────

  /** 玩家键盘走速（世界像素/秒）。服务端 `WALK_SPEED_PX` 是 9.6（约 0.6 格/秒），
   *  手动操控要"跟手"，给 4.5 格/秒左右：再快会像滑冰，再慢会觉得没反应。 */
  const MANUAL_SPEED_PX = 72

  /** 这个 agent 此刻是否由玩家键盘接管（= 选中了它 + 处于移动模式）。 */
  function isManualControl(agentId) {
    return movementEnabled === true && selectedAgentId !== null && selectedAgentId === agentId
  }

  /**
   * 被玩家键盘**挪过位置**的 agent（位置所有权归客户端，服务端同步要跳过）。
   *
   * 为什么不直接复用 `isManualControl`：走两步再切回「对话」时，若立刻把位置还给服务端，
   * 角色会**当场被拽回原位**（服务端还停在旧坐标），观感就是"一进对话就瞬移"。
   * 所以位置所有权要**粘住**，直到解除选中才交还。
   */
  const manualPositionIds = new Set()

  /** 上一帧是否正在被键盘推着走（用于在"停下那一刻"只报一次坐标，不逐帧发请求）。 */
  let wasManualWalking = false
  /** 诊断：`tickManualMovement` 上一次为什么走/没走（`moving` / `no-direction` / `mode-off` …）。 */
  let lastManualReason = 'init'

  /** 把"玩家走完的落点"交给外壳去发命令——渲染层不碰 HTTP。 */
  function notifyMoveSettled(agentId, x, z) {
    if (typeof options.onAgentMoveSettled !== 'function') return
    options.onAgentMoveSettled(agentId, x, z)
  }

  /** 该 agent 的位置此刻是否归客户端（服务端同步跳过它）。 */
  function ownsPosition(agentId) {
    return manualPositionIds.has(agentId)
  }

  /**
   * P3：每帧按键盘给选中 agent 设速度（推进交给 Arcade 物理，不手写位移）。
   *
   * 三种情况都**显式清零速度**（松键 / 切回对话 / 失焦），否则角色会一直滑下去——
   * 这是"键盘控制"最容易留的尾巴。
   */
  function tickManualMovement() {
    const entry = selectedAgentId === null ? undefined : actorNodes.get(selectedAgentId)
    const sprite = entry === undefined ? null : entry.sprite
    const body = sprite?.body ?? null
    if (body === null || body === undefined) { lastManualReason = 'no-body'; return }

    const active = movementEnabled === true && isTextInputFocused() !== true && moveKeys !== null
    if (active !== true) {
      lastManualReason = movementEnabled !== true ? 'mode-off' : (isTextInputFocused() === true ? 'text-focus' : 'no-keys')
      if (body.velocity.x !== 0 || body.velocity.y !== 0) body.setVelocity(0, 0)
      // ⚠️ 这里**不要**挑站立动画：松键/切模式后动画要交回 `drawActors`（服务端朝向），
      // 一旦在这里写 `idle-<lastDir>`，被摸过的人就会永远钉在最后那个方向。
      // 切走/失焦时也要把落点落地（否则服务端还停在旧坐标，解锁会瞬移）。
      if (wasManualWalking === true && selectedAgentId !== null) {
        wasManualWalking = false
        notifyMoveSettled(selectedAgentId, sprite.x / TILE_PX, sprite.y / TILE_PX)
      }
      return
    }

    const anyDown = (list) => list.some((key) => key.isDown === true)
    let vx = 0
    let vy = 0
    if (anyDown(moveKeys.left)) vx -= 1
    if (anyDown(moveKeys.right)) vx += 1
    if (anyDown(moveKeys.up)) vy -= 1
    if (anyDown(moveKeys.down)) vy += 1

    if (vx === 0 && vy === 0) {
      lastManualReason = 'no-direction'
      body.setVelocity(0, 0)
      // ⚠️ 松键后**不要**在这里挑站立动画：动画要交回 `drawActors`（服务端朝向）。
      // 这里一写 `idle-<lastDir>`，被摸过的人就永远钉在最后那个方向——
      // 用户反馈的「只要朝向不是向右就会跳向右」正是这条（因为位置所有权是粘的，
      // drawActors 又整段跳过动画，最后只剩手动这套按 lastDir 播）。
      // 松键 = 一次移动结束：**在这一刻**把落点交给服务端（不逐帧发）。
      if (wasManualWalking === true) {
        wasManualWalking = false
        notifyMoveSettled(selectedAgentId, sprite.x / TILE_PX, sprite.y / TILE_PX)
      }
      return
    }
    wasManualWalking = true
    lastManualReason = 'moving'

    // 斜向归一化：不除的话斜着走会比直着快 √2 倍。
    const len = Math.hypot(vx, vy) || 1
    body.setVelocity((vx / len) * MANUAL_SPEED_PX, (vy / len) * MANUAL_SPEED_PX)
    // 一旦真的被玩家推动过 → 位置归客户端（切回对话模式也不会被服务端拽回）。
    if (selectedAgentId !== null) manualPositionIds.add(selectedAgentId)

    // 屏幕 +y = 世界 +z，所以 atan2(vy, vx) 直接喂 `directionOf` 就是四向。
    const dir = directionOf(Math.atan2(vy, vx))
    entry.lastDir = dir
    playManualAnim(entry, 'walk', dir)
    // 深度按**脚下当前位置**重算：边走遮挡关系边跟上（不再用服务端那份旧 z）。
    sprite.setDepth(depthFor(sprite.y / TILE_PX))
  }

  /** 手动操控时自己挑动画（服务端那套在 `drawActors` 里对被接管的人跳过）。 */
  function playManualAnim(entry, band, direction) {
    if (activeScene === null) return
    const textureKey = entry.textureKey
    if (textureKey === null || textureKey === undefined) return
    const name = resolveAnimationKey(
      (n) => activeScene.anims.exists(animKeyFor(textureKey, n)) === true,
      { band, direction },
    )
    if (name === null) return
    const full = animKeyFor(textureKey, name)
    if (entry.sprite.anims.currentAnim?.key !== full) entry.sprite.play(full, true)
  }

  // ── 墙体碰撞（P5）────────────────────────────────────────────────────────────

  /**
   * 取"与底图同源"的精细碰撞体（`vendor/<mapUrl 同目录>/office-colliders.json`）。
   *
   * 拿不到就**继续用整格网格**（不阻塞渲染、不报错）——它是优化而不是必需依赖。
   */
  function loadFineColliders(mapUrl) {
    if (typeof mapUrl !== 'string' || mapUrl === '') return
    // 记录**底图 url**（不是转换后的路径）：`rebuildWalls` 拿它跟 `plan.map.url` 对齐。
    if (fineCollidersUrl === mapUrl && fineColliders !== null) return
    fineCollidersUrl = mapUrl
    const fetchUrl = String(mapUrl).replace(/\.png$/i, '-colliders.json')
    const base = options.assetBaseUrl ?? './vendor/'
    void fetch(`${base}${withAssetVersion(fetchUrl)}`)
      .then((res) => (res.ok === true ? res.json() : null))
      .then((data) => {
        // 期间可能换了场景：只接受仍是当前这一份。
        if (data === null || fineCollidersUrl !== mapUrl) return
        fineColliders = data
        wallKey = null // 强制下一次 render 重建碰撞体
        if (lastRenderInput !== null) render(lastRenderInput)
      })
      .catch(() => { /* 退回整格网格 */ })
  }

  /**
   * 用 `world.nav` rebuild 墙体的静态碰撞体。
   *
   * 为什么用**行合并**：248 个阻挡格逐格建体会白建 248 个静态体；同一行连续的阻挡格
   * 合成一条矩形后只剩 77 个。墙是横平竖直的，行合并正好贴合它的形状。
   *
   * 为什么交给 Arcade 而不是自己写"下一格能不能走"：自己写只能把那一轴的速度清零，
   * 贴着墙斜走会发涩（先停住再蹭），而引擎的分离+滑动是它自带的能力（D56）。
   */
  function rebuildWalls(worldState) {
    if (activeScene === null) return
    const nav = worldState?.nav ?? null
    const sceneId = String(worldState?.origin?.scene ?? '')
    // 网格参数 + 场景 id 一起当签名：换场景、换地图时就要重建。
    const key = nav === null
      ? `${sceneId}|none`
      : `${sceneId}|${nav.width}x${nav.height}@${nav.unitsPerCell}|${nav.originX},${nav.originZ}`
    if (key === wallKey) return
    wallKey = key

    // 旧组连同它的碰撞一起丢掉（否则换场景后还残留上一张图的墙）。
    for (const entry of actorNodes.values()) {
      entry.collider?.destroy?.()
      entry.collider = null
    }
    if (wallGroup !== null && wallGroup !== undefined) {
      wallGroup.clear(true, true)
      wallGroup = null
    }
    // 兜底：把世界里**所有**静态体清掉再重建。
    //
    // 为什么不能只 clear 自己的组：粗网格（77 个）与精细碰撞体（203 个）是两套实现，
    // 切换时若有一组没被销毁干净，那些"看不见的整格墙"仍然挡人 —— 表现就是
    // "换了精细碰撞还是没改善"。静态体只在换场景/换数据时重建，清一次很便宜。
    const world = activeScene.physics.world
    const stale = world.staticBodies.getArray().slice()
    for (const body of stale) {
      const owner = body.gameObject
      if (owner !== null && owner !== undefined) owner.destroy()
      else world.disableBody(body)
    }
    if (nav === null || nav.width <= 0 || nav.height <= 0) return

    wallGroup = activeScene.physics.add.staticGroup()

    // ── 优先：与底图同源的精细碰撞体（地图像素坐标 → 世界像素，只差一个原点偏移）──
    // 底图 url 在**场景计划**上（`plan.map.url`），不是 world.scene（那只是一个 id 字符串）。
    const mapUrl = state.plan?.map?.url ?? null
    const fine = fineColliders !== null && fineCollidersUrl !== null && fineCollidersUrl === mapUrl
      ? fineColliders
      : null
    if (fine !== null && Array.isArray(fine.rects) === true && fine.rects.length > 0) {
      const offsetPxX = Number(nav.originX) * TILE_PX
      const offsetPxY = Number(nav.originZ) * TILE_PX
      for (const rect of fine.rects) {
        if (Array.isArray(rect) !== true || rect.length < 4) continue
        const [rx, ry, rw, rh] = rect
        if (!(rw > 0) || !(rh > 0)) continue
        const body = activeScene.add.rectangle(offsetPxX + rx + rw / 2, offsetPxY + ry + rh / 2, rw, rh, 0x000000, 0)
        body.setVisible(false)
        wallGroup.add(body)
      }
      for (const entry of actorNodes.values()) {
        const sprite = entry.sprite
        if (sprite === null || sprite === undefined) continue
        if (sprite.body === null || sprite.body === undefined) continue
        entry.collider = activeScene.physics.add.collider(sprite, wallGroup)
      }
      return
    }

    const cellPx = Number(nav.unitsPerCell) * TILE_PX
    if (!(cellPx > 0)) { wallGroup = null; return }
    const originPxX = Number(nav.originX) * TILE_PX
    const originPxY = Number(nav.originZ) * TILE_PX

    for (let row = 0; row < nav.height; row += 1) {
      let col = 0
      while (col < nav.width) {
        if (nav.blocked[row * nav.width + col] !== true) { col += 1; continue }
        const start = col
        while (col < nav.width && nav.blocked[row * nav.width + col] === true) col += 1
        const widthPx = (col - start) * cellPx
        const x = originPxX + start * cellPx + widthPx / 2
        const y = originPxY + row * cellPx + cellPx / 2
        // 不可见的矩形：只做碰撞体，不参与画面（墙本身画在底图上）。
        const rect = activeScene.add.rectangle(x, y, widthPx, cellPx, 0x000000, 0)
        rect.setVisible(false)
        wallGroup.add(rect)
      }
    }

    // 已经建出来的主角补上碰撞（新建的在 drawActors 里挂）。
    for (const entry of actorNodes.values()) {
      const sprite = entry.sprite
      if (sprite === null || sprite === undefined) continue
      if (sprite.body === null || sprite.body === undefined) continue
      entry.collider = activeScene.physics.add.collider(sprite, wallGroup)
    }
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
      // 分层图可用时，合成底图会重复绘制（同一像素画两遍）。藏起来，只留分层。
      image.setVisible(LAYER_KEYS.some((key) => activeScene.textures.exists(key) === true) !== true)
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

  /**
   * 画地图对象（椅子）。**进 `entities` 层并按 y 取深度** —— 这样它和角色一起排序：
   * 站在椅子后面会被挡住，站在前面会挡住椅子（原版 Godot 里就是这个行为）。
   */
  function drawMapObjects() {
    if (activeScene === null) return
    const data = mapObjects
    if (data === null || data === undefined || Array.isArray(data.chairs) !== true) return
    const key = mapObjectsUrl
    if (objectNodesKey !== key) {
      for (const node of objectNodes.values()) node.destroy()
      objectNodes.clear()
      objectNodesKey = key
    }
    const offsetPxX = -37 * TILE_PX
    const offsetPxY = -21 * TILE_PX
    const wanted = new Set()
    data.chairs.forEach((chair, index) => {
      if (chair === null || chair === undefined) return
      const textureKey = String(chair.texture ?? '')
      if (textureKey === '' || MAP_OBJECT_TEXTURES[textureKey] === undefined) return
      if (activeScene.textures.exists(textureKey) !== true) return
      const px = Array.isArray(chair.px) ? chair.px : null
      if (px === null || px.length < 2) return
      const id = `${index}:${textureKey}`
      wanted.add(id)
      let node = objectNodes.get(id)
      if (node === undefined) {
        node = activeScene.add.image(0, 0, textureKey)
        // 原版 Sprite2D 默认居中（centered=true），Phaser 的 image 默认也是 0.5/0.5，不用改。
        activeScene.layers.entities.add(node)
        objectNodes.set(id, node)
      }
      node.setTexture(textureKey)
      // 地图像素 → 世界像素（图左上角 = (-halfW,-halfH)）
      const worldX = px[0] + offsetPxX
      const worldY = px[1] + offsetPxY
      node.setPosition(worldX, worldY)
      // R152：**按椅子自己的底边 Y 参与 Y 排序**（与家具/角色同一套口径），再减 `CHAIR_BIAS`
      // 保留"椅子塞在桌下、不盖桌面"的观感。`index * 0.001` 只保证同深度下次序稳定。
      // 详见 `CHAIR_BIAS` 的注释：固定层级会让前后关系与位置无关（实测 506 对颠倒）。
      const chairBottom = worldY + node.displayHeight * (1 - node.originY)
      node.setDepth(depthFor(chairBottom / TILE_PX) - CHAIR_BIAS + index * 0.001)
      node.setVisible(true)
    })
    for (const [id, node] of objectNodes) if (!wanted.has(id)) node.setVisible(false)
  }

  /**
   * 按**原版层序**铺 6 个图块层。
   *
   * 这是对 `Office.tscn` 的直译：层是**固定前后关系**，层内不排序。
   * 之前我自己发明了"墙按行底部取深度"的 Y 排序，那不是原版行为，已删除。
   */
  function drawLayers() {
    if (activeScene === null) return false
    const anyLayer = LAYER_KEYS.some((key) => activeScene.textures.exists(key) === true)
    if (anyLayer !== true) return false
    const offsetPxX = -37 * TILE_PX
    const offsetPxY = -21 * TILE_PX
    for (const [indexText, depth] of Object.entries(FLAT_LAYER_DEPTHS)) {
      const index = Number(indexText)
      const key = LAYER_KEYS[index]
      if (key === undefined || activeScene.textures.exists(key) !== true) continue
      const nodeKey = `flat:${index}`
      let node = wallNodes.get(nodeKey)
      if (node === undefined) {
        node = activeScene.add.image(offsetPxX, offsetPxY, key)
        node.setOrigin(0, 0)
        // ⚠️ 必须和对象/角色放**同一个容器**：容器之间是整体排序的，
        // 放在 `ground` 里无论深度设多少都压不过 `entities` 里的角色。
        activeScene.layers.entities.add(node)
        wallNodes.set(nodeKey, node)
      }
      node.setTexture(key)
      node.setPosition(offsetPxX, offsetPxY)
      node.setDepth(depth)
      node.setVisible(true)
    }
    return true
  }

  /**
   * 把整层图里的一个矩形注册成**纹理帧**，返回帧名。
   *
   * ⚠️ 不能用 `setCrop`：Phaser 的 `setCrop` 只改 UV、**不改四边形尺寸**，
   * 于是被裁的区域会被拉伸铺满整张图的尺寸（实测表现是"家具被切成条 / 错位"）。
   * 注册帧才是裁剪区域的正统做法 —— 帧自带宽高，渲染出来就是原尺寸的那一块。
   * 帧只是 UV 记录，不会复制纹理，所以 152 个帧几乎没有开销。
   */
  function tileFrame(textureKey, rx, ry, rw, rh) {
    const texture = activeScene.textures.get(textureKey)
    const name = `t${rx}_${ry}_${rw}_${rh}`
    if (texture.has(name) !== true) texture.add(name, 0, rx, ry, rw, rh)
    return name
  }

  /**
   * 把家具（Furniture0..3）按**矩形**摆进 `entities` 并参与 Y 排序。
   *
   * 为什么不能整层一张图：整层只有一个深度，角色永远压在它上面 —— 站到桌子**后面**
   * 也不会被挡住。拆成"每行一个矩形"后，深度取**该行底边**，遮挡关系就对了
   *（同一行的家具深度相同，横向不会有缝）。
   *
   * 矩形用**纹理帧**从整层图上取（见 `tileFrame`），所以纹理只有 6 张，不会多出几百个纹理。
   */
  function drawTiles() {
    if (activeScene === null) return
    const rects = mapTiles?.rects
    if (Array.isArray(rects) !== true) return
    const offsetPxX = -37 * TILE_PX
    const offsetPxY = -21 * TILE_PX
    if (tileNodesKey !== mapTilesUrl) {
      for (const node of tileNodes.values()) node.destroy()
      tileNodes.clear()
      tileNodesKey = mapTilesUrl
    }
    const wanted = new Set()
    rects.forEach((item, index) => {
      const layer = Number(item?.layer)
      const rect = item?.rect
      if (Array.isArray(rect) !== true || rect.length < 4) return
      const key = LAYER_KEYS[layer]
      if (key === undefined || activeScene.textures.exists(key) !== true) return
      const [rx, ry, rw, rh] = rect
      if (!(rw > 0) || !(rh > 0)) return
      const id = `tile:${index}`
      wanted.add(id)
      let node = tileNodes.get(id)
      if (node === undefined) {
        node = activeScene.add.image(0, 0, key)
        node.setOrigin(0, 0)
        activeScene.layers.entities.add(node)
        tileNodes.set(id, node)
      }
      node.setTexture(key, tileFrame(key, rx, ry, rw, rh))
      node.setOrigin(0, 0)
      node.setPosition(offsetPxX + rx, offsetPxY + ry)
      // 深度 = 该行**底边**的世界 z。`depthFor` 乘回 TILE_PX，所以这里就是像素值本身。
      node.setDepth(depthFor((offsetPxY + ry + rh) / TILE_PX))
      node.setVisible(true)
    })
    for (const [id, node] of tileNodes) if (!wanted.has(id)) node.setVisible(false)
  }

  /**
   * 画墙体图层。每条墙（按行合并的矩形）用**纹理帧**从透明图里取那一块，
   * 深度取**该行底部** —— 这样"站在墙上方"的角色会被墙挡住，"站在墙下方"的会盖住墙，
   * 与 Godot 原版 YSort 的观感一致。
   */
  function drawWalls() {
    if (activeScene === null) return
    const rects = fineColliders?.walls
    if (Array.isArray(rects) !== true || activeScene.textures.exists(WALLS_KEY) !== true) return
    const offsetPxX = -37 * TILE_PX
    const offsetPxY = -21 * TILE_PX
    if (wallNodesKey !== WALLS_KEY) {
      for (const node of wallNodes.values()) node.destroy()
      wallNodes.clear()
      wallNodesKey = WALLS_KEY
    }
    const wanted = new Set()
    rects.forEach((rect, index) => {
      if (Array.isArray(rect) !== true || rect.length < 4) return
      const [rx, ry, rw, rh] = rect
      if (!(rw > 0) || !(rh > 0)) return
      const id = `${index}`
      wanted.add(id)
      let node = wallNodes.get(id)
      if (node === undefined) {
        node = activeScene.add.image(0, 0, WALLS_KEY)
        node.setOrigin(0, 0)
        activeScene.layers.entities.add(node)
        wallNodes.set(id, node)
      }
      node.setTexture(WALLS_KEY, tileFrame(WALLS_KEY, rx, ry, rw, rh))
      node.setOrigin(0, 0)
      node.setPosition(offsetPxX + rx, offsetPxY + ry)
      node.setDepth(depthFor((offsetPxY + ry + rh) / TILE_PX))
      node.setVisible(true)
    })
    for (const [id, node] of wallNodes) if (!wanted.has(id)) node.setVisible(false)
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
          node.setDepth(depthFor(prop.z + (part.dz ?? 0)))
          activeScene.layers.entities.add(node)
          propNodes.set(nodeKey, node)
        }
        const [ox, oy] = originOf(sheet)
        node.setTexture(key)
        // 单帧模型也要显式设帧：不设就是 `__BASE`（整张图当一帧）
        const firstAnim = Object.values(sheet.animations ?? {})[0]
        if (firstAnim !== undefined) node.setFrame(animationFrameList(sheet, firstAnim, perRowByUrl.get(model.url) ?? 1)[0] ?? 0)
        node.setOrigin(ox, oy)
        node.setPosition(Math.round((prop.x + (part.dx ?? 0)) * TILE_PX), Math.round((prop.z + (part.dz ?? 0)) * TILE_PX))
        node.setDepth(depthFor(prop.z + (part.dz ?? 0)))
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
          node.setDepth(depthFor(prop.z))
          activeScene.layers.entities.add(node)
          propNodes.set(nodeKey, node)
        }
        node.setPosition(Math.round(prop.x * TILE_PX), Math.round(prop.z * TILE_PX))
        node.setDepth(depthFor(prop.z))
        node.setVisible(true)
      }
    }
    for (const [key, node] of propNodes) if (!wanted.has(key)) node.setVisible(false)
  }

  /**
   * 头顶第二行（他此刻在做哪张单）——**懒创建、按需隐藏**（R123）。
   *
   * ## 三条约束（都是任务书点名的）
   *
   * 1. **只对有单的人建**：没单的人**连 Text 对象都不建**（`return` 在最前面）。
   *    8 个人都挂一行会让头顶变成噪音，而"待命"本身就是**没有第二行**这个信息。
   * 2. **颜色从内容库来**（D31）：用 `actor.color`——它已经是 `ScenePlan` 解析好的
   *    内容色（部门色/角色色）。这里**不新增任何字面色值**，样式复用 `LABEL_STYLE` 的
   *    白字黑描边（既有）。
   * 3. **文本变了才写**：`label.text !== next` 才赋值——Phaser 的 `Text.text` setter 会
   *    重新排版并重绘纹理，每帧写一次等于每帧重画 8 张文字贴图。
   *
   * ⚠️ 对象**建了就留着**（只 `setVisible(false)`，不 `destroy`）：单子会来回换手，
   * 建了销毁再建会让"换单"变成一次分配 + 一次纹理重绘的抖动。
   */
  function updateTaskLabel(entry, actor, task) {
    const text = taskLabelText(task)
    if (text === '') {
      // 没单：不建、也不留 —— 待命的人头顶就只有一个名字。
      if (entry.taskLabel !== null && entry.taskLabel !== undefined) entry.taskLabel.setVisible(false)
      return
    }
    if (entry.taskLabel === null || entry.taskLabel === undefined) {
      const label = activeScene.add.text(0, 0, text, TASK_LABEL_STYLE)
      label.setOrigin(0.5, 1)
      // 比名字再高一档：名字 depth 5，它在 4（名字要压在上面，读的顺序才是"先人后单"）。
      label.setDepth(4)
      activeScene.layers.labels.add(label)
      entry.taskLabel = label
    }
    const label = entry.taskLabel
    // **基文本**（不含 `+N`）单独存一份：错开布局每帧要按隐藏人数拼后缀，
    // 若直接在 `label.text` 上拼，下一帧就会在"已带 +N"的文本上再拼一次。
    if (label.getData('baseText') !== text) {
      label.setData('baseText', text)
      // 基文本变了：先写成基文本（不带 `+N`），后缀由错开布局那一帧按当帧的隐藏人数补上。
      label.text = text
    }
    // 色随人走（部门色）——同一张单换手时，标签颜色也跟着换人，一眼看出是谁的活。
    if (typeof actor.color === 'string' && label.style?.color !== actor.color) label.setColor(actor.color)
    // **可见性不在这里决定**（R148）：它归错开布局（每帧按几何算）与气泡标记管。
    // 这里写 `setVisible(true)` 会在每次换单时把"被错开藏掉的那一行"翻出来，两条规则打架。
  }

  /** 角色：精灵 + 引擎动画（`play`）+ 名字；`setInteractive` 让**整只角色**可点。 */
  function drawActors(worldState, plan, nowMs) {
    const models = new Map((plan?.models ?? []).map((model) => [model.id, model]))
    const actors = [...liveActorsOf(worldState, plan)].sort((a, b) => a.z - b.z)
    /**
     * `ownerId → 他此刻在做的那张单`（R123）。
     *
     * 为什么在渲染层算而不是让服务端下发：这是**纯投影**——服务端已经有
     * `tasks[].owner` 与 `tasks[].status`，再加一个"当前单"字段就是同一份真相的第二份拷贝
     *（D31/D37 的老规矩：能推出来的就别再传一份）。
     *
     * **只收未完结的单**：`done`/`failed` 是历史，挂在人头顶没有信息量
     *（而且会让"待命的人"看起来还在忙）。
     * 同一人多张未完结单时**优先 `in_progress`**——那才是"他此刻在做的那张"。
     */
    const currentTaskByOwner = new Map()
    for (const task of worldState?.tasks ?? []) {
      if (typeof task?.owner !== 'string' || task.owner === '') continue
      if (task.status === 'done' || task.status === 'failed') continue
      const prev = currentTaskByOwner.get(task.owner)
      if (prev === undefined || (prev.status !== 'in_progress' && task.status === 'in_progress')) {
        currentTaskByOwner.set(task.owner, task)
      }
    }
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
        entry = { sprite: null, label, taskLabel: null }
        actorNodes.set(actor.id, entry)
      }
      const nameText = actor.name ?? actor.id
      if (entry.label.text !== nameText) entry.label.text = nameText
      // 第二行：**只有手上有活的人才画**（8 个人都挂一行就成噪音了）。
      updateTaskLabel(entry, actor, currentTaskByOwner.get(actor.id))
      const baseKey = sheet === null || typeof model?.url !== 'string' ? null : textureKeyByUrl.get(model.url) ?? null
      const posX = Math.round(actor.x * TILE_PX)
      const posY = Math.round(actor.z * TILE_PX)
      if (baseKey !== null && activeScene.textures.exists(baseKey) === true) {
        const textureKey = ensureTintedSheet(model.url, actor.color, variants.get(actor.id) ?? 0, sheet) ?? baseKey
        if (entry.sprite === null) {
          // 用**引擎的 Arcade 物理精灵**：移动交给物理系统（`moveActorTo` 里的 `physics.moveTo`），
          // 不手写每帧补间。物理体负责"朝目标匀速走"，其余（动画/点人/深度）照旧。
          entry.sprite = activeScene.physics.add.sprite(0, 0, textureKey)
          entry.sprite.setDepth(depthFor(actor.z))
          activeScene.layers.entities.add(entry.sprite)
          // P2：给精灵打上 actorId 标记，`wireViewControls` 用 `hitTestPointer` 判"点在角色上还是空白"。
          entry.sprite.setData('actorId', actor.id)
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
            // 拖拽（在拖地图）不算点人：位移超过 5px 就放过。
            if (typeof pointer.getDistance === 'function' && pointer.getDistance() > 5) return
            // 长按也不算点人（700ms 以上）。
            if (typeof pointer.getDuration === 'function' && pointer.getDuration() > 700) return
            // P1：点人 = 选中（与开对话解耦——镜头锁定 P2、键盘移动 P3 都读这个选中态）。
            selectAgent(actor.id)
            // 点人 = **聚焦**：选中 + 420ms 平移跟随（由上面 `selectAgent` 里的
            // `startFollowSelection` 负责），面板默认落进移动档。
            // ⚠️ 这里原来写的是「R72：点人只开对话，**不动镜头**」——那条从 R80 起就不成立了
            //（`selectAgent` 现在会 `startFollowSelection`）。注释与代码不符时注释是错的，
            // 留着会直接误导下一个实现者以为点人不该动镜头。
            if (actorPick !== null) actorPick(actor.id)
          })
        }
        // ⚠️ **只在纹理真的变了才 `setTexture`**（R85 真凶）。
        //
        // Phaser 的 `GameObject.setTexture(key)` 会顺手 `setFrame(当前帧名)`，
        // 而新纹理上那个帧名解析回 **第 0 帧** —— 于是每次渲染都把精灵打回第 0 帧。
        // 动画只在**帧号变化时**才写回精灵帧（帧率 5fps = 每 200ms），
        // 而这里每 250ms 重置一次 ⇒ 两者交错，精灵在「正确帧」和「第 0 帧」之间来回跳。
        //
        // 为什么只有"朝右"的人看不出来：第 0 帧是朝右的姿势，朝右的人两帧看着一样；
        // 朝左/上/下的人就会看到"一直被掰回向右"——用户原话「只要朝向不是向右就会跳向右」。
        if (entry.sprite.texture?.key !== textureKey) entry.sprite.setTexture(textureKey)
        const [ox, oy] = originOf(sheet)
        entry.sprite.setOrigin(ox, oy)
        // P5：碰撞体只取**脚下一小块**（俯视游戏的通行做法）——上半身可以盖在桌面上，
        // 脚不能踏进墙里。offset 是相对帧左上角算的，底锚精灵要把 offset 推到脚底，
        // 否则整个身体高度都参与碰撞，人会离墙"悬着"半格过不去。
        const cellW = Math.max(1, Number(sheet.cellW) || 16)
        const cellH = Math.max(1, Number(sheet.cellH) || 16)
        const bodyW = Math.max(4, Math.round(cellW * 0.6))
        const bodyH = Math.max(3, Math.round(cellH * 0.34))
        if (entry.sprite.body !== null && entry.sprite.body !== undefined) {
          entry.sprite.body.setSize(bodyW, bodyH)
          entry.sprite.body.setOffset((cellW - bodyW) / 2, cellH - bodyH)
          // 改完尺寸/偏移要立刻落到物理体上，否则第一帧的碰撞体还在原位。
          entry.sprite.body.updateFromGameObject()
        }
        // 墙/家具碰撞：挂上之后手动操控就穿不过去了（重建墙时由 `rebuildWalls` 统一重挂）。
        if (wallGroup !== null && wallGroup !== undefined && (entry.collider === null || entry.collider === undefined)) {
          entry.collider = activeScene.physics.add.collider(entry.sprite, wallGroup)
        }
        // 名字贴着角色头顶：`posY` 是角色脚下（世界像素）。这些底锚角色在 `cellH` 高的
        // 格子里实际只占下 ~75%（顶部留白 ~25%），所以不能拿整格 `cellH` 当身高——旧值
        // `-(cellH + 4)` 把留白也算进去，名字会飘到头顶上方 ~20px（太远）。按可视身高再留 2px。
        // `labelDy` 记下"标签离脚下的竖直距离"，`update()` 里每帧跟着物理移动的精灵贴。
        entry.labelDy = -(Math.round((Number(sheet.cellH) || 16) * 0.75) + 2)
        // P3：被键盘接管的角色**不接受服务端位置**（否则每 250ms 渲染就被拽回原地，
        // 看起来就是"一走动就弹回去"）。动画同理交给 `tickManualMovement` 自己挑。
        entry.textureKey = textureKey
        const manual = ownsPosition(actor.id)
        if (manual !== true) moveActorTo(entry, posX, posY)
        entry.sprite.setDepth(depthFor(actor.z))
        entry.sprite.setVisible(true)
        // `setTexture` 之后帧可能是 `__BASE`（整张图）——但**只在没有动画可播时才钉帧**。
        // ⚠️ 这里曾经**每帧都 setFrame(第一帧)**，结果动画永远冻在第一帧：
        // `currentAnim.key` 看着是对的，人却在原地滑（R64 逐个验方向时才逮到）。
        // 该播哪个动画：**回退链在纯函数里**（返回候选名），`play` 交给引擎。
        // 动画按纹理分开命名（重上色纹理有它自己的一套），否则换色会串回原图。
        const animName = resolveAnimationKey((name) => activeScene.anims.exists(animKeyFor(textureKey, name)) === true, {
          // **带由内容库给**（`ScenePlan.actions`）：working → sit，其余按库里的声明。
          // 渲染器不自己编这套映射——那正是"坐着干活的人站着"那类错藏身的地方。
          band: bandOfState(plan?.actions, actor.state),
          direction: directionOf(actor.facing),
        })
        // 钉帧必须钉**解析出来的那条动画**的首帧。
        // ⚠️ 原来取 `sheet.animations` 的第一个（= `walk.right`，列 0）—— 于是"动画没在播"
        // 的那一刻人会被钉成**朝右**。这正是用户反馈「朝向不是向右就跳向右」的另一半来源
        //（另一半是位置所有权粘住时跳过了动画，见下面的条件）。取不到就退到 `idle.down`（正面）。
        const pinAnim = animName === null
          ? null
          : (sheet?.animations?.[String(animName).replace(/-/g, '.')] ?? null)
        const pinSource = pinAnim ?? sheet?.animations?.['idle.down'] ?? Object.values(sheet?.animations ?? {})[0]
        const firstFrame = pinSource === undefined || pinSource === null
          ? 0
          : (animationFrameList(sheet, pinSource, perRowByUrl.get(model.url) ?? 1)[0] ?? 0)
        // ⚠️ 动画只在「**键盘正推着走**」的那几帧让给 `tickManualMovement`。
        // 位置所有权（`manualPositionIds`）是**粘住**的（切回对话也不能被服务端拽回），
        // 但**动画不能跟着粘**——否则被玩家摸过的人会永远钉在最后按下的那个方向，
        // 服务端的朝向再也不生效。用户反馈的「只要朝向不是向右就会跳向右」就是这条：
        // 位置仍归客户端 → drawActors 跳过动画 → 只有手动那套按 `lastDir` 播，而它恰好是 right。
        if ((manual !== true || wasManualWalking !== true) && animName !== null) {
          const fullKey = animKeyFor(textureKey, animName)
          if (entry.sprite.anims.currentAnim?.key !== fullKey) entry.sprite.play(fullKey, true)
          // 正在播就**别碰帧**（碰了就成了"看着在走、其实是冻帧"）；没在播才钉第一帧
          else if (entry.sprite.anims.isPlaying !== true) entry.sprite.setFrame(firstFrame)
        }
        entry.label.setVisible(true)
        spriteCount += 1
        continue
      }
      fallbackCount += 1
      if (entry.sprite === null || entry.sprite.type !== 'Rectangle') {
        entry.collider?.destroy?.()
        entry.collider = null
        entry.sprite?.destroy()
        entry.sprite = activeScene.add.rectangle(0, 0, 12, 12, colorOf(actor.color), 1)
        entry.sprite.setDepth(depthFor(actor.z))
        activeScene.layers.entities.add(entry.sprite)
        // 没有模型的角色（fallback 方块）也要有物理体：否则它不受墙约束，能在墙里穿。
        activeScene.physics.add.existing(entry.sprite)
        entry.sprite.setData('actorId', actor.id)
        if (wallGroup !== null && wallGroup !== undefined) {
          entry.collider = activeScene.physics.add.collider(entry.sprite, wallGroup)
        }
      }
      entry.labelDy = -16
      moveActorTo(entry, posX, posY)
      entry.sprite.setDepth(depthFor(actor.z))
      entry.sprite.setVisible(true)
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

  // ── 头顶气泡（R76 进引擎 → R77 用本地 9-slice 美术面板）──────────────────────
  // 底图 = Kenney 像素 UI 包的米色面板（`add.nineslice` 撑到任意尺寸，引擎成熟方案，不再手画圆角矩形）。
  // 文字颜色改**深棕**（适配米色底）；语义色（在想/在忙/失败）挪到一个 6px 状态点，不再染整段文字。
  // 「气泡 vs 名字」二选一：气泡出现藏掉头顶名字标签，消失再露出来（`bubbleVisibleIds`）。

  /** 语义色（状态点用）：在想=琥珀、在忙=蓝、失败=红、其余=面板本色。 */
  function bubbleColor(phase) {
    switch (phase) {
      case 'thinking': return 0xffc94d // --st-ready
      case 'acting': return 0x4fa8ff // --st-in_progress
      case 'failed': return 0xff6b6b // --st-failed
      default: return 0xb08a4f // 面板边框色（米棕）
    }
  }
  const BUBBLE_TEXT_COLOR = '#3d2b1a' // 深棕，适配米色底
  const BUBBLE_PAD_X = 10
  const BUBBLE_PAD_Y = 7
  const BUBBLE_MAX_W = 200
  const BUBBLE_GAP = 4 // 气泡底边离头顶的间距
  // 「对话气泡」和「面板」的区别就是那条朝下指说话人的小尾巴——底图（本地 9-slice 面板）没有
  // 尾巴，这里补一个小三角：填色=面板内芯、斜边描边=面板描边，顶边不描（和面板连成一体）。
  const BUBBLE_TAIL_W = 12 // 尾巴底边宽
  const BUBBLE_TAIL_H = 5 // 尾巴高（朝下，伸进 `BUBBLE_GAP` 指向头顶）
  const BUBBLE_FILL = 0xd3bf8f // 面板内芯米色（采样 Ancient/tan.png 中心）
  const BUBBLE_EDGE = 0xb1a077 // 面板描边米棕（采样 1px 内侧）
  /** 本帧有气泡的 agent——名字标签据此让位（二选一）。 */
  const bubbleVisibleIds = new Set()

  function makeBubbleNode() {
    const container = activeScene.add.container(0, 0)
    container.setDepth(1000)
    // 底图：优先 9-slice 美术面板；纹理没载好时退回 Graphics（不让气泡整块消失）。
    const usePanel = activeScene.textures.exists(BUBBLE_PANEL_KEY) === true
    const bg = usePanel
      ? activeScene.add.nineslice(0, 0, BUBBLE_PANEL_KEY, undefined, 40, 28, BUBBLE_SLICE, BUBBLE_SLICE, BUBBLE_SLICE, BUBBLE_SLICE)
      : activeScene.add.graphics()
    // 尾巴：朝下的小三角，把「面板」变成「对话气泡」。画在 bg 之上、文字之下。
    const tail = activeScene.add.graphics()
    const dot = activeScene.add.circle(0, 0, 3, bubbleColor(''))
    const text = activeScene.add.text(0, 0, '', {
      fontFamily: UI_FONT,
      fontSize: '12px',
      color: BUBBLE_TEXT_COLOR,
      lineSpacing: 2,
      wordWrap: { width: BUBBLE_MAX_W, useAdvancedWrap: true },
    })
    container.add([bg, tail, text, dot])
    activeScene.layers.bubbles.add(container)
    return { container, bg, tail, text, dot, usePanel }
  }

  /** 让底图撑到 w×h：9-slice 直接 `setSize`；Graphics 退路画回 R76 的圆角矩形。 */
  function resizeBubbleBg(node, w, h) {
    if (node.usePanel === true) {
      node.bg.setSize(w, h)
      drawBubbleTail(node.tail, h, true)
      return
    }
    const g = node.bg
    g.clear()
    g.fillStyle(0x3a3a50, 0.92)
    g.lineStyle(1, 0xffffff, 0.14)
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 6)
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 6)
    drawBubbleTail(node.tail, h, false)
  }

  /** 画气泡的朝下小尾巴：填色=面板内芯、斜边描边=面板描边，顶边不描（与面板连成一体）。 */
  function drawBubbleTail(g, h, usePanel) {
    g.clear()
    const y0 = h / 2 - 0.5 // 尾巴顶边略压进面板底边，避免和面板底边之间露一条缝
    const yTip = y0 + BUBBLE_TAIL_H
    const half = BUBBLE_TAIL_W / 2
    const fill = usePanel ? BUBBLE_FILL : 0x3a3a50
    const edge = usePanel ? BUBBLE_EDGE : 0xffffff
    g.fillStyle(fill, usePanel ? 1 : 0.92)
    g.fillTriangle(-half, y0, half, y0, 0, yTip)
    g.lineStyle(1, edge, usePanel ? 1 : 0.14)
    g.beginPath()
    g.moveTo(-half, y0)
    g.lineTo(0, yTip)
    g.lineTo(half, y0)
    g.strokePath()
  }

  function drawBubbles(bubbles = []) {
    // 场景还没 `create()`（`activeScene` 已被 `startGame` 里的 `game.scene.getScene('world')`
    // 提前赋成场景对象，但 `layers` 要等 `create()` 才建）——此时 `activeScene` 非 null 而
    // `activeScene.layers` 是 undefined，直接读 `.bubbles` 会抛"reading 'bubbles'"。
    // 所以和 `render()` 一样先判 `state.ready`（`create()` 的完成信号），再判层在不在。
    if (state.ready !== true || activeScene === null || activeScene.layers === undefined || activeScene.layers.bubbles === undefined) return
    const seen = new Set()
    bubbleVisibleIds.clear()
    for (const bubble of bubbles) {
      const entry = actorNodes.get(bubble.agentId)
      if (entry === undefined) continue
      const sprite = entry.sprite
      if (sprite === null || sprite === undefined || sprite.visible !== true) continue
      seen.add(bubble.agentId)
      bubbleVisibleIds.add(bubble.agentId)
      let node = bubbleNodes.get(bubble.agentId)
      if (node === undefined) {
        node = makeBubbleNode()
        bubbleNodes.set(bubble.agentId, node)
      }
      node.text.setText(bubble.text ?? '')
      const w = Math.min(BUBBLE_MAX_W, node.text.width + BUBBLE_PAD_X * 2)
      const h = node.text.height + BUBBLE_PAD_Y * 2
      resizeBubbleBg(node, w, h)
      node.text.setPosition(-w / 2 + BUBBLE_PAD_X, -h / 2 + BUBBLE_PAD_Y)
      node.dot.setFillStyle(bubbleColor(bubble.phase))
      node.dot.setPosition(-w / 2 + 6, -h / 2 + 6)
      // 容器 origin(0.5,0.5)：中心摆在「头顶 - 间距 - 半高」。头顶用精灵 top-center（不依赖被藏掉的标签）。
      const top = sprite.getTopCenter()
      node.container.setPosition(Math.round(top.x), Math.round(top.y - BUBBLE_GAP - h / 2))
      node.container.setVisible(true)
      // 二选一：气泡盖掉头顶名字标签——**第二行也一起藏**，
      // 否则那行工单会孤零零浮在气泡上方，看着像气泡的标题。
      // 用**显式标记**而不是靠 `visible`：错开布局每帧会重设第二行的可见性，
      // 只把它设成 false 会被下一帧翻回来（两条规则打架）。
      entry.label.setVisible(false)
      entry.taskLabelHiddenByBubble = true
      entry.taskLabel?.setVisible(false)
    }
    for (const [id, node] of bubbleNodes) {
      if (seen.has(id)) continue
      node.container.setVisible(false)
    }
    // 没有气泡、且还活着的 agent：把名字标签重新露出来（顺手贴回位置，避免 update() 跳过隐藏标签后的旧值）。
    for (const [id, entry] of actorNodes) {
      if (bubbleVisibleIds.has(id)) continue
      if (entry.sprite === null || entry.sprite === undefined || entry.sprite.visible !== true) continue
      if (entry.label.visible !== true) {
        entry.label.x = entry.sprite.x
        entry.label.y = entry.sprite.y + (entry.labelDy ?? -16)
        entry.label.setVisible(true)
        // 第二行跟着回来（位置与可见性由下面那帧的错开布局摆正）。
        entry.taskLabelHiddenByBubble = false
      }
    }
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
    drawProps(plan)
    // 墙要先于角色建好，`drawActors` 里新建精灵时才能挂上碰撞。
    loadFineColliders(plan?.map?.url ?? null)
    loadMapObjects(plan?.map?.url ?? null)
    loadMapTiles(plan?.map?.url ?? null)
    rebuildWalls(worldState)
    // 分层图齐了就按"地板背景 + 可排序对象"铺；否则退回合成底图 + 整格墙。
    const layered = drawLayers()
    // 墙**始终**参与 Y 排序：layer0 那张平铺图里的墙只是兜底（在最底层），
    // 真正决定遮挡的是这些按行取深度的墙条 —— 角色站到墙后才会被挡住。
    drawWalls()
    drawTiles()
    drawMapObjects()
    drawActors(worldState, plan, state.nowMs)
    // 家具与角色都进了同一层，且深度跟着世界 z 走 → 每帧按深度重排一次，遮挡才正确。
    activeScene.layers.entities.sort('depth')
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
      // **绑定引擎的 Arcade 物理**：移动交给物理系统（`physics.moveTo`），不再手写补间/lerp。
      // 俯视 2D、无重力；碰撞/寻路仍由服务端确定性模拟负责，客户端物理只负责"视觉上的匀速移动"。
      // ⚠️ `default` 用字符串 `'arcade'`（本 build 不导出 `Physics.ARCADE` 常量，只有 `Physics.Arcade` 命名空间）。
      physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
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
    /** R76：头顶气泡进引擎——每帧喂 `[{ agentId, phase, text, name }]`，场景用 Phaser 对象画。 */
    renderBubbles: drawBubbles,
    /** 诊断：Phaser 到底用了哪个渲染器（webgl / canvas）。 */
    backend: backendName,
    /** 诊断：让夹具/测试能拿到 Phaser 的实例。 */
    game: () => game,
    scene: () => activeScene,
    // ── 选中（P1）/ 镜头锁定（P2）：点人 / 看板定位走这两个；键盘移动（P3）会读选中态 ──
    selectAgent,
    clearSelection,
    selectedAgent: () => selectedAgentId,
    following: () => isFollowing(),
    /** P3：超控面板「移动」模式 → 打开键盘操控；「对话」→ 关掉。 */
    setMovementEnabled,
    movementEnabled: () => movementEnabled,
    /** 诊断：键盘操控的接线状态（键位有没有建起来、焦点头在不在输入框）。 */
    manualState: () => ({
      hasMoveKeys: moveKeys !== null,
      movementEnabled,
      lastReason: lastManualReason,
      keyStates: moveKeys === null ? null : {
        up: moveKeys.up.map((k) => `${k.key}:${k.isDown}`),
        down: moveKeys.down.map((k) => `${k.key}:${k.isDown}`),
        left: moveKeys.left.map((k) => `${k.key}:${k.isDown}`),
        right: moveKeys.right.map((k) => `${k.key}:${k.isDown}`),
      },
      textInputFocused: isTextInputFocused(),
      hasWallGroup: wallGroup !== null,
      wallCount: wallGroup === null ? 0 : wallGroup.getLength(),
      hasKeyControl: keyControl !== null,
    }),
  }
}
