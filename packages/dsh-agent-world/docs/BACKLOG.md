# dsh-agent-world —— 轮次任务队列（BACKLOG）

> **每小时的自动化轮次从这里取任务。**
> 规则：
> 1. 只取最上面依赖已满足的 `ready` 任务；一次轮次取 1–2 个，做完为止，不要贪。
> 2. 有依赖（`depends`）的任务不许提前做，把依赖做完再动。
> 3. 做完把状态改 `done`，并在 `docs/PROGRESS.md` 写清（完成 / 部分完成 / 卡住 + 卡在哪）。
> 4. 每轮**必须**留下可验证的产出：要么代码 + 测试，要么文档 + 决策记录。**不接受"只讨论不落地"**。
> 5. 缺信息不要停下来等人：按最合理的假设推进，把假设写进 PROGRESS 的「假设」一栏。

状态：`ready` 可开工 · `blocked` 等依赖 · `done` 已完成

> **动手前先读对应文档**，不要重新调研：
> - 内容模型 / 怎么加内容 / 怎么换资产 → [`CONTENT.md`](CONTENT.md)
> - 架构与决策记录 → [`ARCHITECTURE.md`](ARCHITECTURE.md)
> - 资产 / 库版本 / 美术配方 → [`ASSETS.md`](ASSETS.md)

---

## M0 — 骨架 ✅

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M0-1 | done | 包骨架 + 分支隔离 + 架构文档 | `package.json` `tsconfig.json` `cordis.patch.yml` `docs/ARCHITECTURE.md` | — |
| M0-2 | done | `src/` 最小可编译闭环：config + 入口 + 工具 | `src/index.ts` `src/config.ts` `src/tools/world.ts` | M0-1 |
| M0-3 | done | `test/` 跑起来 + 冒烟测试 | `test/smoke.test.js` | M0-2 |
| M0-4 | done | 资产/库调研落地成 `ASSETS.md` + 决策 D7/D8/D9 | `docs/ASSETS.md` | M0-3 |

## M1 — 内容库层 ✅

> 这一层是"机制与内容分离"的落地：十个内容库、注册表（提供方链 + 显式覆盖）、内置内容包。

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M1-1 | done | 十个内容库的类型定义 + 库目录 | `src/content/kinds.ts` | M0-1 |
| M1-2 | done | 单包校验：条目形状、枚举、依赖环、lead 数量 | `src/content/validate.ts` + 测试 | M1-1 |
| M1-3 | done | 注册表：提供方链、显式覆盖、拓扑装载、跨包引用校验 | `src/content/registry.ts` + 测试 | M1-2 |
| M1-4 | done | 内置内容包 `pack.default`：4 地块 / 10 站点 / 8 角色 / 2 条工作流 / 皮肤 / 动作 / 主题 | `src/content/packs/default.ts` | M1-3 |
| M1-5 | done | `createWorld` 改成消费内容包；`domain/create.ts` 拆成 `content/instantiate.ts` + `world/create.ts` | 分层：`domain` ← `content` ← `world` | M1-4 |
| M1-6 | done | `CONTENT.md`：十个库规范、包的写法、三种操作、校验规则、常见错误 | `docs/CONTENT.md` | M1-5 |

## M1.5 — 外部内容包

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M1.5-1 | done | 外部内容包加载器：读 `<workspace>/<contentDir>/<packId>/*.json`，解析成 `ContentPack` | `src/content/load-files.ts` + 测试（用临时目录） | M1-5 |
| M1.5-2 | done | 接进 `state.ts`：内置包 + 外部包一起 `loadAll`，问题进 `contentIssues`；`allowImplicitOverride` 接配置 | `src/state.ts` 改造 + 测试 | M1.5-1 |
| M1.5-3 | done | 报错路径友好化：外部包写错时 Issue.where 要带**文件路径**（否则用户不知道去哪个文件改） | `load-files.ts` | M1.5-2 |
| M1.5-4 | done | 工具 `agent_world_content`：列出已装载的包与各库条目、能看某个 id 的提供方链。（**R4 就实现了，R7 才发现这里没标 done**——记账漏了） | `src/tools/world.ts`（并入世界工具集）+ `test/smoke.test.js` | M1.5-2 |
| M1.5-5 | done | 端到端验证：临时 workspace 放一个外部包顶掉小镇布局，`createWorld` 出来的世界确实变了 | `test/external-pack.test.js` | M1.5-2 |
| M1.5-6 | ready | **相对路径的解析基准**：目前相对 `contentDir` 按 `process.cwd()` 解析，不支持"相对当前 session 的 workspace"。`workspaceRegistry` 只有 `list()`/`resolveByPath()`，没有"当前是哪个"的概念，多工作区时任何自动挑选都是猜（猜错的症状是读到别的项目的包）。要做的话得先查清 session→workspace 的绑定从哪拿 | 先写调研结论再动手；建议先把它做成显式配置 `contentRoot` | M1.5-2 |

## M1.6 — 契约层（模块协议）✅

