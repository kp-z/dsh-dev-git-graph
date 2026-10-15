# 面板第三方资源（vendored）

按仓库根 `docs/DIRECTORY.md` 的约定：源在 `src/vendor/`（**入库**），构建同步到
`lib/vendor/`（运行期读那一份，随 `files` 发布）。面板运行期**不走 CDN**。

**共 20 个文件、3.73 MB。** 目录结构**刻意保持与上游一致**：
three 的 addon 之间有相对 import（`loaders/GLTFLoader.js` → `../utils/BufferGeometryUtils.js`），
拍平就断了，而**改 vendored 代码是我不做的事**——改了 sha256 就失去意义。

白名单与 MIME 在 `src/routes/vendor.ts`：认的是这些**确切相对路径**，不做任何拼接猜路径。
`test/vendor.test.js` 会双向核对（磁盘 ↔ 白名单、import map ↔ 白名单）。

## three.js 0.167.1（MIT）

| 文件 | 用途 | 体积 | sha256 |
|---|---|---|---|
| `three/LICENSE` | three.js 许可证原文（MIT） | 1,081 B | `4c40a1ef62450b857c3b2aaf294936304cd552d965fbcd9d32d4c5bcf4ba4454` |
| `three/build/three.module.min.js` | ESM 渲染核心 | 684,042 B | `54a7a52ddce0ad06fbd1d021fd03b1e1812d946114a2111e1260bcd490c6b840` |
| `three/examples/jsm/controls/OrbitControls.js` | 轨道控制 | 32,250 B | `f260591ef315aa04888152e7f121865214e33fb54727145cf4e4445058db1297` |
| `three/examples/jsm/loaders/GLTFLoader.js` | GLB/GLTF 加载器（R19 用） | 110,043 B | `11ea6cf692882d7a2770f2cbb485724def0aa4e623abcfe45fbf74aa0ea5bc55` |
| `three/examples/jsm/utils/BufferGeometryUtils.js` | GLTFLoader 的相对依赖 | 31,768 B | `c25b7930e570e9ec56173cd3b866ec8d2e10016630db3937efb439daf1cedbf6` |
| `three/examples/jsm/utils/SkeletonUtils.js` | **克隆骨骼角色**（R19 用） | 8,421 B | `e0dcb498b3383a032e6e934fcc5bfe07b5e99d4d4d1c77a7956fe935304abf5c` |

## Kenney "Mini Characters" 1.0（**CC0**）

12 个低模角色（6 男 6 女），**每个 GLB 内嵌 32 条动画**（idle / walk / sprint / sit / …），
2 个蒙皮。这是 M5「动作库」的资产来源。

**为什么选它**（详见 `docs/ASSETS.md`）：单个角色约 250 kB，24 个同屏也不到 6 MB；
同档次的 KayKit 每个角色 3.5 MB（把图集与全部剪辑塞进每个 GLB），体积差 14 倍。
授权是 **CC0**——无需署名（Kenney 只是"希望"你署名），零法律风险。

| 文件 | 用途 | 体积 | sha256 |
|---|---|---|---|
| `kenney-mini-characters/License.txt` | 许可证原文（**CC0**） | 718 B | `28358ae5accc85b572eb42507956afc8beae05acb4648bb9026a5714d421b785` |
| `kenney-mini-characters/Textures/colormap.png` | GLB 引用的**外部**贴图，必须一起发 | 8,706 B | `0d4947d34ff32acf4a359c7f22ca784e057e7e72f622170a9a77b6fc88fdb70e` |
| `kenney-mini-characters/character-male-a.glb` | 已绑定骨骼，内嵌 **32 条动画** | 246,916 B | `77572792bfe2773b715b8cd8e18644b52b3e1f155fe10450254b50f9c364382a` |
| `kenney-mini-characters/character-male-b.glb` | 已绑定骨骼，内嵌 **32 条动画** | 247,332 B | `791fc0c203924c175c0a3d5b60d030daf36797b039506689cf7cd01ef5253b3c` |
| `kenney-mini-characters/character-male-c.glb` | 已绑定骨骼，内嵌 **32 条动画** | 263,104 B | `672a6506f7475bbd655da1d7ff712c1729a430f134c62385a4e5d3c1378acb40` |
| `kenney-mini-characters/character-male-d.glb` | 已绑定骨骼，内嵌 **32 条动画** | 245,184 B | `dd12b2e75ffb1cdb45aaec3916c3d6e732929ccb4a8b89b946f69baaabfa64da` |
| `kenney-mini-characters/character-male-e.glb` | 已绑定骨骼，内嵌 **32 条动画** | 242,704 B | `cd76681090ce29861b055b0f8b2bdcf84bfccc4ca816f428df42a9bb76d6e1b6` |
| `kenney-mini-characters/character-male-f.glb` | 已绑定骨骼，内嵌 **32 条动画** | 249,388 B | `ed151fc47c5cd6be9693c524e92f045170c965819f4f81b28ed66dcc3c1085bf` |
| `kenney-mini-characters/character-female-a.glb` | 已绑定骨骼，内嵌 **32 条动画** | 273,448 B | `8cfcff43460da8b421f2a7fdfb43ec177321cad2746db9497cbf128d5806e2a8` |
| `kenney-mini-characters/character-female-b.glb` | 已绑定骨骼，内嵌 **32 条动画** | 252,140 B | `2288438e7baf9acc91a870c82dc00d66710bb486592cfc3474ef8ed93a03863a` |
| `kenney-mini-characters/character-female-c.glb` | 已绑定骨骼，内嵌 **32 条动画** | 252,040 B | `3cd9e1b5d6409fce0ba1af617d9e008c3069493185a4c100f49fb99a2626a055` |
| `kenney-mini-characters/character-female-d.glb` | 已绑定骨骼，内嵌 **32 条动画** | 258,760 B | `67f61708743bd34f91a4c2ba8160b61bf2e7d4ec2ca6647dfe99873422561410` |
| `kenney-mini-characters/character-female-e.glb` | 已绑定骨骼，内嵌 **32 条动画** | 248,012 B | `3ee3939f80d718945fcb9199f909a92c39669e38aeec7f544536b5dce6e79f98` |
| `kenney-mini-characters/character-female-f.glb` | 已绑定骨骼，内嵌 **32 条动画** | 259,488 B | `2ff4311897bfaf99be80d2fa13918db30f506607da0291640b2609d82b70e0ca` |

