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
| M1.6-7 | ready | JSON 里的路径安全边界：`ModelEntry.source.url` 现在可以是任意字符串。限制成**包内相对路径**并禁 `http://` 与 `../`。**M4 真正加载 GLB 之前必须落地**，否则就是一个"内容包能指向任意 URL"的口子 | `src/content/validate.ts` 的路径校验 + 测试 | M4-8 之前 |
| M1.6-8 | ready | 边界检查器的**反向盲区**：`moduleOfPath()` 返回 null 的目录被静默跳过，所以"新建模块目录但忘了在规则表登记"不会被发现。加一条检查：`src/` 下每个一级目录都必须在 `BOUNDARY_RULES` 里（或登记为允许忽略） | `test/boundaries.test.js` | M1.6-2 |

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
| M3-1 | ready | 磁盘真相：`world.json` + 事件追加 `events.jsonl`，原子写 | `src/store/worldStore.ts` | M2-3 |
| M3-2 | done | 世界运行时：tick 循环 + 处理 `StepResult.requests` + 事件出口。**依赖写错了**：原表写它依赖 M3-1（落盘），实际不需要——运行时纯内存就能跑，先把世界驱动起来比先落盘有价值得多（R7 修正） | `src/runtime/index.ts` + 测试 | M2-3 |
| M3-3 | done | HTTP：`GET /api/world` 快照 + `POST /api/command` | `src/routes/api.ts` | M3-2 |
| M3-4 | ready | SSE：`GET /api/events`，带单调 `seq`，客户端 gap 自愈。**替换掉面板现在的轮询** | `src/routes/events.ts` + 面板改成 `EventSource` | M3-3 |
| M3-6 | ready | **面板的轮询改成 SSE 之后，删掉轮询分支**；并给面板加一条"连不上时显示上次快照时间"——否则断线看起来像世界卡住 | `web/app.js` | M3-4 |
| M3-5 | done | 面板静态服务 `/agent-world/*`（MIME 白名单 + 路径穿越防护） | `src/panel.ts` | M3-2 |

## M4 — 3D 场景（three.js）（**R9 起卡在断网**：装不上 `three`，也搜不了现成场景）

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M4-1 | blocked | `web/` Vite + **纯 three.js** 脚手架（决策 D7），能渲染空场景 | `web/` + `build:web` 脚本 | M0-1 |
| M4-2 | blocked | 相机：等距正交 + orbit/缩放/平移（配方见 ASSETS.md §6） | `web/src/scene/camera.ts` | M4-1 |
| M4-3 | blocked | 光照与雾：落地 ASSETS.md §6 的配方 + ACES 色调映射 | `web/src/scene/lighting.ts` | M4-1 |
| M4-4 | blocked | **消费 `themes` 库**：相机/光照/雾/后处理全从主题条目读，不许硬编码 | `web/src/scene/theme.ts` | M4-3 |
| M4-5 | blocked | **消费 `skins` 库**：所有颜色走 token 解析（含 `skin.` 前缀） | `web/src/scene/palette.ts` | M4-1 |
| M4-6 | blocked | **消费 `districts` + `stations` 库**：地面与站点几何按内容生成 | `web/src/scene/town.ts` | M4-4 M4-5 |
| M4-7 | blocked | 程序化几何构建器注册表（`avatar`/`desk`/`server`…，对应 `models` 库的 `builder` 字段） | `web/src/scene/builders.ts` | M4-6 |
| M4-8 | blocked | 资源台账：`VENDOR.md` + `THIRD_PARTY_NOTICES.md` + CI 哈希比对脚本 | `web/public/assets/VENDOR.md` `scripts/verify-assets.mjs` | M4-1 |

## M5 — 角色与动画（**内容层可替换性的第一次真实验证**）

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M5-1 | blocked | 角色实体：从 `models` 库取模型（`glb` 或 `procedural`），`SkeletonUtils.clone` | `web/src/actors/avatar.ts` | M4-7 |
| M5-2 | blocked | **消费 `actions` 库**：`AgentState` → 动作条目 → `AnimationMixer` / 程序化动画 | `web/src/actors/animator.ts` | M5-1 |
| M5-3 | blocked | 网格寻路 A*（网格由站点布局生成）。先零依赖手写；不够再评估 `three-pathfinding@1.3.0` / `@recast-navigation@0.43.1` | `web/src/actors/navmesh.ts` + 测试 | M4-6 |
| M5-4 | blocked | 每帧同步：`model/` 的插值状态 → 场景对象（采样 + 插值，不推理业务） | `web/src/model/worldModel.ts` | M5-1 M3-4 |
| M5-5 | blocked | 新增 `pack.kenney-mini`：显式 `overrides` 掉 `models` 与 `actions`，换成 Kenney CC0 资产 | `src/content/packs/kenney-mini.ts` + 资产入库 | M5-2 M4-8 |
| M5-6 | blocked | **验收：加这个包之后 `pnpm test` 仍全绿，且模拟内核零改动** | 在 PROGRESS 里贴出改动范围作证 | M5-5 |

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
| M2.5-1 | ready | **空闲角色全叠在广场（0,0）**。8 个人里有 6 个待命，位置全是出生点——3D 场景里就是 7 个角色穿在同一格里。需要"待命的人自己散开"的行为：要么去休息区（`breakroom` 已有 `rest` 能力，现在没人用），要么在广场周围找个不重叠的落点 | `src/sim/idle.ts` + 测试；`station.breakroom` 才有真实消费者 | M2-5 |
| M2.5-2 | ready | **邮箱没有任何发送方**：跑 700 步，`messages` 是 0 条。投递链路（延迟、飞行动画的数据源）已经建好并有测试，但模拟里没有一处会发消息。最小闭环：claim 时给任务上一个人发 `handoff`，完工时给负责人发 `report` | `src/sim/mailbox.ts` 的调用点（调度器/完工处）+ 测试 | M2-5b |
| M2.5-3 | ready | **`world.tick` 帧事件里只有"有位移的人"**，没有"站位/朝向变了但没位移"的情况。目前够用（到站当 tick 已含在 `advanced` 里），但一旦加"转身看告示板"这类动作就会漏。先记着，别急着改 | —— | M5 之后再看 |

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
