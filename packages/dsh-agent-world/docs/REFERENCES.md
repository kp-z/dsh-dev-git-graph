# 参考实现地图（M4 的"难实现"去哪借鉴）

> **这份文档为什么存在**：M4 要做 three.js 场景，最贵的是几处"手写很硬"的东西
> （相机模式切换、大量实体的实例化、皮肤→样式收敛、标签、拾取）。
> 原计划是"上网找现成项目借鉴"，但**这台机器目前完全没有外网**
> （R9/R10 连续确认：`api.github.com`、`registry.npmjs.org`、`example.com` 全是 `000`；
> `web_search` 工具的端点也配错了，返回 401）。
>
> 所以先把**本机已有的参考实现**整理成地图。这不是退而求其次：下面这些是
> **同一批库**在真实项目里的用法，有类型、有测试，比随手找的 GitHub 仓库更对口。
>
> **诚实标注**：下面标「已核实」的，是我实际 grep 过关键 API、确认了结构；
> **没有逐行读完**。标「仅清点」的只看了文件名与行数。

## 一、可借鉴的本机项目

| 项目 | 规模 | 是什么 | 为什么对我们有用 |
|---|---|---|---|
| `~/DEV/msim-front-react/src/pages/MvizLite/viz3d/` | ~40 个源文件 | **分层 3D 可视化引擎**：引擎 / 相机架 / 图层构建器 / 交互控制器 / 样式解析 / 可见性 store | **最对口**。它的形状和我们的"引擎 + `ScenePlan` + 图层"几乎同构 |
| `~/DEV/msim-front-react/src/pages/QuickVizPro/core/ThreeVizEngine.ts` | 2386 行 | 另一个完整场景引擎：光照 / 天空 / 地面 / 相机跟随 / 图层 / 双引擎共享相机 | 天空与光照**按录制时间**驱动；两实例共享相机视角的通道设计 |
| `~/DEV/msim-front-react-workspace-2/src/pages/QuickVizPro/core/ThreeVizEngine.ts` | 2386 行 | 上面那个的同源副本 | 同 |
| `~/DEV/mviz-kit/frontends/` | C++ 核心 + web 前端 | 可视化工具集，`ROAD_MARK_TYPE` 枚举等**与前端模型路径对齐** | 看"后端枚举 ↔ 前端资源"的映射约定 |

## 二、难点 → 参考文件（核心）

| 我们的难点 | 去读 | 已核实到什么 |
|---|---|---|
| **等距 ↔ 透视切换**（`theme.camera.projection`） | `viz3d/engine/CameraRig.ts`（510 行） | **已核实**：同时持有 `PerspectiveCamera` 与 `OrthographicCamera`，`CameraMode` 默认 `'2d'`；切模式时要**重建**（`OrbitControls` 绑在相机实例上，第 365 行的注释就写着这条坑）；`readZoom`/`onZoomChange` 按模式各存一份缩放 |
| **正交相机下的缩放语义** | 同上，`get cameraMode()` / 319、339 行附近 | **已核实**：按 `instanceof` 分支取 `zoom` 与 `fov`——正交相机没有 fov，混用会静默出错 |
| **内容 → 样式收敛（同构于我们的 `palette`/`ScenePlan`）** | `viz3d/layers/styleResolver.ts`（206 行） | **已核实**：`DEFAULT_LINE_STYLE` / `DEFAULT_POINT_STYLE` / `DEFAULT_TEXT_STYLE` + `resolveXxxStyle()`。**和我们"token 在服务端解析完再下发"是同一个套路**——这份代码可以验证我们那层设计是对的，也能抄它的缺省补齐细节 |
| **大量实体（24 角色 + 上百道具）** | `viz3d/layers/builders/pointCloudBuilder.ts`（254 行） | **已核实**：显式圆片样式走 `THREE.InstancedMesh`（第 105/112 行），否则退回 `THREE.Points`——**"形状简单但数量多"用实例化**这条判据可以直接搬 |
| **图层生命周期 / 可增删的构建器** | `viz3d/layers/builders/` 下 ~20 个 builder（polyline 548 行、polygon 527 行、persistentPolylines 323 行、persistentCarBoxes 260 行…） | **已核实**：每个 builder 是独立文件、独立可测；`getOrCreateLayer(name)` 按名字取 Group |
| **GLB 模型加载与实例化** | `layers/builders/{egoModelBuilder,obstacleModelBuilder,roadMarkBuilder}.ts` | **已核实**：都用 `three/examples/jsm/loaders/GLTFLoader.js`（**注意**：不是 `three-stdlib` 的，两者都有，选一个统一） |
| **角色/物体头顶标签** | `viz3d/engine/LiteLabelerController.ts`（755 行）、`layers/builders/objectTypeIcon.ts` | **已核实**：755 行的独立控制器；注释里明确**右键/中键不拦截，留给 `OrbitControls` 平移缩放**——这是"我的交互"与"相机的交互"抢事件时的正确解法 |
| **拾取 / 点选 / 测距** | `viz3d/engine/{InteractionController,MeasureController}.ts`（351 / 295 行） | **已核实**：测距在 **capture 阶段**拦截左/右键，避免同一次点击又触发 `OrbitControls` 平移——同一个坑的另一个解法 |
| **地面 / 网格** | `viz3d/engine/GroundPlane.ts`、`layers/builders/gridBuilder.ts` | 仅清点 |
| **场景上下文（渲染器/尺寸/清理）** | `viz3d/engine/SceneContext.ts`（294 行） | **已核实**：第 81 行注释——**矩阵缩放不能用严格的 0**，不可逆的世界矩阵会让 `Mesh`/`InstancedMesh` 的 raycast 失效。这种"必须非零"的坑值得直接抄 |
| **光照 / 天空 / 按时间的色温** | `QuickVizPro/core/ThreeVizEngine.ts` 的 `setupLights` / `setupSky` / `updateSkyFromFrame` | **已核实**：天空与光照由**录制时间戳**驱动（`getSkyAnglesFromRecordTime`）——我们的主题里 `lighting` 是静态的，想加"白天/夜晚"时可参考 |
| **两个视图共享同一个相机** | 同上，`ThreeVizEngineOptions` 的"相机同步通道 key" | **已核实**：相同 key 的两个引擎实例共享视角。将来"俯视图 + 3D 视图并排"会用到 |
| **3D 代码怎么测**（没有 GPU 也要能测） | `viz3d/test/cameraRig.test.ts`、`viz3d/test/Viz3DEngine.test.ts`、各 builder 的 `test/*.test.ts` | **已核实测试位置在 `viz3d/` 下（不在 `engine/` 里）**；`cameraRig.test.ts` **注入一个假 `OrbitControls`**（`vi.importActual` 只取真类再套壳），`Viz3DEngine.test.ts` 第 262 行直接 `instanceof THREE.InstancedMesh` 断言——**"渲染器不参与也能验几何与实例化"**这条正好支撑我们把 `ScenePlan` 做成纯函数 |

