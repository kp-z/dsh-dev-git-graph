# Agent 长期模型（Profile / Level / Knowledge / Task Sets）· v1

> 用户口径（2026-10-20）："**需要长远考虑每个 Agent 的相关设计，包括等级系统、个人 profile、
> 专属知识库、任务集等。** 最关键的是保证系统的可扩展性和稳定性。"
>
> 这是契约制度在 **Agent 域**的展开。制度本身见 [`CONTRACTS.md`](CONTRACTS.md)，
> 舞台表现见 [`STAGE-ACTIONS.md`](STAGE-ACTIONS.md)。

---

## 零、为什么需要长期模型

现在的 Agent 只有"当下"：7 个状态、一个位置、手里一张工单。面板一关，这个人就没了。
真实 subagent 那边有会话 id、模型、工具策略，但世界并不知道**这个人擅长什么、做过什么、知道什么**。

长期模型要回答四个问题：

| 问题 | 能力 | 一句话 |
|---|---|---|
| 这是谁？ | 身份 + profile | 同一张脸、同一个名字，跨会话认得出 |
| 他长多大？ | 等级 + 经验 | 做过的事留下痕迹，且可解释 |
| 他记得什么？ | 专属知识库 | 跨会话保留结论，但不污染上下文 |
| 他该干什么？ | 任务集 + 派单 | 能力匹配、公平、能结算 |

**这四个能力必须是"加在旁边的"，不是"长进内核的"**——否则每加一个就要动模拟内核，
可扩展性立刻归零。

---

## 一、三条纪律（先定边界，再谈设计）

1. **世界不伪造能力**。能力来自 DSH（模型、工具策略、会话）。世界的 `capabilities` 是**投影**，
   只用于任务匹配与表现；任何"提升能力"都必须回到 DSH，不许在世界里造一个。
2. **事实与派生物分离**。经验是**账本**（append-only 的事实），等级/统计是**派生**（可重算）。
   永不双写。这条决定了"改平衡曲线不用迁移数据"、"存档坏了还能重算"。
3. **长期状态不碰确定性**。profile / 账本 / 知识库都在模拟内核**之外**；
   投影进世界时只用 tick，不把墙上时间、文件 IO、随机数带进 `step()`。

---

## 二、身份：两层（人 ↔ 身体）

**先纠正一个事实（评审 P0-1）**：世界里的 `Agent.id` 现在**不是**会话 id，而是
**座位序号**——`src/state.ts` 按 `wanted.length` 生成 `agent-${index+1}`，会话 id 在
`boundAgentId`。这带来两个真问题：

- 新成员按"当前人数"取号，前面有人离开时**会撞上仍在役的 id**；
- 名字与座位绑定，换人就复用身份，与"不可变"直接冲突。

所以身份**分三层**，各自的生命周期不同：

| 层 | id | 生命周期 | 谁生成 | 例子 |
|---|---|---|---|---|
| **人（person）** | `personId` | 最长（跨会话、跨代次） | 档案服务，**一次性铸造** | `p-7f3a…` |
| **身体（body）** | `sessionId` | 短（一次会话/一个代次） | DSH | `01J...`、`agent-world:agent-5` |
| **座位（seat）** | `seatId` | 中（一次布局 / 一个工位） | 场景装配 | `seat-3`（**可复用**） |

- **档案、经验、知识全部挂在 `personId` 上**；`sessionId` 只是"当前这具身体"；
  `seatId` 只决定"长什么样、坐哪"，换人不影响档案。
- **世界的角色 id 必须一次性铸造**（持久化计数器或 UUID），**禁止**由数组长度/座位序号派生。
  现在的 `agent-${index+1}` 是 P0 必修；修完之前不许把 `agent.identity` 标 frozen。
- 绑定关系存在 `profiles/index.json`：`{ personId → { name, role, currentSessionId, seatId, retired } }`；
  一个 person 同一时刻最多一个 body；一个 seat 可以先后坐过多个 person（历史保留）。
