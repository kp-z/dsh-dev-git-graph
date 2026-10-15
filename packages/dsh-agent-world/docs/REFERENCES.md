# 参考实现地图（M4 的"难实现"去哪借鉴）

> **这份文档为什么存在**：M4 要做 three.js 场景，最贵的是几处"手写很硬"的东西
> （相机模式切换、大量实体的实例化、皮肤→样式收敛、标签、拾取）。
>
> **R17 起外网恢复了**（R9–R16 连续十次确认全断，R17 实测 `api.github.com` 带
> User-Agent 返回 200、`registry.npmjs.org` / `unpkg.com` / `example.com` 全 200）。
> 所以下面**第六节**是联网后真去 GitHub 搜到的结果——**全部核对过许可证与文件**，
> 不是搜索结果的转述。
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

---

## 六、联网后的 GitHub 搜索结果（R17，逐个核对过许可证与文件）

### 6.0 截至 R17，本包**没有引入任何外部模型或资产**

这个问题值得钉一行，因为它很容易被后来的叙述带偏。事实（`git ls-files` 可查）：

| 类别 | 实际用了什么 |
|---|---|
| 外部模型文件（glb/gltf/fbx/obj） | **零个**。本包里没有任何这类文件 |
| 贴图 / 音频（png/jpg/hdr/mp3…） | **零个** |
| **3D 形状** | **全部是自己写的程序化几何**：`web/builders.js` 里 8 个构建器（`avatar` / `desk` / `meeting` / `server` / `mailroom` / `lab` / `breakroom` / `delivery`），用 three 的基本体（盒子 / 圆柱 / 胶囊 / 球）拼出来 |
| 第三方代码 | **只有 `three@0.167.1` + `OrbitControls`**（MIT，`src/vendor/`），而且**不是从 GitHub 下的**——是 R15 从本机 `~/DEV/msim-front-react-workspace-2/node_modules/three` 复制并 vendor 的 |
| 本文件里那些 GitHub 项目 | **只读了、一个字的代码都没抄进来**（连注释里都没有它们的标志性写法，`grep makeBasis` 为本包自有代码零命中） |
| `RosterSeat.model`（LLM 路由，与 3D 模型无关） | 内置 8 个席位**全是 `null`**，没接任何模型 |

"参考"与"使用"在这里是两件事：**参考的是结构与手法（可读、可验），用的是自己写的几何**。
将来真正会引入外部资产的是 M5（Kenney 的 CC0 角色），到那时这张表才需要改。

### 6.1 先说结论

**没有"能直接拿来当场景数据"的现成项目。** 两个最对口的候选，布局都**烘在代码里**
（是带硬坐标的声明式 TS），而不是外部数据。按本文件第三节那两条标准，它们都是**借鉴**，
不是**直接使用**。

但搜到的东西**比预期有用**，有两个原因：

1. 其中一个（`factory`）的分层与**我们自己独立选的**几乎同构（`kernel` / `models` /
   `world` / `theme.ts` / `sim`）——这是一次**外部验证**，不是巧合的相似。
2. 另一个（`ai-iso-skill`）给出了**第二种美术风格**的实现，而且短到可以整段读：
   约 15 行投影代码把盒子的每个面变成一幅等距平面。这正好是我们 `ScenePlan`
   那层缝存在的意义（决策 D23）——**同一份计划，换一个渲染器**。

### 6.2 逐个核对过的候选

| 项目 | ★ | 许可证 | 是什么 | 判决 |
|---|---|---|---|---|
| `Khalidabdi1/factory` | 133 | **MIT**（© 2026 Khalid Abdi + Tolga Cohce） | 等距小镇/城市/港口/农场/星舰基地，TS + three.js，78 个文件的 `yard/` 引擎 | **借鉴**（结构可适配，布局不能喂） |
| `MrBongoC/ai-iso-skill` | 182 | **MIT**（© Tolga Cohce） | **纯 SVG** 的发丝等距图：约 15 行投影把每个面变成 SVG `matrix()`，**零依赖** | **借鉴**（美术风格内核，可直接读透） |
| `jeromeetienne/threex.proceduralcity` | 145 | MIT | 老牌程序化城市生成器 | 仅参考（three r60 时代，API 早过期） |
| `StarKnightt/night-street` | 129 | MIT | 黄金时刻程序化街道，R3F + 零外部资产 | 仅参考（React 外壳，我们用不上） |
| `jstrait/city-tour` | 88 | MIT | 程序化生成城市漫游 | 仅参考 |
| `VisualSource/selectiveUnrealBloomPass` | 3 | MIT | 选择性 bloom（只让指定物体发光） | 可作 bloom 的备选实现 |
| `lojjic/aframe-troika-text` | 79 | MIT | `troika-three-text` 在 A-Frame 里的用法 | 看用法（库本身我们已有） |

