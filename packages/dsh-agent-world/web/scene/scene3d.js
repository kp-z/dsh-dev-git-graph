/*
 * 3D 场景（BACKLOG M4-1）—— 面板的第二种渲染器。
 *
 * ── 它和 2D 俯视图的关系 ──────────────────────────────────────────────────────
 *
 * 两个渲染器**吃同一份输入**：`ScenePlan`（布局 / 外观 / 主题）+ 实时 `world`（位姿 / 状态）。
 * 这正是决策 D23 要的效果——"换成现成的 three.js 场景"就只是**换一个消费 ScenePlan 的东西**，
 * 模拟层与内容库一行不用改。所以这个文件里**没有任何内容库知识**：
 * 颜色、模型 id、相机参数、光照、雾，全部来自参数。
 *
 * 2D 俯视图**永久保留**（决策 D21）：3D 调不出来的时候，它是唯一能看清模拟对不对的窗口。
 *
 * ── 三个刻意的取舍 ────────────────────────────────────────────────────────────
 *
 * 1. **不用 rAF 驱动**（R13 踩过的坑：rAF 在不可见的标签页里不触发，
 *    而"agent 在跑、人不一定在看"正是这个面板的常态）。由调用方按节拍调 `render()`。
 * 2. **静态与动态分开**：`ScenePlan` 提供地面/站点/颜色/主题（快照粒度），
 *    实时位姿从 `world` 取（事件粒度）。两者拼起来才是画面——
 *    因为"每帧重算整份 ScenePlan"意味着每帧发一份布局，而那是浪费。
 * 3. **角色暂时是胶囊，不是骨骼模型**。Kenney 的 GLB + 32 条剪辑是 M5 的事
 *    （`docs/ASSETS.md` 已核验）。先把"世界在跑"这件事画对，再谈好看。
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js' // 见 index.html 的 import map
import { createBuilderRegistry } from './builders.js'
import { createModelCache } from './model-loader.js'
import { accountTextures, assessRebuildSeries, BORROWED, OWNED, planDisposal } from '../core/resource-ownership.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
// **必须是 SkeletonUtils.clone 而不是 Object3D.clone()**：后者的克隆会**共享骨架**，
// 于是 12 个角色同步抽搐（摆同一个姿势、同一个进度），看起来像"动画坏了"。
// 这条写在 docs/REFERENCES.md §6.4，是 M5 最容易踩的一个坑。
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

/**
 * 形状从哪来（R16 改）。
 *
 * 这里**不再有任何"桌子是方块、人是胶囊"的判断**——形状由内容的 `models` 条目
 * 指向一个**构建器名**（`desk` / `avatar` / …），构建器实现在 `builders.js` 里。
 *
 * 之前是写死的：站点一律方块（按容量分大小）、角色一律胶囊。那样"换个模型"
 * 就必须改这个文件——而模型选择是内容。
 *
 * **缺失要报出来，不要静默退回方块**：退回的效果是"画面上有个东西，但显然不对"，
 * 而真正的原因（内容引用了一个渲染器没有的构建器）完全看不见。
 * 缺的东西会画成品红占位块，并把名字交给 `onMissing`。
 */
const MISSING_COLOR = '#FF00FF'
/** 还在加载中的占位色（**不是错误色**：灰蓝，与品红区分开）。 */
const PENDING_COLOR = '#7A8BA6'

/**
 * 站点高亮用的两个颜色，**在模块级建一次**。
 *
 * 原来是"每帧、每个 mesh 都 `new THREE.Color(...)`"——10 个站点 × 若干子网格 × 每秒十几次
 * 渲染，就是每秒几百次分配。单看很小，但它是纯 GC 压力，而且**每次都给材质的
 * `emissive` 换一个新对象**，等于每帧都在告诉 three "这个材质变了"。
 */
const EMISSIVE_BUSY = { r: 0.1647, g: 0.1647, b: 0.1647 }
const EMISSIVE_FREE = { r: 0, g: 0, b: 0 }

/**
 * 建一个 3D 场景。
 *
 * @param {HTMLCanvasElement} canvas - 画布。
 * @param {{ onError?: (error: unknown) => void }} [options]
 */
