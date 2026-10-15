# M6-0 侦查报告：怎么给一个 DSH Agent 发话、怎么收回复

> 作者：`bridge`（宿主侧工程师）。写于 M6-0。
> 方法：**只用 Inspect Provider + 已安装 DSH 包的真实实现**，不猜接口（GOAL.md 第七节第 5 条）。
> 本文每一条都带**原始证据**（查询参数 + 返回片段 + 文件行号）。

## 0. 结论（先给答案）

| 问题 | 答案 | 证据 |
|---|---|---|
| 怎么把一条用户消息送进已创建的 Agent？ | **`ctx.sessionController.prompt(request, signal)`** | §2.1 / §3 |
| 怎么订阅它的回复？ | **`ctx.on('session/event', (session, event) => ...)`**，过滤 `event.type === 'assistant/message'` | §2.2 / §4 |
| 一轮结束怎么知道？ | 同上，再过滤 `event.type === 'turn/end'` | §2.2 |
| 回复文本在哪？ | `event.data.message.content` 里的 `{type:'text', text}` 块。**不要去拼 `event.data.stream`** | §4.2 |

**没有 `agent.prompt()` 这种方法。** Inspect 给出的 `Agent` 接口只有 `{ readonly id: SessionId }`（§2.3）。
运行时的 `agent.followup()` / `agent.steer()` 确实存在，但**不是公开契约**（§3.2）——
我们要走的是 `sessionController.prompt`，它是被 `@Remote('prompt')` 正式暴露的那个入口。

## 1. 侦查方法（可复现）

```
cordis_inspect_query({ platform:'host', provider:'Service', method:'listService' })            // 取服务目录
cordis_inspect_query({ platform:'host', provider:'Service', method:'listService',
                       input:{ service:'sessionController' } })                                // 取单个服务确切契约
cordis_inspect_query({ platform:'host', provider:'Event',   method:'listEvents' })             // 取事件目录
```

目录结果很大（`listService` 不带 input 时溢写 31KB+），**直接 grep 溢写文件**比反复发大查询高效。
本次溢写路径：`/var/folders/.../dsh-spill-*/session-*/98a0c018a7c4-cordis_inspect_query.txt`。

目录里与"会话"相关的服务共 12 个（`grep '"key"' <溢写文件>` 得到）：
`sessionController`(L1038) / `sessionFeedback`(1110) / `sessionFileReferences`(1119) /
`sessionPersistence`(1128) / `sessionProjectionCache`(1152) / `sessionProjections`(1173) /
`sessionQuery`(1212) / `sessionReferenceResolver`(1263) / **`sessions`(1278)** /
`sessionSkillCatalog`(1311) / `sessionTelemetry`(1320) / `sessionTitle`(1338)。

**`sessions` 不是发话的地方**，它只是内存存储（`create`/`prepare`/`enter`/`announce`/`get`/`list`/`fork`），
**没有任何 `prompt`/`send`/`post` 方法**（§2.4）。这条排除了一个错误方向，值得记下来。

## 2. Inspect 原始返回片段

### 2.1 `sessionController.prompt` / `follow` —— 发话与订阅的服务入口

查询：`{platform:'host', provider:'Service', method:'listService', input:{service:'sessionController'}}`

```ts
// ctx.sessionController（@deepseek-ai/dsh-api-session-controller 提供）
"key": "sessionController",
"description": "Host service backing the generated `ctx.remote.session` namespace.",
"access": { "optional": { "expression": "ctx.get(\"sessionController\")" },
            "hardDependency": { "inject": ["sessionController"], "expression": "ctx.sessionController" } }

@Remote('prompt') prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue>
//   description: "Admit one prompt after explicitly resuming its Session."
//   returns:     "acknowledgement that the Agent accepted the prompt."

@Remote({ mode: 'stream' }) follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame>
//   description: "Follow one Session log from its opening or resume cursor."
//   returns:     "a complete opening snapshot followed by gap-free durable event frames
//                 and optional cursorless assistant-stream frames."

resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult>
//   description: "Resolve or resume one ordinary Session for another Host API domain."
```

引用类型（同一次查询返回）：

