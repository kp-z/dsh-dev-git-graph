/**
 * 面板第三方资源的白名单服务（按仓库约定，BACKLOG M4-8）。
 *
 * ## 为什么不复用静态面板那条通配路由
 *
 * 静态面板的 `/*` 会服务**任何**能在目录树里找到、且扩展名在白名单里的文件。
 * 对面板自己的资源那是对的（同一次构建出来的，可以互相信任）；对 **vendored 第三方代码**
 * 就不合适了：那是一个"只该服务这几个确切文件"的地方，白名单应当**穷举**，
 * 而不是靠扩展名放行。仓库根 `docs/DIRECTORY.md` 的约定也是这个意思
 * （"精确文件名 → MIME；未命中 / 穿越一律 404"）。
 *
 * ## 路径穿越在这里天然不成立
 *
 * 路由模式是 `/vendor/:file`——**单段**，所以 `../` 根本进不来（那会让段数不匹配）。
 * 叠加上"只认白名单里的确切文件名"，这一层没有拼接路径的机会。
 * 这不是省了防护，是**把防护换成了更强的形式**：不构造路径，就不会拼错路径。
 *
 * ## 与约定的一处偏离
 *
 * 仓库约定里宿主路径是 `GET /vendor/:file`，但 `webServer.register` 对重复的
 * `(kind, path)` **会直接抛错**，而 `dsh-contract-butler` 已经占了它。
 * 所以这里挂在**本插件自己的前缀**下（`/agent-world/vendor/:file`），
 * 免得让对方的插件起不来。理由写在 `src/vendor/README.md` 里。
 */
import { readFile } from 'node:fs/promises'
import type http from 'node:http'
import { join } from 'node:path'
import type { RouteEntry } from './router.js'
import { HttpError } from './router.js'

/**
 * **穷举**白名单：文件名 → MIME。
 *
 * 加一个 vendored 文件必须同时加在这里——`test/vendor.test.js` 会逐个核对目录内容，
 * 漏了会红。这是刻意的摩擦：文件进了 `src/vendor/` 却忘了开路由，
 * 表现是"运行时 404"，而那时你已经在看别的错误了。
 */
