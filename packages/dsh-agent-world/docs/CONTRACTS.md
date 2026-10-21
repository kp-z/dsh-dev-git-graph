# 契约制度（Contracts Charter）· v1

> 用户口径（2026-10-20）："**这里的契约除了动作契约，还有各种其他契约，给我设计一套完整的契约制度。**
> 包括动作、反应等各种各样的契约，只要游戏里面有的，都应该设计进去。
> 需要长远考虑每个 Agent 的设计（等级 / profile / 专属知识库 / 任务集）。
> 最关键的是保证系统的**可扩展性**和**稳定性**。"
>
> 这份文件是**制度**（怎么立契、怎么改、怎么废、怎么验）+ **目录**（现在有哪些契约）。
> 各域细节继续住在原有文档里：线协议 [`PROTOCOL.md`](PROTOCOL.md)、内容库 [`CONTENT.md`](CONTENT.md)、
> 舞台动作 [`STAGE-ACTIONS.md`](STAGE-ACTIONS.md)、Agent 长期模型 [`AGENT-MODEL.md`](AGENT-MODEL.md)。

---

## 零、这份制度治什么

现状盘点：这个仓库**已经在做契约**——`protocol/boundaries.ts` 是模块契约、`wire/` 是线协议、
`content/validate.ts` 是内容契约、`worldStore.WORLD_FILE_VERSION` 是存档契约、
`__agentWorld*` 是调试契约。问题是它们**各自为政**：

| 症状 | 真实后果 |
|---|---|
| 契约只写在注释里，没有登记处 | 加功能时没人知道"这条不许破"，破了也不报错 |
| 失败语义各写各的 | 同一个"宿主没响应"，有的降级、有的白屏、有的静默 |
| 版本规则只在线协议里有 | 存档 / 内容 / 表现三处没有统一规则 |
| 新东西只能改核心 | "扩展"实际上等于"改 sim 或改渲染器"，分层被绕过 |
| 验收靠人眼 | 回归只能等用户发现 |

这份制度要防的**只有三件事**（其他都是手段）：

1. **静默失败**——坏了但看起来正常，是最贵的 bug。
2. **扩展要改核心**——每加一个功能就动 `sim/` 或 `scene-phaser.js`，迟早不敢改。
3. **版本漂移**——两端/新旧存档/新旧内容各说各话，症状出现在离原因很远的地方。

---

## 零点五、怎么用这份制度（五分钟版）

1. **动手前先查目录**（第四节）：找到你要碰的东西对应哪条契约、什么等级。
2. **按等级决定代价**（第二节）：frozen 要新建 id + 迁移；standard 要 bump；extension 随便改。
3. **先写失败语义**（第三节）：这条东西坏了会怎样、谁降级、怎么观测。写不出来就先别写代码。
4. **补一条验收**：测试 / 门面读数 / benchmark，三选一，但必须能跑。
5. **改完更新登记表与本文**（P0 之后由测试强制双向一致）。

加新东西直接跳第七节；要改 Agent 的长期状态看 [`AGENT-MODEL.md`](AGENT-MODEL.md)。

---

## 一、什么算契约（可判定的承诺）

> **契约 = 两方之间关于「形状 / 语义 / 时序 / 错误 / 版本 / 边界」的六项承诺，
> 外加一条可运行的验收。**

六要素（缺一项就不算契约，只能算"注释"）：

| 要素 | 回答什么 | 反例 |
|---|---|---|
| **形状** | 数据长什么样、必填/可选 | 只有一个 TS interface，没有运行时校验 |
| **语义** | 每个字段是什么意思、什么情况下变 | `progress` 是 0..1 还是 0..100？ |
| **时序** | 谁先谁后、什么时候可以读 | 事件先到、快照后到，客户端怎么合 |
| **错误** | 失败长什么样、谁负责降级 | 出错只打一行日志 |
| **版本** | 怎么演进、不匹配怎么办 | 悄悄加字段，旧端读出 undefined |
| **边界** | 谁能调、谁不能调、依赖方向 | web 直接 import 了 sim 的实现 |

**两类契约，交付物不同**（一刀切会把行为契约逼成空壳）：

| 类型 | 例子 | 必须交付 |
|---|---|---|
| **数据契约** | `agent.profile.shape`、`knowledge.entry`、`store.envelope` | **四件套**：形状（类型）+ 校验（validate）+ 迁移（migrate 或明确拒绝）+ 验收（verify） |
| **行为契约** | `world.tick.order`、`stage.channel`、`world.pause` | **三件**：不变量（一句话可判定）+ 验收（可跑的断言）+ 可观测（坏了看得出来） |

数据契约没有"迁移"就要写清"不迁移，拒绝"；行为契约不强行造 shape。
**但所有契约都必须有验收**——没有验收的不许冻结（见第二节）。理由：不能跑的东西，改坏了没人知道。

**契约 id 规范**：`域.对象[.侧面]`，2–3 段，小写，**一旦 frozen 永不复用、永不改名**。

| 域 | 例子 |
|---|---|
| `world` `map` `move` `task` `comms` `dialogue` `team` | `world.tick.order`、`task.status`、`dialogue.turn` |
| `stage` `hud` `ui` | `stage.action.catalog`、`stage.channel`、`ui.dock.layout` |
| `agent` `knowledge` `taskset` | `agent.profile.shape`、`knowledge.retrieve`、`taskset.dispatch` |
| `content` `store` `wire` `bridge` `compat` `obs` | `content.pack.manifest`、`store.envelope`、`wire.event.coverage` |