### 6.3 `factory` 的 `yard/` 分层（外部验证）

```
yard/kernel    6 个文件  等距内核：投影、平面矩阵、Part 绘制累加器
yard/models   13 个文件  几何构建器（车辆等）——**与我们 web/builders.js 是同一个思路**
yard/world    24 个文件  按区域分的场景定义（town / sahel / port / metro / observatory / starbase …）
yard/sim      29 个文件  模拟
yard/theme.ts            主题即数据
yard/layout.ts           路缘等全局常量
```

它的等距内核是这套：

```ts
// Scene coords: +x 右下, +y 左下, +z 上。three.js 是 y-up，所以 W 交换 y/z；
// 一个朝 (-1,-1,-1) 看的正交相机就画出 P(x,y,z)。
export const W = (x, y, z = 0) => new THREE.Vector3(x, z, y)
export const plane = (O, U, V) => { …makeBasis(u, v, n).setPosition(W(...O)) }
export const TOP   = (x,y,z) => plane([x,y,z], [1,0,0], [0,1,0])
export const FRONT = (x,y,z) => plane([x,y,z], [1,0,0], [0,0,-1])
export const SIDE  = (x,y,z) => plane([x,y,z], [0,-1,0], [0,0,-1])
```

**可直接抄的是"平面基矩阵"这个手法**：任何东西（矩形、文字、路径）画在 `(u,v)` 平面上，
靠这个矩阵就落到正确的等距面。**深度靠绘制顺序解决**，不需要深度缓冲 tricks。

**不能直接用的是布局**：`buildFlats(name, x, y, w, d, h, door)`——坐标是参数，但**调用点把
坐标写死在代码里**。所以它是"一个做好的小镇"，不是"给数据就摆"的引擎。
另外它 75 个 `.ts` 里**很多带 `// @ts-nocheck`**，说明这份代码是按"能跑"而不是"能测"写的——
借结构可以，借代码要重写。

### 6.4 第三节那三块硬骨头，现在的答案

| 缺什么 | 最该读的参考 | 状态 |
|---|---|---|
| **骨骼动画** | three.js **官方** `examples/webgl_animation_skinning_blending.html`（200）、`webgl_animation_skinning_ik.html`（200）、`examples/jsm/utils/SkeletonUtils.js`（200） | **已核实存在**。**关键**：`SkeletonUtils.clone()` 是克隆骨骼角色的唯一正确做法——直接 `Object3D.clone()` 会**共享骨架**，24 个角色会同步抽搐。`three-stdlib`（本机 2.35.2 / 最新 2.36.1，MIT）里就有它 |
| **SDF 文字** | `troika-three-text`（本机 0.49.1 / 最新 **0.52.5**，MIT）；用法看 `lojjic/aframe-troika-text`（79★ MIT） | 库已有，缺的是"头顶名字 + 遮挡处理"的具体写法 |
| **后处理 / bloom** | three.js 官方 `examples/webgl_postprocessing_unreal_bloom_selective.html`（200）；`VisualSource/selectiveUnrealBloomPass`（MIT） | **`postprocessing` 最新 6.39.5，许可证是 Zlib**（宽松、与 MIT 兼容，但**不是 MIT**——按本文件第三节第一条应当显式记一笔，当作"经核对的例外"） |

**版本情报（R17 实测 npm registry）**：

| 包 | 最新 | 许可证 | 我们现在 |
|---|---|---|---|
| `three` | **0.186.1** | MIT | vendored **0.167.1**（离线期唯一副本） |
| `postprocessing` | 6.39.5 | Zlib | 无（peer 要求 `three >=0.168`，所以 0.167.1 用不了 → **没有 bloom**） |
| `troika-three-text` | 0.52.5 | MIT | 本机 0.49.1 |
| `three-stdlib` | 2.36.1 | MIT | 本机 2.35.2 |

### 6.5 联网后的下一步（按价值排序）

1. **换掉 vendored 的 three（0.167.1 → 0.186.1）并引入 `postprocessing`** →
   **bloom 立刻可用**（主题里的 `post.bloom.enabled` 从 R10 就留好了，一直没人接）。
   这是一次纯替换：换 `src/vendor/` 三个文件 + 更新 sha256 + 加一个 vendored 依赖。
2. **M5：真拿 Kenney 的 CC0 角色资产**（`docs/ASSETS.md` 已核验过那批），
   接 `SkeletonUtils.clone()` + `AnimationMixer`。这是"换资产只改内容"的**唯一真实验证点**（M5-6）。
