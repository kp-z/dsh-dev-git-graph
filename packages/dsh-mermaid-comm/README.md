# dsh-mermaid-comm

让 AI 在开发交流中**尽可能用 Mermaid 图**表达的 DSH 插件（MVP：主机端）。

## 功能

| 支柱 | 说明 |
|---|---|
| **A. 行为引导** | 全局注入 `systemPrompt.section`，引导模型在架构/数据流/时序/状态机等场景优先用 Mermaid |
| **C. 语法校验** | `mermaid_validate` 工具：模型输出前自检，减少渲染失败 |

> 对话流渲染（B 支柱）为后续版本；当前 Mermaid 以 ` ```mermaid ` 代码块形式出现在消息里
> （不渲染也不影响，回放时以代码块显示）。

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

- `dsh --dump-config --profile devtest | grep -A5 mermaid-comm` 确认 entry 在组合树里。
- 启动后系统提示里应有「开发交流优先用 Mermaid 图表达」段。
- 模型工具列表里应有 `mermaid_validate`。

## 设计文档

见 [docs/DESIGN-mermaid-comm.md](../../docs/DESIGN-mermaid-comm.md)（含存储与持久化设计）。