> ⚠️ **P0 之前先把 id 形状钉死**：现在有 47/68 条是两段 id。登记表一旦落地，frozen id 再改
> 就要走"新建 + 废弃 + 迁移"。这次的修法是显式允许 2 段（域 + 对象），侧面只有真的需要区分时才加。

---

## 二、稳定性分级与版本规则

每一条契约登记时**必须**选一个等级。等级决定了"改它要付什么代价"。

| 等级 | 含义 | 允许的改动 | 破坏性改动的做法 | 谁能依赖 |
|---|---|---|---|---|
| **frozen** | 系统的地基，改了会引起连锁 | 只许加**可选**字段 / 新增取值（消费方必须有默认） | **新建一个契约 id**，旧的标 `deprecated`，写迁移，跑满一个版本再删 | 任何模块 |
| **standard** | 有版本号的正式契约 | 加可选字段、加消息类型、加枚举值 | bump 版本整数（见下），写迁移与验收 | 任何模块 |
| **extension** | 内容包/扩展点提供的实现 | 由提供方自由演进，核心只保证骨架 | 换提供方 / 改 override，不动核心 | 只能被 extension 或 standard 依赖 |
| **experimental** | 还在试的（如知识库） | 随便改 | 不写迁移，直接改；**不许被 frozen/standard 依赖** | 只能被 experimental 依赖 |

### 版本号规则（沿用 `protocol/version.ts` 已经定的，推广到所有域）

- **版本是单个整数**，不做"同 major 就兼容"。消费方只有我们自己两端，宽松匹配的成本大于收益。
- **不 bump**：新增可选字段、新增消息/动作/反应类型、新增枚举取值（消费方必须对未知取值有默认行为）。
- **必须 bump**：删字段、改字段语义、改必填性、收窄枚举取值集合、改时序。
- **不匹配分两种，处理相反**（这是评审抓出来的第一处自相矛盾）：
  - **结构不兼容**（线协议版本、`fileVersion`、场景 id、形状）：**在入口拒绝**，
    不进入半可用；`protocol-mismatch` / `fileVersion` 不认都走这条。
  - **内容版本不同**（存档用的内容包 vs 当前装载）：**采纳 + 重算 + 警告 + 计数**，
    见 `content.compat`。理由：内容升级本来就该改变表现，拒绝等于让"换皮肤"变成"读不了档"。
- 两条都必须**在连接/装载/读档时暴露**，不允许"先跑起来再说"。

### 登记表是单一真相

契约目录（本文第四节）**不是手抄的文档**。它已经在代码里落地：

- `src/protocol/contracts/` —— **一个域一个文件**（`world.ts` / `stage.ts` / `agent.ts` …），
  review 只看相关的那一个；`index.ts` 聚合出 `CONTRACTS: ContractMeta[]`，
  `types.ts` 放类型与域表，`lint.ts` 放 `lintContracts()` / `isContractVerify()`；
  新增契约落到对应域的文件末尾（`src/protocol/contracts/<域>.ts`），再同步本文；
- `test/contracts.test.js` —— **双向比对**：文档里有的登记表必须有、登记表有的文档必须解释得到；
  稳定性 / 承诺 / 验收入口逐字段一致；`test/` 开头的验收文件必须真的存在。

（和 `LIBRARY_KINDS` 与 `LIBRARY_SPECS` 必须一一对应是同一种办法——契约目录自己也要有契约。）

---

## 二之二、单写者与时间纪律（两条跨域硬规则）

### 2.2.1 一个数据只有一个写者

| 数据 | 唯一写者 | 谁可以读 | 落在哪 |
|---|---|---|---|
| 世界状态 `World` | `sim/step`，**外加三类编排写者**（见下） | 工具 / 路由 / 面板 | `world.json` |
| 事件流 | `journal.emitEvent`（**唯一铸 seq 的地方**） | SSE / 面板 | `events.jsonl` + 环形缓冲 |
| 内容注册表 | 内容装载器（装载后**只读**） | host / web（经协议） | 内存 |
| Agent 档案 | profile 服务（host） | 投影层 / 看板 | `profiles/<personId>.json` |
| 经验账本 | progression 服务（**只追加**） | 等级派生器 / 看板 | `progress.jsonl` |
| 知识条目 | knowledge 服务（**只追加 + tombstone**） | 检索器 | `knowledge.jsonl` |
| 舞台动作（瞬时） | **客户端推导器**（唯一） | 渲染通道 | 内存 |
| 对话阶段 | dialogue 路由（SSE） | 面板 | 事件流 |
| UI 偏好 | 浏览器 | 浏览器 | `localStorage` |

**step 之外的合法写者（评审 P1-7 指出原表与代码不符）**：