- 名字的**唯一权威是团队投影**（`team.member` 已定"名字取投影名"）。`profile.displayName`
  是这份投影的**镜像**，不是第二个可写字段：改名只能改 DSH 会话/团队名，档案跟随。
  这样不会出现"档案改了名、投影还是旧名"的两个真相。
- **重名必须诊断，不许静默跳过**：现在 `state.ts` 对与队长同名的成员直接 `continue`，
  等于悄悄吞掉一个人。改成"保留 + 记 conflict + 看板提示"。
- 队长：`person:lead:<conversationId>`——队长是会话自己的 live agent（R167），
  换人会话说白了就是另一个人，符合直觉。

**稳定的收益**：成员会话挂了重建，还是同一个人、同一个等级、同一份记忆；
舞台上的脸不会"换了个新人但从零开始"；座位可以换，身份不跟着换。

---

## 三、Profile（档案）

### 3.1 形状

```ts
interface AgentProfile {
  schemaVersion: number          // 档案格式版本（不是等级曲线版本）
  personId: string               // 稳定身份
  displayName: string            // 团队投影的**镜像**（只读），改名去 DSH，不在这里写
  role: AgentRole                // lead / engineer / reviewer / researcher / ops / docs
  capabilities: Capability[]     // 声明式能力，只用于匹配与表现
  appearance: {
    modelId: string              // models 库 id（可换外观）
    palette: string              // 主色（花名册/看板/重上色都用它）
    badge: 'level' | 'none'      // 等级徽章样式
  }
  personaRef: string | null      // 内容库 rosters 的 id —— 存引用，不复制 prompt（单一真相）
  llm: AgentLlmRoute             // DSH 路由的**投影**（可能过期，随 join 时同步一次）
  toolPolicy: 'default' | 'restricted'
  createdAtTick: number
  retired: boolean
  /** 审计：最近一次改名/改外观/换身体。**不是**核心状态，可为空。 */
  lastChange: { kind: 'rename' | 'appearance' | 'rebind' | 'retire'; atTick: number; ref: string } | null
}
```

**为什么要 `schemaVersion` 而不是复用 `curveVersion`**：档案格式、等级曲线、知识条目格式
是三件独立演进的事，混成一个版本号会让任何一处小改都触发全量迁移。

**为什么允许墙上时间**：档案与账本是**模拟之外**的数据，写 ISO 时间没问题。
但**投影进世界的那一份必须只有 tick**——否则同一个存档在两台机器上重放会不一样（违反确定性）。

### 3.2 谁能改

| 字段 | 谁能改 | 规矩 |
|---|---|---|
| `personId` / `createdAtTick` | 没人 | 不可变 |
| `displayName` | **没人**（镜像） | 从团队投影同步；改名去 DSH 会话/团队 |
| `role` / `capabilities` | 人（受控） | 改能力等于改匹配结果，要审计 |
| `appearance` | 人 / 内容 | 外观可换，不动身份 |
| `personaRef` | 人 | 只存引用；内容改了就跟着变 |
| `level` / `xp` | **没人能直接改** | 只能通过账本追加（见第四节） |

**模型不能改自己的档案**。这是反自我膨胀的硬规则：否则"我给自己加一级"只需要一句自然语言。
**执法点必须写死**（评审 P1-6）：档案变更工具**不进模型工具面**，最多产出"提案"进审批队列；
`test/tool-surface.test.js` 断言工具面里没有 `set_profile` / `grant_xp` / `add_capability`
这类入口。审计日志不算审批——"记下来了"不等于"有人同意了"。

---

## 四、等级与经验

### 4.1 经验来源（只加不改）

