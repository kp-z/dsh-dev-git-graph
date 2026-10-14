# dsh-agent-world —— 架构设计

> 状态：**已定稿 v1**（第 1 轮）。后续轮次如需变更，必须在本文件里改「决策记录」一节并写明理由，
> 不允许默默偏离。

## 0. 一句话

把 `dsh-agent-teams` 的**多智能体协作协议**（lead + members + 任务 DAG + 邮箱 + 调度器）搬进一座
可视化 3D 小镇：**每个真实 subagent = 小镇里一个会走动的角色，每件任务 = 一张可被拾取的工单，
每次调度 = 一次空间上的移动与协作**。

业务底座沿用 AgentTeams 的语义（durable members / dependency-aware tasks / mailbox / scheduler），
`src/` 里是同一套概念；差别只在于**它的呈现从「React 面板 + 树形列表」换成了「3D 场景」**，
并且为此多了一层"世界模拟"。

---

## 1. 技术选型：three.js（Godot 落选）

用户给的是「Godot 或 three.js」，**本轮定为 three.js**，理由如下：

| 维度 | three.js | Godot |
|---|---|---|
| 与 DSH Web GUI 的关系 | 纯前端 JS，直接是宿主 HTTP 路由吐出的一个页面，同一个浏览器里跑 | 需要导出 web 版（wasm + 资源包，通常 30–60MB），跨一层 JS interop |
| 与宿主通信 | 原生 `fetch` + `EventSource` 直连宿主 API | 要写 GDScript↔JS 桥 |
| 依赖与迭代 | npm 生态（three / R3F / drei / rapier / postprocessing），Vite HMR 秒级 | 需要 Godot 编辑器 + 导出流水线，CI 里跑不动 |
| 打包与体积 | 核心 ~600KB（gzip 后更小），可代码分割 + 资源懒加载 | 起步几十 MB |
| 许可 | MIT | MIT（引擎本身没问题，是集成成本问题） |
| 团队可维护性 | 与仓库里其余插件同语言（TS/JS） | 引入第二套语言与工具链 |

**Godot 不是被否决，是被推迟**：本架构把「模拟（host，权威）」与「呈现（web，可替换）」彻底分开，
§5 的渲染层是一个**只读状态 + 只发意图**的哑客户端。将来若要独立桌面客户端，用 Godot 重写这一层即可，
业务与协议一行不用动。这条正是把渲染层做薄的价值。

---

## 2. 三层架构

```
┌────────────────────────────────────────────────────────────────────┐
│  DSH Host (Node ≥ 22)                                              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ dsh-agent-world host plugin   (src/)                         │  │
│  │  · domain  世界模型（纯数据 + 纯函数，无 IO）                  │  │
│  │  · sim     tick / scheduler / movement / mailbox（确定性）     │  │
│  │  · bridge  DSH subagent ⟷ world agent（唯一映射表）            │  │
│  │  · tools   agent_world_*（defineTool，模型可见）               │  │
│  │  · routes  /api/world · /api/events(SSE) · /agent-world/*      │  │
│  └──────────────────────────────────────────────────────────────┘  │
└───────────────────────────┬────────────────────────────────────────┘
                            │ JSON over HTTP + SSE
┌───────────────────────────┴────────────────────────────────────────┐
│  Browser —— Agent World 面板   (web/)                              │
│  Vite + three.js（纯 three，不用 @react-three/fiber —— 见决策 D7）   │
│  · scene/  场景图、材质、光照、相机                                  │
│  · actors/ 角色、寻路、动画状态机                                    │
│  · ui/     HTML HUD 覆盖层（任务板 / 花名册 / 事件时间线）            │
│  · net/    SSE 客户端 + 快照追平                                     │
└────────────────────────────────────────────────────────────────────┘
```

**第一原则：server-authoritative（模拟在 host，权威在 host）。**
渲染层不持有任何业务真相，不推理任何业务规则。它只做两件事：把状态画出来、把用户意图发回去。
推论：面板可以关掉（世界照跑）、可以开多个（看到同一个世界）、可以整个换掉（换引擎不换业务）。

---

## 3. 世界模型（Domain Model）

> 落位 `src/domain/`，全部是纯数据结构 + 纯函数；**不许出现 `fs` / `http` / `three`**。

### 3.1 实体