| 写者 | 写什么 | 必须发的补偿事件 |
|---|---|---|
| `open()` | 整只替换世界 | `world.reset`（新世界从 seq 0 开始，运行时重置水位线） |
| `dispatch()` | 往 `world.tasks` 追加工单 | `noteTasksAdded` → 逐张补丁事件（`task.changed` 形状） |
| `syncSubagents()` | 整只替换 `world.agents`、按投影改名册 | `world.reset{reason:'roster'}` |
| `recovery`（step 内） | 把卡死单退回 `ready` | **当前缺失**（评审 P1-8）：必须发 `task.changed{reason:'recovered'}` |
| `applyExternalTasks`（step 内） | 外部裁决改工单 | **当前发的是 `task.assigned/completed/failed`**（见 `wire.event.coverage`） |

**规矩**：跨进程只走事件（SSE / JSONL），**不共享内存、不双写**。想"两边都存一份、各自更新"，
那就是两个真相的起点。**非 step 写者不是违规，但必须发"客户端能重建"的补偿事件**——
判据不是"一行没改 sim"，而是"客户端应用完事件后 ≡ host"。

### 2.2.2 时间纪律

- **tick 是模拟的唯一时间**。`world.json` 里不许出现墙上时间（现有 `store.envelope` 靠这条做逐字节可复现）。
- 墙上时间只允许出现在三处：**UI 显示、档案/审计、日志**。它们都不参与 `step()`。
- 超时与冷却：在 `sim/` 内用 **tick** 计；在 `web/` 内用 `performance.now()` 计——两边不互相换算。
- 任何"按天/按小时"的规则（如 XP 日上限）必须显式标注它用的是哪种时钟，且**不影响确定性**。

---

## 三、失败语义总表（稳定性真正的来源）

> 原则三句话：**先丢表现，后丢事实；不进入半可用状态；静默失败是缺陷。**

| 失败 | 定义 | 必须的行为 | 可观测 |
|---|---|---|---|
| **absent**（不可用） | 依赖的东西不存在（素材、内容包、知识库未启用） | 走该契约声明的 `fallback`；没有 fallback 就用"最小合法形态" | 门面计数 + 一条 warning |
| **timeout**（超时） | 有截止时间的事没在期限内完成 | **取消**，不留半状态；超时是终态，不是"再等等" | 超时次数 + 最后一次耗时 |
| **mismatch.structural**（结构不兼容） | 线协议版本 / `fileVersion` / 场景 id / 形状对不上 | **在入口拒绝**，不进半可用；给人一条能下手的文案 | 拒绝原因（含两端版本） |
| **mismatch.content**（内容版本不同） | 存档用的内容包 ≠ 当前装载 | **采纳 + 重算派生量 + 警告 + 计数**（`content.compat`）；不拒绝 | 差异清单 + `content.drift` 计数 |
| **corrupt**（损坏） | 数据存在但解析不了（存档、坏行、坏条目） | **隔离坏的那一条**，保留好的；不因为一条坏数据起不来 | 坏条目清单（行号/where） |
| **unknown**（未知） | 收到了不认识的类型/取值 | 事件：跳过并记一条；动作：降级；字段：忽略 | 未知类型的计数（按名字） |
| **overload**（过载） | 超过预算（帧率、事件量、token、条数） | 按优先级**先丢表现、后丢事实**；丢什么要有记录 | 丢弃计数 + 当前预算 |
| **deadlock**（死锁/停滞） | 工单永远开不了工（前置 failed / 无人可派 / 卡死被回收） | **必须可见**：诊断里有停滞原因与时长；不静默 pending | `stalledTicks` / `deadlock` 计数 + 看板标记 |

**"半可用"是最坏的状态**：协议版本不匹配还继续跑、存档读了一半、知识库挂了但任务照派，
都属于"看起来能用，其实数据在悄悄错"。制度要求：**要么完整，要么明确降级**。

---

## 四、契约目录（v1）

> 稳定性：🔒 frozen · 📘 standard · 🧩 extension · 🧪 experimental
> 「验收」列是**已有的或本轮要补的**可跑入口；`—` 表示尚未接入验收（记入契约债，第九节）。

### 4.1 W · 世界内核

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `world.tick.order` | 每 tick 固定**九段**：ingest → scheduler → movement → idle → interaction → comms → mailbox → recovery → emit；顺序是语义 | 🔒 | `test/sim.test.js` |
| `world.step.pure` | `step(world, commands)` 不碰 IO、不吃 `dt`、就地改并返回同一引用 | 🔒 | `test/determinism.test.js` |
| `world.determinism` | 同 seed + 同命令序列 ⇒ 逐字节同世界；禁 `Date.now()` / `Math.random()` | 🔒 | `test/determinism.test.js` |
| `world.state.machine` | 角色 7 态；每个状态**只有一个主人**（谁负责离开它），不许布尔堆叠 | 📘 | `test/sim.test.js` |
| `world.pause` | 暂停只停推进，仍收命令；恢复后不补跑 | 📘 | `test/sim.test.js` |
| `world.speed` | 倍速只改编排层节奏，不改模拟结果；**当前 runtime 未消费 `setSpeed`，属契约债**（实现前必须报错而不是静默） | 🧪 | `planned:P0` |
| `world.reset` | 重开一局 = 用内容重新装配 + `world.reset` 事件；旧世界先落盘；seq 水位线重置 | 📘 | `test/sim.test.js` |
| `world.write.discipline` | 非 `step` 写者（open/dispatch/syncSubagents/recovery）必须发"客户端能重建"的补偿事件 | 📘 | `planned:P0` |
| `world.time` | tick ↔ ms 只在编排层换算；世界文件里不写墙上时间 | 🔒 | `test/reconcile.test.js` |

