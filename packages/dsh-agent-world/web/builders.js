/*
 * 程序化几何构建器注册表（BACKLOG M4-7）。
 *
 * ══ 它在"代码是机制，内容是数据"里的位置 ══════════════════════════════════════
 *
 * 内容（`models` 库）说：`{ id: 'model.station.desk', source: { kind: 'procedural',
 * builder: 'desk' } }`——**由内容决定某个站点用哪个构建器**。
 *
 * 这个文件说：`desk` 这个名字长什么样（几个盒子、多高）。
 *
 * 于是"换模型"分两种情况：
 *   · 换成**另一个已注册的构建器** → 改内容，不动代码（例如让会议桌用 `breakroom` 的形状）；
 *   · 换成**一个全新的形状** → 那是新机制，必须写代码并在这里注册。
 *
 * 判据很清晰：**"这东西会不会有人想换掉"**。想让休息区看起来不一样，改内容就够；
 * 想要一种从没见过的家具，那是在加机制。
 *
 * ══ 为什么按 `builder` 名而不是按 `model.id` ═════════════════════════════════════
 *
 * 按 id 注册的话，内容里新增一个模型条目就必须改代码来"认领"这个 id——
 * 那等于把模型清单写进了代码里（正好是 R16 修掉的那个毛病，见 `scene/plan.ts` 的注释）。
 * 按构建器名注册，则**多个条目可以复用同一个形状**（4 个工位共用 `desk`），
 * 而新条目只要能落到一个已有的构建器上，就完全不用碰代码。
 *
 * ══ 尺寸约定 ══════════════════════════════════════════════════════════════════
 *
 * 每个构建器都返回一个**原点在底面前缘中心**（y=0 贴地）的 `Object3D`，
 * 且尺寸大致落在 1 个世界单位上下。整体缩放由内容条目自己的 `scale` 决定——
 * 所以"这个桌子多大"也是内容，不是代码。
 */

/** 共用的材质工厂：三个参数都从外面来，这里不写字面量色值。 */
function mat(THREE, color) {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(color) })
}