> "模块之间使用协议通信，禁止耦合。"这一层把"协议"落成三样东西：**端口**（进程内）、
> **线协议**（跨进程）、**边界规则**（依赖方向），并用 `test/boundaries.test.js` 读源码强制。

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M1.6-1 | done | 协议版本与兼容判定（单整数、严格相等、破坏性改动必须 bump） | `src/protocol/version.ts` + 测试 | M1-5 |
| M1.6-2 | done | 模块边界规则（数据）+ **强制检查器**：解析每个文件的 import，区分类型/值导入，违规即红 | `src/protocol/boundaries.ts` `test/boundaries.test.js` | M1-5 |
| M1.6-3 | done | 端口：`WorldServicePort`（工具↔状态）、`ContentPort`（工具↔内容）、`EventSinkPort`（sim↔外部） | `src/protocol/ports/*.ts` `src/content/port.ts` | M1.6-2 |
| M1.6-4 | done | 线协议：六种消息 + 命令联合 + JSON codec（换 protobuf 的接缝）+ seq gap 判据 | `src/protocol/wire/*.ts` + 测试 | M1.6-1 |
| M1.6-5 | done | **把工具改成只认端口**：删掉 `tools → state.ts` 的耦合；排版与词汇表上提到契约层（工具与 HUD 共用一份） | `src/tools/world.ts` `src/protocol/format*.ts` | M1.6-3 |
| M1.6-6 | done | `docs/PROTOCOL.md`：三层协议、边界表、加模块/加消息的步骤、为什么现在不做 protobuf | `docs/PROTOCOL.md` | M1.6-5 |

遗留（不阻塞 M2，但别忘）：

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M1.6-7b | ready | **`ActionEntry.clip` 完全没被校验**（任意字符串），而它是引用 GLB 里剪辑名字的字段。**没法静态查**（剪辑名在 GLB 内部），所以只能等 M4 真加载模型时查：加载后发现引用的剪辑不存在 → 报错并**列出该模型实际有的剪辑名**。在那之前它就是个"配错了也不知道"的字段 | M4 加载器 + 校验 | M4 |
| M1.6-7 | done | JSON 里的路径安全边界：`ModelEntry.source.url` 现在可以是任意字符串。限制成**包内相对路径**并禁 `http://` 与 `../`。**M4 真正加载 GLB 之前必须落地**，否则就是一个"内容包能指向任意 URL"的口子 | `src/content/validate.ts` 的路径校验 + 测试 | M4-8 之前 |
| M1.6-9 | done | 边界检查器的**第二个盲区：import 的位置（**根因比"位置"更严重**）**。R11 我把两条 `import type` 写在了接口声明**之间**（合法 ESM，因为 import 会提升），检查器把 `import type { World } from '../../domain/types.js'` 报成了 **`value-import`** —— 也就是说它对"非顶部 import"的分类是不可靠的。修法：解析时先看整条语句是不是 `import type`，别依赖它出现在文件头 | `src/protocol/boundaries.ts` + 测试 | M1.6-8 |
| M1.6-10 | done | 边界表里的**幽灵模块**：R14 加"每个 `src/` 一级目录都必须登记"的反向检查时，立刻查出 `panel` 是**过期条目**（面板早并进 `routes/panel.ts`，规则还留着，app 的 `mayImport` 里也还列着它）。已删除；计划中的 `bridge` 与不在 `src/` 下的 `web` 写进测试的 `planned` 表并注明理由 | `src/protocol/boundaries.ts` + `test/boundaries.test.js` | M1.6-8 |
| M1.6-8 | done | 边界检查器的**反向盲区**：`moduleOfPath()` 返回 null 的目录被静默跳过，所以"新建模块目录但忘了在规则表登记"不会被发现。加一条检查：`src/` 下每个一级目录都必须在 `BOUNDARY_RULES` 里（或登记为允许忽略） | `test/boundaries.test.js` | M1.6-2 |

## M2 — 模拟内核（**技术上最硬的一块**）

> **构建顺序修正（R5）**：原表把 `step.ts` 排在叶子模块前面，但 `step` 只是把叶子串起来。
> 正确的顺序是**先做叶子、再做编排**——每做完一个叶子就能单独测，最后 `step` 只是接线。

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M2-1 | done | 依赖求值：`blockedBy` 全 done ⇒ `pending→ready`（**唯一实现点**） | `src/sim/ready.ts` + 测试 | M1-5 |
| M2-2 | done | 命令类型（`pause`/`resume`/`reset`/`dispatch`/`hire`/`setSpeed`）——**已在 M1.6-4 落到协议层**，不再单独造一份 | `src/protocol/wire/commands.ts` | M1.6-4 |
| M2-4 | done | 调度器：idle agent 原子 claim 一个 ready task，按 `requires` 的 capability 选站（能力**包含**而非有交集），容量把"正在过去的"也算上 | `src/sim/scheduler.ts` + 测试 | M2-1 |
| M2-5 | done | 移动：沿调度器给的路径走向站点，到站切 working；自称 walking 却无目标要**就地修好并报出**（不留静默卡死） | `src/sim/movement.ts` + 测试 | M2-4 |
| M2-5b | done | 干活推进：进度按内容库的 `estimateTicks` 走；完工**释放站点**（否则高峰期死锁）；状态自相矛盾时放回 idle | `src/sim/interaction.ts` + 测试 | M2-5 |
| M2-6 | done | 邮箱：消息投递 + 投递状态（驱动"纸条飞行"动画） | `src/sim/mailbox.ts` + 测试 | M2-5b |
| M2-7 | done | 事件产出：把各段返回的 outcome 压成 delta event，`seq` 单调，环形缓冲截断 | `src/sim/journal.ts` `src/sim/emit.ts` + 测试 | M2-5b |
| M2-3 | done | `step(world, commands)` 纯函数：ingest→scheduler→movement→interaction→mailbox→emit。**定了事件量策略**（帧事件每 tick 最多一条、进度只在 10% 里程碑、stalled 不发事件）；**不收 `dt`**（定步长，决策 D20）；需要内容的命令转交编排层 | `src/sim/step.ts` `src/sim/emit.ts` `src/sim/journal.ts` + 测试 | M2-6 M2-7 |
| M2-8 | done | **确定性验收**：同 seed 跑 1000 tick，两次结果逐字节一致 | `test/determinism.test.js` | M2-3 |
| M2-9 | done | `agent_world_dispatch`：用**任务库**派一条工作流进世界（第一次真正消费任务库） | `src/tools/dispatch.ts` + 测试 | M2-3 |

