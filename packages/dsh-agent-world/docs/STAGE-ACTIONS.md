# 舞台动作与反应协议（Stage Action Protocol）· v1

> 用户口径（2026-10-20）："**舞台**还有很多需要优化的地方，里面的 agent 需要设计一套动作反馈协议。"
> 本文件只回答一件事：**世界发生了什么 → 舞台上演得出什么**。
> 世界怎么算（tick、调度、寻路）不在这里，见 [`ARCHITECTURE.md`](ARCHITECTURE.md) 与 [`PROTOCOL.md`](PROTOCOL.md)。
>
> **本文件是契约制度在舞台域的细则**：它对应 [`CONTRACTS.md`](CONTRACTS.md) 目录里的
> `stage.action.catalog` / `stage.reaction.rules` / `stage.channel` / `stage.asset.fallback` 四条契约。
> 判断一条改动"算不算破坏契约"，以那边的分级与版本规则为准。

---

## 零、为什么要有这份协议（先看现状的窟窿）

R209 时点，舞台上的反馈只有三条通路：**精灵动画带**（`bandOfState` 按状态挑权重最大的那条）、
**对话气泡**（`thinking / acting / replied / failed`）、**头顶工单行**（`core/task-label.js`）。
一条纸条会飞（`drawNotes`），其余离散事件在画面上**没有表现单元**。

于是四个具体问题：

1. **状态 7 个，演出来的只有 3 个**。内容库给 `talking` / `blocked` / `celebrating` / `sleeping`
   都配了 `ActionEntry`，但 2D 实际只有 `idle` / `walk` / `sit` 三条带；`action.celebrate` 的
   `band` 是 `null`——**"完工"在舞台上是一件看不见的事**。
2. **离散事件各写各的 if**。派单、完工、失败、纸条、工具调用，渲染层在收到事件的地方随手改一下
   表现，没有"这段表现多长、被谁打断、冲突时听谁的"。典型症状：气泡与头顶标签叠在一起；
   完工的庆祝被下一帧 `agent.state` 刷新直接抹掉。
3. **素材缺失没有降级约定**。缺一条带、缺一张图时，代码各自决定"什么都不做"，于是表现消失得
   悄无声息——而"功能没做"与"素材没到"在截图上长得一模一样。
4. **无法验收**。没有任何可读门面能回答"舞台此刻在演什么"，只能靠截图目测，回归全靠人眼。

所以：把「世界发生了什么」到「舞台上演什么」抽成一份**显式契约**，代码只负责执行它。

---

## 一、三层词汇

| 层 | 是什么 | 谁权威 | 例子 |
|---|---|---|---|
| **状态 State** | 持续的姿势，是**基线**不是动作 | 服务端（`AgentState`，7 个） | `working`、`talking` |
| **动作 Action** | 有名字、有起止、有优先级的一段表现 | 客户端推导器（纯函数） | 「领单」「完工」「收到纸条」 |
| **通道 Channel** | 动作落到哪个视觉面 | 渲染器 | `body` / `bubble` / `label` / `ground` / `prop` / `hud` |

**状态与动作的关系**：状态是底，动作是叠加。任何时刻每个角色都有基线（由状态决定），
动作在基线上加一段短暂的、可被打断的东西；动作结束后**回落基线**，不回落"上一个动作"。

---

## 二、五条总则

1. **表现只读世界**：动作与通道不许把状态写回世界。渲染层唯一的写操作是玩家操控（见 `input.manual`）。
2. **状态是底、动作是叠加**：没有动作时，画面必须仍然正确（只有状态）。
3. **可中断、可降级**：每条动作必须写清两件事——**被谁打断**（优先级 / 互斥）与**素材缺失时退成什么**
   （`fallback`）。没写降级的动作不许进词汇表。
4. **不新增每帧事件**，但**事件必须先对齐**（评审 P0-4）：live 模式发的是
   `task.assigned/completed/failed`，`task.changed` 只在模拟路径发；客户端对不认识的类型
   是静默 `default:return`，会永久停在旧状态。所以推导器的前提是 `wire.event.coverage`
   先落地（10 种事件全处理，未知事件诊断或重拉）。之后动作由**事件 + 快照差分**推导——
   宿主不涨事件量，推导器是纯函数、node 里可测。
5. **参数进内容，执行进代码**：演什么带、播多久、什么颜色、哪个素材，都来自内容库；
   代码只做时序、优先级与通道调度。调度参数（优先级/冷却）是**协议**，不是美术，住推导器。