| kind | 触发 | 默认 XP | 幂等键 | 备注 |
|---|---|---|---|---|
| `task.done` | 工单完成 | `base × difficulty` | `task:<taskId>:<attemptId>` | 难度 = 估算 tick / 依赖数 / 能力数，归一化 |
| `review.passed` | 评审通过 | 被评审单 XP 的 30% | `review:<taskId>:<attemptId>` | 只有评审者拿；评审者 = 负责人时不结算 |
| `task.rescued` | 卡死单被回收后重新完成 | 基础 × 0.3，按次数递减 | `rescue:<taskId>:<n>` | 鼓励修，但防刷 |
| `manual.grant` | 人工 | 显式数值 | `manual:<uuid>` | 必须带原因，进审计 |

**必须可解释**：每笔 XP 都能回答"凭什么加"（`source.ref` + `ruleVersion`）。
不可解释的经验 = 不可复算 = 不可迁移。

### 4.2 账本（事实）

```ts
interface XpEntry {
  id: string                 // 幂等键（重复写入被拒并记一条 duplicate）
  personId: string
  kind: XpKind
  amount: number
  source: { taskId?: string; attemptId?: string; ref?: string }
  atTick: number             // 用世界 tick，不用墙上时间（可重放）
  ruleVersion: string        // 结算规则版本，例如 'xp-r1'
  reason: string | null      // manual.grant 必填
}
```

- 文件：`profiles/<personId>/progress.jsonl`，**append-only**。
- **只追加、不修改、不删除**；写错了一笔就再追加一笔负数冲销（并留审计），
  永远不改历史——这是"可复算"的前提。
- 重放同一事件（SSE 重复投递、任务同步轮询）时，幂等键挡住，账本不变。

### 4.3 等级（派生）

```
xp        = Σ 账本条目（按幂等键去重后）
level     = curveLevel(xp, curveVersion)     // 单调不减，表驱动
progress  = 封顶 ? 1 : (xp - curveXp(level)) / (curveXp(level+1) - curveXp(level))
```

- **曲线进内容**：新增内容库 `levels`（第 12 个库，按 `content.library` 的「只增」规则加：
  协议 `LIBRARY_KINDS` + 内容 `LIBRARY_SPECS` + 校验 + 测试），条目形如 `{ level, xp }`。
- **`curveVersion` 只存在于派生配置/重算记录里，不进每条账本**（评审 P1-9）：
  每条账本只有 `ruleVersion`（解释"这笔金额怎么算的"）；求和时用**当前**曲线算等级，
  重算记录写进 `profiles/index.json` 的 `{ levelCurveVersion, recomputedAtTick }`。
  否则"旧条目钉旧曲线、新条目钉新曲线"，求和该用哪条就说不清，"换包重算"也不成立。
- **等级不是字段**：任何地方要等级都现场派生（可缓存，但缓存可丢弃）。
  改曲线 = 换 `levels` 包 + 重算，**不迁移任何数据**。
- 上限：曲线可以封顶；封顶后 XP 照记（战绩），等级停在 max。

### 4.4 等级的影响面（刻意做窄）

| 允许 | 不允许 |
|---|---|
| 舞台徽章 / 外观变体（`appearance.badge`） | 改变 `sim` 的 tick、状态机、工单正确性 |
| 任务集的**建议**等级（只进 UI 提示） | 硬性"等级不够不许接单"（会造成饿死） |
| 看板上的"资历"展示 | 影响确定性（任何等级逻辑都不许进 `step()`） |
| — | **进入派单**（v1 明确不做，见下） |

**为什么 v1 不做派单权重（评审 P0-2）**：等级存在 host 的档案里，而 `sim/` 按边界规则
只能 import `protocol` 与 `domain`。要让调度看见等级，只有两条路——把等级**拷进 `World`**
（派生量落盘当事实，改曲线后旧存档留过期值），或者让 `sim` 反向依赖档案服务（越界）。
两条都破坏这套制度自己的纪律。所以 v1 的答案是：**等级不参与派单**；
`recommendedLevel` 只是任务集里的建议，进 UI 提示，不进调度。
将来真要做，必须新开一条 `agent.level.projection` 契约（装配时单写、带 `curveVersion`、
随账本失效、进 world.json 迁移），并单独写公平性测试——不能顺手加个 `×0.5`。