> **R7 起世界会自己动了**：runtime 每 `tickMs`（默认 100ms）推一步，插件加载后自动开始
> （`autoStart` 决定是否自动开始；世界总是先建出来）。热重载时由 `ctx.effect` 清理定时器。
>
> 剩下的 M3 是**落盘与对外接口**：`world.json` / `events.jsonl`、HTTP 快照、SSE 事件流。
> 在那之前世界只活在内存里——进程重启就归零。

> **R10 更新：网络仍然全断**（`api.github.com` / `registry.npmjs.org` / `example.com` 全返回 000）。
> 所以「搜 GitHub 现成场景」这条路**仍然走不了**，M4 继续卡着。详见 PROGRESS.md 的 R10。
>
> **R9 的现实约束（必须知道，别误判进度）**：本机**完全没有外网**——
> `web_search` 的端点配错了（401），shell 直连 TLS 失败（`SSL_ERROR_SYSCALL`），
> npm registry 也不通，浏览器是 `ERR_CONNECTION_CLOSED`。所以**没法搜 GitHub**，
> `three` 也装不上（pnpm store 里没有它的 metadata）。
> 因此 M4 目前**卡在网络**，而 M4-0（场景描述层）刻意做成不依赖 three.js 的纯函数——
> 断网也能做完、能验，且不管最后找到哪个现成场景都不会返工。

## M4 前置 — 场景描述层（R9 已完成，因为它是"用现成场景"的前提）

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M4-0 | done | **场景描述层**：把世界翻译成与渲染器无关的"要摆什么"（`ScenePlan`），颜色解析完、主题映射完 | `src/scene/plan.ts` + `src/protocol/{scene,theme}.ts` + 测试 | M2-3 M3-3 |

> **动手做 M4 之前先读 `docs/REFERENCES.md`**：断网期间已把**本机**可借鉴的参考实现
> 整理成地图（难点 → 具体文件 → 已核实到什么），并标出**本地没有、仍需 GitHub** 的三块
> （骨骼动画 / SDF 文字 / 后处理）。别重新调研。

### 关于"用 GitHub 现成的游戏场景"：两条硬标准与一个张力

联网之后要按下面这两条筛，缺一条就不用考虑：

1. **许可证必须宽松**（MIT / Apache-2.0 / CC0）。GPL 的不能进这个仓库；
   只给"个人学习使用"的更不行——那等于给用户埋雷。
2. **必须能被喂数据，而不是自带烘死的布局**。我们的布局来自内容库
   （`districts` / `stations` / `scenes`），直接搬一个村子的场景图过来，
   要么把内容硬套到它的节点名上（脆得可怕，改一次内容就要改代码——
   直接违反"改内容不用改代码"这条红线），要么只借它的美术风格。

所以现实可行的"用现成场景"有三种，按性价比排：

| 方式 | 拿什么 | 风险 |
|---|---|---|
| **A. 借相机/光照/后期配方**（最推荐） | 它的 `OrbitControls` 配置、光照参数、tone mapping、雾——我们已经把主题做成了内容（`themes` 库），可直接照抄成一组主题条目 | 极低。抄的是参数，不是代码 |
| **B. 借资产 + 实例化** | Kenney 等 CC0 模型（R1 已核验，`ASSETS.md`），我们按 `ScenePlan` 自己摆 | 低。要写摆放逻辑 |
| **C. 整个场景图搬过来** | 它的地形/建筑/贴图 | **高**。除非它本身就是程序化+数据驱动的，否则会和内容库打架 |

**判据一句话**：它是不是"给什么数据就摆什么"？是 → 能用；不是 → 只能借风格与资产。