```ts
export interface SessionPromptRequest {
    readonly requestId: SessionRequestId;                 // Branded<'session-request-id'>
    readonly sessionId: SessionId;
    readonly mode: 'queue' | 'steer';
    readonly content: readonly PromptContentPart[];
    readonly clientTimeZone?: string;
}
export interface SessionPromptValue { readonly accepted: true; }
export type ApiSessionAgentResult = { readonly agent: Agent } | { readonly error: ApiSessionAgentError };
export type ApiSessionAgentError =
    RemoteError<'session/not-found' | 'session/agent-busy' | 'session/writer-held' | 'gateway/internal'>;
export interface SessionFollowFrame ... // snapshot | event | assistant-stream
```

### 2.2 `'session/event'` —— 订阅回复的事件

查询：`{platform:'host', provider:'Event', method:'listEvents'}`

```ts
{
  "name": "session/event",
  "description": "Post-commit, fire-and-forget append feed.",
  "mode": "emit",
  "signature": "'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void"
}
```

同目录里另外两个**我们不需要**的候选，记下来避免走弯路：

- `'agent/assistant-stream'`：`"Process-local assistant-stream publication."`，
  `'agent/assistant-stream'(this: Scoped<Agent>, payload: { agent: Agent; frame: AssistantStreamFrame }): void`
  —— 逐 token 流，**只在"打字机效果"需要时才用**；M6-3 的"说完一句话"用 `session/event` 足够。
- `'agent/status'`（`idle ⇄ running`）与 `'agent/error'`（`{agent, turn, step, error}`）
  —— 做"角色思考中"指示灯与错误退化时会用到。

`SessionEvent` 的形状（`sessions` 服务查询返回）：

```ts
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
    [K in SessionEventType]: {
        type: K;
        seq: SessionSeq;
        time: number;
        data: SessionEventMap[K];
        ignorable?: true;
    } & (K extends SurfaceEventType ? SurfaceIntent<K> : { surfaceOp?: never; sourceEventSeqs?: never });
}[T];
```

`SessionEventMap` 里我们要的两个：

```ts
'assistant/message': { turn: number; step: number; message: AssistantMessage;
                       stream: AssistantStreamRecord[]; usage?: TokenUsage; interrupted?: true; };
'turn/end':          { turn: number; reason: TurnEndReason };
```

`TurnEndReasonMap` 的 7 个 kind：`completed` / `aborted{reason}` / `blocked` / `error{error:LlmFailure}` /
`max-tokens` / `interrupted` / `forked`。**`reason.kind === 'error'` 就是"他说不出话"的判据**（红线第 6 条）。

### 2.3 `Agent` 就是这个

```ts
export interface Agent { readonly id: SessionId; }
```

**没有 prompt/send/tell 方法。** 这一条决定了我们必须从 `sessionController` 走。

### 2.4 `sessions` 服务（用来排除错误方向）

```ts
"key": "sessions", "description": "In-memory session store (`ctx.sessions`)."
registerMessageProjection / create / prepare / enter / announce / flush / get / list / fork
```

`Session` 类（同查询返回）**只有读取与 append**，没有"投递用户消息"：

```ts
export class Session {
    get surface(): SessionSurface;
    readonly header: SessionHeader;
    get id(): SessionId; get seq(): SessionLogOffset;
    eventAt(seq): SessionEvent | undefined;
    snapshotEvents(fromSeq?, toSeqExclusive?): readonly SessionEvent[];
    ownEvents(): readonly SessionEvent[];
    append<T extends SessionEventType>(type: T, data: SessionEventMap[T], ...opts): SessionEvent<T>;
    deriveMessages(): Message[];
}
```

### 2.5 `createAgent` 的 `CreateAgentOptions`（GOAL.md 第三节已记，这里补全 `seed` 的类型）

```ts
export interface CreateAgentOptions {
    readonly sessionId: SessionId;
    readonly parentAgent?: Agent;
    readonly meta?: { cwd?; parentSession?; isSeeded?; origin?: 'subagent'; delegationDepth?; agentPreset? };
    readonly inheritedEventCount?: SessionLogOffset;
    readonly seed?: readonly SessionEvent[];      // ← 人设从这里进去
    readonly agentOptions?: AgentOptions;         // { provider?, model?, reasoningEffort?, maxTokens? }
    readonly signal?: AbortSignal;
    readonly setup?: AgentSetup;                  // (agentCtx, agent) => AgentSetupCommit | void
}
export interface AgentHandle { agent: Agent; dispose(): Promise<void>; }
```