### 4.5 防刷与上限

- 同一 `(taskId, attemptId)` 只结算一次（幂等键）；
- 单任务 XP 上限 = `base × 3`（防止估时被写大）；
- `task.rescued` 按任务计次递减（第 n 次 × 0.3^n，有下限）；
- 失败**不扣分**（扣分会让人不敢接单，是反激励）；失败只拿 0；
- 人工授予必须带原因，进 `audit.jsonl`。

### 4.6 迁移与重算

| 变了什么 | 怎么办 |
|---|---|
| 等级曲线 | 换 `levels` 内容包，等级自动重算（无数据迁移） |
| 结算规则 `ruleVersion` 变 | 新条目用新版本；旧条目保留原版本，**不重算历史**（历史是事实） |
| 账本条目格式变 | `schemaVersion` + 迁移函数；迁移失败的行隔离，保留其余 |

---

## 五、专属知识库

### 5.1 与 DSH 会话记忆的分工（**别混**）

| | DSH 会话记忆 | 世界知识库 |
|---|---|---|
| 范围 | 一次会话 | 跨会话、跨代次 |
| 内容 | 完整对话历史 | **只存结论**（事实/决定/偏好/教训） |
| 谁读 | 模型自己（上下文） | 检索后**注入**上下文（有预算） |
| 可审计 | 否（内部格式） | 是（条目化、可删除、可追溯来源） |
| 失败影响 | 会话没了 | 任务照跑，只是少了上下文 |

**为什么不直接把会话历史当知识库**：会话历史是过程，知识库要的是结论；
过程进检索会稀释信号、放大 token、还会把隐私带进别的会话。

### 5.2 条目形状

```ts
interface KnowledgeEntry {
  id: string
  schemaVersion: number
  owner: { kind: 'person'; personId: string } | { kind: 'team'; teamId: string } | { kind: 'world' }
  // teamId 取团队投影里的 teamName（如 "Agent World G2"），不另造 id
  scope: 'private' | 'team' | 'world'      // world = 所有人只读
  kind: 'fact' | 'decision' | 'preference' | 'lesson' | 'artifact'
  key: string | null                        // 语义键（同一 owner+key 才判冲突）；null = 不参与冲突判定
  text: string                              // 一句话结论，≤ 500 字
  source: { kind: 'task' | 'review' | 'manual' | 'event'; ref: string }
  tags: string[]
  /** 基础置信度（写入时定，**之后不可就地改**）。 */
  confidence: number                        // 0..1，人工=1，自动<1
  /** 派生：基础置信度 + 所有 amend 条目之和，夹在 0..1。 */
  effectiveConfidence?: number
  createdAtTick: number
  expiresAtTick: number | null              // null = 不过期
  /** 我替代了谁（方向：新 → 旧）。 */
  supersedes: string | null
  /** 谁替代了我（反向索引，由 later 条目写入，旧条目不改）。 */
  supersededBy: string | null
  /** 同 key 冲突的其它条目（双向写入，允许一条记录多个）。 */
  conflictWith: string[]
  tombstone: boolean                        // 删除留痕
  contentHash: string                       // 去重用
}
```

### 5.3 写入（三道闸）

| 闸 | 规则 |
|---|---|
| **来源** | 只有三种：任务完成（只抽结论/验收）、评审意见、人工显式写入。**不落原始对话** |
| **幂等** | 同 `(owner, contentHash)` 只留一条；重复写入返回已有 id，不新增 |
| **冲突** | 同一 `(owner, key)` 出现不同值 → **两条都留**，双向写 `conflictWith`，**不改任何已有字段**。`key` 为 null 的条目不参与冲突判定。**绝不静默覆盖** |
| **修正** | 置信度不就地改。要降/升就追加一条 `kind:'amend'`（`targetId` + `delta` + 原因），检索时算 `effectiveConfidence`（评审 P1-10） |

