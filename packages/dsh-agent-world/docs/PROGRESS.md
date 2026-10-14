# dsh-agent-world —— 轮次台账（PROGRESS）

> **这是每小时自动化轮次的交接文档。** 每轮开始先读这里，结束必须更新这里。
>
> 更新规则：
> 1. 在最上面加一条本轮记录（倒序，最新的在上）。
> 2. 记录必须包含：**做了什么 / 验证怎么跑的 / 下一轮从哪继续 / 假设 / 卡住的地方**。
> 3. 「下一轮从哪继续」要具体到文件与函数名，不要写"接着做 M1"。
> 4. 不要删历史记录。台账的价值就在于"三个月后还能看懂当时为什么这么做"。

---

## 环境备忘（每轮都会用到，先看这里）

```bash
cd packages/dsh-agent-world

# 首次 / 依赖缺失时：本包**独立安装**，不走根 workspace
#（根 `pnpm install` 目前被 packages/dsh-daily 的过期 RC 钉死，与本包无关，原因见本文件 R1 的「卡住」一节）
pnpm install --ignore-workspace --lockfile=false

# 之后所有 pnpm run 都要带这个环境变量，否则 pnpm 的 run 前依赖校验会去跑根 install 并失败。
# 这是**唯一的**可靠手段：包内的 .npmrc 写 `verify-deps-before-run=false` 不管用
#（pnpm 读的是 workspace 根的 .npmrc），而且 .npmrc 被仓库级 .gitignore 忽略、根本不会进版本库。
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run build
```

当前验证状态（R6 末）：`typecheck` 绿 · `test` 115/115 绿。

---

## R6 — 2026-10-14 · 事件产出 / 邮箱 / step 编排 / 1000 tick 确定性验收

**本轮目标**（M2-6 / M2-7 / M2-3 / M2-8）：把 M2 收口。**模拟内核到此完成。**

### 做了什么

1. **`src/sim/journal.ts`（M2-7）** —— `emitEvent(world, type, payload)`，**只有它能改
   `world.seq` 与 `world.events`**。事件序号是客户端 gap 自愈的依据（PROTOCOL.md §4.3），
   多处各自造序号会让序号重复或跳号，而症状是"面板偶尔重拉一次快照"——没人会去查。
2. **`src/sim/emit.ts`（M2-7）** —— 把各段返回的 outcome 翻成事件。
   **整个内核的事件只从这一处产出**；四个阶段函数刻意都不发事件。
3. **事件量策略（R5 留下的最大不确定性，本轮定了）**：

   | 事件 | 频率 | 为什么 |
   |---|---|---|
   | `world.tick` | 每 tick **最多一条**，且只在真有位移时 | 位置是连续量。一条"帧"事件带本 tick 有位移的角色 `[id,x,z,facing][]`，而不是每人一条——后者 24 角色 ≈ 240 条/秒，环形缓冲只有 500 条 |
   | `task.changed` | 状态变化 + **每 10% 里程碑** | 进度条自己插值；每 tick 推 24 条进度是纯浪费 |
   | `agent.state` / `message.sent` | 离散 | 本来就稀疏 |
   | `agent.moved` | **保留但不再使用** | 位置走帧事件。留着一个"单个角色大跨度移动"的位置，也避免删枚举取值（那要 bump 协议版本） |

   **`stalled` 刻意不发事件**：它是"为什么现在派不出去"的诊断，没空闲角色时每 tick 都成立，
   发出来只会刷屏。由 `step()` 的返回值交给编排层。
4. **`src/sim/mailbox.ts`（M2-6）** —— 消息有**定量投递延迟**（`MESSAGE_DELIVERY_TICKS = 10`，
   ≈1 秒）。留在常量里而不是由内容决定：它是模拟的时间语义，不是可替换的美术。
   消息 id **不从事件 seq 派生**——混用会让"事件序号不跳号"这条保证失效，有测试钉住。
5. **`src/sim/step.ts`（M2-3）** —— 六段固定顺序。两处值得说：
   - **签名去掉了 `dt`**（决策 D20）：这是定步长模拟，一次调用 = 前进一 tick，
     `dt` 永远等于 `tickMs`。收了却不用它只会让人以为"传别的值会改变结果"。
   - **`reset` / `dispatch` / `hire` 不在内核里执行，而是放进 `requests` 转交编排层**。
     这三个都需要内容（场景/任务集/花名册），而 `sim/` 按边界规则不许 import `content/`。
     这不是权宜之计，是 D16 那条规则在起作用；顺带的好处是 `step()` 可以在
     **没有任何内容注册表**的情况下被测试。
   - `world.tick` 在**最后**自增：上面所有阶段读到的都是"这一步的编号"，事件时间戳因此一致。
     放开头加会让事件落在下一个 tick 上，差一帧。
6. **修掉一个真实缺陷（测试抓到的）**：`movement.ts` 原本要**等下一 tick** 才判定到站，
   于是会出现一帧"状态还是 walking、位置已经到了"——渲染层那一帧不知道该播走路还是坐下，
   看起来像慢了一拍。改成**走到最后一个点的当 tick 就到站**。
