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

### B 支柱实现（已完成，首版 B1）

选 **B1（DOM 后处理）+ 懒加载 chunk**，架构对齐 dsh-better-sidebar 已验证的方案：

```
对话流里出现 ```mermaid 围栏
  → primitives 渲染为 div.md-code-block > pre.plain > code.language-mermaid
    （shiki 无 mermaid grammar，走 plain 分支）
  → 客户端插件 MutationObserver 扫描 code.language-mermaid
  → 懒加载 chunk：注入 <script src="/plugins/dsh-mermaid-comm/chunks/mermaid.js">
  → chunk（内含完整 mermaid 6.8MB）注册 globalThis.__dshChunks__['mermaid-comm']
  → mermaid.render 出 SVG → sanitizeSvg（剥离 foreignObject/script/事件/href）
  → 替换 pre 的 children（保留 banner 与 host 节点，React reconciliation 不丢 host）
```

实现要点：
- **客户端 bundle** `lib/client.js`：`window.__ModuleLoader__.load({ id: 'dsh-mermaid-comm' })`
  注册，dsh web 自动加载（包需声明 `exports["./client"]`）。
- **懒加载 chunk** `lib/client-mermaid.js`：tsdown 独立构建
  （`inlineDynamicImports` 合成单文件，mermaid 全依赖内联、零 external require）。
- **主机端路由**：`webServer.register` 服务 chunk（白名单 + ETag + GET/HEAD）。
- **安全**：`securityLevel:'strict'` + `htmlLabels:false` + 渲染后 SVG 再净化。
- **streaming**：MutationObserver 监听 characterData/childList，debounce 300ms 扫描；
  内容变化时清除标记重新渲染（data-mermaid-comm-processed）；`rendering` WeakSet 防并发。
- 已实测：headless Chrome 渲染 flowchart 成功（SVG 15194 字符、无 foreignObject）；
  host 路由单元测试通过（200/304/404/405）；client bundle 模拟加载通过（零 external）。

**B2（整体替换 assistant-step）仍为后续增强**：当前 B1 已让对话流里的图可视化，
B2 的额外价值是「展开/导出/主题切换」等交互，按需再做。

### C. 语法校验工具（mermaid_validate）

**技术调研结论**（已实测验证）：
- `@mermaid-js/parser`（mermaid 11 的 langium parser，纯 ESM、node 可用）只覆盖**新类型**：
  `info/packet/pie/treeView/architecture/gitGraph/eventmodeling/radar/railroad/treemap/wardley/cynefin`。
- **flowchart/sequenceDiagram/classDiagram/stateDiagram-v2/erDiagram/gantt 等旧类型**
  仍在 mermaid 核心的 jison parser 里，node 端 `mermaid.parse()` 需要真实 DOM
  （DOMPurify 的 `addHook`/`sanitize` 依赖 document），否则报错。
- 完整 node 端校验需 jsdom/happy-dom（重依赖）。

**MVP 决策：分层校验，零重依赖**

| 层 | 覆盖 | 方式 |
|---|---|---|
| **严格校验** | 新类型（parser 支持） | `@mermaid-js/parser` 的 `parse()`，node 端可靠 |
| **启发式预检** | 旧类型（flowchart/sequence/class/state/er/gantt） | 围栏完整性 + 行结构 + 常见错误模式（纯逻辑） |
| **降级提示** | 全部 | 明确告诉模型「旧类型为预检，不 100% 保证」，建议渲染后自查 |

- `mermaid_validate` 输入：`{ type, code }`；输出：`{ ok, errors[] }`。
- 工具描述写明：模型应在输出 mermaid 前调用，减少渲染失败。
- **后续增强**：把 jsdom + 完整 mermaid 作为可选依赖，实现旧类型严格校验
  （`validateMode: 'strict' | 'heuristic'` 配置）。
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

## 7. 落地顺序

1. ✅ **MVP**：A（prompt 注入）+ C（mermaid_validate 工具）——已实现并实测
   （headless 真实模型调用：模型确认工具可见、prompt 生效、校验返回精确错误）。
2. ✅ **B1 渲染**：客户端对话流 mermaid 渲染（懒加载 chunk）——已实现，
   headless Chrome 实测渲染出净化 SVG；待 web GUI 重启后验证真实对话流效果。
3. ⬜ **打磨**：设置页暴露配置、图例说明 prompt 优化、agent 级覆盖、导出/复制交互（B2）。

## 8. 未决问题

- [x] ~~`@mermaid-js/parser` 在 node 端可校验的图类型范围~~ → **已实测**：只覆盖新类型；
      旧类型需 DOM。MVP 采用分层校验（见 §C）。
- [x] ~~对话流渲染的稳定接入点~~ → **已实现 B1**（DOM 后处理 + 懒加载 chunk），
      实测渲染成功。B2（整体替换 assistant-step，加展开/导出交互）留作后续。
- [ ] `systemPrompt.section` 全局注入对既有 agent（如已有 persona）的叠加效果。
- [x] ~~渲染层如何从**流式消息的冻结/未冻结块**中稳定提取围栏~~ → B1 用 MutationObserver
      监听 characterData/childList + 300ms debounce，内容变化时清除标记重渲染；
      流式期间块内容持续变化时自动更新到最终图。
- [ ] 历史会话回放时渲染的节流/批量：多条旧消息带 mermaid 时，是否全部渲染还是
      折叠为「点击展开」。

---

## 9. v0.3.0：注入改为勾选可控 + 安装自带渲染器

两处改动，都是「机制约束逼出来的形状」，不是偏好问题。

### 9.1 注入开关：勾选后才注入（promptLevel 增加 `toggle`）

需求：在 dsh 的对话输入框加勾选按钮，勾选后才注入。

**机制约束**（决定了状态必须住在 host）：

1. 注入点是 host 侧的 `ctx.systemPrompt.section()`——prompt 在 host 组装，客户端按钮只是遥控器。
2. 客户端控件挂 `conversation.input.left`（list 槽，scope session，无 owner props，官方 occupants 为空 → 净新增，不遮蔽任何官方控件）。该槽组件**切换会话时会被 renderer 重挂载**（官方注释明确要求组件局部状态不得跨会话泄漏）→ 状态放组件里既会丢，也永远到不了 host。
3. 门控不需要新机制：`PromptSection.text` 本来就允许是 `(context) => string`，每轮组装实时求值。官方 `dsh-plan-mode` 的 `plan:policy` 就是这么按会话条件注入的（`context.agent.session`）——本插件照此把 text 改成函数即可，空串会被 `renderPrompt` 丢弃，等于该段不存在。

选型：用户拍板**全局粘性**（非每会话）——状态存 `ctx.settings`（namespace `mermaid-comm-inject`），落在 profile 的 settings 文档里，重启后仍在；勾一次所有会话生效。理由：注入本身是全局段（插件 ctx 无 scope 标签），做成每会话的按钮与全局注入语义不匹配，且每会话都要重勾的体验更差。

落地形状：

| 位置 | 职责 |
|---|---|
| `src/switch.ts` | 开关真值：`ctx.inject(['settings'])` 可选注入 → 有则持久化 + watch 跟随，无则退化为进程内（功能不降级，只是重启回默认）；注册 `GET/POST /dsh-mermaid-comm/state` 供客户端读写 |
| `src/prompt.ts` | guidance 与 vault-index 两段的 text 改为函数，未勾选返回 `''` |
| `src/client.js` | 勾选按钮（28×28 圆形，照抄官方 composer 工具行 `.p_FcLG_add` 的尺寸/hover token；选中态用 business 状态色对，与官方 plan chip 同构）；`toggle:false` 时自隐藏 |
| `src/index.ts` | `promptLevel` 三态接线：`toggle`（默认）/`global`（恒注入，按钮隐藏）/`off`（不注册 prompt 段，工具仍可用） |

**边界**：工具（`mermaid_validate` + 图库四件套）与输出闸不随开关走——注入是「引导画」，工具是「画了帮你把关」，解耦才合理。

### 9.2 安装时自动带上 dsh-mermaid（v0.3.0 用 CARRIER，v0.3.1 撤销）

需求：安装本插件时自动安装依赖的另一个插件。

**调研结论（都是读码实证）**：

- dsh **没有**一等机制：`dsh plugin add` 只是把参数原样转发给 pnpm（`@deepseek-ai/dsh/lib/plugin-*.js` 的 `runPlugin`：`spawnSync('pnpm', args, {cwd: profileDir})`，不附加任何 flag）；manifest 里也不存在 `requires`/`plugins` 字段。
- profile 模板把 **`autoInstallPeers: false`** 写死（`dsh-app-boot` 的 `PROFILE_PNPM_WORKSPACE`，profile 首次初始化时落盘）→ 非可选 `peerDependencies` **不会**被自动安装（pnpm 8 起「默认 true」的内建行为在此被显式覆盖）。
- `reconcilePlugins` 只把 **profile 顶层 `dependencies`** 里声明了 `dsh.bundle.patch` 的包提升进 `dsh.profile.bundles`。传递依赖即使被装上也不会进 bundles → 它的 `cordis.patch.yml` 永不被应用 → **装了也是死的**。

**v0.3.0 采用 CARRIER（已撤销）**：`dependencies` 保证 pnpm 装上，再在自己 patch 里追加一行 `{ id: ui-mermaid, name: dsh-mermaid }` 把它挂成 loader entry。当时的判断依据是「同 id 才能让 `dshmarket` 的 `conflictingEntryIds` 拦住冲突」，并配了「不要再单独装 dsh-mermaid」的文档警告。

**实测必然失败（用户真实安装报错）**：

```
重复的 loader 条目 id "ui-mermaid"
```

根因：`dsh-mermaid` **自己带 `dsh.bundle.patch`**，所以只要它成为 profile 顶层依赖，`reconcilePlugins` 就把它提升进 bundles，它自己的 patch 也插入 `ui-mermaid` → 与 carrier 行撞 id → cordis 硬失败（整棵树起不来，报错不点名任何插件）。触发它的不是误操作而是**正常安装路径**：任何把依赖落实为 profile 顶层依赖的安装器（市场/插件管理 UI）都会这样。**结论：只要 dsh-mermaid 可能被独立安装，carrier 就与它互斥——这是设计冲突，不是文档能规避的边界。**

**v0.3.1 定案：职责切开，谁都不依赖谁。**

| 关切 | 由谁负责 | 机制 |
|---|---|---|
| 代码供给（自动安装） | 本插件 `dependencies: { dsh-mermaid: "^0.4.0" }` | pnpm 必装，装本插件就带上 |
| 挂载（entry + 客户端面） | `dsh-mermaid` 自己的 patch | 它作为 bundle 安装即可 |

安装命令回到两包：`dsh plugin --profile web add dsh-mermaid-comm dsh-mermaid`。这样任何安装顺序/路径都不会产生重复 id；「自动安装依赖」的诉求由 `dependencies` 满足，「挂载」由 DSH 原本的 bundle 机制满足。README 已按此改写并保留失败原因说明。


### 9.3 验证

- 单测：`node --test test/*.test.ts` → 20 通过（开关持久化/降级/watch、路由 GET/POST/非法体/非法方法/非 toggle 模式、prompt 段门控、vault 既有 9 项）。
- 装配冒烟 6 项：在 workspace 里因 `@deepseek-ai/dsh-tools@0.1.1-rc.2` 与其拉入的 `dsh-llm` 版本错配而**跳过**（工作区既有问题，非本次改动）；改用与 profile 版本对齐（`0.1.5-rc.2`）的 scratch 环境跑，**6/6 通过**。
- 组合树预检：`dsh --profile web --dump-config` 退出码 0、`ui-mermaid` 恰好出现 1 次 → 不会撞重复 entry id。
- 待用户在重启 `dsh web` 后验证真实 GUI：按钮出现、勾选后注入、图库索引随勾选开关。