export const VENDOR_WHITELIST: readonly string[] = [
  // R66：`three/` 的白名单随 3D 路径一起删了（`scene3d.js` / `model-loader.js` /
  // `src/vendor/three/` 全部移除）。用户的口径是"全部用 Phaser 里现成的工具"。
  // PixiJS 8.6.6（MIT）——2D 的 WebGL 渲染器（R57）。**精灵批处理**是换它的理由：
  // canvas2D 每个精灵一次 drawImage，而游戏需要"几百个精灵一次提交"。
  // 只 vendor 这一个文件：它是自包含的 ESM 包（不像 three 的 addon 之间有相对 import）。
  'pixi/pixi.min.mjs',
  'pixi/LICENSE',
  // Phaser 3.90（MIT）——**成熟的 2D 游戏框架**（R58）。
  // 换它的理由不是"画得更快"（Pixi 已经做到了），而是**动画/相机/瓦片/补间/粒子/输入
  // 全都自带**：这些原先是我们手写的（`pixel-sheet.js` 的帧切分与动画选择、
  // `scene-camera.js` 的相机与拾取，一行行都是引擎该干的活）。
  // 用 `.esm.min.js` 而不是 `.esm.js`：后者 7.8MB 未压缩，解析一次很贵。
  'phaser/phaser.esm.min.js',
  'phaser/LICENSE',
  // 原版办公室底图（R62）：由 `scripts/convert-microverse-map.mjs` 解出的 1322 格烘成一张 PNG。
  // 一次 `drawImage` 就画完整场景——先用这种方式接通，真要"单格可寻址"时再升级 tilemap。
  'microverse/scene/office.png',
  // 精细碰撞体（R78）：由 `scripts/bake-office-map.py` 与底图**同一次**生成。
  // 底图是"看到的样子"，这份是"挡人的形状"——两者同源，才不会出现"墙贴/碰撞对不上"。
  'microverse/scene/office-colliders.json',
  // 地图对象（椅子等）：**不烘进底图**，由前端渲染成实体，才能和角色一起做 Y 排序。
  'microverse/scene/office-objects.json',
  // 墙体图层（透明 PNG）：与角色一起做 Y 排序，所以不能并进底图。
  'microverse/scene/office-walls.png',
  // 原版 6 个 TileMapLayer 各一张透明图（层序固定，见 web 端的 LAYER_DEPTHS）。
  'microverse/scene/office-layer0.png',
  'microverse/scene/office-layer1.png',
  'microverse/scene/office-layer2.png',
  'microverse/scene/office-layer3.png',
  'microverse/scene/office-layer4.png',
  'microverse/scene/office-layer5.png',
  // 椅子贴图（R78）：原版是 prefab 对象（不在图块里），单独随仓库提交，烘焙脚本用。
  'microverse/single-objects/office-chair-101.png',
  'microverse/single-objects/office-chair-106.png',
  'microverse/single-objects/office-chair-110.png',
  // EasyStar.js（寻路库，MIT）——服务端 sim 用它算绕障路径，**浏览器不需要**，
  // 但 `src/vendor/` 的每一份文件都要有路由，否则有一条测试会红（而且运行期 404 很难归因）。
  'easystar/easystar.cjs',
  'easystar/instance.cjs',
  'easystar/node.cjs',
  'easystar/heap.cjs',
  'easystar/index.mjs',
  'easystar/index.d.mts',
  'easystar/LICENSE',
  'easystar/LICENSE-heap',
  'easystar/README.md',
  // Kenney "Mini Characters"（CC0）——12 个已绑定骨骼的角色，每个内嵌 32 条动画。
  // `Textures/colormap.png` **必须一起 vendor**：GLB 里的 `images[].uri` 指的是它，
  // 少一个文件的表现是"模型在、但一片惨白/纯色"，很难归因。
  'kenney-mini-characters/License.txt',
  'kenney-mini-characters/Textures/colormap.png',
  ...['male', 'female'].flatMap((sex) => ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => `kenney-mini-characters/character-${sex}-${k}.glb`)),

  // Kenney "Furniture Kit"（CC0）——办公室陈设。**只取办公室用得上的 30 个**，
  // 没要整包 140 个里的卧室/卫浴/厨房件（用不到；CC0 允许只取一部分）。
  'kenney-furniture/License.txt',
  ...[
    'desk', 'deskCorner', 'table', 'chair', 'chairDesk', 'chairModernCushion', 'chairRounded',
    'computerScreen', 'computerKeyboard', 'computerMouse', 'laptop',
    'bookcaseClosed', 'bookcaseClosedWide', 'bookcaseOpen', 'bookcaseOpenLow',
    'lampRoundTable', 'lampRoundFloor', 'lampSquareCeiling', 'coatRackStanding',
    'doorwayOpen', 'doorwayFront', 'loungeSofa', 'loungeChair',
    'cardboardBoxClosed', 'cardboardBoxOpen', 'trashcan', 'radio',
    'televisionVintage', 'plantSmall1', 'plantSmall2', 'pottedPlant',
  ].map((name) => `kenney-furniture/${name}.glb`),

  // ── 2D 像素资源（R50，D49）：**按目录前缀开放** ────────────────────────────────
  //
  // 为什么不再逐个列举：这一批是 **1720 个文件、11 个 CC0 包**（见 `docs/PIXEL-ASSETS.md`），
  // 手抄 1720 行既不可读、也会在下一次补资源时漏掉（漏掉的表现是"图裂了"，很难归因到白名单）。
  // 而这些包的**授权是整包一致的**（每个包目录里都有上游 `LICENSE.txt` 原文 + sha256，逐包核过），
  // 所以"整个目录可服务"与"逐个文件可服务"在安全上是同一件事——**只要路径解析收紧**（见 `isAllowedVendorPath`）。
  //
  // 注意：目录前缀**只给像素资源**。three 与 Kenney 的 GLB 仍是逐个列举——
  // 那是"渲染器现在要用什么"的清单，收紧它有价值。
  'pixel/',

  // Microverse（**MIT**，用户指定）：8 个像素角色 + 办公室家具 + 地图图集。
  // 与 `pixel/` 同理按目录开放（授权整包一致，`microverse/LICENSE` 是上游原文）。
  // 许可原文必须随包发布——MIT 要求保留版权声明。
  'microverse/',
]