**为什么冲突不覆盖 / 为什么 amend 不改历史**：知识库最常见的坏法是"后来那条错的把对的顶掉，
而且没人知道"。append-only 是这套制度的地基：**任何"修正"都是新事实，不是改旧事实**。
所以冲突只加双向指针、置信度只加 amend 条目；`supersedes` 的方向也写死为"我替代谁"，
反向由 `supersededBy` 承担，避免"注释说一套、字段名说另一套"。

### 5.4 检索与注入

```ts
search({
  owner,                 // person + team + world 三层合并
  query: string,
  budget: { maxEntries: number; maxBytes: number },
  nowTick: number,
}): KnowledgeHit[]       // 空数组是合法结果
```

- 排序：`score = relevance × recency × confidence × scopeWeight`；
  **同分按 id 字典序**（保证同样输入同样输出，可测试）。
- 注入：作为 system prompt 的**独立段落**，标题写明"以下是你过去的笔记，可能过时或有误"。
  超过预算就截断（先截最低分），并记一条 `overloaded`。
- **空结果合法**：没有相关知识不算失败，任务照跑。
- 检索/注入超时 → **不注入**，记 `knowledge.unavailable`，任务继续。
- 世界只读 `scope='world'` 的条目；团队/私有条目不进别人的上下文。

### 5.5 遗忘

| 机制 | 规则 |
|---|---|
| TTL | `expiresAtTick` 到期不再检索（不物理删除） |
| 容量 | 每人 N 条（默认 500）；超了按 `lastUsedTick` 淘汰最低分（LRU + 置信度） |
| tombstone | 显式删除写 `tombstone: true`，检索跳过、审计可查 |
| 不可变 | 纠正错误知识 = 新增一条 + `supersedes` 指向旧条，**不改历史** |

### 5.6 隐私

- `scope` 是硬边界：私有条目永远不出现在别人的检索结果里（测试要钉）。
- 舞台**不显示知识正文**；最多显示"有 N 条记忆"这类摘要（可选，默认关）。
- 知识条目里不许出现密钥/凭据：写入器做一次模式扫描，命中就拒绝并报错。

---

## 六、任务集与派单

### 6.1 形状

```ts
interface TaskSet {
  id: string
  version: number
  title: string
  recommendedLevel: number | null   // 只进 UI 提示；派单不读它
  roles: AgentRole[]                // 适合谁
  tasks: TaskTemplate[]
}

interface TaskTemplate {
  key: string
  title: string
  description: string
  acceptance: string
  requires: Capability[]
  estimateTicks: number | null
  blockedBy: string[]               // 引用同集合内的 key
  difficulty: number                // 归一化到 0.5..2.0，用于 XP 与看板提示（不参与派单）
}
```

- 任务集是**纯内容**：新包 + 条目，不改代码（`content.pack.manifest` 已有能力）。
- 版本化 + 显式覆盖（`overrides` 写明 `tasks/<id>`），和现有内容规矩一致。
- 可组合：一个世界可以派多个集合（`origin.taskSets` 已经记了）。

### 6.2 派单（在现有 `claimTasks` 上加，不重写）

现有流程：`idle` 角色 → 能力匹配的空闲站点 → 原子 claim。
长期模型只加两步，且都在**确定性**范围内，**不读等级**（评审 P0-2）：

1. **能力硬匹配**（已有：任务的 `requires` × 站点能力）；
2. **等级建议只进 UI**：`recommendedLevel` 用于看板提示"这张单更适合资深的人"，
   **不参与权重**——等级在 host 档案里，`sim` 看不到（看到就得拷进 World，产生第二份等级）；