## M3 — 落盘与 HTTP/SSE

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M3-1 | done | 磁盘真相：`world.json` + 事件追加 `events.jsonl`，原子写 | `src/store/worldStore.ts` | M2-3 |
| M3-2 | done | 世界运行时：tick 循环 + 处理 `StepResult.requests` + 事件出口。**依赖写错了**：原表写它依赖 M3-1（落盘），实际不需要——运行时纯内存就能跑，先把世界驱动起来比先落盘有价值得多（R7 修正） | `src/runtime/index.ts` + 测试 | M2-3 |
| M3-3 | done | HTTP：`GET /api/world` 快照 + `POST /api/command` | `src/routes/api.ts` | M3-2 |
| M3-1b | ready | **`events.jsonl` 无上限增长**。现在只增不删：跑一整天就是几万行（每行一个事件）。需要一个轮转/压缩策略（按大小切分 + 保留 N 份，或定期把旧事件压成"里程碑摘要"）。**先记着不动**：还没有长跑的真实场景，而错误的分片策略比不分片更难改 | `src/store/worldStore.ts` + 决策记录 | M3-1 |
| M3-1c | done | 关停路径的**同步刷盘**：`stop()` 里 `await` 出去的写在进程退出时可能跑不完，改用 `saveWorldSync`/`appendEventsSync`（fd + fsyncSync + renameSync） | `src/store/worldStore.ts`、`src/runtime/index.ts` | M3-1 |
| M3-1d | ready | **`stateDir` 的相对基准**：目前按 `process.cwd()` 解析（与 `contentDir` 同源问题，见 M1.5-6）。配置注释写的是 `<session workspace>/<stateDir>/`，但 workspace 拿不到。**多工作区时任何自动挑选都是猜，猜错的症状是"存档写到别的项目里去了"** | 与 M1.5-6 合并处理 | M1.5-6 |
| M3-4 | done | SSE：`GET /api/events`，带单调 `seq`，客户端 gap 自愈。**替换掉面板现在的轮询** | `src/routes/events.ts` + 面板改成 `EventSource` | M3-3 |
| M3-6b | ready | **面板的渲染节流不能依赖 `requestAnimationFrame`**（R13 踩到并已改）。rAF 在**不可见的标签页里不触发**，而这个面板的典型场景就是"agent 在跑、人不一定在看"——第一版用 rAF 时页面在后台会一直停在"连接中…"，而手动 fetch 与 EventSource 都完全正常。已改成时间戳节流。**记着这条**：将来 3D 场景若用 rAF 主循环，要么接受"后台不渲染"，要么用 `document.visibilityState` 显式决定——别让它变成"看不出是设计还是 bug" | —— | M4 |
| M3-7 | done | **面板的 `gap` 判定只用 seq 连续性**：`first.seq > lastSeq + 1` 就重拉快照。但服务端**重开一局**（reset）之后 seq 会从头开始，此时 `first.seq` 远小于 `lastSeq`，条件不成立，客户端会继续往旧世界上叠新事件。要在重连路径上补一条"seq 倒退也要重拉"。**R13 当场发现当场修了**：抽成纯函数 `decideOnBatch()` 并有测试 | `web/world-update.js` + `test/world-update.test.js` | M3-6 |
| M3-4b | ready | **真实 socket 上的背压路径没有端到端测试**。慢客户端分支（`res.write` 返回 false → 断开）现在是用假 res 打进分支的——逻辑验到了，但"真的把 socket 灌满之后确实返回 false"这条没验。要端到端得让服务器 socket 的 `highWaterMark` 很小，或用不读的客户端灌数据；已记着，别当成已验 | `test/sse.test.js` | M3-4 |
| M3-6 | done | **面板的轮询改成 SSE（服务端已就绪）**（R10 已补上 fetch 超时与「数据已过期 N 秒」提示，断线不再表现为「世界卡住」）；并给面板加一条"连不上时显示上次快照时间"——否则断线看起来像世界卡住 | `web/app.js` | M3-4 |
| M3-5 | done | 面板静态服务 `/agent-world/*`（MIME 白名单 + 路径穿越防护） | `src/panel.ts` | M3-2 |