### 4.2 M · 地图与移动

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `map.nav.grid` | 可行走性由 `nav.blocked` 一格一判；派生量，随内容重算 | 📘 | `test/sim.test.js` |
| `move.arrive` | 到站当 tick 吸附到 `slot` 并转 `working`；位置与状态不许分帧 | 📘 | `test/sim.test.js` |
| `station.capacity` | 同站占用 ≤ `capacity`；超了就换站，不重叠 | 📘 | `test/sim.test.js` |

### 4.3 T · 工单

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `task.status` | 6 态；`ready` 是**派生**，只在 `sim/ready.ts` 算一处 | 🔒 | `test/sim.test.js` |
| `task.deps` | 前置全 done 才 ready；前置 failed ⇒ 后继**永不 ready**，必须可诊断（不允许静默 pending） | 📘 | `test/board-layout.test.js` |
| `task.progress` | **同一 attempt 内**进度只在 `interaction.ts` 单调推进；外部指派可清零（换 attempt）、外部完成可置 1 | 📘 | `test/sim.test.js` |
| `task.external` | 外部裁决认 `attemptId`、幂等、指派必须连带落位；**裁决必须发与模拟路径同形状的事件** | 📘 | `test/sim.test.js` |
| `task.stall` | 卡死判定按 `stalledSinceTick`，超阈值退回 ready；回收**必须**发 `task.changed{reason:'recovered'}` | 📘 | `test/sim.test.js` |
| `world.reaction.matrix` | 行为反应的默认动作 / 超时 / 幂等 / 可解释（见 §五之二） | 🧪 | `planned:P0` |

### 4.4 C · 通信与对话

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `comms.message` | 入队即发事件并带 `deliverAtTick`；送达时刻可算、不另发事件 | 📘 | `test/idle-comms.test.js` |
| `dialogue.turn` | `turnId` 归组；`thinking → acting* → replied/failed`，phases 不降级 | 📘 | `test/dialogue-state.test.js` |
| `dialogue.failure` | `failed` 必带原因；缺原因用兜底文案并记协议缺陷 | 📘 | `test/dialogue-state.test.js` |
| `wire.event.coverage` | 10 种世界事件客户端**每种都有明确处理**；未知事件不许静默 `default:return`，必须诊断或重拉快照 | 📘 | `planned:P0` |
| `world.readonly.projection` | 世界是 DSH 团队的**只读投影**，不许反向改团队 | 🔒 | `test/client-plugin.test.js` |

### 4.5 E · 团队与成员

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `team.projection` | 成员/任务来自官方 `agentTeam` projection，不轮询、不解析 tool call | 📘 | `test/client-plugin.test.js` |
| `team.member` | 一个 subagent ↔ 一个角色，靠 `boundAgentId` 映射；名字取投影名 | 📘 | `test/bridge.test.js` |
| `team.captain` | 队长 = 当前会话自己的 live agent（无则回退配置） | 📘 | `test/captain-session-config.test.js` |

### 4.6 P · 舞台与表现

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `stage.action.catalog` | **14 条动作**的触发/通道/优先级/时长/降级；新增只能加、不能改语义 | 📘 | `planned:P1` |
| `stage.reaction.rules` | 反应走 overlay 子槽、不与主动动作抢主槽；不反应自己；群体预算；不改世界 | 📘 | `planned:P1` |
| `stage.channel` | 六通道各有**主子槽 + overlay 子槽**；抢占只在同子槽内比较优先级 | 📘 | `__agentWorldStage.channels()`（P1 建） |
| `stage.asset.fallback` | 素材缺失必须降级到状态基线，不许"什么都不做" | 📘 | `__agentWorldStage.history()`（P1 建） |
| `stage.input` | 点选/键盘/对话三模式互斥；键盘移动期间动画不粘 | 📘 | `test/move-agent.test.js` |
| `stage.camera` | 缩放只走整数档，不吸附/不自动跟随；复位是"缩放+居中" | 📘 | `__agentWorldScene2d.camera()` |
| `stage.perf` | 60fps 预算；**2D** benchmark 不劣于基线 | 📘 | `planned:P1`（3D 门面不存在） |
| `ui.dock.layout` | 三卡 dock 的叶 id 固定 `stage/task/team`；布局树可持久化、坏树回默认 | 🧩 | `planned:P1` |

### 4.7 U · 面板与 HUD

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `hud.counts` | 计数口径只有一处（侧边栏 region header），看板不重复算 | 📘 | `test/sidebar-redesign.test.js` |
| `hud.status.color` | 状态色与 `TaskStatus` 一一对应，不新造 | 📘 | `test/board-layout.test.js` |
| `dialogue.ui` | 点选角色 → 底部面板（默认移动态）；Enter 进对话、Esc 关；历史不丢 | 📘 | `test/dialogue-state.test.js` |
| `ui.persist` | 用户偏好键前缀 `agentWorld.`；读坏值回默认，不抛 | 🧩 | `planned:P1` |
| `ui.a11y` | 角色/卡片/面板可键盘到达；`aria-*` 如实 | 🧩 | `planned:P1` |