/** 造一个盒子并摆好位置（阴影默认打开——沙盘没有影子会很平）。 */
function box(THREE, material, w, h, d, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** 造一个圆柱（桌子腿、凳子、烧瓶都用它）。 */
function cyl(THREE, material, rTop, rBottom, h, x, y, z, segments = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  return mesh
}

/**
 * 建一个构建器注册表。
 *
 * @param {object} THREE - three 命名空间（**注入**而不是 import，这样这个文件能被 node 直接测）。
 * @returns {{ names: () => string[], has: (n: string) => boolean, build: (n: string, spec: object) => object | null }}
 */
export function createBuilderRegistry(THREE) {
  const builders = new Map()

  /** 注册一个构建器。`factory({color, capacity})` 返回一个 Group。 */
  const add = (name, factory) => builders.set(name, factory)

  // ── 角色 ────────────────────────────────────────────────────────────────────

  add('avatar', ({ color }) => {
    const g = new THREE.Group()
    const material = mat(THREE, color)
    // 身体用胶囊：比方块更像人，而且不用引入骨骼模型（那是 M5）。
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 4, 10), material)
    body.position.y = 0.55
    body.castShadow = true
    g.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), material)
    head.position.y = 1.12
    head.castShadow = true
    g.add(head)
    // 一个小鼻子当朝向标记——不然从上方看不出人朝哪边（俯视图里朝向是靠位置推的）。
    const nose = box(THREE, material, 0.1, 0.1, 0.16, 0, 1.12, 0.22)
    g.add(nose)
    return g
  })

  // ── 站点 ────────────────────────────────────────────────────────────────────

  add('desk', ({ color }) => {
    const g = new THREE.Group()
    const material = mat(THREE, color)
    g.add(box(THREE, material, 0.95, 0.07, 0.65, 0, 0.5, 0))
    for (const [x, z] of [[-0.42, -0.26], [0.42, -0.26], [-0.42, 0.26], [0.42, 0.26]]) {
      g.add(box(THREE, material, 0.06, 0.5, 0.06, x, 0.25, z))
    }
    return g
  })

  add('meeting', ({ color }) => {
    const g = new THREE.Group()
    const material = mat(THREE, color)
    g.add(box(THREE, material, 1.5, 0.09, 0.9, 0, 0.56, 0))
    for (const x of [-0.6, 0.6]) g.add(box(THREE, material, 0.1, 0.56, 0.72, x, 0.28, 0))
    return g
  })

  add('server', ({ color }) => {
    const g = new THREE.Group()
    const material = mat(THREE, color)
    g.add(box(THREE, material, 0.55, 1.4, 0.6, 0, 0.7, 0))
    // 前面几条"磁盘槽"——同一材质、稍微凸出，靠阴影就能看出层次。
    for (let i = 0; i < 4; i++) {
      g.add(box(THREE, material, 0.42, 0.06, 0.04, 0, 0.25 + i * 0.28, 0.32))
    }
    return g
  })

  add('mailroom', ({ color }) => {
    const g = new THREE.Group()
    const material = mat(THREE, color)
    g.add(box(THREE, material, 0.8, 1.0, 0.5, 0, 0.5, 0))
    g.add(box(THREE, material, 0.5, 0.12, 0.06, 0, 0.72, 0.28)) // 投递口
    g.add(box(THREE, material, 0.86, 0.08, 0.56, 0, 1.02, 0)) // 顶檐
    return g
  })

  add('lab', ({ color }) => {
    const g = new THREE.Group()
    const material = mat(THREE, color)
    g.add(box(THREE, material, 1.0, 0.08, 0.7, 0, 0.58, 0))
    for (const [x, z] of [[-0.44, -0.28], [0.44, -0.28], [-0.44, 0.28], [0.44, 0.28]]) {
      g.add(box(THREE, material, 0.06, 0.58, 0.06, x, 0.29, z))
    }
    // 台面上一只烧瓶：圆柱 + 细颈。
    g.add(cyl(THREE, material, 0.13, 0.17, 0.28, -0.22, 0.76, 0))
    g.add(cyl(THREE, material, 0.05, 0.05, 0.18, -0.22, 0.99, 0))
    return g
  })

  add('breakroom', ({ color }) => {
    const g = new THREE.Group()
    const material = mat(THREE, color)
    g.add(cyl(THREE, material, 0.5, 0.5, 0.08, 0, 0.46, 0, 16)) // 圆桌面
    g.add(cyl(THREE, material, 0.07, 0.07, 0.46, 0, 0.23, 0)) // 中柱
    g.add(cyl(THREE, material, 0.26, 0.26, 0.05, 0, 0.02, 0, 14)) // 底盘
    for (const [x, z] of [[-0.78, 0.2], [0.78, 0.2]]) {
      g.add(cyl(THREE, material, 0.17, 0.17, 0.06, x, 0.32, z, 12)) // 凳子面
      g.add(cyl(THREE, material, 0.05, 0.06, 0.32, x, 0.16, z, 8))
    }
    return g
  })

  add('delivery', ({ color }) => {
    const g = new THREE.Group()
    const material = mat(THREE, color)
    g.add(box(THREE, material, 0.5, 0.4, 0.4, 0, 0.2, 0)) // 包裹
    g.add(box(THREE, material, 0.52, 0.06, 0.42, 0, 0.42, 0)) // 封口
    g.add(cyl(THREE, material, 0.02, 0.02, 0.5, 0.16, 0.65, 0, 6)) // 旗杆
    g.add(box(THREE, material, 0.18, 0.12, 0.02, 0.27, 0.84, 0)) // 小旗
    return g
  })

  return {
    /** 已注册的构建器名（排序后）。**报错时要把它列出来**，别只说"未知构建器"。 */
    names: () => [...builders.keys()].sort(),

    has: (name) => builders.has(name),

    /**
     * 造一个模型。
     *
     * @param {string} name - 构建器名（来自内容的 `models` 条目）。
     * @param {{ color: string, capacity?: number }} spec
     * @returns {object | null} `Object3D`；构建器不存在时返回 null（由调用方报错）。
     */
    build(name, spec) {
      const factory = builders.get(name)
      if (factory === undefined) return null
      const node = factory({ color: spec.color, capacity: spec.capacity ?? 1 })
      node.userData.builder = name
      return node
    },
  }
}