| 实体 | 说明 | 关键字段 |
|---|---|---|
| `World` | 一个世界实例，绑定一个 workspace | `id name seed tick createdAt districts stations agents tasks messages` |
| `District` | 地段（工程区 / 会议室 / 机房 / 收发室 / 休息区） | `id name kind bounds palette` |
| `Station` | 工位或设施，是任务的落脚点 | `id kind district slot(x,z) capacity capability` |
| `Agent` | 角色 = 真实 subagent 的投影 | `id name role palette state station pos facing carrying llm bound` |
| `Task` | 工单 | `id title status owner station blockedBy progress attemptId acceptance` |
| `Message` | 邮箱消息（投递动画的来源） | `id from to kind body at deliveredAt` |
| `WorldEvent` | 事件日志（驱动动画 + 时间线），单调 `seq` | `seq at type payload` |

### 3.2 状态机（必须显式，不许布尔堆叠）

```
Agent.state : idle | walking | working | talking | blocked | celebrating | sleeping
Task.status : pending | ready | in_progress | blocked | done | failed
```

* `Task.status` 的 `ready` 是**派生**的：所有 `blockedBy` 都 `done` ⇒ `pending → ready`。
  派生只由 `sim/recomputeReady()` 一处算，别处不许判断依赖。
* `Agent.state` 由 `sim/` 单方面推进；渲染层只读。

### 3.3 站点能力（capability）—— 工单落位规则

任务不直接指定工位，而是声明自己需要的能力，由调度器挑一个**空闲且能力匹配**的站点：

| capability | 承载什么 | 站点 kind |
|---|---|---|
| `code` | 写代码 / 改文件 | desk |
| `review` | 评审 / 验收 | desk, meeting |
| `research` | 查资料 / 调研 | lab, desk |
| `converse` | 协作讨论 / 派单 | meeting |
| `compute` | 跑测试 / 构建 | server |
| `deliver` | 收发消息 / 归档 | mailroom |
| `rest` | 空闲待命 | breakroom |

好处：任务编排与小镇布局解耦。以后加一栋楼，不用改任务。

---

## 4. 模拟循环（Simulation Core）

> 落位 `src/sim/`。**这是本项目最需要设计清楚的地方**，因为它同时决定了可测性、确定性与性能。

### 4.1 权威循环

固定步长，跑在 host：

* `TICK_MS = 100`（逻辑 10Hz），渲染 60fps 对位置做插值；**逻辑频率与渲染频率解耦**。
* 每个 tick 按固定顺序执行：
  1. **ingest** —— 吃进外部命令（工具调用 / HTTP command / bridge 上报）
  2. **scheduler** —— 对每个 `idle` agent，按优先级挑一个 `ready` task 并**原子** claim
  3. **movement** —— `walking` 的 agent 沿路径向目标站点推进
  4. **interaction** —— 到站后进入 `working`，推进 `progress`
  5. **mailbox** —— 投递待发消息，产出投递动画事件
  6. **emit** —— 把本 tick 的**变化**压成 delta 事件推给订阅者

### 4.2 三条硬性质（不可妥协）

1. **确定性**：所有随机走 seeded PRNG（mulberry32），路径与决策不引入 `Date.now()` / `Math.random()`。
   同样的 `seed + 命令序列` ⇒ 同样的世界。这条让「回放 bug」成为可能，也让测试不需要 mock 时间。
2. **纯函数 tick**：`step(world, dt, commands) -> { world, events }`，world 进、world 出，不碰 IO。
   于是 `node --test` 可以直接 `for (i<1000) step(...)` 跑到任意时刻再断言，不需要起服务器。
3. **无渲染运行**：面板没打开时世界照跑；打开时先用 `GET /api/world` 拿快照，再订阅事件追平。

### 4.3 为什么模拟跑在 host 而不是浏览器

* 多个标签页 / 多人同时打开要看到**同一个**世界；
* 面板关掉、浏览器崩掉，世界不能停；
* `node --test` 能直接测，不用起浏览器；
* 与真实 subagent 的桥接天然在 host 侧（subagent 就在 host）。

---

## 5. 渲染架构（web/）

### 5.1 场景图

```
Scene
├── Environment    半球光 + 方向光 + 地面 + 边界雾
├── Town
│   ├── District × N
│   │   ├── Station × M        （desk / server / mailroom / meeting …）
│   │   └── Props              （InstancedMesh 批量画，装饰不占 draw call）
│   └── Roads                  寻路网格的可视化投影
├── Actors          Agent × N（≤24 同屏用独立对象；超出走 InstancedMesh + 简模）
├── Effects         投递物 / 庆祝粒子 / 警示气泡
└── CameraRig       斜俯视 isometric，可 orbit / 缩放 / 跟随某个角色
```

### 5.2 分层职责（严格）