- 上游页面：<https://kenney.nl/assets/mini-characters>
- 下载直链：`https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip`
- 整包 zip 的 sha256：`9e1d48e6d7b8479ebbe84df71eb5bd8e1b3f0da546dea641890dccc8a02d0999`（2,403,059 B）
- **只 vendor 了 12 个角色**，没要整包里的 14 个辅具/轮椅（本场景用不到；CC0 允许只取一部分）。
- **`Textures/colormap.png` 必须留着**：GLB 里的 `images[].uri` 指的是 `Textures/colormap.png`，
  少它一个，模型会加载成功但一片纯色——这种"半成功"最难查。

## 一处**有理由的偏离**：为什么不占根 `/vendor`

仓库约定里宿主静态路由是 `GET /vendor/:file`。但 `webServer.register` 对**重复的
(kind, path) 会直接抛错**，而 `packages/dsh-contract-butler` 已经注册了 `/vendor/:file`
（`src/index.ts`）——我再注册一次会让**那个插件起不来**。

所以本插件的白名单路由挂在**自己的前缀**下：`GET /agent-world/vendor/*`。
客户端侧完全无感（import map 里写相对路径）。这是一条**为共存让路**的偏离，
不是随手改约定——如果将来宿主支持多所有者或加前缀，应当回来对齐。

## 还没做的事（写在最显眼的地方）

`GLTFLoader.js` 与 `SkeletonUtils.js` **已经 vendor 并白名单了，但还没有代码去用它们**。
消费它们的是 M5-1/M5-5（加载 GLB + `SkeletonUtils.clone()` 克隆骨骼角色 + `pack.kenney-mini`）。
在那之前，3D 视图里站点与角色**仍然是程序化几何**（`web/builders.js`），一个外部模型都没用。

## Kenney "Furniture Kit" 2.0（**CC0**）

办公室陈设。**只取了 31 个办公室用得上的**（整包 140 个 GLB 里还有卧室/卫浴/厨房 36 个用不到的件）。

- 上游页面：<https://kenney.nl/assets/furniture-kit>
- 下载直链：`https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip`
- 整包 zip 的 sha256：`e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0`（5,130,729 B）
- **无外部贴图依赖**（每个 GLB 自包含），所以不需要额外的 `Textures/` 目录。
- 31 个 GLB 共 **355KB**（平均 12KB）。
- 由 `pack.kenney-furniture` 引用；`sa 内容里引用的每个 url 都有测试核对"文件真的在 src/vendor/ 下"。

### ⚠️ 其中 **25 个还没有消费者**

`SceneProp.modelId` 是**单数**——一个站点只能声明一个模型，所以"书桌 + 椅子 + 显示器"摆不出来。
现在只有 6 个文件被 `pack.kenney-furniture` 引用（desk / table / bookcaseClosedWide /
cardboardBoxOpen / deskCorner / loungeSofa），其余 25 个（椅子×4、显示器/键鼠、笔记本、
书架×3、台灯×3、衣帽架、门框×2、扶手椅、封口纸箱、垃圾桶、收音机、电视、植物×3）
**已 vendor、已进白名单，但没有任何内容引用**。

这就是"**链路建好了没有消费者**"，已记成 BACKLOG 的 **M4-11**。
下一轮要么让它们被用上，要么就该裁掉——**不要让它一直挂在这里**。