---

## 三、信号源（动作从哪来）

| 信号 | 形状 | 到达方式 | 推出的动作 |
|---|---|---|---|
| `agent.state` | 带 `state` / `station` / `targetStation` / `carrying` / `facing` | SSE 增量 | `arrive` / `blocked` / `talk` |
| `task.changed` | 带 `status` / `progress` / `milestone` / `owner` | SSE 增量（**模拟路径**） | `pulse` / `deliver` / `fail` |
| `task.assigned` / `task.completed` / `task.failed` | 外部裁决（**live 路径**） | SSE 增量 | `pickup` / `deliver` / `fail`（**先归一化**，见下） |
| `message.sent` | 带 `from` / `to` / `deliverAtTick` | SSE 增量 | `message`（发送端）/ `message`（接收端，时刻可算） |
| 对话 SSE | `phase: thinking / acting / replied / failed` | 独立通道 | `talk` / `acting` / `fail` |
| 快照差分 | 上一帧本地世界 vs 新快照 | 重连 / 首次加载 | `spawn` / `depart` |
| 本地输入 | 点选、键盘 | DOM | `focus` / `manual` |

**归一化要求（P0 修完才允许开工）**：两条路径必须产出**同一种**客户端事件形状。
推荐做法是 host 侧统一发 `task.changed`（带 `patches.taskPatch` 的完整字段 + `reason`），
而不是让推导器同时认 4 种类型；在统一之前，推导器必须显式处理三种 live 事件，
不许落到 `default`。判据：**应用完事件后客户端世界 ≡ host**（往返测试）。

**为什么出生/离开只能靠快照差分**：世界事件里没有"角色出现/消失"这一对（`hire` 走的是编排层）。
差分是唯一不新增协议就能拿到它的方式；代价是重连时可能补演一次 `spawn`，用冷却压掉。

---

## 四、动作词汇表 v1（14 条）

> 分组：**life**（生命周期）、**task**（工单）、**collab**（协作）、**idle**（待命）、**input**（玩家）。
> `P` 是优先级（0–100，越大越硬）。

| id | 触发 | 通道 | P | 时长 | 结束 / 打断 | 素材缺失降级 |
|---|---|---|---|---|---|---|
| `life.spawn` | 快照差分里新出现的角色 | ground, body | 70 | 400ms | 按时长；被 `fail` 打断 | 原地淡入 |
| `life.depart` | 差分里消失的角色 | body, ground | 70 | 300ms | 按时长 | 直接移除（无表现） |
| `task.pickup` | `agent.state.carrying` 由 `null` 变非空 | label, body | 60 | 600ms | 被 `deliver`/`fail` 打断 | 只弹标签 |
| `task.arrive` | `walking → working` 且 `station` 变为非空 | body, prop | 50 | 300ms | 按时长 | 直接落位（吸附由位置负责） |
| `task.pulse` | `task.changed.milestone` 且 `owner === agent` | prop, body | 20 | 500ms | 被更高优先级打断 | **不许全无**：至少脚下环闪一下 |
| `task.deliver` | `task.changed.status → done` 且 `owner === agent` | body, label, prop | 80 | 1200ms | 不可打断（时长走完） | 程序化跳跃 + 标签飞入「完成」 |
| `task.fail` | `status → failed`，或对话 `phase: failed` | body, bubble | 85 | 1500ms | 不可打断 | 红点气泡 + 抖一下 |
| `task.blocked` | `state → blocked`，或 `task.changed.status → blocked` | body, bubble | 65 | 持续 | 状态离开 `blocked` 即收 | 头顶「受阻」角标 |
| `task.recovered` | `task.changed{reason:'recovered'}`（卡死被回收，评审 P1-8） | body, label | 55 | 900ms | 按时长；被 `pickup` 打断 | 头顶「退回待办」角标 + 抖一下 |
| `collab.message` | `message.sent`（发送端）+ `deliverAtTick`（接收端） | body, ground, prop | 40 | 到送达为止 | 送达或超时 | 纸条照飞（已有 `drawNotes`），角色不反应 |
| `collab.talk` | `state → talking` 或对话 `phase: thinking` 开始 | body, bubble | 55 | 轮次长度 | `replied`/`failed` 或状态离开 `talking` | 气泡在、身体保持 `idle` 带 |
| `idle.fidget` | 待命编排（已有 `IdleBehaviorSpec`） | body | 10 | `ticksMin..ticksMax` | 被任何更高优先级打断 | 站立不动 |
| `input.focus` | 点选角色 | ground, hud | 30 | 持续到取消选中 | 取消选中 / 选别人 | 无（门面仍有读数） |
| `input.manual` | 键盘推着走 | body | 75 | 持续到松手 | 松手 | 无 |