### 关于"可见性 / 图层树"（与你的另一条线重叠，只做提示不碰）

`viz3d/store/visibilityStore.ts`（606 行）与 `store/perceptionSourcePolicy.ts`（208 行）
管的是图层可见性与来源策略。**它和你正在改的 layer tree 是同一个问题域**——
但那是你在 `feat/dsh-daily` 那条线上的活，本包（`dsh-agent-world`）**不会去动它**，
这里只留一句"存在这么一份可参考的实现"。

## 三、本地**没有**的三块（联网后专门去找 GitHub）

这三块是 M4 真正硬的，而本机三个前端项目里**一处都没用到**（我逐个 grep 过，全是 0 个文件）：

| 缺什么 | 为什么它硬 | 联网后搜什么 |
|---|---|---|
| **骨骼动画**：`AnimationMixer` / `SkeletonUtils` / `SkinnedMesh` / `Bone` | Kenney Mini Characters 每个角色 32 条剪辑。24 个角色各自独立播放、还要混合（走↔坐↔工作）。**`SkeletonUtils.clone()` 是克隆骨骼角色的唯一正确做法**（直接 `Object3D.clone()` 会共享骨架，全员同步抽搐） | `three.js` + `SkeletonUtils` + `AnimationMixer` 的角色池实现；`mixamo` 风格的剪辑混合与过渡 |
| **SDF 文字标签**：`troika-three-text` | 本机**装了但零使用**。手写"名字浮在头顶且永远面向相机、还不糊"很难 | `troika-three-text` 的 batched labels / 跟随 + 遮挡处理 |
| **后处理**：`EffectComposer` / tone mapping / bloom | 本机**零使用**。主题里已经预留了 `post.bloom` 开关（内容侧），但渲染侧没人写过 | `three` + `EffectComposer` + `UnrealBloomPass` 的选择性 bloom（只让特定物体发光） |

**联网后的筛选标准（两条，缺一不用）**：

1. **许可证必须宽松**（MIT / Apache-2.0 / CC0）。GPL 不能进这个仓库。
2. **必须能被喂数据，而不是自带烘死的布局**。判据一句话：
   **它是不是"给什么数据就摆什么"？** 是 → 能用；不是 → 只能借它的相机/光照配方与 CC0 资产。

## 四、借鉴的边界（别搬外壳）

- 那些项目是 **React + `@react-three/fiber` + `drei`**；我们的面板按**决策 D7** 是
  **纯 three.js、无 React**。所以借的是**算法与结构**（相机怎么切、实例化阈值、样式怎么收敛、
  事件怎么不打架），**不是组件外壳**。
- 它们的相机/图层是**命令式引擎**（正是我们能用的那种）；`pages/` 下的 React 部分只是外壳。
- 许可证：上面这些是**你自己项目里的代码**，借鉴不受限。将来从 GitHub 引入的才受第一条约束。

## 五、本机可直接用的库（都已在磁盘上，MIT）

| 包 | 版本 | 位置（示例） | 我们用它干什么 |
|---|---|---|---|
| `three` | 0.167.1 | `~/DEV/msim-front-react-workspace-2/node_modules/three` | 渲染核心（**注意**：`postprocessing` 的 peer 是 `three >=0.168 <0.187`，0.167.1 差一个 minor） |
| `three-stdlib` | 2.35.2 | 同上 | 含 **SkeletonUtils** / GLTFLoader / OrbitControls / EffectComposer / DRACOLoader |
| `troika-three-text` | 0.49.1 | 同上 | 头顶名字（SDF 文字） |
| `three-mesh-bvh` | 0.7.8 | 同上 | 快速拾取 |
| `maath` | 0.10.8 | 同上 | 数学分布辅助 |
| `meshline` | 3.3.1 | 同上 | 粗线（路线 / 纸条飞行轨迹） |

装法见 BACKLOG 的「路 B」（vendoring，离线可行）。