export function createScene3d(canvas, options = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // **默认关**（R21 的实测结论）。开着它会保住绘制缓冲，于是 `toDataURL()`
    // 与截图能取到当前帧——但代价是浏览器**每帧都要多做一次缓冲拷贝/同步**，
    // 而且这条路径会绕过 WebGL 的一些快路径。
    //
    // R15 为了"能程序化取像素来核验"把它开成了 true，当时没量过代价；
    // R21 量了：绘制只有 22 个调用 / 224 个三角形，而 `renderer.render` 每帧要 **15.8ms**。
    // 关掉之后（见 PROGRESS R21 的实测数字）就回到正常量级。
    //
    // 需要取像素时**不要**把它改回 true（那会给所有人付代价），用 URL 参数临时开：
    // `?pdb=1`。核验才需要它，日常使用不需要。
    preserveDrawingBuffer: new URLSearchParams(globalThis.location?.search ?? '').has('pdb'),
  })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  /**
   * **阴影图不每帧重画**（R21 实测结论）。
   *
   * three 默认每帧把整个场景再渲染一遍到 2048×2048 的深度纹理——而我们的场景
   * 除了几个慢慢走动的角色之外完全静止。那是纯浪费，而且实测占了每帧成本的一大块。
   *
   * 现在关掉自动更新，改由 `applyWorld` 每 N 次渲染手动要一次。角色一步只走 0.06 世界单位
   * （约 0.6/秒），所以两三帧的阴影滞后在等距视角下看不出来。
   */
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true

  /** 程序化几何注册表。尺寸与形状都在 `builders.js` 里，这里只管摆放。 */
  const builders = createBuilderRegistry(THREE)

  /**
   * GLB 模型的加载缓存（M5-1）。
   *
   * 一个 `GLTFLoader` 实例复用：它内部有解析器缓存，每次 new 一个会白白丢掉。
   * 失败由缓存记住并只报一次——`applyWorld` 每帧都在跑，一个 404 不能变成每秒 60 次。
   */
  const gltfLoader = new GLTFLoader()
  const models = createModelCache({
    load: (url) => gltfLoader.loadAsync(url),
    // 缓存是 GLTF 源资源的唯一所有者；`releaseCachedModel` 是它履行义务的那一步。
    release: (gltf) => releaseCachedModel(gltf),
    onError: ({ url, error }) => {
      assetErrors.set(url, String(error?.message ?? error))
      options.onMissing?.({
        models: [],
        builders: [],
        assets: [...assetErrors.entries()].map(([u, m]) => `${u}（${m}）`),
        registered: builders.names(),
      })
    },
  })
  /** 加载失败的资源：url → 原因。 */
  const assetErrors = new Map()

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  // 正交相机靠 zoom 缩放，不用 dolly。
  controls.enablePan = true
  controls.target.set(0, 0, 0)

  /**
   * 站点 id → 它那个 `Object3D`，以及它下面所有带材质的 mesh。
   *
   * **为什么要缓存**：原来是每帧对每个站点调一次 `staticGroup.getObjectByName(...)`——
   * 那是**遍历整棵场景树**。10 个站点 × 每秒十几次渲染 × 树里几百个节点（GLB 角色带骨架，
   * 每个几十个节点）= 每秒上万次比较，而图形负载只有 22 个绘制调用。
   * 实测这一处就是"绘制 22 · 三角形 224 却要 16ms/帧"的主因。
   */
  const propNodes = new Map()

  /** 由 ScenePlan 建出来的东西，换 plan 时整体丢掉重建。 */
  let staticGroup = new THREE.Group()
  scene.add(staticGroup)
  const actorById = new Map()
  /**
   * 角色头顶的世界高度（气泡锚点用，M6-5）。按 plan 缓存**一次**：
   * 每帧对每个角色算一次 `Box3.setFromObject` 要走整棵子树（GLB 角色带骨架），
   * 而头顶高度在两次换 plan 之间不会变。GLB 到货换模型时那个角色的缓存会被删掉重算。
   */
  const actorTopY = new Map()
  let plan = null
  let half = 8
  let zoomFactor = 1
  /** 相机俯仰角（弧度）。取景要用它算地面菱形的纵向跨度；由 `applyCamera` 更新。 */
  let pitchRad = (35.264 * Math.PI) / 180
  /** 浮层占掉的边距（CSS 像素）。由面板经 `setViewInsets` 告知；取景据此居中在可见区域。 */
  let viewInsets = { right: 0 }

  /**
   * 清掉一棵子树并释放显存（不只是从场景里摘掉）。
   *
   * ══ R47 修的那个泄漏（+16/次重建）══════════════════════════════════════════
   *
   * 症状：每 `setPlan` 一次，`renderer.info.memory.textures` **+16**，
   * 而几何/绘制/三角形完全不变（22/46/7,634）。
   *
   * 量出来的组成：**8 个角色 × 2 个 `SkinnedMesh` = 16 张 `boneTexture`**。
   * 不是 8×2 张 GLB 贴图——整个默认小镇用到的 7 个 GLB 加起来**只有 1 张纹理**
   * （角色那张 512×512 的 colormap），所以"模型加载器漏了 dispose"这条线索是**错的**。
   *
   * 根因：`SkeletonUtils.clone` 给**每个克隆一份自己的 `Skeleton`**，
   * 而 `Skeleton` 的 `boneTexture` 是渲染时惰性创建的 `DataTexture`。
   * 原来的实现只 `dispose()` 了几何与材质——`material.dispose()` **不会碰骨架**，
   * 于是每次重建都新造 16 张骨架纹理，旧的没人释放。
   *
   * ══ 所有权（为什么不是引用计数）════════════════════════════════════════════
   *
   * `models` 缓存是 GLTF 源资源（几何 + 纹理）的**唯一所有者**；实例**借用**它们。
   * 实例只拥有自己造出来的东西：材质 clone、骨架（boneTexture）、程序化几何。
   * 判断交给纯函数 `planDisposal`（可在 node 里测），这里只负责把对象登记进去。
   */
  const disposeTree = (root) => {
    /** id → { id, kind, ownership, release }。按 id 去重：两个 mesh 可能共用同一个骨架/几何。 */
    const resources = new Map()
    const register = (id, kind, ownership, release) => {
      if (!resources.has(id)) resources.set(id, { id, kind, ownership, release })
    }

    root.traverse((node) => {
      const geometry = node.geometry
      if (geometry !== undefined && geometry !== null) {
        register(`geometry:${geometry.uuid}`, 'geometry', node.userData.borrowedGeometry === true ? BORROWED : OWNED, () =>
          geometry.dispose(),
        )
      }

      const material = node.material
      const materials = Array.isArray(material)
        ? material
        : material !== undefined && material !== null
          ? [material]
          : []
      for (const m of materials) {
        // GLB 实例各持一份材质 clone（见 `instantiate`），程序化材质也是就地造的 → 都归实例。
        // ⚠️ 但材质**引用**的纹理是借来的，所以这里只 dispose 材质本身，不碰它的贴图。
        register(`material:${m.uuid}`, 'material', OWNED, () => m.dispose())
      }

      // ★ 这一条就是 R47 的修复：骨架自带 boneTexture，且它是**实例自己**的。
      if (node.isSkinnedMesh === true && node.skeleton !== undefined && node.skeleton !== null) {
        const skeleton = node.skeleton
        register(`skeleton:${skeleton.uuid}`, 'skeleton', OWNED, () => skeleton.dispose())
      }
    })

    const { dispose } = planDisposal([...resources.values()])
    for (const id of dispose) resources.get(id)?.release()
  }

  const clearStatic = () => {
    scene.remove(staticGroup)
    disposeTree(staticGroup)
    staticGroup = new THREE.Group()
    scene.add(staticGroup)
    actorById.clear()
    propNodes.clear()
    actorTopY.clear()
  }

  /**
   * 释放**缓存里的**一份 GLTF 源资源（唯一所有者的责任）。
   *
   * 用 `disposeTree` 复用同一套所有权规则：源场景里的网格没有 `borrowedGeometry` 标记，
   * 所以它们的几何按 `OWNED` 处理——**这是对的**，因为源就是所有者。
   * 这里用函数声明（会被提升）而不是 `const`：缓存在本函数更早的地方建，
   * 而 `release` 是延迟调用的，提升让"先建缓存、后定义释放逻辑"不会踩 TDZ。
   */
  function releaseCachedModel(gltf) {
    if (gltf === null || gltf === undefined) return
    if (gltf.scene === null || gltf.scene === undefined) return
    disposeTree(gltf.scene)
  }

  /** 记下这个站点下的所有 mesh（高亮时直接改，不用再遍历/查找）。 */
  const indexPropMeshes = (node) => {
    const meshes = []
    node.traverse((child) => {
      if (child.isMesh === true) meshes.push(child)
    })
    node.userData.meshes = meshes
    node.userData.occupied = null // 未知：第一帧一定会写一次
  }

  /** 按主题配相机。等距沙盘的经典参数是 45° / 35.264°。 */
  const applyCamera = (theme) => {
    const cam = theme?.camera ?? { projection: 'orthographic', yawDeg: 45, pitchDeg: 35.264, zoom: 1 }
    zoomFactor = cam.zoom ?? 1
    const yaw = (cam.yawDeg * Math.PI) / 180
    const pitch = (cam.pitchDeg * Math.PI) / 180
    pitchRad = pitch
    const dist = half * 6
    camera.position.set(
      dist * Math.cos(pitch) * Math.sin(yaw),
      dist * Math.sin(pitch),
      dist * Math.cos(pitch) * Math.cos(yaw),
    )
    camera.lookAt(0, 0, 0)
    controls.target.set(0, 0, 0)
    controls.update()
    resize()
  }

  /** 按主题配光照。三个光源都可缺省。 */
  const applyLighting = (theme) => {
    for (const light of [...scene.children].filter((c) => c.isLight)) {
      scene.remove(light)
      light.dispose?.()
    }
    const lighting = theme?.lighting
    if (lighting?.hemisphere) {
      const { sky, ground, intensity } = lighting.hemisphere
      scene.add(new THREE.HemisphereLight(new THREE.Color(sky), new THREE.Color(ground), intensity))
    }
    if (lighting?.ambient) {
      scene.add(new THREE.AmbientLight(new THREE.Color(lighting.ambient.color), lighting.ambient.intensity))
    }
    if (lighting?.directional) {
      const d = lighting.directional
      const light = new THREE.DirectionalLight(new THREE.Color(d.color), d.intensity)
      light.position.set(d.position.x, d.position.y, d.position.z)
      light.castShadow = d.castShadow
      light.shadow.mapSize.set(d.shadowMapSize, d.shadowMapSize)
      // 阴影相机要罩住整个小镇，否则边上的建筑没有影子。
      const span = half * 1.6
      const cam = light.shadow.camera
      cam.left = -span
      cam.right = span
      cam.top = span
      cam.bottom = -span
      cam.near = 0.5
      cam.far = half * 8
      cam.updateProjectionMatrix()
      scene.add(light)
      scene.add(light.target)
    }
    // 主题缺光照时给一组兜底，别让画面全黑（黑屏最难判断是"没配"还是"坏了"）。
    if (lighting === undefined || lighting === null) {
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2))
    }
  }

  /** 按主题配雾与色调映射。 */
  const applyPost = (theme) => {
    const post = theme?.post
    renderer.toneMapping =
      { ACESFilmic: THREE.ACESFilmicToneMapping, Linear: THREE.LinearToneMapping, None: THREE.NoToneMapping }[
        post?.toneMapping ?? 'ACESFilmic'
      ] ?? THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = post?.exposure ?? 1
    // bloom 需要 postprocessing（peer 是 three >=0.168），当前 vendor 的是 0.167.1，
    // 所以这里**刻意不做**——主题里的开关留着，换版本后接上即可（见 vendor README）。
    scene.fog =
      theme?.fog === null || theme?.fog === undefined
        ? null
        : new THREE.FogExp2(new THREE.Color(theme.fog.color).getHex(), theme.fog.density)
  }

  /**
   * 用地块铺地面（R32 起是"被灯照亮的台面"，不是一张平涂的色块）。
   *
   * 两处变化，都只改**表现**，不碰数据：
   * 1. `MeshLambertMaterial` → `MeshStandardMaterial`。Lambert 不吃粗糙度，
   *    整块地是一个均匀的明度，看上去就是"平面图上的色块"；PBR 的高粗糙度 + 零金属
   *    会让主光在台面上留下柔和的明暗过渡，这是"现代"质感最便宜的来源。
   * 2. 每块地略微抬高并缩一圈，四周露出深色缝隙（`GROUND_GAP`），再在边缘加一圈
   *    同色相、更亮的细线——地块之间有了边界，"他走去机房了"一眼就能看出来。
   *    边线颜色由地块色**推导**（提亮），所以仍然没有任何颜色字面量：换皮肤，边线跟着换。
   */
  const GROUND_GAP = 0.12
  const buildGround = (ground) => {
    for (const g of ground) {
      const base = new THREE.Color(g.color)
      const w = Math.max(0.1, g.width - GROUND_GAP)
      const d = Math.max(0.1, g.depth - GROUND_GAP)

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ color: base, roughness: 0.92, metalness: 0 }),
      )
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(g.x, 0.002, -g.z) // 面板的世界坐标 z 朝下，three 的 z 朝屏幕外；略抬高避免与底板 z-fight
      mesh.receiveShadow = true
      mesh.name = `ground:${g.id}`
      staticGroup.add(mesh)

      // 边缘灯带：同色相、提亮。用 LineLoop 而不是发光材质——零后处理成本，不进 bloom 管线。
      const edge = base.clone().offsetHSL(0, 0.12, 0.22)
      const hw = w / 2
      const hd = d / 2
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-hw, 0, -hd),
          new THREE.Vector3(hw, 0, -hd),
          new THREE.Vector3(hw, 0, hd),
          new THREE.Vector3(-hw, 0, hd),
        ]),
        new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.85 }),
      )
      outline.position.set(g.x, 0.006, -g.z)
      outline.name = `ground-edge:${g.id}`
      staticGroup.add(outline)
    }
  }

  /** 缺东西的记录：`{ models: Set, builders: Set }`。换 plan 时清空。 */
  let missing = { models: new Set(), builders: new Set() }

  /**
   * 把一个外部模型**摆正**：x/z 居中、底面贴地（就地修改 `position`）。
   *
   * ## 为什么这是机制而不是内容
   *
   * Kenney 的家具模型**原点在角/边上，不在中心**（实测 `desk` 的包围盒是
   * `x -0.01..+0.72 / z -0.38..+0.18`）。而站点的 `anchor` 是"中心"——直接摆，
   * 家具会整体偏出去半间屋子。
   *
   * 修法有两条：在内容里给 30 个模型各写一个偏移量（数据会随模型数量膨胀，
   * 而且换一个模型就要补一条），或者**在这里按包围盒自动摆正**。
   * 后者是"怎么把任意外部模型放进来"的通用能力，所以它属于机制。
   *
   * 对已经居中的模型（Kenney 的角色）这是**无操作**——所以不需要开关。
   *
   * ⚠️ **调用方的契约（R49 立）**：这里把位移写在 `node.position` 上，
   * 所以 `onLoaded` 里的调用方必须**往这个位置上加**自己的摆放偏移
   * （`position.add(...)`），**不能 `position.copy(...)` / `position.set(...)` 覆盖**——
   * 覆盖会把居中的位移整个抹掉，于是模型按原始原点摆放，
   * 而 Kenney 家具的原点在角上（`desk` 的盒心在 x 0.536 / z -0.276）。
   * 这个坑真的发生过（R49：桌面小件和桌子各自带着不同的原点偏移，
   * 鼠标直接悬在桌子外面），所以两个调用点都写了注释指着这一段。
   */
  const recenterOnGround = (node) => {
    node.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(node)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    // 绕自身原点旋转不会移动原点，所以这里的位移与 `rotation.y` 无关，可以放心加。
    node.position.x -= center.x
    node.position.z -= center.z
    node.position.y -= box.min.y
  }

  /** 一个中性占位块（还在加载中）。 */
  const pending = () => {
    const node = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.3, 0.5),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PENDING_COLOR), roughness: 0.6, transparent: true, opacity: 0.55 }),
    )
    node.position.y = 0.65
    node.userData.pending = true
    return node
  }

  /** 品红占位块：缺失也要**看得见**，否则画面上只是"少了个东西"。 */
  const placeholder = () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(MISSING_COLOR), roughness: 0.7 }),
    )
    mesh.position.y = 0.4
    mesh.castShadow = true
    return mesh
  }

  /**
   * 按 `modelId` 造一个模型实例。
   *
   * @returns {object} 摆好的 `Object3D`（缺失时是占位块）。
   */
  const instantiate = (modelId, modelById, spec, onLoaded) => {
    const model = modelById.get(modelId)
    if (model === undefined) {
      missing.models.add(modelId)
      return placeholder()
    }

    // ── 外部模型（GLB）：**异步** ─────────────────────────────────────────────
    //
    // 先挂一个中性占位块，加载完再把它换掉。三条约束：
    //  · 占位色是灰蓝不是品红——"还没到"与"出错了"是两件事，不该长得一样；
    //  · 到货时要检查它**还在场景里**（用户可能已经换过快照/重开一局）；
    //  · 每个实例克隆一份材质（`cloneSkinned` 会共享材质，改一个会改到所有人）。
    if (model.url !== null) {
      const node = pending()
      models
        .get(model.url)
        .then((gltf) => {
          const real = cloneSkinned(gltf.scene)
          real.traverse((child) => {
            if (child.isMesh !== true) return
            // 几何是**借**缓存里那份的：`Object3D.clone` / `SkeletonUtils.clone` 都**共享几何**
            // （不复制 buffer）。所以重建时不许释放它——那是缓存的东西，
            // 释放它只会让下次重建把同一份几何重新上传一遍（白费，且看起来像在增长）。
            child.userData.borrowedGeometry = true
            // 材质则**必须**每个实例一份 clone：clone 会共享材质，改一个会改到所有人。
            // 它引用的贴图同样是借的（`Material.clone()` 只复制引用）——我们从不 dispose 贴图。
            child.material = child.material.clone()
            child.castShadow = true
            child.receiveShadow = true
          })
          real.userData.kind = 'glb'
          real.userData.animations = gltf.animations
          real.scale.setScalar(model.scale)
          real.rotation.y = model.rotationY
          real.position.y += model.anchorY
          // 摆正：Kenney 的家具原点在角上，不摆正会整体偏出去半间屋子。
          recenterOnGround(real)
          onLoaded?.(real, node)
        })
        .catch(() => {
          // 原因已经由缓存的 onError 报过了（而且只报一次）。这里只保证画面诚实：
          // 把占位块换成"明确的错误色"，别让它一直假装在加载。
          node.material.color = new THREE.Color(MISSING_COLOR)
          node.material.opacity = 1
          node.userData.pending = false
        })
      return node
    }

    // ── 程序化几何：同步 ──────────────────────────────────────────────────────
    if (model.builder === null) {
      missing.builders.add(`（无构建器也无 url）${model.id}`)
      return placeholder()
    }
    const node = builders.build(model.builder, spec)
    if (node === null) {
      missing.builders.add(model.builder)
      return placeholder()
    }
    node.userData.kind = 'builder'
    node.scale.setScalar(model.scale)
    node.rotation.y = model.rotationY
    node.position.y += model.anchorY
    return node
  }

  /**
   * 把"加载完的模型"换到占位块的位置上。
   *
   * 到货时那个占位块可能**已经不在场景里**了（用户换过快照、或者重开了一局），
   * 所以先看 `parent`——没有就丢掉，不要往一个已经废弃的组里挂东西。
   */
  const swapIn = (real, old, record) => {
    const parent = old.parent
    if (parent === null) return
    // ⚠️ **不要在这里动 `real` 的变换**（R49 修）。
    //
    // 原来这里有一行 `real.position.copy(old.position)`，用来"继承占位块站的位置"。
    // 但它同时把 `recenterOnGround` 写进 `real.position` 的**居中贴地位移一起抹掉**了，
    // 而 Kenney 家具的原点在角/边上（`desk` 盒心在 x 0.536 / z -0.276）。
    // 后果是两个都很难查的缺陷：
    //   · 站点家具按**原始原点**摆放，于是"桌面小件"的位置全都不对（鼠标悬在桌子外面）；
    //   · 角色继承了占位块的 `y`（`pending()` 把它放在 0.65，因为占位盒高 1.3、要让它底面贴地），
    //     于是**8 个角色都浮在地面上方 0.65**（实测：块高 1.343、minY 0.65）。
    //
    // 现在契约是：**调用方在 `onLoaded` 里算好 `real` 的完整变换**（位置与朝向），
    // `swapIn` 只负责挂进场景、改名、销毁旧节点。两个调用点都按这个契约写了。
    real.name = old.name
    parent.add(real)
    parent.remove(old)
    disposeTree(old)
    record?.(real)
  }

  /**
   * 摆站点。形状由内容声明的模型决定，这里没有形状判断。
   *
   * ## 一个站点是一**组**部件（M4-11，R48）
   *
   * `p.parts` 里的每一项是"这个站点的一件东西"（桌子、椅子、显示器…），
   * 位置是**相对站点锚点**的局部偏移。所以每个站点建一个**空组**当锚点，
   * 每件东西挂在组里——**组名保持 `prop:<id>`**，因为 `applyWorld` 是按名字
   * 找站点来更新高亮的；名字放在某一件家具上会让"这个站点在哪"变成"这个显示器在哪"。
   *
   * 偏移的坐标约定与站点本身一致：世界的 +z 朝**屏幕下方**（等距视角），
   * 所以 z 取负（与 `node.position.set(p.x, _, -p.z)` 同一条约定）。
   */
  const buildProps = (props, modelById) => {
    for (const p of props) {
      const group = new THREE.Group()
      group.name = `prop:${p.id}`
      group.position.set(p.x, 0, -p.z)
      const parts = Array.isArray(p.parts) && p.parts.length > 0 ? p.parts : []
      for (const part of parts) {
        const node = instantiate(
          part.modelId,
          modelById,
          { color: p.color, capacity: p.capacity },
          // 到货后：换到**同一个局部位置**（组已经承担了站点的世界坐标）。
          //
          // ⚠️ 这里必须是 `add`，**不是 `copy`**（R49 修）。
          //
          // `recenterOnGround` 把"按包围盒在 x/z 居中、底面贴到 y=0"的位移**写在了
          // `real.position` 上**；而 `copy(old.position)` 会把它整个抹掉，于是 GLB
          // 按**原始原点**摆放——而 Kenney 家具的原点在角/边上（实测 `desk` 的盒心
          // 在 x 0.536 / z -0.276，`computerKeyboard` 在 x 0.212）。
          //
          // 后果正是 R48 那个"桌面小件与桌子对不上"：桌子和键鼠各自带着**不同的**
          // 原始原点偏移，内容里算好的相对位置就全错了（我实测过：只有桌子+鼠标时，
          // 鼠标落在桌子外面、悬在背景上）。`add` 之后两边都按盒心摆放，内容里的偏移才成立。
          (real, old) => {
            // 位置 = `recenterOnGround` 的居中贴地位移（已经在 `real.position` 上）
            //      **加上**内容声明的局部偏移。
            real.position.add(old.position)
            // 朝向同理：`real.rotation.y` 是模型条目自己的 rotationY，再叠内容的额外旋转。
            real.rotation.y += old.rotation.y
            swapIn(real, old, (fresh) => {
              indexPropMeshes(fresh)
            })
          },
        )
        // 局部偏移：模型条目的 scale/rotationY 由 `instantiate` 负责，
        // 这里只叠内容声明的**位置**与**额外旋转**。
        node.position.set(part.dx, part.dy, -part.dz)
        if (part.rotationY !== 0) node.rotation.y += part.rotationY
        node.name = `part:${p.id}:${part.modelId}`
        group.add(node)
      }
      staticGroup.add(group)
      indexPropMeshes(group)
      propNodes.set(p.id, group)
    }
  }

  /** 摆角色。同理，形状来自内容；真正的骨骼模型是 M5。 */
  const buildActors = (actors, modelById) => {
    for (const a of actors) {
      const node = instantiate(a.modelId, modelById, { color: a.color }, (real, old) => {
        // 角色与家具**不同**：x/z 与朝向每帧都由 `applyWorld` 从世界状态写回来，
        // 所以这里只负责把 `recenterOnGround` 算好的 **y 留住**（让脚踩在地面上）。
        // **绝不能继承占位块的 y**——`pending()` 把它放在 0.65（占位盒高 1.3、底面要贴地），
        // 继承过来就是"8 个角色整体浮空 0.65"（R49 实测到的那个缺陷）。
        real.position.set(a.x, real.position.y, -a.z)
        real.rotation.y = -a.facing
        // 换过之后 `actorById` 必须指向新对象，否则**位置会停在原地不动**
        // （`applyWorld` 每帧从这张表里拿对象来更新位姿）。
        swapIn(real, old, (fresh) => actorById.set(a.id, fresh))
        // 头顶高度也重新算：占位块（灰蓝盒子）与真模型不是一个高度，
        // 不删缓存的话气泡会一直挂在占位块的高度上。
        actorTopY.delete(a.id)
      })
      node.position.set(a.x, node.position.y, -a.z)
      node.rotation.y = -a.facing
      node.name = `actor:${a.id}`
      staticGroup.add(node)
      actorById.set(a.id, node)
    }
  }

  /**
   * 换一份 ScenePlan（快照粒度）。
   *
   * @param {object} nextPlan - `ScenePlan`。
   */
  /** `setPlan` 被调了几次。它在反复调用 = 面板在反复重拉快照（纹理增长的可疑来源）。 */
  let planRebuilds = 0

  const setPlan = (nextPlan) => {
    planRebuilds += 1
    plan = nextPlan
    half = plan.extent?.half ?? 8

    missing = { models: new Set(), builders: new Set() }
    // 计划自带模型表（只含本场景用到的），所以渲染器不用去内容库里找。
    const modelById = new Map((plan.models ?? []).map((m) => [m.id, m]))

    clearStatic()
    applyPost(plan.theme)
    applyLighting(plan.theme)
    buildGround(plan.ground ?? [])
    buildProps(plan.props ?? [], modelById)
    buildActors(plan.actors ?? [], modelById)
    applyCamera(plan.theme)

    // **一次性报全**，不是每帧刷一条：缺失是内容/渲染器对不上的问题，
    // 而每帧报一次会把控制台淹掉、也把"到底缺几个"这件事埋了。
    if (missing.models.size > 0 || missing.builders.size > 0) {
      options.onMissing?.({
        models: [...missing.models].sort(),
        builders: [...missing.builders].sort(),
        assets: [...assetErrors.entries()].map(([url, reason]) => `${url}（${reason}）`),
        registered: builders.names(),
      })
    }
  }

  /** 按实时世界更新位姿与状态（事件粒度）。 */
  const applyWorld = (world) => {
    if (world === null || world === undefined) return

    // 站点：有人的高亮（亮度由"有没有人在用"决定，颜色仍来自内容）。
    const busy = new Set()
    for (const agent of world.agents ?? []) {
      if (agent.station !== null) busy.add(agent.station)
      if (agent.targetStation !== null) busy.add(agent.targetStation)
    }
    for (const p of plan?.props ?? []) {
      const node = propNodes.get(p.id)
      if (node === undefined) continue
      const occupied = busy.has(p.id)
      // **只在状态真的变化时**动材质。原来每帧都写一遍，等于每帧都在告诉 three
      // "这个材质变了"——即使值完全一样。
      if (node.userData.occupied === occupied) continue
      node.userData.occupied = occupied
      const target = occupied ? EMISSIVE_BUSY : EMISSIVE_FREE
      for (const mesh of node.userData.meshes ?? []) {
        mesh.material.emissive.setRGB(target.r, target.g, target.b)
      }
      // 只对**程序化**几何做"被占用时抬一点"：对真模型是拉伸，很难看。
      if (node.userData.kind === 'builder') node.scale.y = occupied ? 1.12 : 1
    }

    for (const agent of world.agents ?? []) {
      const mesh = actorById.get(agent.id)
      if (mesh === undefined) continue
      // **只改 x/z，不动 y**：y 由构建器决定（人形模型的底面在 y=0，
      // 而旧写法按一个写死的常量把人抬到半空）。这正是"形状交给构建器"带来的差别。
      mesh.position.set(agent.position.x, mesh.position.y, -agent.position.z)
      // GLB 角色的朝向：Kenney 的模型面朝 +z，而世界里的 `facing` 是绕 y 的弧度，
      // 且 three 的 z 朝屏幕外（世界坐标 z 朝下，所以取负号）。M5 之前的口径一致。
      mesh.rotation.y = -agent.facing
      // 只对**程序化**几何用"压扁"表示在干活：对真模型那是把人压扁，很难看。
      if (mesh.userData.kind === 'builder') mesh.scale.y = agent.state === 'working' ? 0.82 : 1
    }
    controls.update()
  }

  /** 按容器尺寸重算正交视锥。 */
  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    // **像素比封顶 1.5**（R21 实测结论）。
    //
    // 我们的画布在高分屏上是 2112×1403，DPR=2 → 约 **3 百万像素**，而每个像素都要付
    // 雾 + PCF 软阴影 + ACES 色调映射的账。实测这就是每帧 17ms 的主因之一。
    // 1.5 之后填充量降到 56%，而在等距沙盘这种风格上肉眼几乎看不出差别。
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    renderer.setPixelRatio(dpr)
    renderer.setSize(width, height, false)

    const aspect = width / height
    // ── 取景（R32 修）──────────────────────────────────────────────────────────
    //
    // 旧版用 `half * 1.25 * zoomFactor` 当纵向半高，于是横向可见半宽 = span × aspect
    // ≈ 16.7，而世界只有 `half`=8 —— **横向留了一倍多的空白**，小镇显得又小又偏。
    //
    // 现在是"把世界装进**看得见的那块**"：等距视角下 2·half 见方的地面是个菱形，
    // 横向跨度 `2·half·√2`、纵向跨度 `2·half·√2·sin(pitch)`；取更紧的那一边定缩放。
    //
    // `insetRight` = 右侧浮动抽屉占掉的宽度。世界要居中在可见区域，而不是整个画布——
    // R32 之前抽屉把小镇最右一列（黄区）的角色整个盖住了。
    // 用 `setViewOffset` 平移投影窗口：**相机位置不动**，所以 OrbitControls 的状态不受影响。
    const insetRight = Math.max(0, Math.min(viewInsets.right, width * 0.6))
    const visibleW = Math.max(1, width - insetRight)
    const visibleAspect = visibleW / height
    const groundHalfW = half * Math.SQRT2
    const groundHalfH = half * Math.SQRT2 * Math.sin(pitchRad)
    const margin = 1.08 // 留 8% 边距，小镇不贴边
    const span = Math.max(groundHalfH * margin, (groundHalfW * margin) / visibleAspect) * zoomFactor
    camera.left = -span * aspect
    camera.right = span * aspect
    camera.top = span
    camera.bottom = -span
    // 把投影窗口往右挪半个抽屉宽：世界中心落在"可见区域"中心。
    if (insetRight > 0) camera.setViewOffset(width, height, insetRight / 2, 0, width, height)
    else camera.clearViewOffset()
    // 远近裁剪面跟着世界尺寸走：写死会在放大/缩小后把小镇切掉。
    camera.near = 0.1
    camera.far = half * 40
    camera.updateProjectionMatrix()
  }

  /**
   * 告诉场景"浮层占掉了多少"（R32）。由面板在抽屉开合时调用；之后会自动重新取景。
   *
   * @param insets - 目前只用 `right`（右侧抽屉宽 + 边距，CSS 像素）。
   */
  const setViewInsets = (insets) => {
    const right = Number(insets?.right) || 0
    if (right === viewInsets.right) return
    viewInsets = { right }
    resize()
  }

  // ── 性能可见性 ──────────────────────────────────────────────────────────────
  //
  // 用户的要求是"**最起码前端不要卡住**"。而**没有可见性就无法对这件事负责**——
  // 卡顿的表现是"画面一顿一顿"，但看不出是渲染太重、事件太多、还是主线程被别的东西占了。
  // 所以这里把渲染器的真实计数暴露出来（`renderer.info` 是 three 自己维护的）：
  // 绘制调用数、三角形数、纹理/几何体数，以及最近这些帧的**平均帧耗时**。
  let frames = 0
  let lastFrameMs = 0
  let frameMsAvg = 0
  let worstFrameMs = 0
  /** 拆分：`applyWorld`（我们的簿记）与 `renderer.render`（three 的活）各占多少。 */
  let applyMs = 0
  let drawMs = 0
  /** 阴影图的节拍计数（见 `shadowMap.autoUpdate` 的说明）。 */
  let shadowTick = 0

  // ── 交互（M6-5：在 3D 里点一个小人物）────────────────────────────────────────
  //
  // 只建一个 `Raycaster` 与一个 `Vector2`：它们每次点击都会 `set`，
  // 没必要每次 `new`（"每帧新建对象"那种习惯，代价是纯 GC 压力）。
  const pickRaycaster = new THREE.Raycaster()
  const pickPointer = new THREE.Vector2()

  /**
   * 点到哪个角色了（点不到返回 null）。
   *
   * 从命中物体**往上走父节点**，靠 `actor:<id>` 这个命名找根——GLB 角色是一棵树
   * （骨架 + 若干 mesh），只有根带着身份。名字是 `buildActors` 里写的，
   * 而 `swapIn` 会把名字从占位块搬到真模型上，所以两种状态下都对。
   *
   * 只对**角色**求交（不遍历整棵场景树）：站点与大件道具不参与拾取，
   * 而全树在 GLB 角色进来之后是几百个节点——点一下的代价本来应该接近 $0。
   *
   * @param {number} clientX - 视口坐标（`PointerEvent.clientX`）。
   * @param {number} clientY - 视口坐标。
   * @returns {string|null} 角色 id。
   */
  function pickActor(clientX, clientY) {
    if (actorById.size === 0) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    pickPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    )
    pickRaycaster.setFromCamera(pickPointer, camera)
    const hits = pickRaycaster.intersectObjects([...actorById.values()], true)
    for (const hit of hits) {
      let node = hit.object
      while (node !== null && node !== undefined) {
        if (typeof node.name === 'string' && node.name.startsWith('actor:')) {
          return node.name.slice('actor:'.length)
        }
        node = node.parent
      }
    }
    return null
  }

  const projectVec = new THREE.Vector3()

  /**
   * 世界坐标 → 画布内的 CSS 像素（头顶气泡挂钩用）。
   *
   * 返回**画布相对**坐标而不是视口坐标：气泡是挂在 `.map` 里的一层 DOM，
   * 用视口坐标的话滚动或改布局就会整体偏移。
   */
  function projectToScreen(x, y, z) {
    const rect = canvas.getBoundingClientRect()
    projectVec.set(x, y, z).project(camera)
    return {
      x: (projectVec.x * 0.5 + 0.5) * rect.width,
      y: (-projectVec.y * 0.5 + 0.5) * rect.height,
      /** 相机身后/视锥外：气泡不要画到画布外面去。 */
      behind: projectVec.z > 1,
      width: rect.width,
      height: rect.height,
    }
  }

  /**
   * 某个角色头顶的世界高度（气泡的锚点）。按 plan 缓存，见 `actorTopY` 的说明。
   * 角色不存在时给一个保守值，让气泡至少挂在人身上而不是脚下。
   */
  function topYOf(id) {
    const cached = actorTopY.get(id)
    if (cached !== undefined) return cached
    const node = actorById.get(id)
    if (node === undefined) return 1.7
    const box = new THREE.Box3().setFromObject(node)
    const top = Number.isFinite(box.max.y) && box.max.y > 0 ? box.max.y : 1.7
    actorTopY.set(id, top)
    return top
  }

  const api = {
    setPlan,
    applyWorld,
    resize,
    // ── 给对话 UI 用的两个（M6-5）──────────────────────────────────────────────
    // `pickActor`：在 3D 里点人；`projectToScreen` + `topYOf`：把头顶气泡挂到人身上。
    pickActor,
    projectToScreen,
    topYOf,

    /**
     * 告知"浮层占掉了多少"（R32）：抽屉开合时调用，世界会重新居中到可见区域。
     * 这是场景与面板之间**唯一**的新接口——面板不需要知道相机怎么算。
     */
    setViewInsets,

    /**
     * 取一份性能快照（诊断用）。
     *
     * @returns {{fps: number, frameMs: number, worstMs: number, drawCalls: number, triangles: number, geometries: number, textures: number, programs: number, actors: number, programsNote: string}}
     */
    stats() {
      const info = renderer.info
      return {
        fps: frameMsAvg > 0 ? Math.round(1000 / frameMsAvg) : 0,
        // ⚠️ `frameMs` / `drawMs` **含 vsync 等待**，不是 CPU 成本。
        // 实测它恰好落在一个 60Hz vblank（≈16.7ms）上，且**不随场景复杂度变化**
        // （22 个绘制调用与 42 个、224 与 7634 个三角形，都是同一个数）。
        // 真正属于我们的 CPU 时间是 `applyMs`；渲染提交本身要看 `benchmark()` 的结果。
        frameMs: Math.round(frameMsAvg * 100) / 100,
        applyMs: Math.round(applyMs * 100) / 100,
        drawMs: Math.round(drawMs * 100) / 100,
        worstMs: Math.round(worstFrameMs * 100) / 100,
        frames,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        actors: actorById.size,
        planRebuilds,
        programsNote: 'three 的 renderer.info，按最近一帧',
      }
    },

    get plan() {
      return plan
    },
    /** 画一帧。**由调用方调**——不用 rAF，理由见文件头。 */
    render(world) {
      try {
        const t0 = performance.now()
        applyWorld(world)
        const t1 = performance.now()
        // 每 3 次渲染更新一次阴影图（见上面 `autoUpdate` 的说明）。
        shadowTick += 1
        if (shadowTick % 3 === 0) renderer.shadowMap.needsUpdate = true
        renderer.render(scene, camera)
        // 指数滑动平均：单帧抖动不该被当成"卡了"，但持续变慢必须看得出来。
        const t2 = performance.now()
        applyMs = applyMs === 0 ? t1 - t0 : applyMs * 0.9 + (t1 - t0) * 0.1
        drawMs = drawMs === 0 ? t2 - t1 : drawMs * 0.9 + (t2 - t1) * 0.1
        lastFrameMs = t2 - t0
        frameMsAvg = frameMsAvg === 0 ? lastFrameMs : frameMsAvg * 0.9 + lastFrameMs * 0.1
        worstFrameMs = Math.max(worstFrameMs * 0.995, lastFrameMs)
        frames += 1
      } catch (error) {
        options.onError?.(error)
      }
    },
    /**
     * 连续渲染 N 次并返回耗时（**诊断用**）。
     *
     * ## 为什么需要它
     *
     * 把 `performance.now()` 套在一次 `render()` 外面，量到的是
     * **"提交 + 等 vsync"**——实测恒为 ~16.7ms，且与场景复杂度无关。
     * 那会让人误以为"渲染很贵"，进而做出错误的架构判断（比如因此转 Godot）。
     *
     * 连续渲染绕开了 vsync（合成器只取最后一帧），所以它量的是**真实的提交成本**。
     *
     * @param {number} [n] - 次数。
     */
    benchmark(n = 60) {
      const t0 = performance.now()
      for (let i = 0; i < n; i++) renderer.render(scene, camera)
      const total = performance.now() - t0
      return { renders: n, totalMs: Math.round(total * 100) / 100, perRenderMs: Math.round((total / n) * 1000) / 1000 }
    },

    dispose() {
      clearStatic()
      // 场景走了，它就再也不是那些 GLTF 源资源的所有者了——**先把义务履行掉**再拆渲染器。
      // 不调这一步的后果不是立刻可见的：它会表现为"切回 3D 之后每次重建都在重新上传"。
      models.dispose()
      controls.dispose()
      renderer.dispose()
    },

    /**
     * **可跑的验收检查**（R47 / M4-12 的判据）：连续重建 `rebuilds` 次，纹理不许增长。
     *
     * 判据由纯函数 `assessRebuildSeries` 给（有 node 测试），这里只负责"在真页面上跑一遍它"。
     * 这样"修好了没有"是一条命令的答案，而不是靠人盯着一排数字看：
     *
     *     await __agentWorldScene3d.checkRebuildLeak(3)   // → { ok: true, growth: 0, sequence: [...] }
     *
     * `settleMs` 是刻意留的参数：重建里有一段**异步**（GLB 到货后才换模型），
     * 采样要等它落定。所以返回里同时给 `sequence`——**涨了没有要能一眼看出来**，
     * 而不是只信一个 `ok`（R47 的教训正是"数字涨了但没人看组成"）。
     *
     * @param {number} [rebuilds] - 重建几次（判据要求 ≥3）。
     * @param {number} [settleMs] - 每次重建后的等待（让异步加载与首帧落定）。
     * @returns {Promise<{ok: boolean, growth: number, sequence: number[], reason: string, unaccounted: number[]}>}
     */
    async checkRebuildLeak(rebuilds = 3, settleMs = 600) {
      const series = [renderer.info.memory.textures]
      const unaccounted = [this.textureReport().unaccounted]
      for (let i = 0; i < rebuilds; i++) {
        setPlan(plan)
        await new Promise((resolve) => setTimeout(resolve, settleMs))
        series.push(renderer.info.memory.textures)
        unaccounted.push(this.textureReport().unaccounted)
      }
      return { ...assessRebuildSeries(series, { rebuilds }), unaccounted }
    },

    /**
     * 场景里每个"件/角色"的**世界包围盒**（R49 / M10-15 的量法）。
     *
     * 为什么需要它：等距视角下"贴着桌面"与"悬空 0.1"在截图上几乎同形，
     * 而"鼠标是不是在桌面上"是可以**算**的——把桌子的盒子和鼠标的盒子拿出来一比就知道。
     * 实测证明目测在这件事上不可靠：同一张只有桌子+鼠标的图，
     * 修好之前鼠标明显在桌子外，而看图并不能稳定地给出这个结论。
     *
     * @returns {{name: string, min: number[], max: number[]}[]} 世界坐标下的 AABB。
     */
    sceneBoxes() {
      const out = []
      staticGroup.traverse((node) => {
        const name = typeof node.name === 'string' ? node.name : ''
        if (!name.startsWith('part:') && !name.startsWith('actor:') && !name.startsWith('prop:')) return
        const box = new THREE.Box3().setFromObject(node)
        if (box.isEmpty()) return
        out.push({ name, min: box.min.toArray(), max: box.max.toArray() })
      })
      return out
    },

    /**
     * 纹理账面（R47 / M4-12 的**可复现量法**）。
     *
     * 为什么需要它：`stats().textures` 只给一个**总数**（`renderer.info.memory.textures`），
     * 而"总数涨了 16"有两种完全不同的原因：
     *
     * 1. 场景图中**还在用**的纹理变多了（真的多画了东西）；
     * 2. 场景图里**已经没有**引用、但 GPU 上没释放的纹理变多了（泄漏）。
     *
     * 光看总数分不出这两者，于是"修没修好"就变成了猜。这个函数把账面拆开：
     *
     * - `gpuTextures`：three 记的 GPU 纹理数（= `stats().textures`）；
     * - `viaMaterials`：**当前场景图里**材质引用到的**去重**纹理数；
     * - `shadowMaps`：还在场景里的灯，各自有没有阴影贴图；
     * - `unaccounted` = `gpuTextures - viaMaterials`：**没有被任何材质引用**的部分。
     *   它就是"泄漏量"的上界——阴影贴图也计入其中，所以还要看 `shadowMaps`。
     *
     * @returns {object} 账面明细（诊断用；正常渲染不依赖它）。
     */
    textureReport() {
      const referenced = new Map()
      let meshes = 0
      let skinnedMeshes = 0
      const boneTextures = new Map()
      const materials = new Set()
      scene.traverse((node) => {
        if (node.isMesh === true) meshes += 1
        if (node.isSkinnedMesh === true) {
          skinnedMeshes += 1
          // ★ 骨架自带一张 boneTexture（DataTexture）。**材质不引用它**，
          //   所以它既不出现在 `viaMaterials` 里，也不会被 `material.dispose()` 释放。
          const bone = node.skeleton?.boneTexture
          if (bone !== undefined && bone !== null) boneTextures.set(bone.uuid, bone)
        }
        const material = node.material
        const list = Array.isArray(material) ? material : material !== undefined ? [material] : []
        for (const m of list) {
          if (m === undefined || m === null) continue
          materials.add(m.uuid)
          for (const [slot, value] of Object.entries(m)) {
            if (value === null || typeof value !== 'object') continue
            if (value.isTexture !== true) continue
            const hit = referenced.get(value.uuid)
            if (hit === undefined) {
              referenced.set(value.uuid, {
                slot,
                refs: 1,
                width: value.image?.width ?? 0,
                height: value.image?.height ?? 0,
                name: value.name ?? '',
              })
            } else {
              hit.refs += 1
            }
          }
        }
      })

      const shadowMaps = []
      let shadowMapTextures = 0
      for (const child of scene.children) {
        if (child.isLight !== true) continue
        const map = child.shadow?.map
        const hasMap = map !== undefined && map !== null
        if (hasMap) shadowMapTextures += 1
        shadowMaps.push({ type: child.type, castShadow: child.castShadow === true, hasMap })
      }

      const gpuTextures = renderer.info.memory.textures
      // 账面交给纯函数算（`web/core/resource-ownership.js`）：去重、共享项只算一次
      // 这些细节在那儿有测试，这里不再抄一遍算式——抄一遍就迟早会与测试漂移。
      const account = accountTextures({
        gpuTextures,
        materialTextureIds: [...referenced.keys()],
        skeletonTextureIds: [...boneTextures.keys()],
        shadowMapTextures,
      })

      return {
        gpuTextures,
        viaMaterials: account.bySource.materials,
        viaSkeletons: account.bySource.skeletons,
        materials: materials.size,
        meshes,
        skinnedMeshes,
        shadowMaps,
        shadowMapTextures,
        textures: [...referenced.values()].sort((a, b) => b.refs - a.refs),
        /**
         * 既没被材质引用、也没被骨架引用的 GPU 纹理数（阴影贴图已单独算过）。
         * **这才是真正的泄漏量**——R47 之前它是 16/次重建。
         */
        unaccounted: account.unaccounted,
      }
    },
  }

  // 只有显式 `?debug=1` 才把句柄挂出去。默认不挂：面板的页面上下文没必要多一个全局。
  if (new URLSearchParams(globalThis.location?.search ?? '').has('debug')) {
    globalThis.__agentWorldScene3d = api
  }
  return api
}