**入场规则**：只比较**同 (通道, 子槽)** 的占用者。新动作 `P` ≥ 当前占用者才能进场；
`P` 更高则换掉它（被换掉的按 `fallback` 收尾，没有就立即收）。`overlay` 不参与 `base` 的争夺。
同 `(actionId, agentId)` 在冷却窗内只触发一次——冷却以 **tick** 计（`cooldownTicks`），
`task.pulse` 取 `PROGRESS_MILESTONES` 的间隔（10% 一跳）并由协议层导出，
**不在 web 里抄一份 10%**（两处真相）。

---

## 四之二、反应 v1（5 条）

**动作是自己发起，反应是"别人做的事落到我身上"**。两者共用通道与优先级，但反应多一层**抑制**——
如果没有抑制，8 个人在同伴完工时一起鼓掌，看起来像故障而不是热闹。

| id | 触发 | 子槽 | P | 时长 | 表现 | 抑制 |
|---|---|---|---|---|---|---|
| `react.paper` | 纸条送达（`deliverAtTick` 时刻可算） | `body.overlay` + `bubble.overlay` | 35 | 500ms | 抬头 → 转向发送者 | 每人每消息一次；正在对话时不演 |
| `react.assigned` | `task.assigned` 事件（**外部/队长**指派），区别于自动领单 | `body.overlay` | 45 | 700ms | 转向派单者 + 点头 | 与 `task.pickup` 并行：pickup 占 `body.base`，本反应只叠 overlay |
| `react.rejected` | 评审被打回（`task.changed.status → failed` 且原因含评审） | `body.overlay` + `bubble.overlay` | 60 | 900ms | 挠头 + 红色叹号 | 每任务一次；`task.fail` 占 `bubble.base`，本反应叠 overlay |
| `react.peer.done` | 同伴完工（别人 `task.changed.status → done`） | `body.overlay` + `ground.overlay` | 25 | 800ms | 鼓掌（朝那人） | **每 2s 全局最多 2 人**；不庆祝自己；对方不在视野内不演 |
| `react.called` | 对话打开 / 被点名 | `body.overlay` | 30 | 400ms | 转向提问者 | 已经朝向时不重复；`collab.talk` 占 `body.base` |

四条硬规则（与 `CONTRACTS.md` §五一致，测试要钉住）：

1. **不反应自己**——自己完工走 `task.deliver`，不走 `react.peer.done`。
2. **群体反应有预算**——全局同时最多 2 条 `kind:'reaction'`，其余**静默降级**（不是排队，排队会在
   几秒后放出一串迟到的鼓掌，比不演更怪）。
3. **反应只进 overlay**——不抢主槽，因此不会被同事件的高优先级主动动作永久压死；
   同一 overlay 子槽内才比较优先级。
4. **反应无副作用**——不写世界、不发消息、不影响派单。

**碰撞真值表（`test/stage-actions.test.js` 必测）**：每条反应 × 当前占用者 → 期望赢家。
至少四组：`react.rejected` vs `task.fail`、`react.called` vs `collab.talk`、
`react.paper` vs `collab.message`、`react.assigned` vs `task.pickup`。

---

## 五、通道规格（每条通道的硬约束）

| 通道 | 主子槽 `base` | overlay 子槽 | 硬约束 |
|---|---|---|---|
| `body` | 状态基线（idle/walk/sit）与主动作 | 手势/抖动/点头 | `input.manual` 优先；`manual` 期间**动画不跟着粘**（R89）；任何动作不得把精灵停在半帧 |
| `bubble` | 一个主气泡（thinking/acting/replied） | 叹号、角标 | `bubble.base` 已被对话占用时，反应只叠 overlay；`bubble-place` 防重叠 |
| `label` | 头顶工单行（`core/task-label.js`） | 「退回待办」等短角标 | 与工单行共用错位布局；弹入/飞出各 ≤ 200ms |
| `ground` | 选中环、受阻虚线圈 | 落地光、鼓掌圈 | 画在 `entities` 层**之下**；不得盖住工单标签 |
| `prop` | 桌面/服务器脉冲 | — | 只在该角色**占着**这个站点时触发 |
| `hud` | 卡片/行动行 | — | 与面板同一套 token；不新造状态色 |

---