## M4 — 3D 场景（three.js）（**R9 起卡在断网**：装不上 `three`，也搜不了现成场景）

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M4-1 | done | `web/` **原生 ESM 脚手架**，能渲染空场景。**实际没上 Vite**：three 用 vendored 的那份 + 一张 import map 直接引，少一层构建就少一处"源码与产物不一致"（见决策 D30，理由与代价都写在那里） | `web/scene3d.js` · `web/index.html` | 
| M4-1b | done | **3D 视图的第一帧**：等距正交相机 + 光照/雾 + 地块/站点/角色 + 视图切换（`web/scene3d.js`）。输入只有 `ScenePlan` + 实时 `world`，所以它**完全不吃内容库知识**——这正是 D23 那层缝的用处。**注意**：站点是方块、角色是胶囊，都是**占位几何**；真正的形状由 `models` 库驱动，那是 M4-7 | `web/scene3d.js` | M4-0 |
| M4-2 | done | 相机：等距正交 + orbit/缩放/平移（配方见 ASSETS.md §6） | `web/src/scene/camera.ts` | M4-1 |
| M4-3 | done | 光照与雾：落地 ASSETS.md §6 的配方 + ACES 色调映射 | `web/src/scene/lighting.ts` | M4-1 |
| M4-4 | done | **消费 `themes` 库**：相机/光照/雾/后处理全从主题条目读，不许硬编码 | `web/src/scene/theme.ts` | M4-3 |
| M4-5 | done | **消费 `skins` 库**：所有颜色走 token 解析（含 `skin.` 前缀） | `web/src/scene/palette.ts` | M4-1 |
| M4-6 | done | **消费 `districts` + `stations` 库**：地面与站点几何按内容生成 | `web/src/scene/town.ts` | M4-4 M4-5 |
| M4-7 | done | 程序化几何构建器注册表（`avatar`/`desk`/`server`…，对应 `models` 库的 `builder` 字段） | `web/src/scene/builders.ts` | M4-6 |
| M4-10 | blocked | **发丝等距作为第二种视图**（可选）：用 `ai-iso-skill` 那套平面基矩阵手法，写一个**消费同一份 `ScenePlan`** 的渲染器，与现在的网格渲染器并列切换。这是决策 D23 那层缝的第二次兑现，但**它是一条美术方向的岔路，需要用户拍板** | `web/` 新渲染器 + `web/index.html` 的视图切换 | 用户拍板 |
| M4-12 | ready | **3D 重建时贴图泄漏**（R32 量到确切速率）：**每重建一次 +16 纹理**，而几何/绘制/三角形不变（22/46/7,634）。干净实验：34 → 50 → 66。怀疑 `model-loader.clear()` 只清 Map 不 dispose 贴图，且重建时模型被重新 clone、clone 的材质各自持引用。先确认 16 = 8 角色 × 2 还是别的组合 | `web/scene/{scene3d,model-loader}.js` + 测试 | —— | **判据：重建 3 次后纹理不再增长** |
| M4-11 | ready | **站点组合道具**：一个站点现在只能声明一个模型（`SceneProp.modelId` 是单数），所以"书桌 + 椅子 + 显示器"摆不出来——视觉核对明确指出"没有椅子，人像坐在空气里"。R20 已 vendor 31 个 Kenney 家具文件，其中 **25 个还没有消费者**。倾向做成内容侧的组合（`StationEntry.models: string[]`）——"这张桌子上有没有显示器"是内容决策，不是渲染器决策；单个模型的局部偏移也进内容（"显示器摆在桌面上"），而"摆正/贴地"留在机制（`recenterOnGround`） | `src/content/kinds.ts` + `src/scene/plan.ts` + `packs/kenney-furniture.ts` + `web/scene3d.js` | R20 |
| M4-9 | ready | **换掉 vendored 的 three（0.167.1 → 0.186.1）+ 引入 `postprocessing`** → 接上 bloom。主题里的 `post.bloom.enabled` 从 R10 就留好了却一直没人接——0.167.1 差一个 minor 进不去 peer 范围。**现在联网了，这是纯替换**：换 `src/vendor/` 三个文件 + 更新 sha256 + 新增一个 vendored 依赖（Zlib，见 `src/vendor/README.md` 的许可记录约定） | `src/vendor/` + `web/scene3d.js` 的 `applyPost` | R17 | **R18 实测后暂停**：主题里 `post.bloom.enabled: false`（当前就是暖色纸感等距，bloom 是关着的），而升级 three 要 +2.2MB（0.186 起 `three.module.js` 与 `three.core.js` 分成两个文件、且没有 min 版）。为一个**关着的开关**付这个代价不划算。**哪天主题要开 bloom，这条就是前提**——代价已经量过了 |
| M4-7b | ready | **`SceneModel.url`（GLB 分支）没被消费**：内容里写 `kind: 'glb'` 的模型，渲染器现在会报「（GLB）xxx」并把位置画成品红块——**诚实**，但还没实现。依赖 M5（要联网拿 `pack.kenney-mini`）与 M1.6-7 已就绪的路径校验 | `web/scene3d.js` + `web/builders.js` | M5 |
| M4-8 | done | 资源台账：**按仓库实际约定**落在 `src/vendor/README.md`（版本 / 来源 / sha256 / 许可 / 换版本步骤 / 为什么钉 0.167.1），加穷举白名单路由 + `test/vendor.test.js` 双向核对（目录↔白名单、import map↔白名单）。**更正**：这条原计划写 `VENDOR.md` + `THIRD_PARTY_NOTICES.md`，但本仓库没有这两个文件，`docs/DIRECTORY.md` 的约定就是 `src/vendor/README.md`——按既有约定走，不自己发明一套 | `src/vendor/README.md` · `src/routes/vendor.ts` · `test/vendor.test.js` | 