## 3. 运行时实现证据（`sessionController.prompt` 到底干了什么）

Inspect 给的是契约；契约背后的实现决定了**错误怎么退化**，所以我把实现也读了。
文件：`/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js`

### 3.1 服务方法只是转发（L3096）

```js
prompt(request, signal) {
    signal.throwIfAborted();          // ← 必须传 signal，否则第一次调用就抛
    return this.commands.prompt(request);
}
```
`this.commands` 在 L2850 构造：`new SessionCommandController(ctx, this.agents, process.cwd())`。

### 3.2 `SessionCommandController.prompt`（L850 起，全文要点）

```js
async prompt(request) {
    if (!hasPromptContent(request.content))
        throw new RemoteError("gateway/bad-request",
            "prompt content must include non-whitespace text or an attachment", {});
    const clientTimeZone = request.clientTimeZone === void 0 ? void 0 : canonicalClientTimeZone(request.clientTimeZone);
    if (request.clientTimeZone !== void 0 && clientTimeZone === void 0)
        throw new RemoteError("session/invalid-time-zone", ...);
    const agent = await this.resolveAgent(request.sessionId);               // ← 冷会话自动 resume
    if (hasPromptRequest(agent, request.requestId)) return { accepted: true };   // ← requestId 幂等
    const source = { kind: "user", rpcId: request.requestId, ... };
    ...
        const message = createUserMessage({
            content: await this.ctx.attachments.admitPromptContent(admission.content),
            source
        });
        if (this.ctx.agents.get(agent.id) !== agent)
            throw new RemoteError("session/not-found", `session "${agent.id}" was disposed during prompt admission`, ...);
        const binding = this.ctx.fileUploads.bindPrompt(agent, admission.receiptIds, request.requestId);
        if (request.mode === "steer") agent.steer(message);
        else                          agent.followup(message);               // ← 真正投递
        binding.commit();
    ...
    return { accepted: true };
}
```

**从这段实现里得到的 4 条可操作事实：**

1. **`requestId` 是幂等键。** 同一个 requestId 重复 `prompt` 直接返回 `{accepted:true}` 而**不重复投递**
   （`hasPromptRequest(agent, requestId)`）。重试安全 —— 我们的 `/api/say` 断线重发不会让角色说两遍。
2. **空内容会被拒**：`gateway/bad-request`。所以面板发空串要在 bridge 里先挡掉，给出更好读的原因。
3. **`mode:'queue'` → `agent.followup()`，`mode:'steer'` → `agent.steer()`。**
   对话语义用 `queue`（排队到下一个 turn）；"打断他正在干的事"才用 `steer`。
4. **错误码就是我们"退化时给的原因"**：`session/not-found` / `session/agent-busy` / `session/writer-held` /
   `gateway/internal` / `gateway/bad-request`（§2.1 + §3.2）。bridge 要把它们翻译成能直接下手的中文原因。

### 3.3 `PromptContentPart` 的确切形状（Inspect 的 `PromptContentPart` 没展开，从 typert schema 取）

`grep -oE "PromptContentPart.{0,250}" .../dsh-api-session-controller/lib/typert.host.js`：

```ts
PromptContentPart =
    | { readonly type: 'text';  readonly text: string; }
    | { readonly type: 'image'; readonly mediaType: ImageMediaType; readonly data: string; readonly name?: string; }
    | { readonly type: 'file';  readonly receiptId: Branded<'file-upload-receipt-id'>; };
```

`dsh-tool-cordis/lib/types/api-catalog.js` 里同一名字还有一版（attachment 形态），
两版的 `text` 分支一致 —— **我们只用 `{type:'text', text}`**，这一支没有歧义。

## 4. 本仓库里已经在用的真实范例（比自己写前先抄）

> 这两个是本仓库真实在跑的其他 DSH 插件，**它们证实了订阅写法**。

### 4.1 `dsh-taskboard`（`dsh-taskboard/src/index.ts:97`）

```ts
const events: EventsFace = {
  onSessionEvent: (listener) => wsCtx.on('session/event', (session, event) => {
    listener(session.id, event as { type: string; data?: unknown }, session as never)
  }),
}
```

