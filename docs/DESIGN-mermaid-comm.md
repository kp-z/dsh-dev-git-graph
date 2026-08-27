# dsh-mermaid-comm 设计文档

> 让 AI 在开发交流中「尽可能用 Mermaid 图」的 DSH 插件设计方案。
> 状态：**设计稿**（已调研 DSH 机制，待确认后实现）

## 1. 目标与成功标准

**目标**：在 dsh（Web profile）的开发对话中，AI 的架构说明、流程讲解、数据流、调用链等
场景优先用 Mermaid 图表达，且这些图**能在对话流里真正渲染成图**（不是纯文本代码块）。

**成功标准**：
- [ ] 全局提示注入后，模型在开发场景主动产出 mermaid 代码块
- [ ] 对话流中 ` ```mermaid ` 代码块渲染为可视化图
- [ ] 模型输出前可用 `mermaid_validate` 自检，渲染失败率低
- [ ] 可通过 profile 配置关闭/调整（全局+可配置）
- [ ] 卸载后无残留（prompt 段、客户端 hook、工具都干净移除）

## 2. 三个功能支柱

功能拆成三层，对应 DSH 的三个扩展点：

| 支柱 | 扩展点 | 作用 |
|---|---|---|
| **A. 行为引导** | 主机端 `ctx.systemPrompt.section()` | 让模型「尽可能用」Mermaid |
| **B. 对话渲染** | 客户端（web） | 把 ` ```mermaid ` 渲染成图 |
| **C. 语法校验** | 主机端 `ctx.tools.register(defineTool)` | 让模型输出前自检，减少渲染失败 |

## 2.5 存储与持久化（Mermaid 怎么存、怎么持久化）

> 这是本插件最重要的基础决策：Mermaid 图的存在形态决定它如何进入会话、如何回放、如何导出。

### 核心结论：Mermaid 图 = 消息里的 ` ```mermaid ` 围栏文本块，不额外建库

DSH 的会话是 **append-only JSONL 日志**（`dsh-session-persistence-jsonl`），assistant 消息的
文本块（`AssistantBlock.kind === 'text'`）逐 chunk 持久化。Mermaid 图本质是消息文本里
一个 ` ```mermaid ... ``` ` 围栏，**它已经作为消息的一部分被持久化了**——不需要插件再存一份。

```
会话日志（session.jsonl.zstd，append-only）:
  ... assistant/chunk 事件 → 完整消息文本（含 ```mermaid 围栏）
```

- **存储形态**：Mermaid 源码**只存在于消息文本里**。源码 = 消息文本的子串（围栏内的部分）。
- **渲染产物（SVG）不持久化**：图是渲染时实时生成的，历史回放时重新渲染。
  渲染是纯函数（源码 → SVG），无需缓存。

### 为什么不需要「单独存 Mermaid」

| 备选方案 | 问题 |
|---|---|
| 单独建 Mermaid 库（DB/文件） | 与消息脱钩；回放/导出要再对齐；会话删除时不同步；违反 DSH 单一事实源 |
| 缓存渲染 SVG 到附件库 | SVG 可由源码确定性重建；缓存带来一致性/过期问题，收益低 |

唯一值得考虑的是**客户端渲染缓存**（memoize 源码→SVG，会话内复用），这是内存态、非持久化。

### 持久化链路（零新增代码）

Mermaid 作为消息文本自动获得 DSH 的全部持久化保障：

1. **写入**：assistant `text/chunk` 事件进 append-only 日志（fsync、崩溃恢复、seq 校验、
   zstd 压缩）——插件无需做任何事。
2. **回放**：恢复会话时，日志里的消息文本原样回来，` ```mermaid ` 围栏随消息重建；
   客户端渲染层（B 支柱）识别围栏并渲染。**渲染是客户端行为，持久化是宿主行为，二者解耦**。
3. **导出**：`/export` 下载的 ZIP 里已含完整消息文本（含 mermaid 源码），无需额外导出逻辑。
4. **搜索结果/标题/压缩**：都基于消息文本，mermaid 围栏作为普通文本参与，无特殊处理。

### 边界与注意点

- **流式（streaming）**：消息在流式输出时围栏可能不完整，渲染层必须等 `settled`
  （流结束）再渲染，流式期间显示源码或占位（官方 MarkdownText 对流式有同样的冻结语义）。