| 目录 | 只许做 | 不许做 |
|---|---|---|
| `net/` | 快照拉取、SSE 订阅、断线重连、gap 自愈 | 任何业务推理 |
| `model/` | 把快照 + 事件折叠成渲染用的插值状态（可单测，无 three 依赖） | 碰 three / DOM |
| `scene/` | 场景图构建与每帧同步（读 `model/`） | 发网络请求 |
| `actors/` | 角色实体、寻路、动画状态机 | 改业务数据 |
| `ui/` | HTML HUD（任务板 / 花名册 / 时间线 / 控制条） | 画 3D |

**HUD 用 HTML 覆盖层而不是 3D 文字**：清晰、可选中、可无障碍访问、改样式便宜。3D 里只画"世界"。

### 5.3 性能预算（60fps @ 1080p，集显）

> 数字已在 R1 按资产调研结果收紧（原稿是 300k 面 / 150 draw call，偏松；见 `docs/ASSETS.md` §6）。

| 指标 | 预算 | 手段 |
|---|---|---|
| draw calls | **≤ 60** | InstancedMesh + `BufferGeometryUtils.mergeGeometries` 合并静态簇 |
| 可见三角面 | **≤ 100k** | 低模 + LOD |
| 贴图 | **≤ 512²** | KayKit 的 1024 图集降到 128–256 |
| 实时光源 | 1 方向光 + 1 半球光（+ 极低 ambient） | 最多 3 个光源，不开多光源阴影 |
| 阴影 | 1 张 2048² shadow map，shadow camera 紧贴小镇 | 用烘焙 AO / 每站点一张接地阴影面替代全局 SSAO |
| 后处理 | **只开 bloom**（阈值 0.9 / 强度 0.3–0.4），默认关 | 低端机自动降级 |
| 首屏载荷 | **≤ 5 MB** | meshopt/Draco 压缩 GLB；HDRI 预滤波成一张小 `.ktx2` |
| 蒙皮角色 | ≤ 20（`SkeletonUtils.clone`） | 超出走程序化简模 |

降级策略：帧率连续低于 45fps 时自动 关阴影 → 关后处理 → 降角色动画帧率 → 减角色数。

### 5.4 美术方向（免费且好看）

**「舒适等距沙盘园区」**（cozy isometric diorama campus）：一块桌面尺度的办公小镇，平面着色低模，
暖色柔光配柔而长的阴影，轻微深度雾。参考 *Monument Valley*（等距粉彩沙盘、一区一强调色）、
*Townscaper*（低模舒适村落、柔方向光 + 轻雾）、*Untitled Goose Game*（平面低模 + 低饱和暖调 + 单一强强调色）。
三者共性：近似正交的取景、最多 3 个光源、**零贴图细节、全靠颜色讲故事**。

* **相机**：`OrthographicCamera`，标准等距（yaw 45°，tilt ≈ 35.264°），±10° 微转 + 两档缩放。
* **光照/渲染器/后处理**：完整配方（含 hex 与参数）见 [`ASSETS.md`](ASSETS.md) §6。
* **调色板**：10 色，见 `ASSETS.md` §6。**色彩纪律：饱和度分三层 —— 大面积低饱和表面 / 中间调家具 /
  每个功能分区只有一个饱和强调色；所有角色服装留在中间调**，这样一群 agent 读起来像一个团队。
* **模型**：**Kenney（CC0）为主** —— Mini Characters（角色 + 32 个内嵌动画，2.29 MB）、Furniture Kit、
  City Kit、Nature Kit；KayKit（CC0）作升级路径。**不用 Quaternius**（2026 换 QAL 许可，禁止再分发资产本身）。
* **贴图/HDRI**：ambientCG 与 Poly Haven（均 CC0），降到 512² / 预滤波 `.ktx2`。
* **字体**：自托管开源字体（如 Inter，SIL OFL）—— **不引 CDN**。
* **资产策略**：只有 **CC0 / public domain** 的字节可以进 git。**禁止** Mixamo 派生文件、CC-BY 资产、
  Sketchfab 素材。完整许可红线清单见 `ASSETS.md` §4。
* **台账**：`web/public/assets/VENDOR.md` 一行一个**下载下来的压缩包**（来源 URL + 许可 + zip 内许可
  文件名 + 下载日期 + sha256），模板见 `ASSETS.md` §5；另有 `THIRD_PARTY_NOTICES.md` 划清
  「代码 MIT / 美术 CC0」的边界；CI 重新哈希比对，漂移就红。
* **动画策略**：预烘焙 GLB（主）+ 程序化（补充）。理由与 Mixamo 的排除依据见 `ASSETS.md` §2。

---