3. **负载**：手上已有单的人排后面（现在一次只拿一张，天然成立）；
4. **公平**：等待超过 `starvationTicks`（默认 600 tick）的 `ready` 单，权重 × 2；
   同分按 `ordinal` 升序——**必须有确定的 tie-break**，否则同 seed 两跑结果不同。

### 6.3 结算

- 完成事件 → 结算 XP（幂等），写账本；**不写等级**。
- 任务集可以给"额外奖励"（集合完成奖励），同样是账本条目。
- 与 agent-teams 任务的映射沿用 `externalId`（已有），不新造同步机制。

---

## 七、投影到舞台（长期状态只露该露的）

| 档案/账本字段 | 舞台通道 | 规则 |
|---|---|---|
| `displayName` | `label` / 卡片标题 | **镜像团队投影**；改名去 DSH，不在档案里独立改 |
| `personId` | （不显示） | 舞台只画人，不暴露内部 id |
| `appearance.palette` | 角色主色 | 同一个人恒定 |
| `appearance.modelId` | 精灵/模型 | 换外观不动身份 |
| `level`（派生） | 头顶徽章 / 成员卡角标 | 只在等级变化时重绘，不每帧算 |
| `capabilities` | 详情面板（可选） | 不画在舞台上 |
| `xp` / `progress` | — | 舞台上只显示等级与进度条，不显示数字 |
| 知识条目 | —（摘要可选） | **永不显示正文** |

**预算**：徽章是一段文字/一张小图，不新增每帧 draw call；等级变化才更新。
舞台契约（`stage.*`）不因为长期模型而新增"每帧查档案"的路径。

---

## 八、存储布局与版本

```
<stateDir>/
  sessions/<session>/world.json        # 世界（已有）
  profiles/
    index.json                         # personId ↔ 名字/角色/当前 body/退役
    <personId>.json                    # AgentProfile（原子写）
    <personId>/
      progress.jsonl                   # XP 账本（append-only）
      knowledge.jsonl                  # 知识条目（append-only + tombstone）
  audit.jsonl                          # 改名/授予/退役/换身体（append-only）
```

| 文件 | 版本字段 | 迁移 |
|---|---|---|
| `index.json` | `schemaVersion` | 逐版本迁移；坏了重建（从 profile 文件扫） |
| `<personId>.json` | `schemaVersion` | 逐版本迁移；失败 → 用花名册默认档案，**不阻断** |
| `progress.jsonl` | 每行 `schemaVersion` | 坏行隔离；好行保留；重算等级 |
| `knowledge.jsonl` | 每行 `schemaVersion` | 坏行隔离；未知 `kind` 降级为 `fact` |

**为什么全是 JSONL**：和 `events.jsonl` 同一种办法——被杀进程最坏只损失最后不完整的一行，
其余照读。档案要"可审计、可重建"，append-only 比数据库更符合这个仓库的体量。

---

## 九、失败与降级（每一层都不许拖垮世界）

| 失败 | 行为 | 观测 |
|---|---|---|
| 档案缺失 | 用内容库 `rosters` 的默认档案（无等级） | `profile.missing` 计数 |
| 档案损坏 | 隔离该文件，用默认档案；原文件改名留证 | `profile.corrupt` + 路径 |
| 账本坏行 | 跳过坏行，其余照算；等级可能偏低 | `xp.badline` 计数 |
| 等级曲线未知版本 | 用内置默认曲线并警告 | `level.curve.fallback` |
| 知识库不可用 / 超时 | 不注入，任务照跑 | `knowledge.unavailable` |
| 知识条目冲突 | 两条都留、降置信度 | `knowledge.conflict` 计数 |
| person 退役 | 从派单池移除，档案保留可查 | `profile.retired` |

**一句话**：长期模型是"增强"，不是"依赖"——它全挂了，世界也应当能跑完一局。

---

## 十、契约清单（本文件负责的 A / K / J 组，共 14 条）