## M5 — 角色与动画（**内容层可替换性的第一次真实验证**）

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M5-1 | done | 角色实体：从 `models` 库取模型（`glb` 或 `procedural`），`SkeletonUtils.clone` | `web/model-loader.js` + `web/scene3d.js` | M4-7 | **R19 做完了**：异步加载（去重 / 失败记忆 / 到货时检查占位块还在不在）+ `SkeletonUtils.clone()` + 每实例克隆材质。目录写在计划里（`web/src/actors/`）是 D30 之前的设想，实际落在 `web/`。
| M5-2 | ready | **消费 `actions` 库**：`AgentState` → 动作条目 → `AnimationMixer` / 程序化动画 | `web/src/actors/animator.ts` | M5-1 | **R19 起可做**：`scene3d.js` 已把 GLB 的 `animations: 32` 挂在 `real.userData.animations` 上，就等这一步。**第一件事是 dump 出 GLB 里真实的 32 个剪辑名**——凭印象写内容会在加载时静默对不上。
| M5-3 | blocked | 网格寻路 A*（网格由站点布局生成）。先零依赖手写；不够再评估 `three-pathfinding@1.3.0` / `@recast-navigation@0.43.1` | `web/src/actors/navmesh.ts` + 测试 | M4-6 |
| M5-4 | blocked | 每帧同步：`model/` 的插值状态 → 场景对象（采样 + 插值，不推理业务） | `web/src/model/worldModel.ts` | M5-1 M3-4 |
| M5-5 | done | 新增 `pack.kenney-mini`：显式 `overrides` 掉 `models` 与 `actions`，换成 Kenney CC0 资产 | `src/content/packs/kenney-mini.ts` + 资产入库 | M5-2 M4-8 | **R19 做完了 `models` 那一半**（`overrides: ['models/model.agent.base']` → Kenney GLB）。`actions` 那一半留给 M5-2（要等剪辑名 dump 出来）。
| M5-6 | done | **验收：加这个包之后 `pnpm test` 仍全绿，且模拟内核零改动** | 在 PROGRESS 里贴出改动范围作证 | M5-5 | **R19 验收通过**：`test` 286/286 绿；diff 证明 `src/sim/`、`src/domain/`、`src/world/`、`src/scene/`、`src/protocol/`、`src/routes/` **全部零改动**（改的是 `web/` 三个文件 + 内容包 + 测试）。渲染器改了，但那是**新机制**（GLB 加载以前不存在），不是"因为换了资产所以改了"。
| M5-7 | ready | **让 8 个 agent 长得不一样**：12 个 Kenney 角色都入库了，但现在全部用同一个 `model.agent.base`（看起来像复制粘贴）。需要一个「角色模型列表 + 按序分配」的内容概念（例如 `SceneEntry.agentModels: string[]`，host 按 agent 序号分配并写进 `SceneActor.modelId`）。**故意没混进 R19**：那一轮的目标是「GLB 能跑起来」，不是顺手加一个内容概念 | `src/content/kinds.ts` + `src/scene/plan.ts` + `packs/kenney-mini.ts` | R19 |
| M6-0 | **done** | **查清「怎么把用户消息送进 DSH Agent 并收回复」**（整条 M6 的阻塞点）。用 `cordis_inspect_query` 查，原始证据进 `docs/BRIDGE-RECON.md` | `docs/BRIDGE-RECON.md` + `docs/GOAL.md` 第三节 | —— | owner: `bridge`（task-1）
| M6-1 | **done** | 角色 ↔ DSH 会话绑定：懒创建（同角色复用）+ 并发上限 + dispose + `seed` 注入 system prompt | `src/bridge/` + node 测试 | M6-0 | owner: `bridge`（task-1）
| M6-10 | **done** | **U1/U2 真机验证**（G2 的门槛）：`MessageBase` 是否强制 `id`、seed 的 `seq` 是否要自洽——只能在**真宿主**上验，需要把插件装进一个 profile。**这是唯一需要用户点头的动作**（会注册路由与工具，影响他当前会话）。若 seed 被拒，「跟小人物说话」会在最后一寸失败 | 真机验证记录 | M6-2 | ⚠️ 等用户点头 |
| M6-11 | **用户待办**（不再挡路） | **等用户环境**：① web profile 的 `@roarpeng/graphflow@1.20.0` 写退休 source 形状，所有新会话第一步失败 → 升到 2.x；② web profile 默认路由 `deepseek-official` 的 key 失效 → 重填或换路由。两件都做完再跑一次真机对话 | 用户 | M6-10 | 不在我们的代码里 |
| M6-12 | ready | **`seed.ts` 去留**（R33）：人设已改走 agent 作用域的 section，生产代码不再调用 seed。R30 在 seed 形状上付的学费（消息 id / turn-step 闭合框 / seq）只对 M6-6「把上一局对话回放进新会话」有用。决定：删，或标明只服务 M6-6 | `src/bridge/seed.ts` + 测试 | —— | 别让它悄悄变成死代码 |
| M6-9 | ready | **flaky 测试普查**（R27 发现）：`test/store.test.js` 用固定 `setTimeout(20)` 当同步手段，在载荷下会假红。已修那一处，但**同类写法可能还有**（`grep -n 'setTimeout(' test/`）。flaky 比失败更糟：它让「绿」不可信，而绿是验收纪律的基础 | `test/**` | —— | 一行 grep 就能普查 |
| M6-2 | **done** | 人设驱动 system prompt（R27 内容侧 + R28 宿主侧）。`seatForAgent` 按**序号优先 + 名字交叉校验**，同名歧义返回 undefined 让上层报原因。**哨兵测试**防 id 规则变动导致人设静默错位。**判据「改花名册 → prompt 跟着变、代码零改动」由真实内容的装配测试证明** | —— | ✅ R28 | —— |
| M6-3 | **done**（传输段）| 对话通道：`POST /api/say` → Agent → 回复进 SSE → 面板气泡 | `src/routes/` + `src/bridge/` + `web/` | M6-1 | **关键路径**
| M6-4 | ready | **让角色干活**：Agent 调世界工具产生**可见变化**（任务板出现该单 + 角色走向工位）。这一整套设计的意义所在 | `src/tools/` + 集成测试 | M6-3 | 判据：「对话通过工具改变了世界」，不是「画面变了」
| M6-5 | **done** | 对话 UI（3D 头顶气泡 + 侧栏对话面板）+ 对话状态机（纯函数、可 node 测） | `web/` + `test/dialogue-state.test.js` | 契约已冻结 | owner: `panel`（task-2）
| M6-6 | ready | 对话落库与回放（进现有事件日志，重开一局能读到上一局的对话） | `src/store/` + 测试 | M6-3 | ——
| M6-7 | ready | **对话面板打磨**（R24 视觉核对发现）：① **同一段错误显示了两遍**——既作为一条消息、又作为一个橙色提示块；应该只留一处（消息流里那条，橙色块只在"输入被拒"时出现）。② 错误文案直接暴露 `POST ./api/say`、`HTTP 404` 这类实现细节，对非开发者读者像 debug 日志；**改成"宿主还没有对话端点"这类人话，"技术细节"折叠在可展开里** | `web/dialogue-ui.js` + `styles` | M6-5 | 不是 bug，是"能不能给人用" |
| M6-8 | ready | **验一次角色的动态位移**：2D 俯视图的角色位置原本从不更新（R24 由 panel 修成 `liveActors()`），但当前服务器上 8 人**全是"待命 @ 广场"没有位移**，所以只做了代码层面的一致性核对，**没有肉眼验过移动中的角色**。要造一个"有人在走"的局面再看一眼 | 验证记录 | M6-5 | 面板队友主动交出来的未验项 |
| M7-0 | ready | **`web/` 迁到 TS**（看板要算最长前置链一类逻辑，手写 JS 无类型会持续付代价；这笔债记了 11 轮）。先只迁新代码 + 类型声明，不追求一次全迁 | `web/` + `tsconfig` | —— | P2 前置
| M7-1 | **done** | 看板骨架（R29）| —— | ✅ | —— |
| M7-2 | **done** | 依赖图布局纯函数（R29，19 例）| —— | ✅ | —— |
| M7-8 | ready | **增量要带 `blockedBy`/`requires`**：`web/world-update.js` 的 `task.changed` 把新任务建成 `blockedBy: []`，所以**快照之后新建的任务画不出依赖边、也没有 review 虚线框**。真修在 `src/sim/patches.ts` | `src/sim/patches.ts` + `web/world-update.js` + 测试 | M7-1 | panel 报的，不在它范围 |
| M7-9 | **done** | 看板裁剪 + 响应式（R31，panel）：1280/1024/800 下 `clipped()` 全空；检查判据改为「元素 vs 容器∩视口」 | —— | ✅ | 极端数据下的滚动兜底未验 |
| M7-10 | ready | 六态中文标签在 `board.js` 与 `app.js` 里是两份 → 合并成共享模块（M7-7 搬侧栏 tab 时一起做） | `web/` | M7-7 | panel 报的债 |
| M8-0 | ready | **台账归档**（R32 起）：`PROGRESS.md` 已 236KB/32 轮。把 R1–R27 搬进 `docs/PROGRESS-ARCHIVE.md`，`PROGRESS.md` 只留最近窗口 + 环境备忘。**规矩是不删历史**，所以是搬移；搬完要能 grep 到旧轮次 | `docs/PROGRESS*.md` | —— | 纯搬移，值得单独一轮单独验 |
| M7-2 | ready | **依赖图布局（纯函数）**：输入任务表 → 输出列号（=最长前置链）+ 连线端点；可单测 | `web/board-layout.js` + 测试 | M7-1 | **唯一有算法含量、且可并行**
| M7-3 | ready | 详情栏 + **与 3D 双向高亮**（点方框 → 场景里工位/角色发亮） | `web/board.js` + `web/scene3d.js` | M7-1 | 看板存在的最大理由
| M7-4 | ready | 顶部进度条（`done/failed/ready/pending` 分段），数字与 `/api/world` 一致 | `web/board.js` | M7-1 | ——
| M7-5 | ready | 实时：事件流驱动看板（**不许轮询**） | `web/board.js` | M7-2 | ——
| M7-6 | ready | **`goal` 概念**：内容库 `goals` + `world.goalId` + 顶部显示；goal 是**派生视图**（进度=所辖任务汇总，不许自己一套状态机） | `src/content/` + `web/board.js` | M7-4 | 唯一的内容 schema 变更
| M7-7 | ready | 看板挂到 **DSH 右侧栏 tab**（抄 `dsh-spellbook` 的挂法）；与页面内看板**共用同一份渲染代码** | 新 client 目录 | M7-3 | 第二步
| M8-1 | ready | **同站对话**：规则决定谁/何时/几轮（`sim/` 触发），内容由两个 DSH Agent 轮流生成 | `src/sim/` + `src/bridge/` + 测试 | M6-3 | **谁跟谁说话由规则定，说什么由 LLM 定**
| M8-2 | ready | 对话有界：轮数上限 + 成本上限（**只有已唤醒的角色参与自动对话**，否则会互相叫醒） | `src/bridge/` + 测试 | M8-1 | 开工前必须先量 Agent 成本
| M8-3 | ready | 对话能产出后果（一方调世界工具 → 世界真的变） | `src/tools/` + 测试 | M8-1 + M6-4 | ——
| M8-4 | ready | 主动发起对话（工具 `agent_world_talk_to(agentId)`） | `src/tools/` | M8-3 | ——