## 六、状态 → 基线（现有 `bandOfState` 的收口）

| 状态 | 2D 带 | 3D / 程序化 | 说明 |
|---|---|---|---|
| `idle` | `idle` | 呼吸起伏 | 待命编排可换成 `action.idle.*` 的带 |
| `walking` | `walk` | 走路循环 | 待命踱步也走这条（`targetStation === null` 时是踱步） |
| `working` | `sit` | 坐着干活 | 允许 `task.pulse` 叠加 |
| `talking` | `idle`（**素材缺口**：没有 `talk` 带） | 面向对方 + 轻微点头 | 降级到 idle，靠气泡表达 |
| `blocked` | `idle`（权重 1 的 `action.blocked`） | 低频摆动 | **靠 `task.blocked` 的角标区分**，不能只靠带 |
| `celebrating` | 无带（`action.celebrate` 的 `band` 是 null） | 一次性 tween | 目前等于不可见，v1 用 `task.deliver` 的程序化动作补上 |
| `sleeping` | `sit` | 低头 | 与 `working` 靠位置区分 |

**结论**：基线**不需要新状态**；缺口全在"素材"与"动作"两层。

---

## 七、数据形状（v1 的落点）

```ts
// 与 web/ 共享的类型：只放形状，不放实现（放 protocol/ 会被边界规则允许两边 import）
export type StageChannel = 'body' | 'bubble' | 'label' | 'ground' | 'prop' | 'hud'
/** 每个通道两个子槽：主槽同一时刻只有一个；overlay 可以叠，反应只走 overlay。 */
export type StageSlot = 'base' | 'overlay'

export type StageActionId =
  | 'life.spawn' | 'life.depart'
  | 'task.pickup' | 'task.arrive' | 'task.pulse' | 'task.deliver' | 'task.fail' | 'task.blocked'
  | 'task.recovered'
  | 'collab.message' | 'collab.talk'
  | 'idle.fidget'
  | 'input.focus' | 'input.manual'
  // 反应（他人事件触发，见 §四之二；kind = 'reaction'，只进 overlay）
  | 'react.paper' | 'react.assigned' | 'react.rejected' | 'react.peer.done' | 'react.called'

export interface StageActionSpec {
  id: StageActionId
  kind: 'action' | 'reaction'
  priority: number                 // 0–100；只在同 (通道, 子槽) 内比较
  slots: Partial<Record<StageChannel, StageSlot>>  // 例：{ body:'overlay', bubble:'overlay' }
  durationMs: number | null        // null = 持续型，必须给 endCondition
  endCondition: string | null      // 'state:blocked' | 'event:replied' | 'tick:+30' …
  cooldownTicks: number            // 用 tick 而非 ms：模拟是定步长的，避免 web 抄 sim 常量
  interruptible: boolean
  /** 内容 actions 库里的动作 id（band/clip/fade/speed 从那里取，代码不写 if）。 */
  visualRef: string | null
  /** 素材缺失 / 被抢占时的降级；null = 直接回落状态基线。 */
  fallback: StageActionId | null
}

export interface StageActionInstance {
  actionId: StageActionId
  agentId: string
  startedAtMs: number
  endsAtMs: number | null
  /** 已经降级了：素材缺失或被抢占，门面要能回答"为什么没演"。 */
  degraded: 'asset-missing' | 'preempted' | 'budget' | null
  /** 来的那条信号（诊断与验收用：能说清"这动作凭什么出现"）。 */
  source: { kind: 'event' | 'diff' | 'input' | 'dialogue'; ref: string }
}
```

**为什么必须有子槽（评审 P0-3）**：如果只有"通道 + 单优先级"，`react.rejected`（P60）
和 `task.fail`（P85）就是同一通道的两个竞争者，低的那个**永远进不来**。
拆成主子槽后，`task.fail` 占 `bubble.base`，`react.rejected` 叠 `bubble.overlay`——
两者都演，且语义清楚：一个是主体状态，一个是附加手势。

**主槽争夺**：同一 `(通道, base)` 内比较优先级，高进低出；`overlay` 不参与 base 的争夺，
只受全局预算与自身冷却约束。

**只有一份动作目录**：`StageActionId → visualRef`（内容 `actions` 库的 id）写成一张**测试钉住的映射表**，
不允许"舞台自己一套、内容库一套"。内容改权重/带名，舞台跟着变，不用改代码。

**推导器**（新文件 `web/core/stage-actions.js`，纯函数、node 可测）：