### 4.8 A · Agent 身份与成长（详见 [`AGENT-MODEL.md`](AGENT-MODEL.md)）

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `agent.identity` | 人（personId）不可变、不复用；**座位可复用**；角色 id 一次性铸造（不得由数组长度派生）；重名必须诊断 | 📘 | `planned:P2` |
| `agent.profile.shape` | 档案形状 + schema 版本；名字是投影的**镜像**（不独立写回） | 📘 | `planned:P2` |
| `agent.profile.write` | 模型工具面**没有**改档案/发 XP/加能力的入口；只能提交提案走审批 | 📘 | `planned:P2` |
| `agent.level.ledger` | 经验**账本** append-only；等级是派生量，永不双写 | 🧪 | `planned:P2` |
| `agent.level.derive` | 等级 = f(xp, curveVersion)，单调、可重算 | 🧪 | `planned:P2` |
| `agent.capability` | 能力是**声明**，只用于匹配与表现，从不授权 | 📘 | `test/sim.test.js` |
| `agent.lifecycle` | 招募 / 换身体 / 退役；退役保留档案，不删历史 | 📘 | `planned:P2` |

### 4.9 K · 专属知识库

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `knowledge.entry` | 条目形状 + scope（私有/团队/世界只读）+ 来源 | 🧪 | `planned:P3` |
| `knowledge.write` | 只写结论；幂等键；去重；冲突**保留两版**不静默覆盖 | 🧪 | `planned:P3` |
| `knowledge.retrieve` | 带预算（条数/字节）的 top-k；空结果合法；超时降级为不注入 | 🧪 | `planned:P3` |
| `knowledge.forget` | TTL + 容量淘汰 + tombstone；删除可审计 | 🧪 | `planned:P3` |

### 4.10 J · 任务集

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `taskset.definition` | 任务模板 + 集合元数据；版本化、可覆盖、可组合 | 📘 | `test/content.test.js` |
| `taskset.dispatch` | 能力硬匹配 → 负载 → 公平防饿死；**等级不进调度**（v1） | 📘 | `test/sim.test.js` |
| `taskset.reward` | 完成 → XP 结算幂等（`taskId:attemptId`），失败不扣 | 🧪 | `planned:P4` |

### 4.11 X · 内容与装配

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `content.pack.manifest` | 包有 id/version/requires/overrides；依赖拓扑序装载 | 📘 | `test/content.test.js` |
| `content.library` | 库的种类**只增不改语义**；当前 11 个；加库要同时改协议 `LIBRARY_KINDS` 与内容 `LIBRARY_SPECS` | 🔒 | `test/content.test.js` |
| `content.validate` | 校验产出 `error/warning`；有 error 的包不装载 | 📘 | `test/content.test.js` |
| `content.override` | 覆盖必须显式登记；隐式覆盖默认拒绝 | 📘 | `test/external-pack.test.js` |
| `content.compat` | 内容版本不同：采纳 + 重算派生量 + 警告 + 计数（不拒绝） | 📘 | `test/reconcile.test.js` |

### 4.12 S · 存储与迁移

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `store.envelope` | `fileVersion` + 原子写（tmp → fsync → rename）；**内容版本只是注释，不参与兼容判定** | 🔒 | `test/reconcile.test.js` |
| `store.events` | `events.jsonl` 只增；坏行跳过、好行保留 | 📘 | `test/reconcile.test.js` |
| `store.migrate` | 逐版本迁移函数链；不认识的版本**拒绝读**，不猜（当前只有"拒绝"，迁移链待补） | 🧪 | `test/reconcile.test.js` |
| `compat.structural` | `fileVersion` / 场景 id / 形状对不上时**拒绝**，不进入半可用 | 🔒 | `test/reconcile.test.js` |

### 4.13 B · 桥接与宿主

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `bridge.minimal.shape` | 只声明真正用到的 DSH 字段；与 Inspect 契约逐字对齐 | 🔒 | `test/bridge.test.js` |
| `bridge.tool.policy` | 工具授权由 DSH 决定；世界只投影，不扩权 | 🔒 | `test/acceptance-m6.test.js` |
| `bridge.session.projection` | 团队成员状态来自会话 projection，不解析模型输出 | 📘 | `test/bridge.test.js` |

### 4.14 O · 可观测与治理

| id | 承诺 | 等级 | 验收 |
|---|---|---|---|
| `obs.facade` | `?debug=1` 下每个域有一个可读门面；门面只读 | 📘 | `planned:P1` |
| `obs.verify` | 验收列只允许三种：**存在的测试文件+用例名 / 存在的门面调用 / `planned:<阶段>`**；登记表测试校验前两种存在（P0 后转 frozen） | 📘 | `test/contracts.test.js` |
| `obs.registry` | 代码登记表与本文目录一一对应（P0 落地后转 frozen） | 📘 | `test/contracts.test.js` |

**合计 68 条**（frozen 11 / standard 44 / extension 3 / experimental 10）。这个数字会变，
但"只增不改、有 id、有等级、有验收"的形态不变。

---

## 五、动作契约与反应契约（舞台域细则）

动作契约的完整定义见 [`STAGE-ACTIONS.md`](STAGE-ACTIONS.md)。这里只补**反应**这一半——
用户明确要求"动作、反应"，而这两者的契约形状不一样：