## M6 — HUD

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M6-1 | blocked | 任务板：工单列表 + 状态色 + **依赖连线**（按 `set` 分组） | `web/src/ui/taskBoard.ts` | M3-4 |
| M6-2 | blocked | 花名册：谁在哪、在干什么、用什么模型 | `web/src/ui/roster.ts` | M3-4 |
| M6-3 | blocked | 事件时间线 | `web/src/ui/timeline.ts` | M3-4 |
| M6-4 | blocked | 控制条：pause / resume / reset / speed | `web/src/ui/controls.ts` | M3-3 |
| M6-5 | blocked | 面板入口落位（右侧栏常驻 vs 新 view tab）—— 待决问题 1，此轮决定并记录 | 决策记录 + 实现 | M6-1 |

## M7 — Bridge：接真实 subagent

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M7-1 | blocked | Bridge 单一映射表落地（ARCHITECTURE §8） | `src/bridge/mapping.ts` `src/bridge/observe.ts` | M2-3 |
| M7-2 | blocked | `agent_world_hire` / `agent_world_report` 工具 | `src/tools/*.ts` | M7-1 |
| M7-3 | blocked | 端到端：真派一个成员 → 场景里出现角色并干活 | 演示脚本 | M7-2 M5-4 |

## M8 — 打磨

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M8-1 | blocked | 性能降级四级（ARCHITECTURE §5.3） | `web/src/scene/perf.ts` | M5-4 |
| M8-2 | blocked | 音效（CC0）+ bloom 后处理（可关）；**消费 `sounds` 库** | `web/src/audio/` + `sounds` 条目 | M8-1 |
| M8-3 | blocked | 环境/道具资产（Kenney Furniture Kit / City Kit / Nature Kit）并登记台账 | `web/public/assets/` + VENDOR.md | M5-5 |
| M8-4 | blocked | 第二个主题包（换个美术方向，验证 `themes` 库真的可切） | `src/content/packs/theme-*.ts` | M4-4 |