```js
export function deriveActions(prevWorld, nextWorld, events, nowMs, specs) // → StageActionInstance[]
export function activeActions(state, nowMs)                              // → 当前活跃动作
export function channelOwner(state, agentId, channel, slot)              // → 该子槽被谁占着
export function reactionBudget(state, nowMs)                             // → 当前还能进场几条反应
```

宿主侧**不需要**为舞台改动模拟内核；但 **live 事件覆盖必须先修**（`wire.event.coverage`），
否则推导器在 live 模式下拿不到工单生命周期。唯一可能的后补是"多面板同步"（音效/第二块屏），
那属于 R3 之后的事，届时不加新事件，而是把推导器搬到共享包。

---

## 八、素材缺口（内容层排队的事，按影响排序）

| 缺什么 | 卡住哪个动作 | 现行降级 | 优先级 |
|---|---|---|---|
| `talk` 动作带 | `collab.talk` 的身体 | 保持 `idle` 带 | 高 |
| `celebrating` 的帧或一次性 tween 参数 | `task.deliver` | 程序化跳跃 + 标签 | 高 |
| 「受阻」角标图标 | `task.blocked` | 头顶文字「受阻」 | 中 |
| 完工闪光（桌面/服务器） | `task.deliver` 的 `prop` 通道 | 只闪角色本身 | 中 |
| 「领单」手部动作帧 | `task.pickup` | 只弹标签 | 低 |

**规矩不变**：补素材 = 改内容库，不改 `web/` 的渲染代码；补不了就把 `fallback` 写清。

---

## 九、验收（能跑、能读、能看）

1. **单测**（`test/stage-actions.test.js`）：每条动作的触发条件、优先级抢占、冷却、降级；
   用构造的 `(prevWorld, nextWorld, events)` 断言产出，不碰 DOM。
   **必测碰撞真值表**（§四之二）：四条反应 vs 对应主动动作，断言"两个都在演"而不是"高的赢"。
   `degraded` 必须被记录（`asset-missing` / `preempted` / `budget`），否则"没演"无法归因。
2. **门面**：`?debug=1` 下挂 `__agentWorldStage`：
   - `.actions()` → 当前活跃动作（`[{ agentId, actionId, remainingMs }]`）
   - `.history(n)` → 最近 n 条动作（含 `source.ref`）
   - `.channels()` → 每个子槽当前占用者（查"叠没叠"）
3. **真机判据**：每个动作至少一条可读判据，不靠目测。例：
   - 领单后 600ms 内 `.history()` 里有 `task.pickup`，且该角色 `label` 通道占用者 = `task.pickup`；
   - 点完工后 `task.deliver` 在 `history` 里且 `body` 通道未被下一帧状态刷新抢走；
   - 受阻角色 `bubble` 通道占用者为 `task.blocked`，且 `channels()` 无重复占用。
4. **不回归**：现有全量测试绿；**2D** 帧预算不劣于基线（3D 门面不存在，别引用
   `__agentWorldScene3d.benchmark`）；`?debug=1` 的既有门面全在。

---

## 十、分批实现（建议顺序）

| 批 | 内容 | 判据 |
|---|---|---|
| **前置** | `wire.event.coverage`：统一发 `task.changed`（推荐）或推导器显式处理 3 种 live 事件 | **应用完事件后客户端世界 ≡ host** |
| **A** | 协议类型（含子槽/降级）+ 推导器骨架 + `task.pickup` / `task.arrive` / `task.deliver` / `task.fail` + 门面 + 单测 | 四个动作在真机可读；`degraded` 有记录；面板不回归 |
| **B** | 协作三条 + `task.recovered` + 五条反应：`collab.message` / `collab.talk` / `task.blocked` / `react.*`，overlay 接进渲染器 | 碰撞真值表全绿、气泡不叠、纸条两端都有反应、群体反应不超预算 |
| **C** | 素材补齐（`talk` 带、`celebrate` 帧、完工闪光）+ 视觉打磨，参数迁进内容库 | 换素材零代码改动 |

每批都按仓库规矩：只 `git add packages/dsh-agent-world`，更新 [`PROGRESS.md`](PROGRESS.md)。

---

## 十一、非目标（明确不做）

- 骨骼动画 / 蒙皮（超出 Phaser 像素管线）；
- 音效与粒子系统（没有素材与许可结论）；
- 每帧动作事件（协议第 4 条明确禁止）；
- 跨面板同步（多屏、音效）——留给 R3；
- 用动作**推断**世界状态（表现永远只读，不许反向影响调度）。
