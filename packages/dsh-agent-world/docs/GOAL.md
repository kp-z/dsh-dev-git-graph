# 目标与架构：让"能和场景里的小人物对话、让他们干活"成为事实

> **这份文档是权威目标。** 与之冲突的旧计划以这里为准；实现顺序以 `docs/BACKLOG.md` 为准。
> 写于 R22（用户第一次把最终目标说清楚的那一轮）。

## 一、用户要的最终效果（原话）

> 在一个网页上，利用 DSH 的对话机制和它的 AI 基座作为基础，在游戏场景里面
> 控制并与不同的 Agent（即里面的小人物）进行对话，让他们干活。

拆成四条可验收的能力：

| # | 能力 | 验收长什么样 |
|---|---|---|
| G1 | **一个网页** | 打开 `/agent-world/` 就能看到 3D 小镇（**已经有**，R15–R20） |
| G2 | **点一个小人物，跟他说话** | 点角色 → 出现对话面板 → 打字发送 → 他用自己的语气回话 |
| G3 | **用 DSH 的 AI 基座**（不是自己接第三方 LLM） | 每个角色的"脑子"是一个真实的 DSH Agent 会话，走 DSH 的模型配置与工具机制 |
| G4 | **让他们干活** | 对话里说"你去修那个登录 bug" → 角色**真的动起来**去工位、任务板真的出现这张单 |

**G4 是这一整套设计的意义所在**，也是最容易做成"演示玩具"的一环。判据很具体：
**对话必须通过工具/命令改变世界，而不是改画面。**

## 二、架构（关键决策）

```
                     ┌─────────────────────────────────────────────┐
   面板（网页）        │  宿主（插件）                                 │
   ────────────       │  ───────────────────────────────────────── │
   3D 场景 + 对话面板  │  sim/  确定性世界（tick、调度、寻路）          │
        ▲  │          │    ▲            ▲                          │
        │  │ 事件流    │    │ 命令        │ 人设（内容库 rosters）      │
        │  └─────────▶│  dispatch/say   │                          │
        │             │  ┌──────────────┴───────────────────────┐ │
        └─────────────┼──│ bridge/  每个角色 ↔ 一个 DSH Agent      │ │
          SSE 事件     │  │  · 懒创建（第一次搭话才建会话）          │ │
                      │  │  · seed 注入 system prompt（人设）      │ │
                      │  │  · Agent 只能通过**工具**改变世界        │ │
                      │  └──────────────────────────────────────┘ │
                      └─────────────────────────────────────────────┘
```

### 决策 D35：宿主是权威，"脑子"是插件

- **世界状态只由 `sim/` 推进**（D20 的 `step(world, commands)` 不变）。
- **DSH Agent 负责"想"与"说"，不直接改状态**。它想干活，只能调工具
  （`agent_world_dispatch` 已有；`agent_world_say` / `agent_world_claim` 待加）。
- 这条把"AI 让世界动起来"限制在**一条可审计、可回放、可测试**的路径上：
  与人类玩家、与规则调度器走的是同一个 `commands` 入口。
  **不允许** Agent 直接写 `world`——那会让确定性、存档与回放全部失效。

### 决策 D36：一个角色 = 一个 DSH 会话，**懒创建**

- 8 个角色 × 常驻会话 = 8 份上下文与 8 次模型加载。多数角色整局都没人搭话。
- 所以：**第一次与某个角色对话时才创建他的 Agent 会话**；之后复用。
- 成本可见：面板显示"已唤醒的角色数 / 会话数"，并有一个上限（配置项）。

### 决策 D37：人设来自内容库，不写进代码

- 角色的 `system prompt` 由 `rosters` 库的条目（`role`/`name`/将来加 `persona`）
  **生成**，不是代码里的字面量。
- 理由与 D31（模型选择是内容）同源：**"这个角色是什么人"是内容**。
  换一个花名册 = 换一套性格，不改一行代码。
- 内容侧要新增的字段（`persona` / `speechStyle` / `goals`）属于内容 schema 变更，
  要按 R16 的规矩走：显式、有校验、报错给可用取值。

### 决策 D38：对话是**世界里的事件**，不是旁路

- 一次对话产生：`user → agent` 与 `assistant → world` 两类记录。
- 它们进事件流（SSE 推给所有面板），所以**多开一个面板能看到同一段对话**，
  存档回放也能重现"谁在什么时候说了什么"。
- 这与 R10 定的"纸条事件"同构：**对话也是世界里发生的事**。

## 三、已核实的 DSH 接口（R22 用 Inspect Provider 查的，不是猜的）

> 方法：`cordis_inspect_query({platform:'host', provider:'Service', method:'listService'})`。
> 先取目录，再取单个服务的**确切契约与引用类型**。**后续任何 DSH 接口问题都这样查，不要猜。**