## M2.5 — 从真实输出里发现的模拟缺口（R7 预览时看到）

> 跑 700 步、把世界画成俯视图之后发现的。**不是设计疏漏，是设计没覆盖到的行为细节。**

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M2.5-1 | done | **空闲角色全叠在广场（0,0）**。8 个人里有 6 个待命，位置全是出生点——3D 场景里就是 7 个角色穿在同一格里。需要"待命的人自己散开"的行为：要么去休息区（`breakroom` 已有 `rest` 能力，现在没人用），要么在广场周围找个不重叠的落点 | `src/sim/idle.ts` + 测试；`station.breakroom` 才有真实消费者 | M2-5 |
| M2.5-2 | done | **邮箱没有任何发送方**：跑 700 步，`messages` 是 0 条。投递链路（延迟、飞行动画的数据源）已经建好并有测试，但模拟里没有一处会发消息。最小闭环：claim 时给任务上一个人发 `handoff`，完工时给负责人发 `report` | `src/sim/mailbox.ts` 的调用点（调度器/完工处）+ 测试 | M2-5b |
| M2.5-3 | ready | **`world.tick` 帧事件里只有"有位移的人"**，没有"站位/朝向变了但没位移"的情况。目前够用（到站当 tick 已含在 `advanced` 里），但一旦加"转身看告示板"这类动作就会漏。先记着，别急着改 | —— | M5 之后再看 |

## M2.6 — R10 动手时发现的新活

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M2.6-1 | ready | **消息文案要不要进内容库**。现在正文由内容里的标题拼出来（`任务标题 → 任务标题`），连接符在代码里。按「代码是机制、内容是数据」这条红线，用户可见的文案本该可替换，但为了一张纸条再加第 11 个库值得吗？倾向：等 M6 真的要在面板上显示纸条正文时再定——那时才知道文案需要多少自由度 | 先做决策记录，不动代码 | —— |
| M2.6-2 | ready | **纸张飞行没有「到达」的视觉反馈**。纸条在 `deliverAtTick` 那一刻直接消失。要做像样得在送达时给收件人一个短促高亮，属于 M5 的动作层 | `web/app.js` + `actions` 库 | M5 |
| M2.6-3 | done | 面板没有 fetch 超时：一个挂住的连接会让画面永远冻在最后一帧，而状态栏还写着「运行中」——**看起来就像世界不跑了**。已补 AbortController 超时、超时原因、以及「数据已过期 N 秒」提示 | `web/app.js` | —— |
| M2.6-4 | done | `runtime.diagnostics.ticks` 原本统计「循环转了几圈」而不是「世界前进了几次」，暂停时会持续上涨，表现为「说跑了 600 步、可 tick 才 388」 | `src/runtime/index.ts` + `protocol/ports/runtime.ts` | —— |

## M9 — 发布

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M9-1 | blocked | README / 安装脚本 / 装进 web profile 并验证 | `README.md` `scripts/` | M7-3 |

---

## 待决问题（轮到再说，不要现在卡住）

1. 面板入口放哪：右侧栏常驻（`betterSidebar`）还是新开一个 view tab？→ **M6-5 决定**
2. 一个 workspace 是否允许多个世界并存？（当前假设：一个活跃世界 + 历史归档）
3. 角色数上限多少才既好看又不掉帧？（当前假设 24，M5 实测后定）
4. 是否要音效？（默认做，但可关）→ **M8-2**
5. 外部内容包要不要支持"只覆盖一条而不整包"？（当前假设：包是替换单位，不拆条）