| | 动作 Action | 反应 Reaction |
|---|---|---|
| 谁发起 | 角色自己（世界状态/事件驱动） | **别人**的事件（同伴完工、收到纸条、被点名） |
| 目标 | 自己 | 自己，但**指向**触发者 |
| 会不会改变世界 | 不会（表现只读） | 不会 |
| 关键风险 | 抢通道 | **全员一起演**（8 个人同时鼓掌像故障） |
| 额外契约 | 优先级 + 通道互斥 | 抑制：每人每事件一次、群体预算、不反应自己 |

**反应 v1（5 条）——必须走 overlay 子槽，否则会被永久压死**

评审 P0-3 抓到的真问题：`react.rejected`（P60）和 `task.fail`（P85）用同一对通道，
按"同通道低优先级不得进场"就**永远不会演**；`react.called` 与 `collab.talk`、`react.paper`
与 `collab.message` 同理。修法是把通道拆成**主子槽 + overlay 子槽**（见第五节），
反应只进 overlay，抢占只在同子槽内比较：

| id | 触发 | 子槽 | P | 时长 | 抑制 |
|---|---|---|---|---|---|
| `react.paper` | 纸条送达（`deliverAtTick`） | `body.overlay` + `bubble.overlay` | 35 | 500ms | 每人每消息一次；正在对话时不演 |
| `react.assigned` | `task.assigned`（外部/队长指派） | `body.overlay` | 45 | 700ms | 与 `task.pickup` 并行：pickup 占 `body.base`，本反应只叠手势 |
| `react.rejected` | 评审被打回 | `body.overlay` + `bubble.overlay` | 60 | 900ms | 每任务一次；`task.fail` 占 `bubble.base`，本反应叠 `bubble.overlay` |
| `react.peer.done` | 同伴完工 | `body.overlay` + `ground.overlay` | 25 | 800ms | **每 2s 全局最多 2 人**，其余静默；不庆祝自己 |
| `react.called` | 对话打开 / 被点名 | `body.overlay` | 30 | 400ms | 已朝向时不重复；`collab.talk` 占 `body.base` |

**四条硬规则（写进 `stage.reaction.rules`）**：

1. **不反应自己**——自己完工走 `task.deliver`，不走 `react.peer.done`。
2. **群体反应有预算**——全局同时最多 2 条 `kind:'reaction'`，其余**静默降级**（不排队）。
3. **反应只进 overlay**——不抢主槽，因此不会被高优先级主动动作永久压死；
   同一 overlay 子槽内才比较优先级。
4. **反应不得有副作用**——不写世界、不发消息、不影响派单。

**碰撞真值表（必须写成测试）**：每条反应 × 当前占用者 → 期望赢家。
最低覆盖四组：`react.rejected` vs `task.fail`、`react.called` vs `collab.talk`、
`react.paper` vs `collab.message`、`react.assigned` vs `task.pickup`。

---

## 五之二、两层反应：表现反应 vs 行为反应（**别混**）

"反应"在系统里有两层，契约完全不同：

| | 表现反应（stage reaction） | 行为反应（behavioral reaction） |
|---|---|---|
| 是什么 | 舞台上演一下（抬头、鼓掌） | Agent 的**下一步动作**（接受/返工/接手） |
| 谁决定 | 客户端推导器 | 模拟内核 + 调度 + 队长 |
| 影响世界吗 | 不 | 会（改变工单/角色状态） |
| 契约 | `stage.reaction.rules`（[`STAGE-ACTIONS.md`](STAGE-ACTIONS.md)） | `world.reaction.matrix`（下） |

**行为反应矩阵 v0（当前多数未实现，先定形状）**

| 触发 | 默认反应（不反应 ≠ 卡死） | 备选 | 决定者 | 现状 |
|---|---|---|---|---|
| 被派单 `task.assigned` | 接受并前往 | 拒绝（必须给理由） | 负责人 | 自动接受 |
| 自己失败 / 卡死被回收 | 返工（同一负责人、新 attempt） | 上报队长 | 调度 | 部分（`recovery` 回收） |
| 同伴失败 / 受阻 | 接手（能力匹配时） | 忽略 | 调度 | 未实现 |
| 收到问题消息 | 回答 | 转发 / 升级 | 负责人 | 已实现（对话） |
| 评审被打回 | 返工 | 争辩（写理由） | 负责人 | 未实现 |

**四条硬规则**：

1. **必须有默认反应**——没人决定时按默认走，不能停在"等一个不会来的决定"。
2. **有超时**——反应超过 `reactionTimeoutTicks`（默认 300）按默认反应执行，并记一条事件。
3. **幂等**——同一触发只反应一次（键 = 触发 id + 反应者）。
4. **可解释**——每次反应记 `{ by, because, atTick }`，看板/诊断能回答"他为什么接了这张单"。

行为反应暂列 🧪（experimental）：它一旦真的改动派单与工单，就会影响确定性，
必须先在测试里把"默认反应 + 超时 + 幂等"钉死，才允许升 standard。

---

## 六、Agent 长期模型的契约边界

完整设计见 [`AGENT-MODEL.md`](AGENT-MODEL.md)。这里只钉三条**跨域纪律**，因为它们决定
可扩展性会不会被"等级/知识库"这种长期状态拖垮：