3. **可选：加"发丝等距"作为第二种视图**——拿 6.3 那个平面基矩阵手法，
   写一个**消费同一份 `ScenePlan`** 的渲染器，与现在的网格渲染器并列切换。
   这才是"能用 GitHub 上的东西"最实在的形态：不是搬场景，是**搬内核**。
   需要用户拍板要不要（它是一条美术方向的岔路）。

---

## 七、`KsanaDock/Microverse` —— 同一个问题域的 Godot 实现（用户提供，R20 核对）

**这是目前最"对口"的一个**：它做的是 **AI 小镇**，我们做的是 **agent 工作世界**——同一问题域。

| 事实 | 值 |
|---|---|
| 地址 | <https://github.com/KsanaDock/Microverse> |
| 许可证 | **MIT**（`Copyright (c) 2025 KsanaDock`）—— 可以用，要求保留声明 |
| 技术 | **Godot 4 + GDScript**（不是 web） |
| 是什么 | 上帝视角沙盒：8 个预设 AI 角色、LLM 自然对话、持久记忆、自主任务、环境感知 |
| LLM | OpenAI / Claude / Gemini / DeepSeek / 豆包 / Kimi 多供应商 |
| 结构 | `script/`（`ai/`、`ui/`）+ `scene/`（`characters`/`maps`/`prefab`/`ui`）+ `asset/` |
| 核心管理器 | `APIManager` · `DialogManager` · `MemoryManager` · `CharacterManager` · `TaskManager` |

### 7.1 它的分工与我们**惊人地对应**（一次外部验证）

| Microverse | dsh-agent-world |
|---|---|
| `CharacterPersonality.gd` + `script/ai/background_story/` | `rosters` 库 |
| `TaskManager.gd` | `tasks` 库 + `sim/scheduler.ts` |
| `RoomData.gd` / `RoomManager.gd` / `RoomArea.gd` | `districts` + `stations` 库 |
| `GameSaveManager.gd` | `store/worldStore.ts`（世界 + 事件日志两个文件） |
| `CameraController.gd` | `ScenePlan.theme.camera` |
| `Desk.gd` / `Chair.gd`（道具即场景脚本） | `web/builders.js` 的程序化构建器 |
| `script/ai/AIAgent.gd` | `sim/` 的状态机 + `domain/types.ts` 的 `Agent` |

**"世界 / 角色 / 任务 / 存档"这个切分是这类项目的自然形状。** 一个独立实现走到同样的分工，
说明我们那十个库不是过度设计。

### 7.2 但它踩的**恰恰是我们明令禁止的两条线**（反向验证）

**① 人设硬编码在代码里。** `script/CharacterPersonality.gd`：

```gdscript
const PERSONALITY_CONFIG = {
    "Stephen": {
        "position": "SleepySheep公司老板",
        "personality": "奥斯卡级虚伪表演家，职场PUA持证上岗选手……",
        "speaking_style": "张嘴就是'期权池已备好'……",
        "work_duties": "每周发布新的'三年愿景'……",
        "work_habits": "下班时间必在公司群发'深夜奋斗者照片'……",
    },
    "Tom": { … }, "Lea": { … }, "Alice": { … },   # 8 个角色全在这一个 const 里
}
```

这就是**"代码是数据"**。我们那条红线（决策 D15/D17：人设进 `rosters` 库、
`RosterSeat` 只有 `role`/`name`/`palette`）要避免的正是这个：
**换一个人设、加一个角色，都要改这个 `.gd` 文件**。用它的反面来验我们自己的设计，很有说服力。

**② 世界状态挂在场景节点上，靠运行时字符串路径互相找。** `script/ai/AIAgent.gd`：

```gdscript
extends Node
class_name AIAgent
@onready var character = get_parent()
@onready var dialog_manager = get_node("/root/DialogManager")
@onready var room_manager = get_node("/root/Office/RoomManager")
var current_state = State.IDLE
```

- 世界状态 = Godot 场景树里的节点（**模拟与渲染是同一棵树**）；
- 模块之间靠 `get_node("/root/…")` 这个**字符串路径**耦合——**没有编译期检查**，
  重命名一个节点就在运行期静默断掉。

而我们的做法是：`ScenePlan`（渲染器无关，决策 D23）+ 事件日志（协议层）
+ `BOUNDARY_RULES` 边界表（谁能 import 谁，**编译期强制**）。
**所以它不是"解耦"的参考**——它是单引擎游戏的省事选择，而我们的要求是
"模块之间用协议通信、禁止耦合"。

### 7.3 它有、而我们**完全没有**的两块（这才是真能借的）