## 6. 同步协议（HTTP + SSE）

| 端点 | 方法 | 作用 |
|---|---|---|
| `/api/world` | GET | 全量快照（打开面板时拿一次） |
| `/api/events` | GET (SSE) | 增量事件流 |
| `/api/command` | POST | 面板发出的用户意图（pause / resume / reset / dispatch） |
| `/agent-world/` | GET | 静态面板（Vite 产物） |

事件类型：`world.reset` · `world.tick` · `agent.state` · `agent.moved` · `task.changed` ·
`message.sent` · `world.paused`。

**gap 自愈**：每条事件带单调 `seq`。客户端发现 `seq` 不连续（丢包 / 断线重连）就丢掉本地状态、
重新拉一次快照。**不许**在 gap 状态下继续增量应用——那会造成静默的状态漂移。

---

## 7. 工具面（模型可见）

命名空间 `agent_world_*`，用 `defineTool` 注册：

| 工具 | 作用 | 里程碑 |
|---|---|---|
| `agent_world_open` | 建立/打开世界，返回面板 URL | M1 |
| `agent_world_status` | 读世界状态（谁在哪、什么在跑、卡在哪） | M1 |
| `agent_world_dispatch` | lead 派单：把任务挂到告示板并分配 | M2 |
| `agent_world_hire` | 招募角色（映射到真实 subagent 生成） | M6 |
| `agent_world_report` | 成员上报进度（→ 角色走到 lead 工位） | M6 |
| `agent_world_archive` | 归档一个完成的世界 | M7 |

写操作必须写明副作用（写盘 / 改配置），这是本仓库 `docs/DEVELOPMENT.md` §8 的红线。

---

## 8. 与真实 subagent 的桥（Bridge）

> `src/bridge/`。这是"模拟世界"与"真实工作"合流的地方，也是最容易语义漂移的地方。

单一映射表（**只此一处**，别处不许各自解释）：

| DSH 真相 | 世界表现 | 动画 |
|---|---|---|
| subagent 生成 | 角色从"招募门"走进小镇 | walk-in |
| subagent 空闲 | `idle`，可能踱去休息区 | idle / stroll |
| task claim | 走向能力匹配的站点 | walk + 落座 |
| 依赖未满足 | 工单在告示板上是灰的，无人拾取 | 无 |
| 邮箱消息 | 一个纸条飞行物从 A 到 B | fly |
| 任务完成 | 站点亮起、角色庆祝、工单归档 | celebrate |
| 失败 / 阻塞 | 角色头顶 ⚠，走向 lead 工位 | alert → walk |
| lead 派单 | lead 走到告示板，投出 N 张工单 | dispatch |

**分阶段接入**：M1–M5 用「模拟模式」（假数据驱动，纯展示与验证渲染）；M6 才接真实 subagent。
这样渲染层能独立推进，不被 host 侧的 subagent 生命周期挡住。

---

## 9. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0** | 骨架：包结构、patch、typecheck 通过 | `pnpm typecheck` 绿 |
| **M1** | 世界模型 + 纯函数 tick + `node --test` | 1000 tick 确定性测试通过 |
| **M2** | HTTP API + SSE + 落盘 | curl 能拿到快照与事件流 |
| **M3** | three.js 场景：静态小镇 + 站点 + 相机 | 浏览器里能看到小镇 |
| **M4** | 角色出现 / 走路 / 寻路 / 动画状态机 | 角色从 A 走到 B |
| **M5** | HUD：任务板 + 依赖可视 + 时间线 | 能看出"谁在干什么、卡在哪" |
| **M6** | Bridge：接真实 subagent | 真派一个成员，场景里出现角色 |
| **M7** | 打磨：美术 / 音效 / 后处理 / 性能降级 | 60fps 稳定 |
| **M8** | 打包 / 文档 / 发布 | 安装到 web profile 可用 |

---

## 10. 目录结构

```
packages/dsh-agent-world/
├── src/                     host 插件（TS）
│   ├── index.ts             入口：name / inject / apply
│   ├── config.ts            schemastery 配置
│   ├── domain/              世界模型（纯逻辑，无 IO）
│   ├── sim/                 tick / scheduler / movement / mailbox
│   ├── store/               落盘（world.json + events.jsonl）
│   ├── tools/               agent_world_*（defineTool）
│   ├── routes/              HTTP + SSE
│   └── panel.ts             静态面板服务
├── web/                     3D 面板（Vite + three.js）
│   ├── index.html
│   ├── src/{net,model,scene,actors,ui,style}
│   └── public/assets/       模型贴图 + VENDOR.md
├── docs/
│   ├── ARCHITECTURE.md      本文
│   ├── BACKLOG.md           轮次任务队列
│   └── PROGRESS.md          轮次台账
├── test/                    node --test
├── cordis.patch.yml
└── package.json
```