→ 订阅就是 **`ctx.on('session/event', (session, event) => ...)`**，`session.id` 拿会话身份，
`event.type` / `event.data` 拿内容。**没有 remote/carrier 依赖**，宿主侧插件可直接订阅。

### 4.2 `dsh-mermaid-comm`（`packages/dsh-mermaid-comm/src/gate.ts:57,146`）

```ts
const handle = async (session: any, event: any) => {
    if (event?.type !== 'assistant/message') return
    if (!isAppend(event?.surfaceOp)) return
    const message = event.data?.message
    if (message?.role !== 'assistant') return
    const content = Array.isArray(message.content) ? message.content : []
    const textBlocks = content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    ...
}
ctx.on('session/event', (session: unknown, event: unknown) => { ... })
```

→ **回复文本 = `event.data.message.content` 里的 `{type:'text',text}` 块**，
并且 `message` 上有 `role` / `content` / `id`（该文件 L108 注释："保留原 message id 与 source"）。
**`event.surfaceOp` 可能是 `'append'` 也可能是 `{op:'append'}`** —— 顺便解释了为什么 gate.ts 要写 `isAppend`。

> 抄这套写法时要小心：`ctx.on` 的 `event.data` 是 `unknown`，我们要自己收窄。

## 5. 决定了什么（写成代码前的裁决）

1. **发话走 `ctx.sessionController.prompt(...)`**，不碰 `agent.followup/steer`（非公开契约，且 `Agent` 类型上没有它们）。
2. **收话走 `ctx.on('session/event', ...)`**，用 `session.id` 过滤自己的角色，`event.type` 过滤 `assistant/message` / `turn/end`。
3. **两个都要能在测试里被替换**：`sessionController` 与事件总线都封装成**注入的 `SessionTransport`**，
   所以 `test/bridge*.test.js` 里**一个模型调用都不会发生**（红线：测试不许真调模型）。
4. **`requestId` 用作幂等键**（§3.2 事实 1）：bridge 自己生成，重复投递安全。
5. **冷会话由 `prompt` 自动 resume**，和 D36 的"懒创建"天然契合：我们只管 `createAgent` 一次，之后 `prompt` 永远不会因为"没人唤醒"失败。

## 6. 还没核实的（**不要当已知事实用**）

| # | 未确认项 | 影响 | 怎么核实 |
|---|---|---|---|
| U1 | `MessageBase` 的完整字段（我们只知道有 `id` / `content` / `role`，从 §4.2 推断） | 影响 `seed` 里 `system/message` 的 `data.message` 是否被 `createAgent` 判定为合法 | M6-3 真机跑一次 `createAgent({seed})`；若抛错，按错误信息补字段 |
| U2 | `seed` 的 `seq` / `time` 是否必须自洽（例如从 0 递增） | 同上 | 同上；bridge 已把 seed 构造集中在 `buildSystemSeed()`，一处改即可 |
| U3 | `sessionController` 在**本插件被加载的那个 profile**里是否一定存在 | 不存在则 bridge 必须退化（"会话服务不可用"） | bridge 用 `ctx.get('sessionController')` 可得 `undefined`，已在代码里处理并给原因 |

**U1/U2 的处理方式**：把 seed 的构造收敛到一个纯函数（`buildSystemSeed`）并单测它的输出形状；
真机若报错，只改那一个函数，不动绑定逻辑。

## 7. 原始证据的可复现命令

```bash
# 1) 服务目录（很大，会溢写；grep '"key"' 看全部 100+ 个服务）
#    cordis_inspect_query({platform:'host',provider:'Service',method:'listService'})
# 2) 单个服务的确切契约
#    cordis_inspect_query({platform:'host',provider:'Service',method:'listService',
#                          input:{service:'sessionController'}})
# 3) 事件目录
#    cordis_inspect_query({platform:'host',provider:'Event',method:'listEvents'})

# 4) 实现证据（本机已安装的 DSH 包）
sed -n '850,900p' "/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js"
sed -n '3090,3100p' "/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js"
grep -oE "PromptContentPart.{0,250}" "/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.host.js"

# 5) 本仓库真实范例
sed -n '95,100p'   dsh-taskboard/src/index.ts
sed -n '56,66p'    packages/dsh-mermaid-comm/src/gate.ts
sed -n '144,150p'  packages/dsh-mermaid-comm/src/gate.ts
```