| 契约 | 等级 | 关键验收 |
|---|---|---|
| `agent.identity` | 📘 standard | personId 不可变、座位可复用、角色 id 一次性铸造、重名有诊断 |
| `agent.profile.shape` | 📘 standard | 形状校验；名字是投影镜像 |
| `agent.profile.write` | 📘 standard | 工具面没有改档案/发 XP/加能力的入口 |
| `agent.level.ledger` | 🧪 experimental | append-only、幂等、重放不增 |
| `agent.level.derive` | 🧪 experimental | 同账本 ⇒ 同等级；改曲线不迁移 |
| `agent.capability` | 📘 standard | 只匹配、不授权 |
| `agent.lifecycle` | 📘 standard | 招募 / 换身体 / 退役；退役保留档案 |
| `knowledge.entry` | 🧪 experimental | 形状 + scope 硬边界 |
| `knowledge.write` | 🧪 experimental | 幂等、去重、冲突保留 |
| `knowledge.retrieve` | 🧪 experimental | 预算、确定性排序、空结果合法 |
| `knowledge.forget` | 🧪 experimental | TTL / 容量 / tombstone |
| `taskset.definition` | 📘 standard | 内容包版本与覆盖 |
| `taskset.dispatch` | 📘 standard | 确定性 tie-break、防饿死 |
| `taskset.reward` | 🧪 experimental | 结算幂等、失败不扣 |

从 🧪 升 📘 的条件：**连续两个版本没有破坏性改动，且验收进了全量测试**。

---

## 十一、路线图

| 阶段 | 做什么 | 不做什么（刻意） |
|---|---|---|
| **P2 · 档案与等级** | 三层身份（person/body/seat）+ 角色 id 一次性铸造、profile 文件、XP 账本、等级派生、舞台徽章 | **不做派单权重**；要做得先开 `agent.level.projection` |
| **P3 · 知识库** | 条目/写入/检索/遗忘四件套、注入预算、空结果与超时降级 | 不做自动向量检索（先用标签 + 词面，够用且可测） |
| **P4 · 任务集** | 集合定义、等级建议（只进 UI）、防饿死、结算幂等 | 不做"等级硬门槛"，也不进派单 |

**顺序理由**：身份是地基（等级与知识都挂在 `personId` 上），而现在的 `agent-${index+1}`
必须先改成一次性铸造；等级只需要账本 + 派生，是最便宜的一块；知识库要等身份稳定，
否则迁移会失控；任务集最后做，因为它依赖结算（账本），但**不依赖等级**。

---

## 十二、修订记录（v1.1：红队评审后的处理）

| # | 问题 | 处理 |
|---|---|---|
| P0-1 | `Agent.id` 是座位序号、会撞在役 id；personId 拿座位当身份；名字两个真相 | 改成三层身份（person/body/seat），id 一次性铸造；名字以团队投影为唯一权威、档案只镜像；重名必须诊断 |
| P0-2 | 等级进派单必须拷进 World，违反派生纪律与边界 | **v1 等级不参与派单**；`recommendedLevel` 只进 UI；要做得先开新契约 |
| P1-6 | "模型不能改档案"没有执法点 | 档案变更工具不进模型工具面，只出提案；补工具面测试 |
| P1-9 | `curveVersion` 声称在账本每条，实际只有 `ruleVersion` | `curveVersion` 移到派生配置/重算记录，账本只留 `ruleVersion` |
| P1-10 | 知识冲突就地改置信度、`supersedes` 方向反了 | 加 `conflictWith` / `supersededBy` / `amend` 条目；置信度派生 |

---

## 十三、非目标

- 不做"模型自己改档案/自己发 XP"（不可审计的能力等于没有边界）；
- 不做跨用户知识共享（当前一个会话一个世界，没有多租户）；
- 不做向量数据库（引入外部依赖与不确定性，先用手写检索，接口形状不变）；
- 不用等级做硬门槛（会饿死新人，且偏差不可见）；
- 不把长期状态写进 `world.json`（世界是"当下"，档案是"历史"）。