> 注意：`src/` 与 `web/` 是**两个独立构建**。`src/` 用 `tsc` 出 `lib/`；`web/` 用 Vite 出
> `lib/web/`（面板静态产物）。`web/` 的依赖（three 等）**不进入**宿主 client bundle，
> 因此不可能与宿主的 React/three 版本打架。这是选"独立面板页"而非"宿主 client bundle 内嵌"的核心原因。

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| three.js 面板体积拖慢首屏 | 用户以为坏了 | 先出 HUD 骨架，3D 懒加载；显示加载进度；首屏载荷 ≤5 MB（§5.3） |
| 资产许可污染 MIT 仓库 | 法律风险 | 决策 D9：只进 CC0 字节；`VENDOR.md` 一行一个压缩包登记 URL+许可+sha256；许可原文入库；`THIRD_PARTY_NOTICES.md` 划清代码/美术边界；CI 哈希比对。红线清单见 `docs/ASSETS.md` §4 |
| 依赖的 peer 上限卡住升级 | 某天升 three 直接红 | `postprocessing` 的 peer 是 `three >=0.168 <0.187`，**每次升 three 都要复查**；不引 `three-stdlib`（直接 `three/addons/*`）避免与 drei 的 `three-mesh-bvh` 版本打架 |
| 低端机掉帧 | 体验崩 | §5.3 的四级自动降级 |
| 模拟与真实 subagent 语义漂移 | 世界在说谎 | §8 单一映射表；模拟模式与真实模式共用同一套 domain |
| 面板与 host 状态不一致 | 静默错误 | §6 的 `seq` gap 自愈；权威永远在 host |
| 每小时轮次上下文丢失 | 重复劳动 | `docs/PROGRESS.md` 强制台账 + `docs/BACKLOG.md` 强制排队 |

---

## 12. 决策记录（Decision Log）

| # | 决策 | 理由 | 轮次 |
|---|---|---|---|
| D1 | 渲染用 three.js，不用 Godot | 同浏览器、npm 生态、CI 可跑、体积可控；Godot 推迟为独立客户端备选 | R1 |
| D2 | 模拟权威在 host，渲染层是哑客户端 | 多端一致、可测、可换引擎 | R1 |
| D3 | 面板是宿主 HTTP 路由吐出的**独立页面**，不塞进宿主 client bundle | 避免与宿主 React/three 版本冲突，Vite HMR 迭代快 | R1 |
| D4 | `tick` 是纯函数 + seeded PRNG | 确定性回放、无 mock 测试 | R1 |
| D5 | 任务按 capability 落位，不硬绑工位 | 布局与编排解耦 | R1 |
| D6 | HUD 用 HTML 覆盖层，3D 只画世界 | 可访问性、可维护性、省事 | R1 |
| D7 | 面板用**纯 three.js**（不引 `@react-three/fiber` / drei） | ① R3F 系库全部**只支持 React 19**（fiber 9.x: `>=19 <19.4`），引它等于把面板绑死在某个 React 大版本上；② §5.2 的分层本来就是「`model/` 出插值状态 → `scene/` 每帧命令式同步」，React 的 diff 在这一层不是价值而是开销；③ 依赖越少，越不容易撞 `postprocessing` 对 three 的 peer 上限（`>=0.168 <0.187`）。HUD 也走原生 DOM | R1 |
| D8 | 角色资产用 **Kenney Mini Characters**（CC0），不用 KayKit | 单角色 247 kB vs KayKit 3.5 MB（后者把 1024 图集与全部剪辑塞进每个 GLB，5 个角色 17.2 MB）—— 我们 ≤24 个同屏，差 14 倍。KayKit 留作"要更好看"时的升级路径 | R1 |
| D9 | **只有 CC0/public domain 的字节可以进 git**；禁止 Mixamo 派生文件、CC-BY 资产、Sketchfab 素材、Quaternius 资产 | Mixamo：Adobe FAQ 只授权"在项目里使用"，**未授权再分发剪辑文件本身**，且中国区/企业账号不可用 ⇒ 不可复现、溯源不可证。CC-BY：不能被 MIT 再许可，需逐文件署名。Quaternius：2026-08-28 起为 QAL v1.0，§3(a) 禁止再分发资产本身（包页仍挂 CC0 徽章，是个陷阱）。依据见 `docs/ASSETS.md` §2/§4 | R1 |