- **源码与文本一致**：渲染层从消息文本提取围栏 → 渲染。提取逻辑必须与 Markdown 围栏
  解析一致（CommonMark 规则），避免「渲染用的源码」和「消息里的源码」不一致。
- **回放一致性**：历史会话恢复时若插件未安装/被禁用，消息文本仍完整（mermaid 围栏作为
  纯文本代码块展示），不会丢内容——这是「文本即存储」的最大好处。
- **不引入 `dsh-attachment`**：attachment 是给**图片等二进制**用的（content-addressed 大对象）。
  Mermaid 是文本，走消息文本即可，用 attachment 反而破坏「消息即源码」的简单性。
  除非未来要存「渲染好的 PNG/SVG 快照」做分享，否则不需要。

### 一句话总结

> **Mermaid 的持久化 = 把它留在消息文本里**。渲染是客户端的、可重算的；存储是宿主的、
> append-only 的。插件只负责「让模型写进文本 + 让客户端渲染文本」，不碰存储层。

## 3. 各支柱设计

### A. 行为引导（systemPrompt.section）

- 用 `systemPrompt.section()` 注册一个 order 在工具引导带的 prompt 段（如 order 150）。
- 内容要点：
  - **触发场景**：架构说明、数据流、时序/调用链、类关系、状态机、流程、分支策略、git 历史。
  - **明确要求**：先给一句话摘要，再给 ` ```mermaid ` 图；图要能独立表达核心信息。
  - **类型**：全部类型开放（flowchart / sequenceDiagram / classDiagram / stateDiagram-v2 /
    erDiagram / gantt / gitGraph / pie / journey / timeline 等）。
  - **约束**：图**必须语法正确**（可先用 `mermaid_validate` 校验）；不要为了图而图——
    简单列表/单行结论不必画图；每个图配简短图例说明。
  - **降级规则**：文本解释仍必要，图是补充不是替代——AI 仍要写清楚结论与决策理由。
- **可配置**：
  - 全局默认开启；`enabled: false` 关闭。
  - `promptLevel: 'global' | 'off'`（agent 级覆盖可后续扩展）。
  - 用 schemastery schema 声明，暴露到插件设置页。

**注意（DSH 机制约束）**：`systemPrompt.section()` 全局注入影响所有 agent。
要用 `{{variable}}` 或 `agent.ctx` 作用域时需额外设计；首版用全局 + 配置开关最稳。

### B. 对话渲染（客户端）

**现状调研结论**（已核实）：
- 官方 web 前端 bundle **不含 mermaid**；对话流 `MarkdownText` 不渲染 mermaid。
- 官方 `MarkdownText` props 只有 `text/streaming/codeLabels/fileMentions`，
  **没有代码块自定义渲染注入点**。
- 已装的 `dsh-better-sidebar` 内置 mermaid v11，但其 Mermaid 渲染是 **sidebar 文件预览**
  专用（`MermaidMarkdown`），不作用于对话流；`ctx.betterSidebar` 服务只提供
  `registerTab`/`registerFileViewer`（sidebar 专属），**不能直接给对话流用**。
- 对话流可用的插槽：`conversation.chat.node`（keyed，按 `ChatNodeKind` 分发，
  scope session）。外部可注册 `assistant-step` 渲染器，但那是**整体替换**
  （要自己处理 streaming/思考块/图标/中断态），复杂度高。

**推荐路径（务实，两种可选）**：

**方案 B1（首选，渐进）**：对话流 `DOM 后处理`——客户端插件在 assistant 消息
渲染完成后，扫描 `code.language-mermaid` 元素，用 mermaid 渲染替换其内容。
- 优点：不动官方渲染器、不重写 assistant 节点、复用 better-sidebar 已安装的 mermaid。
- 接入点：`conversation.chat.node` 之外更轻的钩子——监听对话容器 DOM 变化，
  或注册一个 `slots` 贡献点（若官方暴露消息渲染完成回调）。
- 风险：与官方渲染的耦合是「事后扫描」，streaming 期间需节流/等 settled 再处理。

**方案 B2（更强但重）**：整体替换 `assistant-step` 渲染器（keyed 插槽注册）。
- 优点：完全控制、可加「展开/导出/复制源码」等交互。
- 缺点：要复刻官方 assistant 节点的全部行为（streaming、思考、图标、中断），
  维护成本高，官方升级易碎。

**首版建议 B1**，把 mermaid 渲染逻辑封装成独立客户端组件（懒加载 mermaid chunk，
避免拖慢启动），B2 作为后续增强。

### C. 语法校验工具（mermaid_validate）

- `ctx.tools.register(defineTool({ name: 'mermaid_validate', ... }))`
- 输入：`{ type: 'flowchart'|'sequenceDiagram'|..., code: string }`
- 输出：`{ ok: boolean, errors: string[] }` 或文本。
- 实现：用 mermaid 的 parser（`@mermaid-js/parser`，better-sidebar 已装）在**主机端**
  校验语法——避免浏览器端每次都要加载完整 mermaid。
  - 需要确认：`@mermaid-js/parser` 是否可在 node 端独立校验全部图类型（
    flowchart/sequence 等基础类型可以；部分类型 parser 覆盖有限）。
  - 备选：npm 上 `mermaid` 包可在 node 端 `mermaid.parse()`（会拉较重依赖）。
- 工具描述要写明：模型应在输出 mermaid 前调用，减少渲染失败。

## 4. 插件结构（对齐 dsh-plugins 工作区规范）

```
packages/dsh-mermaid-comm/
├── src/
│   ├── index.ts            # 主机端入口：name/inject/apply
│   ├── prompt.ts           # systemPrompt.section 注入
│   ├── tool-validate.ts    # mermaid_validate 工具（defineTool）
│   └── config.ts           # schemastery schema（enabled/promptLevel/...）
├── client/
│   └── index.tsx           # 客户端：对话流 mermaid 渲染（B1）
├── cordis.patch.yml        # insert 插件 entry（含 client 声明）
├── package.json            # dsh.bundle + dsh.client（platform: web）
└── README.md
```

`package.json` 关键声明：
```jsonc
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-conversation"
      ]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/schemastery": "*",
    "mermaid": "*"          // 复用 better-sidebar 的 mermaid v11，不重复安装
  }
}
```

## 5. 配置项（schemastery）

```ts
export const MermaidCommConfig = z.object({
  enabled: z.boolean().default(true),        // 总开关
  promptLevel: z.enum(['global', 'off']).default('global'),
  diagramTypes: z.array(z.string()).optional(),  // 空=全部类型
  validateBeforeRender: z.boolean().default(true), // 提示模型先用校验工具
})
```

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 对话流渲染 seam 不公开，B1 事后扫描可能不稳 | 首版聚焦 prompt 引导+校验工具；渲染做成可独立开关，验证 DOM 扫描稳定性 |
| `@mermaid-js/parser` node 端校验覆盖不全 | 校验工具先支持基础类型，标注不支持的类型提示模型；或降级为「仅提示」 |
| 全局 prompt 注入影响非开发场景 | `promptLevel` 配置 + prompt 文本限定「开发/代码讨论」场景触发 |
| 模型乱用图类型导致语法失败 | 校验工具 + prompt 明确「先校验再输出」 |
| mermaid 客户端依赖体积 | 懒加载 mermaid chunk（better-sidebar 已验证此模式：仅检测到 mermaid 围栏才拉取） |
| better-sidebar 卸载导致 mermaid 缺失 | peerDependency 声明 + README 注明依赖；或后续改为插件自带 mermaid |

## 7. 落地顺序（建议）

1. **MVP**：A（prompt 注入，可配置关闭）+ C（mermaid_validate 工具）——不碰渲染，
   最快验证「模型是否真的会多用图」。安装进 devtest profile 实测。
2. **B1 渲染**：客户端对话流 mermaid 渲染（懒加载），验证 DOM 扫描稳定性。
3. **打磨**：设置页暴露配置、图例说明 prompt 优化、agent 级覆盖、导出/复制交互。

## 8. 未决问题（实现前需确认）

- [ ] `@mermaid-js/parser` 在 node 端可校验的图类型范围（实现时实测）。
- [ ] 对话流渲染的稳定接入点：B1 的 DOM 扫描，还是等官方开放渲染 seam。
- [ ] `systemPrompt.section` 全局注入对既有 agent（如已有 persona）的叠加效果。
- [ ] 渲染层如何从**流式消息的冻结/未冻结块**中稳定提取围栏（需对齐 MarkdownText 的
      streaming 语义与 frozen block 边界）。
- [ ] 历史会话回放时渲染的节流/批量：多条旧消息带 mermaid 时，是否全部渲染还是
      折叠为「点击展开」。
