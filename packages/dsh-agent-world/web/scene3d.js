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
import { OrbitControls } from 'three/addons/OrbitControls.js' // 见 index.html 的 import map
import { createBuilderRegistry } from './builders.js'

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
    // 保留绘制缓冲。WebGL 默认在合成之后就把绘制缓冲丢掉，于是
    // `toDataURL()` 与截图工具拿到的是**空白**。这个面板的用途有一部分就是"被人看/被人验"，
    // 所以付出这点代价换"随时能取到当前这一帧"。代价是显存里多留一块缓冲。
    preserveDrawingBuffer: true,
  })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  /** 程序化几何注册表。尺寸与形状都在 `builders.js` 里，这里只管摆放。 */
  const builders = createBuilderRegistry(THREE)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  // 正交相机靠 zoom 缩放，不用 dolly。
  controls.enablePan = true
  controls.target.set(0, 0, 0)

  /** 由 ScenePlan 建出来的东西，换 plan 时整体丢掉重建。 */
  let staticGroup = new THREE.Group()
  scene.add(staticGroup)
  const actorById = new Map()
  let plan = null
  let half = 8
  let zoomFactor = 1

  /** 清掉一棵子树并释放显存（不只是从场景里摘掉）。 */
  const disposeTree = (root) => {
    root.traverse((node) => {
      if (node.geometry !== undefined) node.geometry.dispose()
      const material = node.material
      if (Array.isArray(material)) for (const m of material) m.dispose()
      else if (material !== undefined) material.dispose()
    })
  }

  const clearStatic = () => {
    scene.remove(staticGroup)
    disposeTree(staticGroup)
    staticGroup = new THREE.Group()
    scene.add(staticGroup)
    actorById.clear()
  }

  /** 按主题配相机。等距沙盘的经典参数是 45° / 35.264°。 */
  const applyCamera = (theme) => {
    const cam = theme?.camera ?? { projection: 'orthographic', yawDeg: 45, pitchDeg: 35.264, zoom: 1 }
    zoomFactor = cam.zoom ?? 1
    const yaw = (cam.yawDeg * Math.PI) / 180
    const pitch = (cam.pitchDeg * Math.PI) / 180
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

  /** 用地块铺地面。 */
  const buildGround = (ground) => {
    for (const g of ground) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(g.width, g.depth),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(g.color) }),
      )
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(g.x, 0, -g.z) // 面板的世界坐标 z 朝下，three 的 z 朝屏幕外
      mesh.receiveShadow = true
      mesh.name = `ground:${g.id}`
      staticGroup.add(mesh)
    }
  }

  /** 缺东西的记录：`{ models: Set, builders: Set }`。换 plan 时清空。 */
  let missing = { models: new Set(), builders: new Set() }

  /** 品红占位块：缺失也要**看得见**，否则画面上只是"少了个东西"。 */
  const placeholder = () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(MISSING_COLOR) }),
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
  const instantiate = (modelId, modelById, spec) => {
    const model = modelById.get(modelId)
    if (model === undefined) {
      missing.models.add(modelId)
      return placeholder()
    }
    if (model.builder === null) {
      // GLB 模型：M5 才会真正加载（需要联网拿资源）。**现在明确报出来**，
      // 而不是画个方块让人以为加载成功了。
      missing.builders.add(`（GLB）${model.id}`)
      return placeholder()
    }
    const node = builders.build(model.builder, spec)
    if (node === null) {
      missing.builders.add(model.builder)
      return placeholder()
    }
    node.scale.setScalar(model.scale)
    node.rotation.y = model.rotationY
    node.position.y += model.anchorY
    return node
  }

  /** 摆站点。形状由内容声明的模型决定，这里没有形状判断。 */
  const buildProps = (props, modelById) => {
    for (const p of props) {
      const node = instantiate(p.modelId, modelById, { color: p.color, capacity: p.capacity })
      node.position.set(p.x, node.position.y, -p.z)
      node.name = `prop:${p.id}`
      staticGroup.add(node)
    }
  }

  /** 摆角色。同理，形状来自内容；真正的骨骼模型是 M5。 */
  const buildActors = (actors, modelById) => {
    for (const a of actors) {
      const node = instantiate(a.modelId, modelById, { color: a.color })
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
  const setPlan = (nextPlan) => {
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
      const mesh = staticGroup.getObjectByName(`prop:${p.id}`)
      if (mesh === undefined) continue
      const occupied = busy.has(p.id)
      // 站点现在是 Group（形状由多个 mesh 组成），所以高亮要遍历子节点。
      mesh.traverse((child) => {
        if (child.isMesh !== true) return
        child.material.emissive = occupied ? new THREE.Color(0x2a2a2a) : new THREE.Color(0x000000)
      })
      mesh.scale.y = occupied ? 1.12 : 1
    }

    for (const agent of world.agents ?? []) {
      const mesh = actorById.get(agent.id)
      if (mesh === undefined) continue
      // **只改 x/z，不动 y**：y 由构建器决定（人形模型的底面在 y=0，
      // 而旧写法按一个写死的常量把人抬到半空）。这正是"形状交给构建器"带来的差别。
      mesh.position.set(agent.position.x, mesh.position.y, -agent.position.z)
      mesh.rotation.y = -agent.facing
      // 在站上/走路/干活用一个矮一点的姿态区分，避免"所有人像在同一状态"。
      mesh.scale.y = agent.state === 'working' ? 0.82 : 1
    }
    controls.update()
  }

  /** 按容器尺寸重算正交视锥。 */
  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(dpr)
    renderer.setSize(width, height, false)

    const aspect = width / height
    const span = half * 1.25 * zoomFactor
    camera.left = -span * aspect
    camera.right = span * aspect
    camera.top = span
    camera.bottom = -span
    // 远近裁剪面跟着世界尺寸走：写死会在放大/缩小后把小镇切掉。
    camera.near = 0.1
    camera.far = half * 40
    camera.updateProjectionMatrix()
  }

  return {
    setPlan,
    applyWorld,
    resize,
    get plan() {
      return plan
    },
    /** 画一帧。**由调用方调**——不用 rAF，理由见文件头。 */
    render(world) {
      try {
        applyWorld(world)
        renderer.render(scene, camera)
      } catch (error) {
        options.onError?.(error)
      }
    },
    dispose() {
      clearStatic()
      controls.dispose()
      renderer.dispose()
    },
  }
}
