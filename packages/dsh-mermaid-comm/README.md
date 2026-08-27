# dsh-mermaid-comm

让 AI 在开发交流中**尽可能用 Mermaid 图**表达的 DSH 插件。

## 功能

| 支柱 | 说明 |
|---|---|
| **A. 行为引导** | 全局注入 `systemPrompt.section`，引导模型在架构/数据流/时序/状态机等场景优先用 Mermaid |
| **B. 对话流渲染** | 对话流里的 ` ```mermaid ` 代码块自动渲染为可视化图（懒加载 mermaid chunk） |
| **C. 语法校验** | `mermaid_validate` 工具：模型输出前自检，减少渲染失败 |

## B 支柱：对话流渲染（架构）

- **客户端插件**：`lib/client.js`（`window.__ModuleLoader__.load` 注册，dsh web 自动加载）。
  `apply(ctx)` 启动 `MutationObserver`，扫描 `pre > code.language-mermaid`（` ```mermaid `
  在 primitives 里渲染成此结构，shiki 无 mermaid grammar）。
- **懒加载 chunk**：`lib/client-mermaid.js`（6.8MB，内含完整 mermaid + 全部传递依赖）。
  首次遇到 mermaid 围栏才通过 `<script>` 注入，不拖慢启动。注册
  `globalThis.__dshChunks__['mermaid-comm']`。
- **主机端路由**：`webServer.register` 服务 `/plugins/dsh-mermaid-comm/chunks/mermaid.js`
  （白名单 + ETag 缓存 + 仅 GET/HEAD）。
- **安全**：mermaid `securityLevel:'strict'` + `htmlLabels:false`，渲染后 SVG 再净化
  （剥离 foreignObject / script / 事件属性 / href）才进 DOM。

## 校验策略（已实测验证）

- **严格校验**（`@mermaid-js/parser`，node 端可靠）：`pie` / `gitGraph` / `architecture` /
  `treeView` / `radar` / `packet` / `info` 等新类型。
- **启发式预检**（围栏/行结构/括号，不能 100% 保证）：`flowchart` / `sequenceDiagram` /
  `classDiagram` / `stateDiagram-v2` / `erDiagram` / `gantt` 等旧类型（mermaid 核心 jison
  parser 在 node 端需要 DOM，故用启发式）。

## 安装 / 卸载

```bash
# 在工作区根目录
pnpm build
pnpm install:web      # 或 dsh plugin --profile web add dsh-mermaid-comm
pnpm remove:web       # 或 dsh plugin --profile web remove dsh-mermaid-comm
```

> 安装后需**重启 dsh web** 使客户端 bundle 生效（客户端插件在启动时加载）。
> 包需声明 `exports["./client"]` 指向 `lib/client.js`（host 端 compose 校验）。

## 配置

在 profile 的 `cordis.patch.yml` 或 `$DSH_HOME/cordis.patch.yml` 中覆盖：

```yaml
- id: mermaid-comm
  config:
    enabled: true
    promptLevel: global      # global | off
    diagramTypes: []          # 空 = 全部类型
    validateBeforeRender: true
```

## 验证

- `dsh --dump-config --profile web | grep -A5 mermaid-comm` 确认 entry 在组合树里。
- 启动后系统提示里应有「开发交流优先用 Mermaid 图表达」段。
- 模型工具列表里应有 `mermaid_validate`。
- 对话流里的 ` ```mermaid ` 块渲染为图（B 支柱）。
- 已实测（headless Chrome）：mermaid chunk 在浏览器渲染出净化 SVG（无 foreignObject）。

## 设计文档

见 [docs/DESIGN-mermaid-comm.md](../../docs/DESIGN-mermaid-comm.md)（含存储与持久化设计）。