1. **`script/ai/`：LLM 智能体层。** `APIManager.gd` / `APIConfig.gd`（多供应商接入）
   + `DialogManager.gd` / `ConversationManager.gd` / `DialogService.gd`（对话编排）
   + `memory/`（持久记忆）+ `background_story/`（角色背景）。
   **我们的 agent 是确定性规则引擎，没有任何 LLM 层**——而"一个 lead 分配安排各种 agent 任务"
   最终需要它（就是我们记的 **M7：与真实 subagent 的桥**）。
2. **`ScenePerceptionManager`：把"角色周围有什么"整理成能给 LLM 的形式。**
   这是"环境感知 → prompt"的那一层。我们已经有它的**原料**（`ScenePlan`、
   世界快照、事件流），但没有"怎么裁成一段给模型看"的设计。

### 7.4 判决

| 用途 | 能不能用 |
|---|---|
| 直接当**场景数据**用 | ❌ 它是 Godot 项目，不是"给数据就摆"的场景描述 |
| 当**架构参考** | ⚠️ **反向参考**：它踩了我们禁止的两条线，**验证了我们为什么要那样设计** |
| 借**我们缺的 LLM 层设计**（M7） | ✅ **真有价值**：多供应商接入、对话编排、记忆、感知→prompt |
| 当 **Godot 路线的参考/起点** | ✅ **最有价值的一条**——用户最初的首选之一就是 Godot；决策 D23 本来就是为"将来换 Godot 客户端"留的缝 |

**边界与注意**：GDScript + 场景文件与我们的 three.js/TS **无法共用代码**，借的是
**设计与数据形状**；若抄任何代码，MIT 要求保留版权与许可声明；
它的人设文案是讽刺职场风格（PUA / 996 玩笑），要借的是**结构**，不是文案。
### 7.5 用户的意见：AI 基座用 DSH，只借它的场景与模型（R20 核实后修正）

用户明确：**AI 层用我们自己的 DSH 基座**，Microverse 只当**场景与模型的来源**。
方向没问题——我们本来就把 AI 层与渲染层分开（7.3 里我把它的 LLM 层标成"不一定借"）。

**但"用他的模型"这条，核实后不成立**：

| 核实项 | 实测结果 |
|---|---|
| 画面风格 | **2D 顶视像素画**（用视觉模型读它自己的 README 预览图 `asset/pics/office.png`：地板是 Tilemap 网格、**无透视**；字符边缘是像素锯齿；阴影是**画在贴图里**的；角色是"顶视像素小人"） |
| 素材格式 | **32×32 PNG 精灵图**，不是 GLB。`asset/singleObjects/office_objects/` 下有 **698 个** `Modern_Office_Singles_32x32_*.png` |
| 场景格式 | Godot 2D 场景：`scene/maps/Office.tscn` + `scene/characters/{8 个角色}.tscn` |
| 有没有 3D 模型 | **没有**。`asset/{characters,objects,singleObjects,maps}` 全是 PNG / 字体 / UI 图 |
| 素材许可 | **仓库里没有任何署名、来源或第三方许可记录**（各 `asset/` 子目录下没有 license/credits 文件） |

**许可这条要当心**：那 698 张图明显是某个第三方「Modern Office」像素素材包的单图拆分，
而 MIT **只覆盖它的代码**。这类素材包的常见条款是**禁止再分发素材本身**
（`docs/ASSETS.md` 里对 Quaternius 记过同类问题）。**在没有确切条款之前，按"不能 vendor"处理**——
把它们拷进我们自己的 MIT 仓库，风险自负。

**所以"用他的场景和模型"有三种可行读法**（都**不**碰它的素材文件）：

| 方案 | 做什么 | 代价 |
|---|---|---|
| **A（推荐）** | 借他场景的**内容**：办公室的房间划分、工位/家具布置（那是"布局知识"，不是素材） → 写成我们的 `districts`/`stations`/`scenes` 内容库；模型用 **Kenney Furniture Kit（CC0，`ASSETS.md` 已核验 140 个模型 / 4.89MB）** 配 3D | 需要把 `Office.tscn` 的布局**读出来**再手写成内容；素材要另外下 Kenney |
| **B** | 走 **2D 像素风**：我们**已经有 2D 俯视图**（决策 D21 永久保留的那个），把它像素化是相对小的工作 | 素材许可仍要解决（自己画 / 找 CC0 像素包），且这是**换美术方向** |
| **C** | 按预览图**照着摆**我们自己的 3D 家具（CC0 素材），复刻"那个办公室的样子" | 只借设计、不借素材；比 A 更省事，但也不那么"用他的" |
