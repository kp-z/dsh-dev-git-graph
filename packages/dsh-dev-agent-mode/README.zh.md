# dsh-dev-agent-mode

将 DeepSeek Harness 左侧对话分类栏切换为 **Agent 模式** 的 DSH 插件（纯前端，MVP）。

## 这是什么

左侧栏官方是「Workspace 浏览器」——按 host workspace（目录）分组列出会话。本插件将其**拟人化**：

- 每个 workspace = 一个 **Agent**：确定性头像（workspaceId → 色相 + 首字母）、名称、路径、会话数徽标；
- workspace 只是该 Agent 的一个「标签」（cwd 属性）；
- 点击 Agent 卡片展开其会话列表，点击会话打开，可新建会话；
- 左下角一键在 **官方模式 ↔ Agent 模式** 间切换，切回即恢复官方浏览器，无残留。

## 安装

```bash
dsh plugin --profile web add file:/path/to/dsh-plugins/packages/dsh-dev-agent-mode
# 重启 dsh web
```

## 机制（为什么这么实现）

| 项 | 说明 |
|---|---|
| 孔位 | 注册 `sidebar.workspaces`（官方 single 孔位，`entriesOfSlot()[0]` 胜出 = 注册即替换） |
| 数据 | 完全复用官方 `useWorkspaces` / `useSessions` hooks（slot standard props），零数据层 |
| 切换 | `sidebar.footer.action` list 孔位注入开关（优先）；不可用时 DOM 注入兜底（仿 task-board） |
| 构建 | 无打包器：`src/client.js` 拷贝为 `lib/client.js`（IIFE，仿 dsh-dev-git-graph） |

详见 [`docs/DESIGN-dsh-dev-agent-mode.md`](../../docs/DESIGN-dsh-dev-agent-mode.md)。

## 开发

```bash
pnpm --filter dsh-dev-agent-mode typecheck   # 类型检查
pnpm --filter dsh-dev-agent-mode test        # 单测（node:test）
pnpm --filter dsh-dev-agent-mode build       # 构建 lib/
```

## 配置

当前无配置项（MVP）。模式偏好存 `localStorage` 键 `dsh-dev-agent-mode.mode`（`official` | `agent`），
存储不可用时回退内存态。

## 已知边界（MVP）

- 头像/名称/个性为确定性派生，暂不可编辑（后续版本支持落库）；
- official 模式为官方浏览器的「行为等价精简实现」（分组 + 会话树 + 新建会话），
  与官方完整 UI 在细节（拖拽、搜索、归档菜单）上有差异；
- 每个 Agent 独立的 system prompt / 工具权限不在本插件范围（agent 层能力）。