1. **世界不伪造能力**：能力来自 DSH（模型、工具策略、会话）。世界的 `capabilities` 是**投影**，
   只用于任务匹配与表现；任何"提升能力"的诉求都必须回到 DSH，不许在世界里造。
2. **事实与派生物分离**：经验账本是事实（append-only），等级/统计是**派生**（可重算）。
   绝不双写——双写是"同一件事两个真相"的起点。
3. **长期状态只增不改核心**：档案、知识、任务集全部是**新存储 + 新端口**，
   `sim/` 与 `domain/` 不为它们改一行。**等级不参与派单**（v1）：任务集的
   `recommendedLevel` 只进 UI 建议；要做权重就必须先承认"等级投影进 World + 迁移"，
   那是另一条契约，不塞进 v1。

---

## 七、怎么加东西（扩展清单）

> 规矩：**新东西优先做成 extension，不改 frozen/standard 的形状**。
> 每一步都要过"四件套"，至少要有形状 + 验收。

### 加一条动作

1. 在 `STAGE-ACTIONS.md` 词汇表加一行（触发/子槽/优先级/时长/**结束条件**/降级）；
2. 在内容 `actions` 库里给它一个 `visualRef`（band / clip / 程序化参数），不许在渲染器里写 if；
3. 推导器 `web/core/stage-actions.js` 加触发；
4. 单测：触发、抢占、冷却、降级、`degraded` 记录；
5. 门面：`__agentWorldStage.history()` 能读到它（含 `source.ref` 与 `degraded`）。

### 加一条反应

同上，外加：**抑制规则**（每人每事件一次 / 群体预算 / 不反应自己），
并且**只能进 overlay 子槽**；碰撞真值表加一行，见 `stage.reaction.rules` 的测试。

### 加一个等级来源

1. 账本条目加一种 `kind`（只加，不改已有 kind 的语义）；
2. 幂等键必须能唯一确定"这件事只结算一次"；
3. 派生算法版本 `curveVersion` 不变（变的是账本，不是等级公式）；
4. 单测：同一事件重放 N 次，XP 只加一次。

### 加一个知识 kind

1. 枚举加值（消费方必须有默认行为）；
2. 校验器加规则；
3. 检索排序权重写进契约（不许在检索函数里随手乘系数）；
4. 旧条目无需迁移（未知 kind 读出来降级为 `fact`）。

### 加一个任务集

纯内容：新包 + `tasks` 库条目 + `roles`/能力声明；不改代码。
若要新的**派单规则**，那是 `taskset.dispatch` 的 bump，不是内容。

### 加一个内容库

协议 `LIBRARY_KINDS` + 内容 `LIBRARY_SPECS` 两处同时加，校验器补规则，
`test/content.test.js` 的"一一对应"会自动要求它 —— 这条规矩已经存在，别绕过。

### 加一个模块 / 线协议消息 / 端口

照 [`PROTOCOL.md`](PROTOCOL.md) §6 的四步走；漏一步的后果那里写得很清楚（检查器会跳过它）。

---

## 八、治理：谁能改什么

| 动作 | 需要什么 |
|---|---|
| 改 **frozen** | 新契约 id + 迁移 + 全量测试 + 一轮红队评审 + 更新本文与登记表 |
| 改 **standard**（破坏性） | bump 版本 + 迁移 + 验收 + 更新变更记录 |
| 改 **standard**（只加可选） | 测试 + 变更记录（不 bump） |
| 改 **extension** | 提供方自己的测试；核心不动 |
| 改 **experimental** | 随意，但**不许被 frozen/standard 依赖** |
| 废弃一条契约 | 标 `deprecated` → 保留一个版本并打警告 → 删除 + 从登记表移除 |

**提案模板**（提新契约时必须写清）：为什么（要解决哪个静默失败） / 形状 / 语义 /
时序 / 失败语义 / 版本影响 / 验收怎么跑 / 依赖谁。

**契约债清单**（有 id、没验收或没实现的，按第九节路线图补）：

| 债 | 欠什么 | 归哪个阶段 |
|---|---|---|
| `world.speed` | runtime 不消费 `setSpeed`，倍速是空操作 | P0 |
| `world.write.discipline` | recovery 改单不发事件；live 裁决事件形状不统一 | P0 |
| `wire.event.coverage` | 客户端对 3 种 live 事件 `default:return` | P0 |
| `ui.a11y` / `ui.persist` | 无可跑验收 | P1 |
| `ui.dock.layout` | dock 树没有测试 | P1 |
| `stage.perf` | 3D 门面不存在，2D benchmark 未进 CI | P1 |
| `obs.facade` | 只有部分域有门面 | P1 |
| `agent.profile.write` / `agent.identity` | 工具面与 id 铸造都还没做 | P2 |
| `knowledge.*` / `taskset.reward` | 只有形状，没有实现 | P3/P4 |

---

## 九、路线图

