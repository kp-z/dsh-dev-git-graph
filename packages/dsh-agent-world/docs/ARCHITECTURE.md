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
│  │  · content 内容库：装载 / 校验 / 注册表 / 内置包 / 实例化      │  │
│  │  · domain  世界模型（纯数据 + 纯函数，无 IO，不认识内容）      │  │
│  │  · world   装配：createWorld（内容 → World）                  │  │
│  │  · sim     tick / scheduler / movement / mailbox（确定性）     │  │
│  │  · bridge  DSH subagent ⟷ world agent（唯一映射表）            │  │
│  │  · tools   agent_world_*（defineTool，模型可见）               │  │
│  │  · routes  /api/world · /api/events(SSE) · /agent-world/*      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│            ▲ 消费稳定 id（model.* / action.* / skin.* / theme.*）    │
│  ┌─────────┴────────────────────────────────────────────────────┐  │
│  │ 内容包（机制之外的一切，可整包替换/升级/切换）                 │  │
│  │  内置：src/content/packs/*.ts（编译进 lib/，不新增文件）        │  │
│  │  外部：<workspace>/.agent-world/content/<packId>/*.json        │  │
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

### 2.1 内容库层：机制与内容分离

**代码是机制，内容是数据。** 这条在游戏架构里是常识，但工程上最容易失效——
因为往代码里硬编码一个站点坐标总是"更快"。所以这里把它变成有强制力的规则：

| | 代码（机制） | 内容（数据） |
|---|---|---|
| 例子 | "走路要向目标移动"；"工单要等前置完成" | "走路播哪个剪辑"；"这条流水线有哪几张工单" |
| 落位 | `src/domain/` `src/content/registry.ts` `src/world/` `web/src/` | `src/content/packs/` · `<workspace>/.agent-world/content/` |
| 换它要做什么 | 改代码、跑测试 | 换一个内容包，**代码一行不动** |

**十个库**分两层：**语义库**（地块/站点/场景/花名册/任务，权威在 host）与
**表现库**（模型/动作/皮肤/音效/主题，权威在 web）。两层共享同一套 id 契约与同一个注册表实现——
拆成两套机制就会开始漂移。

**解耦的关键一跳是动作库**：模拟层只会说 `AgentState = 'walking'`，至于"walking 播哪个剪辑、
多快、要不要循环"全在动作库里。所以换一套角色包**只改模型库 + 动作库**，模拟内核一行不动。

**"方便替换升级和切换"落到机制上是三件事**（详见 §12 的 D10–D14）：

1. **稳定 id**：代码永远引用 `action.walk`，不引用 `walk.fbx`。
2. **提供方链**：同一个 id 可以有多个包提供实现，当前生效的排在链首。切换 = 改链序，不改调用点。
3. **显式覆盖**：想顶掉别人的条目必须在清单 `overrides` 里写明，否则报冲突。
   理由——"悄悄换掉内容"是最难查的一类问题：世界看起来一切正常，只是某个站点变成了别的东西。

完整规范（十个库的条目形态、包的写法、校验规则、三种操作、常见错误）见
[`CONTENT.md`](CONTENT.md)。

### 2.2 分层依赖方向

```
domain/   世界模型：类型、数值调参、几何、摘要、随机源     ← 不认识"内容"
   ↑
content/  内容库：类型、校验、注册表、内置包、实例化
   ↑
world/    装配：createWorld（内容 → World）+ 后续的 sim/
   ↑
web/      渲染：直接 import domain 拿类型，不复制
```

**依赖单向向上，没有环。** `domain` 不许 import `content`——一旦反过来，
就再也没法单独测"世界模型"这一层了。加新东西时按这个方向放。

### 2.3 模块协议：**只通过契约通信，且由机器强制**

上面那张依赖图只是"方向"，还不够——它没规定 `tools/` 能不能直接 import `state.ts`。
所以在 R4 加了一层**契约层** `src/protocol/`，并把它变成有强制力的规则：

| 层 | 治什么 | 谁强制 |
|---|---|---|
| **端口（port）** `protocol/ports/` | 同进程模块之间的调用面（接口 + 语义 + 类型） | tsc + 边界测试 |
| **线协议（wire）** `protocol/wire/` | host ↔ 浏览器：消息、版本、编解码 | `WireDecodeError` + 测试 |
| **边界规则** `protocol/boundaries.ts` | 谁能 import 谁、谁不许碰什么依赖 | `test/boundaries.test.js`**读源码判定** |

**"禁止耦合"不被检查就只是口号。** 规则写成数据，测试真的去解析每个文件的 import
并逐条判定；违规会打印出模块、违规的 import、以及当初写下的理由。
完整规范见 [`PROTOCOL.md`](PROTOCOL.md)。

三条最关键的禁令：

1. **`sim/` 不许 import `content/`** —— 模拟内核只认**已经装配好的 `World`**。
   一旦它 import 内容库，"换一套内容就得动模拟逻辑"，§2.1 那层就白拆了。
2. **`tools/` 只许 import `protocol/`** —— 工具通过**端口**拿东西。
   改这条之前 `tools/world.ts` 里写着 `import type { PluginState } from '../state.js'`，
   那就是耦合：给工具写单测要伪造整个插件状态。
3. **`web/` 只许 import `protocol/`** —— 宿主机与浏览器之间那道缝只留一条。

**类型导入与值导入分开治理**：`import type` 编译期被完全擦除，不产生运行时依赖，
所以它可以跨过值导入不许跨的线（`protocol/wire/messages.ts` 需要 `World` 这个**类型**，
因为世界的形状本来就是契约的一部分）。这是写完第一版规则后自己踩到的坑——
一刀切禁止会导致连"世界长什么样"都写不进协议。

---

## 3. 世界模型（Domain Model）

> 落位 `src/domain/`，全部是纯数据结构 + 纯函数；**不许出现 `fs` / `http` / `three`**，
> 也**不许 import `content/`**——这一层不认识"内容包"是什么东西，只认识一座已经摆好的小镇。
> 内容 → 世界的翻译只在 `src/content/instantiate.ts` 一处发生（见 §2.2 的分层方向）。

### 3.1 实体

| 实体 | 说明 | 关键字段 |
|---|---|---|
| `World` | 一个世界实例，绑定一个 workspace | `id name seed tick createdAt paused mode origin districts stations agents tasks messages events seq` |
| `WorldOrigin` | **这个世界是由哪些内容装出来的**（场景 id + 内容包 id + 任务集 id） | `scene packs taskSets` —— 没有它就没法"用同样的内容重开一局" |
| `District` | 地段（工程区 / 机房 / 会议区 / 公共区） | `id name kind bounds ground` |
| `Station` | 工位或设施，是任务的落脚点 | `id name kind district anchor capacity capabilities slots` |
| `Agent` | 角色 = 真实 subagent 的投影 | `id name role palette state position facing station targetStation path carrying llm boundAgentId` |
| `Task` | 工单 | `id key set title status owner station requires blockedBy progress attemptId acceptance estimateTicks` |
| `Message` | 邮箱消息（投递动画的来源） | `id from to kind body atTick deliveredAtTick` |
| `WorldEvent` | 事件日志（驱动动画 + 时间线），单调 `seq` | `seq tick type payload` |

> `Task.key` / `Task.set` 是**回指内容库**用的：`set` 说出自哪条工作流，`key` 说在这条流水线里是哪一步。
> 实例化时 `key` 被映射成全局唯一的 `task-<n>`，`dependsOn` 被映射成实例化的 `blockedBy`。
> 这个两段映射只在 `instantiate.ts` 一处做——分开做必然出错。

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
2. **纯函数 tick**：`step(world, commands) -> { world, events, claims, stalled, requests }`，
   world 进、world 出，不碰 IO。（**没有 `dt`**——定步长模拟下一次调用就是前进一 tick，见决策 D20。）
   模拟内核不认识内容库，所以 `reset` / `dispatch` / `hire` 会被放进 `requests` 转交给编排层。
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

> R2 重排过：**内容库层插到了模拟内核之前**，因为它正是模拟的输入。
> 先有可替换的内容，才谈得上"换一座小镇不用改代码"。

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0** ✅ | 骨架：包结构、patch、世界模型类型、工具、`node --test` | `pnpm typecheck` 绿 + 测试全绿 |
| **M1** ✅ | **内容库层**：十个库的类型与校验、注册表（提供方链/显式覆盖）、内置内容包 | 覆盖与切换的机制有测试证明；`CONTENT.md` 定稿 |
| **M1.5** ✅ | 外部内容包：`contentDir` 指过去即生效 | 用户放一个 JSON 目录就能换世界 |
| **M1.6** ✅ | **契约层**：端口 / 线协议 / 边界规则 + 强制检查 | `test/boundaries.test.js` 能抓到人造违规；真实源码零违规 |
| **M2** | 模拟内核：纯函数 tick / 依赖求值 / 调度器 / 移动 / 邮箱 | 同 seed 跑 1000 tick 两次结果逐字节一致 |
| **M3** | 落盘（`world.json`）+ HTTP 快照 + SSE 事件流 | curl 能拿到快照与事件流；gap 能自愈 |
| **M4** | three.js 场景：小镇、站点、相机、光照 | 浏览器里能看到小镇 |
| **M5** | 角色与动画：模型库/动作库开始被真正消费（Kenney CC0 资产） | 角色从 A 走到 B，且**模拟内核零改动** |
| **M6** | HUD：任务板 + 依赖可视 + 花名册 + 时间线 | 能看出"谁在干什么、卡在哪" |
| **M7** | Bridge：接真实 subagent | 真派一个成员，场景里出现角色 |
| **M8** | 打磨：美术 / 音效 / 后处理 / 性能降级 | 60fps 稳定 |
| **M9** | 打包 / 文档 / 发布 | 安装到 web profile 可用 |

---

## 10. 目录结构

```
packages/dsh-agent-world/
├── src/                     host 插件（TS）
│   ├── index.ts             入口：name / inject / apply
│   ├── config.ts            schemastery 配置
│   ├── protocol/            ★ 契约层：端口 / 线协议 / 边界规则（唯一的通信面）
│   │   ├── boundaries.ts    模块边界规则（数据；由测试强制）
│   │   ├── ports/           WorldServicePort / ContentPort / EventSinkPort
│   │   ├── wire/            消息、命令、编解码（换 protobuf 的接缝）
│   │   ├── format.ts        展示词汇表（工具与 HUD 共用，避免同义异形）
│   │   ├── format-text.ts   世界状态的文本排版（工具与 HUD 共用）
│   │   └── library-kinds.ts 库名联合类型（边界类型，不住在内容层）
│   ├── content/             ★ 内容库层（机制之外的一切）
│   │   ├── kinds.ts         十个库的类型定义 + 库目录
│   │   ├── validate.ts      单包自洽校验 + 依赖环检测
│   │   ├── registry.ts      注册表：提供方链 / 显式覆盖 / 跨包引用校验
│   │   ├── instantiate.ts   内容条目 → 世界对象（两层之间唯一的翻译层）
│   │   └── packs/           内置内容包（TS 常量，编译进 lib/）
│   ├── domain/              世界模型（纯逻辑，无 IO，不认识"内容"）
│   ├── world/               装配：createWorld（内容 → World）+ 后续的 sim/
│   ├── sim/                 tick / scheduler / movement / mailbox（M2）
│   ├── store/               落盘（world.json + events.jsonl）（M3）
│   ├── scene/               场景描述层：世界 → ScenePlan（与渲染器无关的"要摆什么"）
│   ├── runtime/             运行时：tick 循环 + 处理转交的请求 + 事件出口
│   ├── tools/               agent_world_*（defineTool）
│   └── routes/              HTTP 传输层
│       ├── router.ts        极小路由表 + JSON 体 + 异常翻状态码
│       ├── api.ts           快照与命令（GET /api/world · POST /api/command）
│       └── panel.ts         静态面板：MIME 白名单 + 路径穿越防护
├── web/                     面板（R8 起是 2D 俯视图；M4 换成 three.js 场景）
│   ├── index.html
│   ├── app.js               canvas 俯视图 + 轮询 /api/world
│   ├── style.css
│   └── public/assets/       M4 的模型贴图 + VENDOR.md
├── scripts/copy-web.mjs     web/ → lib/web/（服务的是 lib 里那份，避开硬链接副本的坑）
├── docs/
│   ├── ARCHITECTURE.md      本文
│   ├── CONTENT.md           内容库规范（十个库 / 包 / 校验 / 三种操作）
│   ├── PROTOCOL.md          模块协议规范（端口 / 线协议 / 边界规则）
│   ├── ASSETS.md            资产、库版本与美术配方
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
| D10 | **代码是机制，内容是数据**：凡可替换的东西一律进内容库（十个库），代码里禁止字面量的资产名/剪辑名/任务文案/配色值 | 游戏架构的常识，但最容易失效——硬编码一个坐标总是"更快"。判据：问自己"这东西会不会有人想换掉" | R2 |
| D11 | 覆盖必须**显式**：想顶掉别人的条目必须在清单 `overrides` 里写明 `kind/id`，否则报冲突且原条目不变 | "悄悄换掉内容"是最难查的一类问题——世界看起来一切正常，只是某个站点变成了别的东西 | R2 |
| D12 | 每个逻辑 id 可有多提供方，形成**回退链**；`resolve(prefer)` 只排序不裁剪 | 资产加载失败要降级而不是崩（GLB 挂了退回程序化几何）。`prefer` 里没提到的提供方跟在后面，保证"优先"永不导致条目丢失 | R2 |
| D13 | 内容分**语义库**（host 权威）与**表现库**（web 权威），但共享同一套 id 契约与同一个注册表实现 | 拆成两套机制就会开始漂移。表现库在 host 侧缺失时相关校验自动跳过（host 可能没装表现库） | R2 |
| D14 | **内置内容包编译进代码**（TS 常量），**外部内容包走文件系统** | 本仓库 `file:` 依赖是硬链接副本，**新增文件不会被同步进 profile**（DEVELOPMENT.md §7）；而插件树加载失败会让整个 dsh 起不来。内置走编译避免踩坑，外部走文件系统保证用户可替换 | R2 |
| D15 | 内容校验只做**引用完整性与声明一致性**，不做类型校验；报错必须给出可用取值 | 类型是 tsc 的活。校验要抓的是 tsc 抓不到、运行时又难定位的错误（站点引用不存在的地块、某状态没有动作、任务依赖成环）。文案是给内容作者看的，"引用无效"四个字帮不了任何人 | R2 |
| D16 | **模块之间只通过 `protocol/` 通信**：端口（进程内）+ 线协议（跨进程）+ 边界规则；**边界由 `test/boundaries.test.js` 读源码强制**，违规即红 | "禁止耦合"不被检查就只是口号。规则写成数据、测试真的去解析 import 逐条判定，才能挡住后来的人（包括未来的我们）顺手 import 一下。三条最关键的：`sim/` 不许 import `content/`、`tools/` 只许 import `protocol/`、`web/` 只许 import `protocol/` | R4 |
| D17 | **现在不做 protobuf**，但把接缝留在 `wire/codec.ts`（业务代码只调 `encode/decode`，不碰 JSON） | ① 进程内模块间是同进程函数调用，套 protobuf 白付编解码开销还**丢掉 tsc 类型检查**，而类型检查才是进程内解耦真正依赖的东西——"禁止耦合"靠边界规则，不靠序列化；② 跨进程 10Hz / ≤24 角色，JSON 的带宽代价测不出来，而 devtools 里能直接读；③ protobuf 要多一套 `.proto` + codegen + 产物入库，而本仓库对"新增文件进 profile"本来就有坑。**换的判据**：单条消息常态 >64KB、事件频率 >100Hz、或出现非 JS 客户端 | R4 |
| D18 | 边界规则**区分类型导入与值导入**（`mayImport` / `mayImportTypes`） | `import type` 编译期完全擦除，不产生运行时依赖。一刀切禁止 `protocol → domain` 会导致连"世界长什么样"都写不进协议——这是写完第一版规则后自己踩到的坑 | R4 |
| D19 | `protocol/` 是浏览器侧**唯一**的 import 入口，它转出渲染需要的 domain 类型 | 多一条缝就多一处会漂移的地方。类型是编译期的，转出它不会让 web 在运行时依赖 domain 的代码 | R4 |
| D20 | `step(world, commands)` **不收 `dt`**；需要内容的命令（`reset`/`dispatch`/`hire`）以 `requests` **转交**给编排层 | ① 这是定步长模拟，一次调用 = 前进一 tick，`dt` 永远等于 `tickMs`；收了却不用它，只会让人以为"传别的值会改变结果"——步长属于编排层。② `sim/` 按 D16 的边界规则不许 import `content/`，而这三个命令都需要内容（场景/任务集/花名册），所以只能转交。这不是权宜之计，是边界规则在起作用；顺带的好处是 `step()` 可以在**没有任何内容注册表**的情况下被测试 | R6 |
| D21 | **先出 2D 俯视图，再换 three.js**；该视图**永久保留**为调试模式 | 世界从 R6 起就是活的，但"看不见"让每一次判断都只能靠读测试输出。而通往可见的零件——HTTP 快照、SSE、静态面板服务、MIME 白名单、穿越防护——**M4 一条也少不了**，所以先做它们不是弯路。俯视图还额外有长期价值：3D 调不出来时，它是唯一能看清模拟对不对的窗口 | R8 |
| D22 | **调色板随快照下发**（`palette` 字段），面板不读内容库 | 面板只许 import 协议层（D16/D19），拿不到 `skins` 库；而地块的 `ground` 是 token 不是色值。两个选择：让面板去读内容库（破坏那条缝），或把 token 解析放在服务端（多一个字段）。后者对——**缝只有一条，token 解析属于服务端的活** | R8 |
| D23 | **场景描述层（`ScenePlan`）独立于渲染器**：世界 → "要摆什么"，颜色与主题在这里解析完 | 用户要"用 GitHub 上现成的游戏场景"，但现成场景都自带烘死的布局，而我们的布局来自内容库。硬接的后果是"改一次内容要改一次代码"——直接踩中本研究的第一条红线。所以先把渲染器的输入定成一份中立描述：现成场景、我们自己的程序化场景、将来的 Godot 客户端，消费的都是同一份。**它还是个纯函数**，所以断网也能做完、能验，且不管最后选中哪个场景都不返工 | R9 |
| D33 | 外部模型（GLB）**异步加载**，配三条硬规矩：**「还没到」与「出错了」用不同颜色**、**失败只报一次且要显式重试**、**到货时先检查它还在不在场景里** | ① 这是本包第一个异步的东西（在那之前场景里一切都是同步造出来的），而异步的三个坑都只在这一层能管：同一个模型会被要很多次（24 个角色共用一个 GLB）→ 去重；`applyWorld` 每帧都在跑 → 失败必须**被记住**，否则一个 404 变成每秒 60 次请求；用户可能已经换过快照 → 到货时那个占位块可能已经不在场景里。② **灰色（在加载）与品红（出错）必须分开**：混成一种颜色的话，「还没到」会被读成「坏了」，而「坏了」会被等成「还没到」。③ 失败原因分两类报：**内容写错**（没有这个构建器/模型）去看内容；**文件没发出去**（加载失败）去看 `src/vendor/` 与白名单——排查动作完全不同，混在一起会让人查错地方 | R19 |
| D32 | vendored 资源**保持上游目录结构**，白名单认**确切相对路径**（不再是单段文件名）；`ModelEntry.source.url` 是**相对本插件资源根**的路径，渲染器按 `./<url>` 解析 | ① three 的 addon 之间靠相对 import 相连（`loaders/GLTFLoader.js` → `../utils/BufferGeometryUtils.js`），**拍平一层那些路径就断了**；而"改 vendored 代码"是我不做的事——改了 sha256 就失去意义，而 sha256 正是"这份代码确实是我核对过的那份"的唯一凭据。② 白名单从"文件名→MIME"的映射改成**路径数组 + 按扩展名给 MIME**：这样"哪些文件能服务"（安全边界）与"以什么类型服务"（协议细节）是两个独立问题。穷举性没有降低——认的是确切路径，**不做任何拼接猜路径**，所以 `..` 与编码斜杠根本匹配不上。③ **无扩展名的文件要当心**：`three/LICENSE` 没有点，`slice(lastIndexOf('.'))` 会切出一个 `"E"`，于是这个白名单文件一被请求就 **500**——这是测试抓到的，不是我看出来的 | R18 |
| D31 | **模型选择是内容**：站点（`StationEntry.model`）与场景（`SceneEntry.agentModel`）各自**声明**用哪个模型条目；渲染器按条目里的 `builder` 名查自己的**构建器注册表**（`web/builders.js`） | ① R16 之前 `scene/plan.ts` 里写的是 `` `model.station.${kind}` ``——**代码拼接出来的 id**，等于把模型清单写进了代码，`models` 库根本没人读。坏得很安静：内容换模型、或某个 kind 的模型另有其名时，代码指向一个不存在的模型，而库里看起来一切正常。② 按 **builder 名**（而不是按 model id）注册构建器是关键：按 id 注册的话，新增一个模型条目仍要改代码来"认领"，等于没改。③ 判据：想让休息区换个样子 → 改内容（换一个已注册的 builder）；想要从没见过的家具 → 那是新机制，写代码并注册。④ **注册表里没有的名字要报出来并画品红占位块**，不静默退回方块——退回的效果是"画面上有个东西但显然不对"，而真正的原因完全看不见 | R16 |
| D30 | 面板**不上打包器**：原生 ESM + 一张 **import map** 直接引 vendored 的 three（不用 Vite/打包） | ① 少一层构建就少一处"源码与产物不一致"的可能；vendored 的 three 就是浏览器要跑的那份文件，**没有转译**。② three 的附加组件写的是裸说明符 `from 'three'`，import map 是浏览器原生的解法，不需要为此引入 bundler。③ 代价：依赖 import map 支持（Chromium 系都有），且 addon 的裸说明符**必须逐个映射**——`test/vendor.test.js` 会核对 import map 指向的文件确实在白名单里（写错一个字符就是 3D 白屏且只报一个 404） | R15 |
| D29 | 离线期的 three 走**仓库约定的 vendoring**（`src/vendor/` → 构建同步 `lib/vendor/` → 白名单路由），**钉在 0.167.1** | ① 本机唯一可用的副本是 0.167.1，而外网连续九次确认全断；选它的**唯一代价**是 `postprocessing` 的 peer（`three >=0.168`）进不去，**暂时没有 bloom**——主题侧的开关已预留，换版本只需换文件、不改场景代码。② 走白名单而**不是**复用静态面板的通配：vendored 是"只该服务这几个确切文件"的地方，白名单应当**穷举**。③ 路由挂在**本插件前缀**下（`/agent-world/vendor/:file`）而非约定的根 `/vendor/:file`：`webServer.register` 对重复 `(kind, path)` **直接抛错**，而 `dsh-contract-butler` 已占了根路径——这是一条**为共存让路**的偏离，不是随手改约定 | R15 |
| D28 | 内容里的资产地址**只允许包内相对路径**（`models[].source.url` / `sounds[].url`），并为此写一个**专门的**校验函数，不复用 `checkId` | ① `checkId` 的语义只是"非空字符串"——它是给 **id** 写的最小检查。被复用到路径字段上时名字看着对（都叫"校验一个字段"），**保护却是零**：`http://evil.example/x.glb` 与 `../../../../etc/passwd` 都能过。教训是"最小检查"不能跨语义复用。② 拒绝的是：URL 协议（含 `data:`、`file:`、Windows 盘符）、绝对路径、`~`、反斜杠（换平台会读到另一个文件）、`..` 上跳、空路径段、无扩展名。③ 报错要给**允许的形状 + 一个例子**——只说"地址无效"帮不了任何人 | R14 |
| D27 | 增量推送下的**两类量分开对待**：**离散量逐条下发**（状态、工单、消息），**连续量采样下发**（位置每帧只有位移的人、进度只在里程碑）。事件的载荷必须**带齐客户端显示所需的字段** | ① 事件漏一个字段的症状极难归因：完工事件不带 `station`，客户端就不知道把人从工位上摘掉，画面上他永远坐在那张桌子上——而**全量快照是对的**，所以这个 bug 只在换成增量之后出现，看起来像"渲染层没刷新"。做法是每条事件**并入变更后的当前值**（`sim/patches.ts`），而不是在每个调用点手写要带哪些字段。② 连续量**不能**逐条下发（24 个角色 ≈ 240 条/秒会冲爆缓冲），所以客户端必须知道哪些量是采样的：位置靠逐帧事件是精确的，进度只到里程碑、要自己插值，而**时钟**永远不随变更事件走——它靠 `sync` 心跳校准 + 本地时钟推进 | R13 |
| D26 | SSE 的三条规矩：**`id:` 带 `seq`**（续传靠它）、**慢客户端断开而不是缓冲**、**定期心跳注释** | ① 浏览器断线重连会自动带 `Last-Event-ID`，服务端据此补发——补得了就补，**补不了（已滚出环形缓冲）就发 `reset` 明说**；假装能补的后果是客户端静默丢一段历史。② `res.write` 返回 false 说明内核缓冲满了，继续写就是让内存随一个卡住的浏览器无限增长；断开更好，因为重连会带来一次续传。这也正是广播层的 `publish` 能保持同步的原因（模拟内核不该被 IO 拖住）。③ 世界暂停时没有事件，长连接会被中间层掐掉，所以要有注释帧 | R12 |
| D25 | 落盘用**两个文件两种语义**：`world.json`（快照，原子写） + `events.jsonl`（追加）。快照**不含事件环形缓冲**；关停路径**同步刷盘** | ① 环形缓冲（500 条）是**活客户端的补洞窗口**，不是历史。把它当历史写进快照，历史会在第 501 条事件时开始静默丢失——而"丢了一段"只有在需要它的时候才发现。② 原子写的顺序必须是「写临时文件 → fsync → rename」：直接覆盖时写到一半掉电会留下半截 JSON，把原来那份也毁掉。③ `stop()` 之后进程可能立刻退出，`await` 出去的写不保证跑得完——那正是"最后一段丢了"的成因，所以关停用阻塞式 fsync。④ 文件里**不写墙上时间**，于是"同一个世界存两次逐字节相同"可以被直接断言 | R11 |
| D24 | `ScenePlan` 的**类型住协议层**（`protocol/scene.ts`），**派生逻辑住场景层**（`scene/plan.ts`） | 它要跨进程给浏览器，所以是契约。R9 我一开始把类型写在 `scene/plan.ts` 里，协议层为了声明快照字段不得不 import 场景层——**反向依赖，被边界检查器当场抓住**。判据很好用："谁被跨进程引用，类型就归谁"。同一条也适用于 `skin.` token 的解析器：那个约定本身就是跨边界的，两个实现一定会漂移 | R9 |