7. **`test/determinism.test.js`（M2-8）** —— 1000 tick 逐字节比对，外加三条"防止假通过"的检查。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 115 / pass 115 / fail 0
```

91 → **115**。M2-8 那组特别值得看，因为**确定性测试最容易假通过**：

- **1000 tick 逐字节一致**（`JSON.stringify` 比对，同时覆盖"值不同"与"字段顺序不同"）。
- **加一条"世界确实在动"**：如果世界是死的，上一条会因为"两边都是初始状态"而假通过。
  所以断言 1000 tick 后有角色在工作、有工单完工、产生过事件。
- **加一条静态检查**：直接读 `src/sim/*.ts` 源码（**去掉注释再查**），
  出现 `Math.random` / `Date.now` / `new Date` 就红。注释里正当地写"禁止 Math.random"
  不该被判成违规——这个细节不做，这条检查会立刻变成噪声被关掉。
- **加一条 3000 tick 长跑**：事件缓冲有界、状态机取值合法、进度不越界、
  **不许有角色卡在 walking 却没目标**（静默卡死）、进行中的工单必须有负责人与站点。
- **加一条完整流水线**：quick-fix 三张单全部完成，且**完工后没人还占着工位**。

另有两条关于"事件量策略真的生效"的检查：400 tick 只产生 133 个事件（帧事件只在有人移动时发）；
2000 tick 的 `seq` 仍远小于缓冲上限 500。**如果按人头逐条发位置事件，这两条会当场红。**

三处测试写错、**实现是对的**（记在这里免得下次重写）：
① 我断言 `resume` 那一步不推进世界——实际它推进了，且**这是对的**（命令影响它到达的那一 tick）；
② 环形缓冲断言差一（`world.seq` 从 1 起，不是 0）；
③ 邮箱测试忘了推进 `world.tick`，时间不走消息当然不送达。

### 下一轮从哪继续

**M2-9：`agent_world_dispatch` 工具**，让任务库真正被消费。具体：

1. `WorldServicePort` 加 `dispatch(taskSetId: string): World`（或返回新派进的工单 id 列表）。
   **必须在 `state.ts` 里实现**（它 import `content`，符合边界规则），工具侧只调端口。
2. 复用 `content/instantiate.ts` 的 `instantiateTasks(set, startIndex, tick)`——
   `startIndex` 要接着现有 `world.tasks.length + 1`，否则跨任务集会撞 id。
3. 新建 `src/tools/dispatch.ts`，注册 `agent_world_dispatch`。工具描述要写明副作用
   （**会往世界加派工单**）。参数 `taskSet` 要校验：库里没有就报错并**列出可用任务集**。
4. 测试：派 quick-fix 进世界 → 工单数 +3、首张 `ready`、id 不撞已存在的。
5. 顺带把 `agent_world_open` 的说明改掉——它现在说"等 lead 派单"，但派单工具就是这一个。

**然后 M3**。M3 的第一件事应该是 **M3-2 runtime**，而不是 M3-1 落盘：因为
**现在没有任何东西驱动 `step()`**，插件加载后世界是静止的（`world.tick` 一直是 0）。
先把 tick 循环接上，世界才真的会动：

- `src/runtime.ts`：`setInterval(step, tickMs)` + `ctx.effect(() => () => clearInterval(...))` 清理
  （**必须清理**，否则热重载会泄漏定时器，这是本仓库的既有踩坑）。
- 处理 `StepResult.requests`：`dispatch` / `hire` 需要内容，`reset` 要么重建世界要么明确拒绝。
- `autoStart` 配置项**终于有了真实语义**（之前只是"先把世界建出来"）。
- 注意：runtime 属于 `runtime/` 模块，边界规则允许它 import 全部；但 `sim/` 不许反过来 import 它。

### 假设

- **`world.tick` 在暂停期间不前进**，且暂停时 `step()` 除了 ingest 段什么都不做。
  这样 HUD 上不会出现"暂停了但时间还在走"。
- **消息投递延迟 10 tick 是定数**，不随内容变化。真要改观感，改的是渲染层怎么插值这段飞行。
- **进度事件只在里程碑发**，所以面板的进度条**必须自己插值**，不能指望收到每一帧的进度。
  这条要写进 M4/M6 的实现说明里，否则做 HUD 的人会以为"进度事件丢了"。

### 卡住 / 风险

- **最该记住的一条：`step()` 现在没有驱动者。** 内核对、测试全绿，
  但插件加载后世界静止（`world.tick` 一直是 0），工具看到的是一个"装好了但还没开始跑"的世界。
  这不是 bug，是 M3-2 还没做——但**很容易被误读成"模拟已经能用了"**。已写进 BACKLOG 的 M3 抬头。
- **`world.messages` 只增不减**（不像 `events` 有环形缓冲）。一个跑很久的世界里消息会无限堆积。
  M3-1 落盘时必须定策略（截断 / 归档 / 只留未送达 + 最近 N 条）。现在没定，因为还没有长跑的真实场景。
- **`emit.ts` 里 `world.tick` 帧事件的载荷是元组数组**，过 JSON 会变成普通数组，
  反序列化方要按位置解包。这是个**隐式契约**，PROTOCOL.md 只写了"事件带 seq"没说载荷形状。
  M3 接 SSE 时必须把它写进 PROTOCOL.md 的载荷说明，否则面板只能靠读源码猜。

### 本轮产出

- 新增：`src/sim/{journal,emit,mailbox,step}.ts`、`test/step.test.js`、`test/determinism.test.js`
- 修改：`src/sim/{movement,interaction,index}.ts`（到站同 tick、progressed 带 delta）、
  `src/domain/{types,constants}.ts`（事件量策略注释、投递延迟、里程碑粒度）、
  `docs/ARCHITECTURE.md`（§4.1 签名 + 决策 D20）、`docs/BACKLOG.md`
- 测试从 91 → 115

---

## R5 — 2026-10-14 · 模拟内核的四个叶子：依赖求值 / 调度 / 移动 / 干活

**本轮目标**（M2-1 / M2-4 / M2-5 / M2-5b）：把"世界会动"这件事做出来。
四个阶段函数都是**纯的**（不碰 IO、不用未注入的随机与时间），各自可单独测。

### 做了什么

1. **`src/sim/ready.ts`（M2-1）** —— `ready` 状态的**唯一**实现点。
   强调"唯一"是因为：如果调度器、HUD、工具各自判断一次"依赖满没满足"，
   三处总有一天对同一张工单给出不同答案，而每处单独看都对——那种不一致最难查。
   两条刻意的语义：
   - **依赖指向不存在的任务 ⇒ 返回 false**（不是"当成没依赖"）。
     基于一个"消失了的前置"判断可以开工，比不开工更坏。
   - **`ready → pending` 的退回也有实现**：依赖被重新打开时，不让世界卡在
     "依赖没了但单还是可领取"这种自相矛盾的状态上。
2. **`src/sim/scheduler.ts`（M2-4）** —— 原子 claim。几条设计：
   - **"原子"靠结构保证，不靠时序小心**：一趟遍历里完成"挑单 + 挑人 + 挑站 + 写状态"，
     中途没有 await、也没有第二次遍历。一旦有，"两个人抢到同一张单"就会变偶发问题。
   - **容量把"正在过去的"也算上**：只看"已经在那里的"会让三个人同时被派到一张
     单人工位，到了才发现挤不下。
   - **座位在 claim 时定好并写进路径**：到达时再算会拿到不确定的序号。
   - 排序用 `ordinal` 而**不是 id 字符串**——`task-10` 的字符串序在 `task-2` 前面，
     那会让优先级在两位数时静默改变。
   - 职业匹配是**优先而不是门槛**：没有同职业的人就把单给任何空闲的人。
     否则一个小队只要缺某个职业，整条流水线就停在那里。
3. **`src/sim/movement.ts`（M2-5）** —— 只做位置推进，**不负责找路**（路径由调度器给）。
   好处：以后换网格 A\* 或 navmesh，改的是"路径怎么算出来"，"怎么沿路走"一行不动。
   一条防御：自称 `walking` 却没有（有效）目标 → **就地修好并报出来**。
   不修的话角色会永远卡在"走路"状态上不动——**静默卡死**是最难查的一类问题。
4. **`src/sim/interaction.ts`（M2-5b，本轮新增的任务）** —— 干活推进。三个决定：
   - **进度按内容库声明的 `estimateTicks` 走**：既然内容里写了"预估 600 tick"，
     就让它真的有意义。否则它只是个装饰数字，而"显示 3 分钟、实际 25 秒"比不显示还糟。
   - **完工即释放站点**：站点容量是稀缺资源（只有 4 张能写代码的工位）。
     如果干完活的人赖在工位上，高峰期会死锁——工位被"已经干完的人"占着，新工单永远派不出去。
   - **不做庆祝状态**：`celebrating` 留给渲染层对完工事件做反应。
     模拟内核不必多维护一个计时器，而"看起来在庆祝"本来就是表现层的事。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 91 / pass 91 / fail 0
```

70 → **91**。新增 21 个，每条都对应一个真实会踩的坑：

- 依赖指向不存在的任务 → **不开工**（而不是当成没依赖）
- 依赖被重新打开 → 已 ready 的单**退回 pending**
- 一张单在同一 tick 内只被派一次；同一个人不会被派两张
- **容量超了要 stalled 而不是硬塞**，且 stalled 的说明要指出缺的是什么能力
- **占位把"正在过去的"也算上**（这是最容易漏的一条）
- `pickStation` 要求**能力包含**而不是有交集（要求「评审+讨论」的单不能放到只有「评审」的桌上）
- 优先级按 ordinal：造 12 张单、3 个工位座位，断言拿到的是 `task-1/2/3`
  而不是字符串序的 `task-1/10/11`
- 位置**精确落位**（差一点点在渲染层看起来就是没坐下）
- 自称 walking 却无目标 / 目标站点不存在 → 修好
- 完工**释放站点**（断言 `occupancyOf` 回到 0）
- 四段串起来能跑通一条流水线（triage 完工后 patch 被接上）

两处测试写错、**实现是对的**，改的是测试（记在这里免得下次又写一遍）：
① 我给 12 张单都写了 `research` 能力，而实验台只有 1 个座位，所以只能派出去 1 张、
观察不到顺序——改成 `code`（3 个座位）才看得到有序前缀；
② `pickStation({ requires: [] })` 我写了个自相矛盾的断言（`null ?? 自己`），
实际行为是"落到第一个有空位的站点"（`every` 对空数组为真）——这是确定的、可接受的，
因为内容校验本来就**禁止**任务模板不声明能力。

### 下一轮从哪继续

**M2-7：`src/sim/journal.ts` + `src/sim/emit.ts`（事件产出）**，然后 M2-6（邮箱）、M2-3（`step`）、M2-8（确定性）。具体：

1. `src/sim/journal.ts`：`emitEvent(world, type, payload): WorldEvent` —— 取 `world.seq` 当序号、
   自增、push 进 `world.events`、超过 `EVENT_RING_SIZE` 从头部截断。**只有它能改 `world.seq`**。
2. `src/sim/emit.ts`：把四段返回的 outcome 翻成事件。类型用 `WorldEventType`
   （`agent.state` / `agent.moved` / `task.changed` / `message.sent`）。
   **注意别每 tick 发一堆 `agent.moved`**：位置每 tick 都变，那是高频事件（≤24 条/tick ≈ 240 条/秒），
   会给 SSE 与"环形缓冲只有 500 条"带来压力。**先定采样策略再写代码**
   （按位移阈值采样，或只在一个批里给最终位置），否则会在 M2-8 的对比里以"输出太大"暴露。
3. 四段函数**刻意都不发事件**（返回 outcome），事件只在 `emit.ts` 一处产出。
   别在 `ready.ts` / `scheduler.ts` 里顺手加 emit——那会让"事件从哪来"变成四个答案。
4. 然后 `src/sim/mailbox.ts`（M2-6）→ `src/sim/step.ts`（M2-3，六段顺序：
   `ingest → scheduler → movement → interaction → mailbox → emit`）→ `test/determinism.test.js`（M2-8）。
5. `step` 的签名与语义：`step(world, dt, commands) -> { world, events }`，**就地修改传入的 world
   并返回它**（"纯"指的是不碰 IO、不用未注入的随机/时间，不是不可变）。调用方要么拥有它，
   要么先克隆。这点要写在文件头，否则下一个人会以为它不修改入参。

### 假设

- **`sim/` 的路径目前是直线（一个座位点）**。小镇还没有障碍物，所以正确；
  真正的绕障在 M5-3（网格 A\*）。换的时候改的是"路径怎么算出来"，
  `movement.ts` 的推进逻辑不用动——这正是把找路与走路分开的收益。
- **`progress` 是增量累加**（每 tick `+1/estimateTicks`），不是由 tick 反推。
  浮点累加有误差，但同一个世界跑同样的步数得到同样的浮点结果，所以**确定性不受影响**。
  如果以后要"从任意 tick 直接算出 progress"，得改成按 `startedAtTick` 反推
  （那需要给 `Task` 加字段）——现在没这个需求。
- **完工的角色就地站住**（位置不动、`station` 清空）。"走回休息区"与"庆祝"都是表现层的事。

### 卡住 / 风险

- **事件量还是未知数**（见「下一轮」第 2 点）。这是本轮留下的最大不确定性：
  必须先定 `agent.moved` 的采样策略，否则 M2-8 的逐字节对比会因为输出太庞大而没法用。
- **`Task.ordinal` 是跨任务集连续的**（`instantiateTasks` 传的是全局 `tasks.length + 1`）。
  好处是全世界一个稳定序；代价是它**不表达**"在所属流水线里是第几步"。
  HUD 要画流水线内部顺序时得用 `set` + 集合内下标，不能直接用 `ordinal`。记在这里免得误用。
- 边界检查器对 `src/sim/` 的规则已生效（只许 import `protocol` 与 `domain`），
  所以 `journal.ts` / `emit.ts` **不许** import `runtime` 或 `content`——
  事件出口是 `EventSinkPort`（`protocol/ports/events.ts`）。

### 本轮产出

- 新增：`src/sim/{ready,scheduler,movement,interaction,index}.ts`、`test/sim.test.js`
- 修改：`src/domain/types.ts`（`Task` 加 `ordinal` / `suggestedRole`）、
  `src/content/instantiate.ts`、`src/domain/constants.ts`（`DEFAULT_TASK_TICKS`）、
  `docs/BACKLOG.md`（M2 构建顺序修正）
- 测试从 70 → 91

---

## R4 — 2026-10-14 · 契约层：模块之间只通过协议通信，且由机器强制

**本轮目标**（用户反馈驱动）："要各个模块解耦定好自己的协议或者 protobuf 通信，模块之间使用协议通信禁止耦合。"

### 先给结论：为什么不是 protobuf

用户说的是"定好自己的协议**或者** protobuf"。我的判断是**协议要，protobuf 现在不要**，理由不是省事：

1. **进程内的模块之间不该序列化**。`domain`/`content`/`world`/`sim` 之间是同进程函数调用，
   套一层 protobuf 只白付编解码开销，还会**丢掉 tsc 的类型检查**——而类型检查才是进程内解耦
   真正依赖的东西。"禁止耦合"靠的是边界规则，不是序列化。
2. **跨进程没有带宽压力**：10Hz tick、≤24 个角色，JSON 的代价测不出来；而 devtools 里能直接读。
3. protobuf 要多一套 `.proto` + codegen + 产物入库，而本仓库对"新增文件进 profile"本来就有坑。

**但把接缝留好了**：业务代码只调 `codec.encode/decode`，从不碰 JSON。换 protobuf = 改 `wire/codec.ts` 一个文件。
**换的判据也写下来了**（不是拍脑袋）：单条消息常态 >64KB、事件频率 >100Hz、或出现非 JS 客户端。

### 做了什么

1. **边界检查器（本轮最有价值的东西）**。规则写成**数据**（`src/protocol/boundaries.ts`），
   `test/boundaries.test.js` 去**读源码、解析每个文件的 import、逐条判定**，违规打印模块名 +
   违规的 import + 当初写下的理由。三条规定被真正钉住：
   - **`sim/` 不许 import `content/`** —— 模拟内核只认装配好的 `World`；
   - **`tools/` 只许 import `protocol/`**；
   - **`web/` 只许 import `protocol/`**。
2. **当场抓到一处真耦合**：`src/tools/world.ts` 写着 `import type { PluginState } from '../state.js'`。
   已改成只认 `WorldServicePort` 端口——现在塞一个手写的假端口就能给工具写单测。
3. **端口**：`WorldServicePort`（工具↔状态）、`ContentPort`（工具↔内容，实现在 `content/port.ts`）、
   `EventSinkPort`（sim↔外部，M2 接）。端口里**不许出现实现类型**——否则消费方又被迫认识具体实现，
   端口就退化成多余的间接层。
4. **线协议**：六种消息（hello/snapshot/events/command/ack/error）+ 六种命令 + JSON codec。
   版本是**单整数、严格相等**，且**不匹配在形状检查之前就拒绝**（否则用户会以为是数据坏了）。
5. **两条设计教训（都是本轮自己踩的）**：
   - **规则自相矛盾**：第一版禁止 `protocol` import 任何模块，结果 `wire/messages.ts` 连
     `World` 这个**类型**都 import 不了——而世界的形状本来就是契约一部分。
     于是规则加了 `mayImportTypes` 维度，检查器区分 `import` 与 `import type`（擦除，无运行时依赖）。
   - **契约层的类型必须自持**：`boundaries.ts` 一开始 import 了 `content/kinds.js` 的 `LibraryKind`
     ——契约层 import 业务模块，缝就没了。把 `LibraryKind` 上提到 `protocol/library-kinds.ts`，
     内容层反过来 import 它（content → protocol 是允许方向）。
6. **排版与词汇表上提到契约层**（`protocol/format.ts` / `format-text.ts`）：
   工具输出与 HUD 要用同一套文案与同一份中文标签。放在 domain 层则 web 够不着（web 只许 import protocol），
   复制两份则必然出现"工具说『进行中』、HUD 说『运行中』"这种最难发现的同义异形。
   世界模型现在只负责"数字是多少"。
7. `docs/PROTOCOL.md`：三层协议、边界表、端口设计两条规矩、加模块/加消息的步骤、常见错误表。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 70 / pass 70 / fail 0
```

49 → **70**（含 M1.5-4 的 `agent_world_content` 工具测试）。新增 21 个里最该看的是这几条：

- **检查器本身被检查**：先用 7 组**人造违规**验证它真的会红（`sim` 值 import `content`、
  `tools` import `state`、`domain` import `node:fs`…），再去检查真实代码。
  **一个"永远返回 0 违规"的检查器是有害的**——它给人虚假的安全感。
- **豁免只对那一个文件有效**：`content/load-files.ts` 用 `node:` 允许，`content/registry.ts` 用 `node:` 报错。
- **import 提取要分清类型与值**：多行 `import type {`、`export type { … } from`、
  副作用导入 `import '../panel.js'`、以及 `import typewriter from './z.js'`（不能把 `type` 当关键字切）。
- **协议层与内容层的库清单必须一一对应**（`LIBRARY_KINDS` vs `LIBRARY_SPECS`）——
  不一致的症状是"面板按协议层遍历，静默地少显示一栏"。
- **版本不匹配要在形状检查之前拒绝**：故意发一个"版本错且缺 world 字段"的 snapshot，
  断言报的是 `protocol-mismatch` 而不是 `bad-shape`（报错的种类会决定排查方向）。
- **每一条边界规则都指向真实存在或明确登记为 planned 的模块**，且 `rationale` 不能太短。
  加新目录却忘了登记规则 → 检查器会**直接跳过它**（`moduleOfPath` 返回 null），违规不会被发现。

一处实现被测试纠正的记录：`resolveImportTarget('./state.js', 'tools/world.ts')` 我原本断言是 `app`，
实现给的是 `tools`。**实现是对的**（`./state.js` 从 `tools/` 出发就是 `tools/state.js`；
指向组合根的是 `../state.js`）。改的是测试。

### 下一轮从哪继续

**M2-1：`src/sim/ready.ts` 的依赖求值**（唯一实现点：`blockedBy` 全 done ⇒ `pending → ready`）。
按这个顺序推进 M2：

1. `src/sim/ready.ts`（M2-1，先做它因为调度器依赖它）→ 立刻加测试。
2. `src/sim/step.ts`（M2-3）严格按六段顺序：`ingest → scheduler → movement → interaction → mailbox → emit`。
   命令类型**已经有了**（`protocol/wire/commands.ts`，M2-2 已完成，别再造一份）。
   emit 段往 `EventSinkPort`（`protocol/ports/events.ts`）里丢，**不许直接调 runtime** —— 那会把
   模拟内核焊死在"一定有个 HTTP 服务器"上，而它的一半价值恰恰是可以 headless 跑。
3. 然后 scheduler / movement / mailbox（M2-4/5/6），每个模块写完立刻加测试。
4. M2-8 收口：`test/determinism.test.js` 同 seed 跑 1000 tick 两次逐字节一致。
5. `src/sim/` 是**新模块**：动手前先确认 `boundaries.ts` 里已有它的规则（已有），
   并且它只许 import `protocol` 与 `domain`——**不许** import `content`/`world`/`store`/`runtime`。

### 假设

- **协议只有我们自己两端**，所以版本策略取严格的单整数相等，不做向后兼容层。
  出现第三方客户端时这条要重新评估（见 PROTOCOL.md §4.2）。
- **`web/` 还没建**，所以"web 只许 import protocol"那条测试目前是空转（目录不存在就跳过）。
  它会在 M4 建 `web/` 的那一刻开始生效——**这是刻意的**：规则先生效于未来，而不是等违规出现再补。
- 端口方法的判据是"能被手写假实现满足"。做不到就说明这个方法切错了位置。

### 卡住 / 风险

- **边界检查器有一个已知盲区**：`moduleOfPath` 返回 null 的目录会被**静默跳过**。
  也就是说"新建一个模块目录但忘了在规则表登记"不会被发现。已有测试检查"规则表里的模块都真实存在"，
  但**反方向没有检查**（真实存在的目录都在规则表里）。已排成 M1.6-8。
- **路径安全边界仍未处理**（R2 就记过，R4 仍未动）：`ModelEntry.source.url` 可以是任意字符串。
  M4 真正加载 GLB 之前必须限制成包内相对路径并禁 `http://` 与 `../`。已排成 M1.6-7。
- 线协议的**编解码器只有 JSON 实现**，protobuf 只是"接缝留好了"，不是"已经能用"。
  别把 PROTOCOL.md §4.4 读成"我们支持 protobuf"——它说的是"换起来是改一个文件"。

### 本轮产出

- 新增：`src/protocol/`（`version` `boundaries` `library-kinds` `format` `format-text`
  `ports/{content,events,world-service}` `wire/{commands,messages,codec}` `index`）、
  `src/content/port.ts`、`test/boundaries.test.js`、`test/protocol.test.js`、`docs/PROTOCOL.md`
- 重构：`src/tools/world.ts`（只认端口 + 新增 `agent_world_content` 工具）、`src/state.ts`
  （实现 `WorldServicePort`）、`src/domain/summary.ts`（只留取数，排版搬走）、
  `src/content/{kinds,validate}.ts`（契约类型上提）
- 测试从 49 → 70；顺带补完 M1.5-4（`agent_world_content` 工具）

---

## R3 — 2026-10-14 · 外部内容包：用户改内容就能改世界

**本轮目标**（M1.5-1/2/3/5）：让"内容可替换"从"改源码里的包"变成"往目录里放 JSON"。
这是 R2 那套机制的第一次真实兑现——**不写一行代码，换掉花名册**。

### 做了什么

1. **`src/content/load-files.ts`** —— 对**目录**的纯函数（不决定目录在哪，那由调用方定，
   这样测试能直接喂临时目录）：
   - `<rootDir>/<packId>/pack.json` 是清单，`<kind>.json` 是各库条目数组（缺文件 = 不提供该库，不是错误）。
   - 允许单对象写法（`scene.json` 只有一条时少写一层方括号）。
   - `scenes` 同时接受单数 `scene.json`。
   - 子目录没有 `pack.json` → 跳过 + 警告（报的是**哪个目录**）。
   - **有一个错就整包跳过**，不加载半成品，并明确说"已整体跳过"。
2. **`resolveContentRoot(contentDir, cwd)`** —— 路径解析策略**明确、不猜**：
   空 → 不用外部内容；绝对路径 → 原样；相对路径 → 相对 `process.cwd()`。
   最终解析出的绝对路径 + 理由会**原样打进日志**。
3. **报错定位到文件（M1.5-3）** —— 校验器给的 `where` 是按库分的（`stations/station.x.kind`），
   它不知道文件叫什么。所以按 `where` 首段反查该库实际用的文件名，统一前缀成
   `my-town/stations.json: stations/station.x.kind`。**定位到条目 id 而不是数组下标**——
   手写 JSON 里搜 id 比数第几个元素快得多。
4. **不认识的 `.json` 文件名一律警告并列出可用名**。`station.json`（单数）这种手滑，
   症状是"站点一个都没有"而报错什么都不说——那种问题能耗掉一小时。
5. **接进 `state.ts` + `index.ts`（M1.5-2）**：内置包在前、外部包在后（于是外部排到提供方链首），
   但**链首 ≠ 可以乱覆盖**：没声明 `overrides` 的撞 id 仍是错误。`allowImplicitOverride` 接上配置。
6. **`content/index.ts` 刻意不导出 `load-files.ts`**：它 import 了 `node:fs`，而 `content/index`
   是给浏览器侧 `web/` 也能 import 的入口，混进去 Vite 打包会当场炸。这条写进了文件头注释。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 49 / pass 49 / fail 0
```

32 → **49** 个测试。新增 17 个全部围绕外部内容，含 3 条**走完整插件入口的端到端**：

- **改内容就改世界**：临时目录放一个 `my-team` 包，显式覆盖 `rosters/roster.software-team`，
  于是 `createWorld` 出来的是 2 个人（"队长本人" + "唯一的工程师"）而不是默认的 8 个；
  `world.origin.packs` 记着 `['pack.default', 'pack.my-team']`。**没改一行代码。**
- **偷偷换掉会被拦**：同样的包，去掉 `overrides` → 装载报错，且世界退回内置的 8 人、名字仍是"工头阿金"。
- **走 `apply()` 的完整链路**：`apply(ctx, { contentDir: <绝对路径> })` → 工具读到的世界就是外部内容装出来的；
  日志里能原样看到"实际读取的外部内容目录：/tmp/..."。
- 目录不存在 → **只警告不报错**，插件照常可用，世界退回内置内容（不能因为用户还没建目录就崩）。

一个测试写窄了被实现纠正的记录：我原本断言报错要含 `stations[0]`（数组下标），
实现给的是 `stations/station.x.kind`（条目 id）。**实现是对的**——手写 JSON 里搜 id 比数下标有用得多，
改的是测试。

### 下一轮从哪继续

**M1.5-4：`agent_world_content` 工具**（`src/tools/content.ts`）。具体：

1. 用 `state.content` 列：已装载的包（`content.packIds` 与各包的 version）、每个库的条目数与条目 id。
2. 支持按 id 查**提供方链**（`content.providersOf(kind, id)`）——这是排查"为什么我的覆盖没生效"的入口。
3. 输出要能回答三个问题，这也是它的验收标准：
   · 到底装了哪些包？· 某个 id 现在生效的是哪个包提供的？· 外部目录是哪个、有没有被跳过？
4. 顺带把 `state.contentIssues` 全量列出（现在只有前 5 条进日志，工具里应当给全部）。
5. **注意**：它只读，不许写盘、不许联网，工具描述里要写明。

做完 M1.5-4 就可以进 **M2 模拟内核**（`src/sim/ready.ts` 起步）——那是整个项目技术上最硬的一块。
M1.5-6（相对路径的解析基准）建议**先别做**：`workspaceRegistry` 没有"当前 workspace"的概念，
需要先查清 session→workspace 的绑定从哪拿，否则就是猜；宁可先让它显式要绝对路径。

### 假设

- **相对 `contentDir` 按 `process.cwd()` 解析**（宿主进程的工作目录，通常就是 workspace）。
  没去猜"当前 session 的 workspace"：`workspaceRegistry` 只提供 `list()` 与 `resolveByPath()`，
  多工作区时任何自动挑选都是猜，而猜错的症状是"读到了另一个项目的包"，比"没读到"难查得多。
  需要精确指向就写绝对路径。这条作为 M1.5-6 排进队列。
- 一个目录 = 一个包；不支持一个目录放多个包。
- 库文件名固定为 `<kind>.json`（`scenes` 兼容单数）。**拼错会被警告而不是静默忽略**。

### 卡住 / 风险

- **JSON 里的路径仍然没有安全边界**：`ModelEntry.source.url` 现在可以是任意字符串。
  等 M4/M5 真的开始加载 GLB 时，必须限制成**包内相对路径**并禁 `http://` 与 `../`。
  这条在 R2 就记过一次，**本轮仍未处理**——因为还没有消费者，现在定规则是空谈；
  但 M4-8（资源台账）之前必须落地，否则就是一个"内容包能指向任意 URL"的口子。
- 外部内容的**热重载**没有：改了 JSON 要重开世界才生效（`content` 在 `apply` 时装载一次）。
  是否要 watch 到 M3-2（runtime）再定，现在不做。
- M1.5-6 的调研成本未知，已单独拆成一条任务，避免它把别的事堵住。

### 本轮产出

- 新增：`src/content/load-files.ts`、`test/external-pack.test.js`
- 修改：`src/state.ts`（接受 `externalRoot`）、`src/index.ts`（解析并记录内容目录）、
  `docs/BACKLOG.md`、`docs/CONTENT.md`、`README.md`
- 测试从 32 → 49

---

## R2 — 2026-10-14 · 内容库层：机制与内容分离

**本轮目标**（用户反馈驱动）："应该按照一个游戏的模式设计，模型库、动作库、任务库、场景库等等都要整理好解耦好，方便替换升级和切换。"

R1 的架构里"内容"和"代码"是**混着**的——地段坐标、站点布局、配色全硬编码在 `src/domain/constants.ts` 里。
本轮把这层拆出来，并把"方便替换"从一句愿望变成**有强制力的机制**。

### 做了什么

1. **十个内容库**（`src/content/kinds.ts`）分两层：
   - **语义库**（host 权威）：`districts` 地块 / `stations` 站点 / `scenes` 场景 / `rosters` 角色 / `tasks` 任务
   - **表现库**（web 权威）：`models` 模型 / `actions` 动作 / `skins` 皮肤 / `sounds` 音效 / `themes` 主题
   两层共享同一套 id 契约与同一个注册表实现（决策 D13）——拆成两套机制就会开始漂移。

2. **"方便替换"的机制化**（这是本轮真正的产出，也是三条新决策）：
   - **稳定 id**：代码引用 `action.walk`，永远不引用 `walk.fbx`（D10）。
   - **提供方链 + 回退**：同一个 id 可被多个包提供，链首生效，其余留作回退；
     `resolve(kind, id, prefer)` 只**排序**不裁剪，所以"优先"永不导致条目丢失（D12）。
   - **覆盖必须显式**：撞 id 但没在清单 `overrides` 里声明 → 报错，且**原条目保持不变**（D11）。
     理由："悄悄换掉内容"是最难查的一类问题——世界看起来一切正常，只是某个站点变成了别的东西。

3. **校验器**（`src/content/validate.ts` + `registry.validate()`）：抓的是 **tsc 抓不到、
   运行时又难定位**的错误。单包查条目形状/枚举/依赖环/lead 数量；跨包查引用完整性
   （站点→地块、场景→站点/花名册/主题、配色→皮肤 token）与**动作覆盖度**
   （某个 `AgentState` 没动作 ⇒ 角色会僵在上一帧）。报错文案一律给"可用取值有哪些"（D15）。

4. **内置内容包** `pack.default`（`src/content/packs/default.ts`）：4 地块 / 10 站点 /
   8 人花名册 / 2 条工作流（`task.software-feature` 7 步 DAG、`task.quick-fix` 3 步）/
   皮肤（10 色调色板 + 职业色 + 站点色）/ 7 个动作 / 1 个主题。**表现层全是程序化几何**，
   所以现在零外部资产、零许可风险、零加载时间。

5. **重构分层**（决策 D10 的落地）：
   ```
   domain/   世界模型（类型、数值调参、几何、摘要、随机源）——不认识"内容"
      ↑
   content/  类型、校验、注册表、内置包、实例化
      ↑
   world/    createWorld（内容 → World）
   ```
   - `src/domain/create.ts` 删除，拆成 `src/content/instantiate.ts`（内容 → 对象，两层之间**唯一**的翻译层）
     + `src/world/create.ts`（装配）。
   - `src/domain/constants.ts` 只剩**数值调参**；`DEFAULT_DISTRICTS` / `DEFAULT_STATIONS` /
     `AGENT_PALETTE` / `ROLE_COLOR` 全部搬到内容包。
   - `Task` 新增 `key` / `set` / `estimateTicks`；`World` 新增 `origin`（场景 + 内容包 + 任务集），
     没有它就没法"用同样的内容重开一局"。

6. **`docs/CONTENT.md`**：十个库规范、包的写法、**三种操作**（新增内容 / 替换升级 / 切换提供方）、
   校验规则表、命名规范、一个完整的 Kenney 替换示例、常见错误对照表。

7. `src/index.ts` 加了内容问题的**软失败**：内容有 error 时不让它拖垮插件加载
   （插件树加载失败会让整个 dsh 起不来，代价远大于"世界暂时建不出来"），
   改为打日志 + `agent_world_status` 里列出细节。照 dsh-daily 的既有做法。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 32 / pass 32 / fail 0
```

从 10 个测试涨到 **32 个**。新增的 22 个里，**18 个专门钉住内容层机制**，每条都对应一个真实会踩的坑：

- 撞 id 没声明 overrides → 报错**且原条目不变**；声明了就生效**且旧提供方留在链上可回退**
- `resolve(prefer)` 只排序不裁剪（prefer 里写个不相干的包，条目不能丢）
- `allowImplicitOverride` 打开时只警告
- 站点引用不存在的地块 / 场景引用不存在的站点 / 皮肤 token 不存在 → 都在加载时报错
- **某个 AgentState 没有动作 → 报错**（这条最值钱：换动作库时漏一个状态，会在测试里红，而不是在画面上看到角色僵住）
- 任务依赖成环 → 报错并打印完整环路；依赖指向集合外 → 报错并列出可用 key
- `schemaVersion` 不匹配 → 明确拒绝；包依赖缺失/成环 → 报错
- 拓扑序：故意把依赖方放在前面传入，装载顺序仍正确
- `relativeTo` 坐标解析正确（**所有站点都必须落在小镇范围内**——坐标解析错了最典型的症状就是跑到地图外）
- 连派两个任务集，跨集合 id 不撞且依赖不串

### 下一轮从哪继续

**M1.5-1：外部内容包加载器**（`src/content/load-files.ts`）。具体：

1. 读 `<workspace>/<contentDir>/<packId>/` 下的 `pack.json` + 各库 `.json`（缺哪个文件 = 不提供那个库，不是错误）。
2. **错误信息里必须带文件路径**（M1.5-3）——否则用户不知道去哪个文件改。这是外部内容与内置内容最大的体验差别。
3. 接进 `src/state.ts`：内置包 + 外部包一起 `loadAll`，`allowImplicitOverride` 接上配置（配置项已就位）。
4. M1.5-5 是验收：临时 workspace 里放一个外部包顶掉小镇布局，`createWorld` 出来的世界确实变了。

之后就是 M2 模拟内核（`src/sim/ready.ts` 起步），那是整个项目技术上最硬的一块。

### 假设

- **内置内容编译进代码、外部内容走文件系统**（决策 D14）。这是被本仓库的硬链接副本坑逼出来的：
  `file:` 依赖装进 profile 时新增文件**不会**被同步（`docs/DEVELOPMENT.md` §7），
  而插件树加载失败会让整个 dsh 起不来。所以内置走 TS 常量（不新增文件），外部走文件系统（用户自己放的）。
- **包是替换与升级的单位**，不支持"只覆盖一条而不整包"（BACKLOG 待决问题 5）。想要细粒度就新建一个包。
- 表现库在 host 侧可能完全不存在（面板没打开、只跑 headless），所以跨包校验里
  "场景引用的主题""皮肤 token"这类检查**只在对应库非空时才跑**。

### 卡住 / 风险

- **M5 是这个设计唯一的真实验证点**：到目前为止"换一套角色只改模型库+动作库"还是**推理**，
  没被跑过。到 M5-6 必须拿出证据：加了 `pack.kenney-mini` 之后 `pnpm test` 仍全绿、模拟内核零改动。
  在那之前不要把这条当成已验证的事实。
- 外部内容包的**安全边界**没定义：JSON 里将来若出现 `url` 字段（模型/音效），
  要不要限制只能读包内相对路径、禁 `http://` 与 `../`？→ 留到 M1.5-1 一并处理，倾向于**默认禁网络**。
- 注册表的提供方链目前**没有持久化**：世界落盘（M3-1）时只存 `origin.packs`，
  恢复时靠"用同样的包按同样顺序装载"重建链。如果用户换了包集合，旧存档的渲染表现会变——
  这是可接受的（内容升级本来就该改变表现），但要在 M3-1 里把 `origin.packs` 的版本一并存下来，
  好让"这局是用哪个版本的内容玩的"可查。

### 本轮产出

- 新增：`src/content/{kinds,validate,registry,instantiate,index}.ts`、`src/content/packs/default.ts`、
  `src/world/create.ts`、`test/content.test.js`、`docs/CONTENT.md`
- 删除：`src/domain/create.ts`（拆成上面两个）
- 重写：`src/domain/constants.ts`（只剩数值）、`src/domain/index.ts`、`src/state.ts`、
  `src/tools/world.ts`、`src/index.ts`、`src/config.ts`、`test/smoke.test.js`
- 文档：`ARCHITECTURE.md`（§2.1/§2.2 新增、§3 实体表、§9 里程碑重排、§10 目录、§12 加 D10–D15）、
  `BACKLOG.md`（全量重排）、`README.md`

---

## R1 — 2026-10-14 · 立项、选型、骨架、世界模型

**本轮目标**：把项目立起来，并把「架构」这块最难的地方先定死（用户点名说架构是难点）。

### 做了什么

1. **勘察底座**：定位到参考实现 `@nanmicoder/dsh-agent-teams@0.1.23`
   （装在 `~/.dsh/profiles/web/node_modules/@nanmicoder/dsh-agent-teams`）。读出了它的骨架：
   - host 侧一层：`index.js`（注册 `agent_teams_*` 工具 + 系统提示词段落）、`state.js` / `members.js` /
     `scheduler.js` / `mailbox.js` / `tools.js`、`cordis.patch.yml`（bundle patch）。
   - 磁盘真相：`<workspace>/.agent-teams/<teamId>/`（`team.json` + `inbox/*.jsonl`）。
   - client 侧一层：`lib/client.js`，React，注入 DSH 的 slot。
   **本项目的「底座」= 这套语义（lead + durable members + 依赖感知任务 + 邮箱 + 调度器），
   不是它的代码。** 我们重写 host 侧，并把呈现层从 React 面板换成 3D 场景。

2. **技术选型（决策 D1）**：**three.js**，不用 Godot。完整对比在
   `docs/ARCHITECTURE.md` §1。一句话：Godot 要 wasm + JS interop + 编辑器流水线，
   three.js 直接就是同浏览器里的一个页面。Godot 被**推迟**（不是否决）——
   因为 §2 把渲染层做成了哑客户端，将来换引擎不用动业务。

3. **架构定稿**：`docs/ARCHITECTURE.md`（12 节 + 6 条决策记录）。核心是三条：
   - **server-authoritative**：模拟跑在 host，渲染层只画状态、只发意图；
   - **`tick` 是纯函数 + seeded PRNG**：确定性 ⇒ 可回放 bug、可无 mock 测试；
   - **capability 落位**：任务只声明"需要什么能力"，不硬绑工位 ⇒ 布局与编排解耦。

4. **代码骨架 + 世界模型（M0-1…M0-3, M1-1…M1-3）**：
   ```
   src/config.ts              schemastery 配置 + resolveConfig 兜底
   src/state.ts               插件态：内存世界 + ensureWorld/resetWorld
   src/index.ts               入口：name/inject/apply
   src/tools/world.ts         agent_world_status（只读）+ agent_world_open（写）
   src/domain/types.ts        世界模型全部类型 + 两个状态机
   src/domain/constants.ts    默认小镇布局（4 地段 / 10 站点）+ 配色 + 调参
   src/domain/rng.ts          mulberry32 seeded PRNG
   src/domain/create.ts       createWorld()（纯函数）
   src/domain/geometry.ts     距离/转向/到站 slot 吸附
   src/domain/summary.ts      世界摘要 + 花名册 + 工单板文本（三处共用同一口径）
   src/domain/index.ts        领域层出口（web/ 以后直接 import 这份，不复制）
   test/smoke.test.js         10 个测试
   ```

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test
# → tests 10 / pass 10 / fail 0
```

测试覆盖：导出契约（`name`/`inject`/`apply`）、**`apply(ctx, undefined)` 不崩**
（Loader 在 patch 没写 config 时就是给 undefined，schema default 不会自动填——本仓库最容易崩的一条路径）、
`createWorld` 同 seed 逐字段一致 / 不同 seed 分叉、小镇结构完整性（每个站点的 district 与 slot 都存在）、
`maxAgents` 硬上限、`summarize` 口径与数组真实内容一致、PRNG 序列可复现且不退化。

### 下一轮从哪继续

**M1-4：`src/sim/step.ts` 的纯函数 tick。** 具体：

1. 先写 `src/sim/ready.ts`（M1-5，先做它因为调度器依赖它）：唯一实现点是
   「所有 `blockedBy` 的 task 都 `done` ⇒ `pending` 变 `ready`」。
2. 再写 `src/domain/commands.ts`：命令类型联合（`pause` / `resume` / `reset` / `dispatch` / `hire`），
   这是 `step()` 的第三个参数。
3. 然后 `src/sim/step.ts`，严格按 §4.1 的六段顺序：
   `ingest → scheduler → movement → interaction → mailbox → emit`。
   注意：**模拟层禁止 `Math.random()` / `Date.now()`**，随机一律走传入的 `Rng`。
4. 每写一个 sim 模块，立刻在 `test/` 加一个测试。M1-9 是收口：
   `test/determinism.test.js` 跑 1000 tick，两次结果逐字节一致。

### 假设（没问人，按最合理的定了）

- 一个 workspace 一个活跃世界 + 历史归档（BACKLOG 待决问题 2）。
- 角色数上限默认 24（`MAX_AGENTS`），M4 实测后再调。
- 小镇是 16×16 单位、原点在中心、四象限四地段（`TOWN_HALF = 8`）。
- 面板用宿主 HTTP 路由吐出的**独立页面**，不塞进宿主 client bundle（决策 D3）。
  理由：避免与宿主 React/three 版本冲突，且 Vite HMR 迭代快。

### 卡住 / 风险

1. **根 workspace 的 `pnpm install` 是坏的**（不是本包引起的）：
   `packages/dsh-daily` 声明了 `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-invariants` /
   `@deepseek-ai/dsh-session` 的 `>=0.1.2 <0.2.0-0` 范围，而公共 registry 上这些包只有
   `0.0.1-rc.1`（latest）/ `next: 0.2.0-rc.2` / `alpha: …`，范围内无匹配；
   根 `pnpm-lock.yaml` 停在 2026-09-22 的旧解析结果（有 3000+ 行未提交改动，**不是本轮改的**，
   mtime 未变）。`pnpm-lock.yaml` 本轮**没有被我修改**，也没提交。
   → 本包因此独立安装并关掉 run 前校验（见上方环境备忘）。**没有去修它**：
   那属于 dsh-daily 的依赖维护，且用户当时在 `feat/dsh-daily` 分支上有未提交改动，不该我碰。
2. `docs/ARCHITECTURE.md` §5.4 的美术方向目前是**设计**，还没有任何真实资产。
   资产落地在 M3-5 / M7-3，届时必须有 `web/public/assets/VENDOR.md`（URL + 许可 + sha256）。
3. 面板入口位置（右侧栏常驻 vs 新 view tab）与音效是否要做，都留到 M5 再决（BACKLOG 待决问题）。

### 补充（同日）：资产 / 库调研已落地成文档

派了一个后台调研去把 M3/M7 的美术与依赖问题一次问清（一手来源核验，含真的把资产 zip 与 GLB
拉下来解析），结果收到后**没有让它烂在对话里**，全部折进了文档：

- 新增 [`docs/ASSETS.md`](ASSETS.md)：推荐的 CC0 资产包（含实测体积）、角色动画三方案对比、
  three.js 生态库版本与许可、10 条许可红线、`VENDOR.md` 台账模板、美术配方（相机/光照/调色板/性能预算）。
- `ARCHITECTURE.md`：§5.3 性能预算按调研**收紧**（300k 面 → ≤100k，150 draw call → ≤60，
  新增贴图 ≤512² 与首屏载荷 ≤5 MB）；§5.4 重写成具体配方并指向 ASSETS.md；
  §11 补两条风险（资产许可、peer 上限）；§12 新增 **D7/D8/D9** 三条决策。
- `BACKLOG.md`：M3-1/M3-3/M3-5/M4-2/M7-3 全部改成**可执行的具体项**（原本只是"落地美术方向"这种空话）。

三条本轮新定的决策（都已进 §12）：

- **D7 面板用纯 three.js，不引 `@react-three/fiber`**：R3F 系库全部只支持 React 19，
  引它等于把面板绑死在某个 React 大版本上；而 §5.2 的分层本来就是「model 出插值状态 →
  scene 每帧命令式同步」，React 的 diff 在这层不是价值而是开销。HUD 也走原生 DOM。
- **D8 角色用 Kenney Mini Characters**：单角色 247 kB vs KayKit 3.5 MB，我们 ≤24 个同屏差 14 倍。
- **D9 只有 CC0/public domain 的字节可以进 git**：禁 Mixamo 派生文件、CC-BY 资产、Sketchfab、
  Quaternius。**这条最值得记住**：Mixamo 的 Adobe FAQ 只授权"在项目里使用"，**没授权再分发
  剪辑文件本身**（而且中国区和 Enterprise/Federated 账号根本用不了，外部贡献者无法复现）；
  Quaternius 2026-08-28 起换成 QAL v1.0，§3(a) 禁止再分发资产本身，**但各包页面仍挂着 CC0 徽章**——
  这是个真陷阱。官方条款页在本机被 IP 拦（403），Mixamo 再分发问题**仍标注为未核验**，
  已写进 ASSETS.md §7 待复核。

### 本轮产出

- 分支：`feat/dsh-agent-world`（从 `feat/dsh-daily` 的 HEAD 切出；**没有**动那个分支上的未提交改动）
- 新增包：`packages/dsh-agent-world/`
- 文档：`docs/ARCHITECTURE.md`、`docs/BACKLOG.md`、本文件、`README.md`