```ts
// ctx.agentLoop（@deepseek-ai/dsh-agent-loop 提供）
createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>
resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>

interface CreateAgentOptions {
  readonly sessionId: SessionId
  readonly parentAgent?: Agent
  readonly meta?: { cwd?, parentSession?, isSeeded?, origin?: 'subagent', delegationDepth?, agentPreset? }
  readonly seed?: readonly SessionEvent[]          // ← **人设从这里进去**
  readonly agentOptions?: { provider?, model?, reasoningEffort?, maxTokens? }
  readonly signal?: AbortSignal
  readonly setup?: (agentCtx: Context, agent: Agent) => void | AgentSetupCommit
}
interface AgentHandle { agent: Agent; dispose(): Promise<void> }
interface Agent { readonly id: SessionId }
```

- `SessionEventMap['system/message'] = { turn, step, message: SystemMessage }`
  → 用 `seed` 造一条 `system/message` 就是该角色的 system prompt。
- `SessionEventMap['assistant/message']` 带 `stream: AssistantStreamRecord[]`
  → 回复文本从流式记录里拼。
- 其他相关服务：`agents`（`create`/`get`/`list`/`register`）、`subagents`
  （`start`/`startContinuable`/`sendMessage`/`prompt`）、`agentTeams`

**还没查清的（下一轮第一件事，用同样的方法查）**：**怎么把一条用户消息送进已创建的 Agent
并拿到回复**（`agent.prompt(...)`？`ctx.sessions` 的某个方法？`subagents.sendMessage`？），
以及**怎么订阅它的 `assistant/message`**（事件还是回调）。

## 四、里程碑（每个都要能独立验收）

| # | 里程碑 | 验收 | 依赖 |
|---|---|---|---|
| **M6-0** | **查清"怎么给 Agent 发话、怎么收回复"** | 写进本文档第三节的空白处，附 Inspect 原始输出 | —— |
| **M6-1** | 角色 ↔ DSH 会话绑定（懒创建 + 上限 + dispose） | 单测：同一角色两次搭话只建一次会话；上限生效 | M6-0 |
| **M6-2** | 人设 → system prompt（从 `rosters` 生成） | 单测：给定花名册条目，生成的 prompt 含姓名/职业/语气；内容改了 prompt 跟着变 | M6-1 |
| **M6-3** | 对话通道：面板 POST `/api/say` → Agent → 回复 | 浏览器实测：打字 → 气泡里出现**该角色语气**的回复 | M6-1 |
| **M6-4** | **让角色干活**：Agent 调世界工具并产生可见变化 | 浏览器实测：说"去修登录 bug" → 任务板出现该单 + 角色走向工位 | M6-3 + 工具 |
| **M6-5** | 对话 UI（3D 里头顶气泡 + 侧栏对话面板） | 浏览器实测 + 截图 | M6-3 |
| **M6-6** | 对话落库与回放（进现有事件日志） | 单测：重开一局后能读到上一局的对话 | M6-3 |

**M6-0 必须最先做**，因为后面每一件都要用它；而它只需要查文档 + 一个最小实验，
是**最适合并行开始时先派出去**的一件。

## 五、红线（延伸现有那些，不新增例外）

1. **AI 不能绕过命令改世界**（D35）。工具是唯一入口。
2. **人设是内容**（D37）。代码里不许出现角色名、性格描述、台词。
3. **对话是事件**（D38）。不许做成面板与模型之间的私有旁路。
4. **模拟仍确定性**：`src/sim/` 里不许出现 `Date.now()`/`Math.random()`——
   对话带来的时间戳与随机性都留在 `bridge/`（宿主侧、非确定性边界之外）。
5. **成本可见可控**：会话懒创建 + 有上限 + 面板显示会话数。
6. **失败要退化，不要卡住**：模型不可用/超时 → 角色保持原行为，面板给出明确原因
   （沿用 R19 那条"灰蓝=加载中 / 品红=出错"的思路：宁可显示"他说不出话"，也不要装作没事）。
7. **前端不卡**（R21 的结论直接沿用）：`benchmark()` 与状态栏性能行是既有工具，
   加对话 UI 之后要重新量一次。

## 六、这一目标改变了什么（对已有计划的修正）

- **优先级**：`M5-2`（动作库 / 32 条剪辑）不再是最高优先——**M6 系列在它前面**。
  对话是用户要的核心；角色动画是"更好看"，可以后做。
- **`M4-11`（站点组合道具）仍然做**，但排在 M6-3 之后：椅子/显示器让场景像办公室，
  而"能和小人物说话"是用户真正要的那件事。
- **内容侧要准备**：`rosters` 需要 `persona`/`speechStyle`（D37），
  这是下一步的内容 schema 变更。

## 七、每一轮的工作方式（沿用，且这一轮补了一条）

1. 读 `docs/PROGRESS.md` 最上面那条「下一轮从哪继续」；
2. 取 BACKLOG 里依赖满足的 `ready`，**一次 1–2 件**；
3. 跑 `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck` 与 `pnpm test`；
4. 记账 + 只 `git add packages/dsh-agent-world` 后提交；
5. **新的一条（R22 补）**：**涉及 DSH 接口时，先用 Inspect Provider 查确切契约再写代码**。
   本项目在 R17 之前靠猜接口吃过亏；Inspect 是免费的，猜不是。