/**
 * 扩展名 → MIME。
 *
 * 单独一张表而不是把 MIME 写进白名单：这样"哪些文件能服务"与"以什么类型服务"
 * 是两个独立的问题（前者是安全边界，后者是协议细节），改一个不会碰另一个。
 */
export const VENDOR_MIME: Readonly<Record<string, string>> = {
  // 空键 = **没有扩展名**（例如上游的 `LICENSE`）。当时写成
  // `name.slice(name.lastIndexOf('.'))`，对 `phaser/LICENSE` 会切出 `"E"`，
  // 于是这个白名单里的文件一被请求就 500——测试抓到的，不是我看出来的。
  '': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // `.mjs` 是 ESM 的另一种扩展名（PixiJS 的 dist 用它）。**没有它浏览器会拒绝执行**
  //（`text/plain` 的 module script 会被 CORS/类型检查拦下），而表现是"场景整个起不来"。
  '.mjs': 'text/javascript; charset=utf-8',
  // EasyStar 是 CommonJS 源码 + 一个 ESM 垫片（见 `src/vendor/easystar/index.mjs` 的头注释）。
  '.cjs': 'text/javascript; charset=utf-8',
  // ⚠️ 取扩展名用的是 `lastIndexOf('.')`，所以 `index.d.mts` 切出来是 **`.mts`** 不是 `.d.mts`。
  '.mts': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  // 精细碰撞体（R78）：与底图同源生成的 JSON 数据。
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

/**
 * 造 vendor 路由。
 *
 * @param rootDir - vendored 资源目录（`lib/vendor`）。
 */
export function vendorRoutes(rootDir: string): RouteEntry[] {
  return [
    {
      method: 'GET',
      // `*` 而不是 `:file`：vendored 资源要能放进子目录（three 的 addon 之间靠相对
      // import 相连，必须保持上游结构）。安全性**没有降低**：认的是白名单里的**确切
      // 相对路径**，不做任何拼接猜路径——所以 `..` 之类根本匹配不上。
      //
      // 客户端**不可能靠编码斜杠越界**：`matchPath` 逐段解码后用 `/` 重新拼接，于是
      // `phaser%2Fphaser.esm.min.js` 会得到同一条（合法的）相对路径；能匹配到的只有白名单里那些。
      pattern: '/vendor/*',
      handler: async ({ pathname, res }) => {
        const name = pathname.slice('/vendor/'.length)
        if (!isAllowedVendorPath(name)) {
          throw new HttpError(
            404,
            `不在白名单里的第三方资源 "${name}"。已开放 ${VENDOR_WHITELIST.length} 个条目，例如：` +
              `${VENDOR_WHITELIST.slice(0, 4).join(' / ')} …`,
          )
        }
        const ext = extensionOf(name)
        const mime = VENDOR_MIME[ext]
        if (mime === undefined) {
          // 白名单里有、但扩展名没登记 MIME：这是**代码不一致**，不是请求的问题。
          throw new HttpError(
            500,
            `资源 "${name}" 在白名单里，但扩展名 "${ext}" 没登记 MIME。` +
              `已登记：${Object.keys(VENDOR_MIME).join(' / ')}`,
          )
        }

        const body = await readFile(join(rootDir, name)).catch(() => null)
        if (body === null) {
          // 白名单里有、磁盘上没有：这是**构建没同步**，不是请求写错了。
          // 所以报错要说清该去哪找，而不是只说"找不到"。
          throw new HttpError(
            404,
            `资源 "${name}" 在白名单里但读不到。` +
              `多半是构建没把 src/vendor/ 同步到 lib/vendor/（跑 pnpm run build:web）。路径：${join(rootDir, name)}`,
          )
        }

        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': body.length,
          // ⚠️ 这里按**是否会被重新生成**分两档，不能一律长缓存。
          //
          // `microverse/` 下的底图与碰撞体是 `scripts/bake-office-map.py` 的产物，
          // 我们会**反复重烘**（补椅子、改碰撞）。以前统一 `max-age=3600`，结果重烘完
          // 浏览器仍然拿旧图一小时 —— 表现就是"代码明明改了，画面一点没变"，
          // 而且服务端 200、md5 也对得上，极难归因。这类资源一律 `no-cache`（每次回源校验）。
          //
          // 其余 vendored 库版本固定（文件名/README 里记着版本号），可以放心长缓存。
          'Cache-Control': name.startsWith('microverse/')
            ? 'no-cache'
            : 'public, max-age=3600',
        })
        res.end(body)
        return undefined
      },
    },
  ]
}