| 阶段 | 内容 | 产出 |
|---|---|---|
| **P0 · 收编** | ✅ 登记表（68 条）+ 文档同步测试已落地；⬜ 还差四处阻塞（身份铸造 / 等级不入调度 / 反应子槽 / live 事件覆盖）修完才允许把相关契约转 frozen | 制度有牙且**不会把错误冻成 frozen** |
| **P1 · 舞台** | 动作推导器 + 14 动作 + 5 反应 + 门面 + 单测（[`STAGE-ACTIONS.md`](STAGE-ACTIONS.md) 的 A/B 批） | 舞台可读、可验 |
| **P2 · 档案与等级** | `agent.profile` / `agent.level.ledger` / `agent.level.derive` + 投影徽章 | Agent 认得出来、长得大 |
| **P3 · 知识库** | `knowledge.*` 四件套 + 注入预算 + 失败降级 | Agent 记得住 |
| **P4 · 任务集** | `taskset.*` + 奖励幂等 + 派单公平 | Agent 有事做 |

**顺序的理由**：P0 先让"契约"变成可检查的东西；P1 是用户当前最想看的舞台反馈；
P2–P4 是长期模型，必须建立在"事实与派生分离"和"世界只读投影"之上，
否则做到一半就会开始出现两个真相。

---

## 十、修订记录（v1.1：红队评审后的处理）

2026-10-20 的第一版被一轮红队评审打回 5 个 P0、8 个 P1、2 个 P2。**每条都改了，不是记一笔了事**：

| # | 问题 | 处理 |
|---|---|---|
| P0-1 | 世界里的 `Agent.id` 是座位序号（`agent-${index+1}`），不是会话 id；personId 拿座位当身份会复用；名字有投影/档案两个真相 | 身份契约改为"**personId 长期、座位可复用、角色 id 一次性铸造**"；名字改为投影的镜像；见 [`AGENT-MODEL.md`](AGENT-MODEL.md) §二 |
| P0-2 | 等级进派单必须把等级拷进 `World`，同时违反"派生不落盘""sim 不改一行" | **v1 等级不参与派单**；`recommendedLevel` 只进 UI 建议；见 §六 与 AGENT-MODEL §4.4 |
| P0-3 | 反应被同事件的高优先级动作永久压死；overlay 语义无法表达 | 通道拆主子槽；加 `mode/slot/kind/durationMs`；补碰撞真值表；见 §五 |
| P0-4 | live 模式发 `task.assigned/completed/failed`，客户端 `default:return` 静默吞 | 新增 `wire.event.coverage`：10 种事件必须都有处理；未知事件必须诊断或重拉 |
| P0-5 | 读档 mismatch 三处说法不一致（拒绝 / 暴露 / 采纳） | 拆成 `mismatch.structural`（拒绝）与 `mismatch.content`（采纳+重算+警告）；新增 `content.compat`、`compat.structural` |
| P1-6 | "模型不能改档案"没有执法点 | 新增 `agent.profile.write`：工具面不得有改档案/发 XP/加能力的入口 |
| P1-7 | 单写者表与代码不符（open/dispatch/syncSubagents 都写世界） | 改成"**step 是主写者 + 三类编排写者必须发补偿事件**"，并列出补偿事件 |
| P1-8 | `world.tick.order` 写成六段（实际九段）；recovery 改状态却不发事件 | 改为九段；新增 `task.stall`；`world.write.discipline` 要求 recovery 发 `task.changed{reason:'recovered'}` |
| P1-9 | `curveVersion` 声称写在账本每条，实际只有 `ruleVersion` | `curveVersion` 移到**派生配置/重算记录**，不进每条账本 |
| P1-10 | 知识冲突就地改 confidence，违反 append-only；`supersedes` 方向反了 | 加 `conflictWith[]` / `supersededBy`；置信度改为**派生**或 amend 条目；见 AGENT-MODEL §5 |
| P1-11 | 验收列有不存在的门面/测试 | 验收只允许"存在文件+用例 / 存在门面 / `planned:<阶段>`"；逐条改正 |
| P1-12 | `world.speed` 是静默空操作（runtime 不消费 `setSpeed`） | 降为 🧪 并标 `planned:P0`；实现前必须报错而不是静默 |
| P1-13 | 前置 failed 让后继永远 pending 且无诊断；`task.progress` 有多写者 | `task.deps` 加上"必须可诊断"；`task.progress` 改成 attempt 内单调；§三 加 **deadlock** |
| P2-14 | `StageActionSpec` 表达不了词汇表（overlay / 结束条件 / 冷却 / 素材引用 / 降级记录） | 补 `kind/mode/slot/endCondition/visualRef/cooldownTicks/degraded`；见 STAGE-ACTIONS §七 |
| P2-15 | "四件套"对行为契约不成立；47/68 条 id 只有两段 | 分数据契约（四件套）与行为契约（三件）；id 规则改为显式允许 2 段 |

**结论**：v1 的方向（事实/派生分离、世界只读、失败可见、契约分级）成立，但**登记表必须在上述
四处（身份、等级入调度、反应优先级、live 事件源）修完后再落地**——否则会把错误固化成 frozen。

---

## 十一、非目标

- 不做通用插件系统（我们只有一条产品线，过度抽象等于增加负担）；
- 不追求"零改核心就能加任何东西"——那会变成配置地狱；目标是**新增功能以 extension 为主**；
- 不引入外部 schema 工具（zod/protobuf）——现有手写校验器已够用，且能给出中文错误；
- 不做多租户/多世界并行（当前一个会话一个世界，见 `session.world` 相关记录）。