/**
 * 取一个白名单路径的扩展名（含点）。**没有扩展名时返回空串**，而不是最后一个字符。
 *
 * 单独一个函数是因为这个表达式很容易写错（第一版就写错了）。抽出来也让测试能直接打它。
 *
 * @param path - 白名单里的相对路径。
 */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot)
}

/**
 * 列出白名单里的文件名。
 *
 * 给测试与诊断用：`src/vendor/` 里出现没登记的文件时，要能报出"多了什么"。
 */
export function vendorFileNames(): string[] {
  return [...VENDOR_WHITELIST].sort()
}

/**
 * 这条请求路径能不能服务（R50：白名单支持**目录前缀**）。
 *
 * 两条规则：
 * 1. 白名单里的**确切路径**永远可以（老行为不变）；
 * 2. 以 `/` 结尾的白名单条目是**目录前缀**，其后任何文件都可以——**但路径必须先过关**。
 *
 * 为什么单独一个纯函数：这是**安全边界**，而边界要被穷举测试（`..`、绝对路径、空段、
 * 编码过的斜杠…）。混在 handler 里就只能靠发请求去试，测不全。
 *
 * @param name - 已由 `matchPath` 逐段解码并重新用 `/` 拼好的相对路径。
 */
export function isAllowedVendorPath(name: string): boolean {
  if (VENDOR_WHITELIST.includes(name)) return true
  if (!isSafeRelativePath(name)) return false
  return VENDOR_WHITELIST.some((entry) => entry.endsWith('/') && name.startsWith(entry))
}

/**
 * 相对路径安全吗。
 *
 * 收紧到什么程度：**只允许** `[A-Za-z0-9._-]` 组成的段、用 `/` 分隔、至少两段
 * （必须落在某个目录里）、且没有空段。于是 `..`、`.`、绝对路径、`~/`、空字节、
 * 反斜杠、以及 Windows 盘符都进不来——**不靠"拼接前替换掉 `..`"那种补丁**。
 *
 * 为什么要求至少两段：单段路径（`pixel` 这种）是目录本身，没有 servable 的内容，
 * 而"能服务一个目录"没有意义（我们要么服务文件、要么什么都不服务）。
 */
export function isSafeRelativePath(name: string): boolean {
  if (typeof name !== 'string' || name === '' || name.length > 512) return false
  const segments = name.split('/')
  if (segments.length < 2) return false
  return segments.every((seg) => /^[A-Za-z0-9._-]+$/.test(seg) && seg !== '.' && seg !== '..')
}

/** 供类型推断用的响应形状（避免 `http` 被 TS 当成未使用）。 */
export type VendorResponse = http.ServerResponse
