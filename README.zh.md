# dsh-dev-git-graph

DSH 插件：会话 **Git Graph 面板**——源码级移植 [mhutchie/vscode-git-graph](https://github.com/mhutchie/vscode-git-graph) 1.30.0（MIT 许可），
在 DSH Web GUI 的会话页里以「Git 树」tab 显示**当前会话工作区**的提交图（分支彩线、
提交信息、日期、作者、分支/标签），右键支持 checkout / merge / rebase / push / tag / stash 等全部操作。

## 架构

```
会话 tab「Git 树」(client.js)
  └─ sessionCwd() 从 sessions 取该会话工作区
  └─ iframe /dsh-dev-git-graph/gg/index.html?repo=<cwd>
        │ host 注入 window.__DSH_GG_BOOT__ = { apiBase, repo, initialState, ... }
        ▼
git-graph 前端（media/gitgraph.js，原版 webview UI）
  └─ VS Code 兼容桥：postMessage → fetch POST /dsh-dev-git-graph/gg/api
        ▼
host 路由 (src/git-graph/routes.ts)
  └─ vendor/git-graph/dataSource.ts：child_process 直跑 git（spawn 数组，无 shell 注入）
        ▼
本地 git 仓库
```

- 静态：`GET /dsh-dev-git-graph/gg/` 及 `/<static>`（media/ 下构建产物，index.html 动态注入 boot 数据）。
- API：`POST /dsh-dev-git-graph/gg/api`，命令集对齐原扩展 `gitGraphView.respondToMessage`（约 60 个命令）。
- 主题：CSS 把 `--vscode-*` 映射到 DSH `--dsw-alias-*` 设计变量（缺省值兜底），随主题变明暗。

## 与原版差异

| 项 | 说明 |
|---|---|
| VS Code 专属命令 | `openFile` / `viewDiff` / `openTerminal` / `createPullRequest` / `createArchive` 等返回「暂不支持」 |
| 状态持久化 | 前端 localStorage（原扩展用 workspaceState），`setGlobalViewState` 等直接 ACK |
| 仓库来源 | 自动绑定当前会话工作区（无工作区时 tab 显示提示） |

## 构建与安装

```bash
# 构建（web 前端 tsc → media/ 合并；host tsc → lib/；client.js 拷贝）
pnpm --filter dsh-dev-git-graph build

# 类型检查
pnpm --filter dsh-dev-git-graph typecheck

# 安装到 web profile（本地 file: 依赖）
dsh plugin --profile web add file:/Users/kp/DEV/dsh-plugins/packages/dsh-dev-git-graph
# 重启 dsh web 生效；会话页出现「Git 树」tab
```

## 许可

前端与数据层来自 **mhutchie/vscode-git-graph**，许可见 `vendor/git-graph/LICENSE`（MIT）。
本插件的 host 集成代码按 MIT 发布。
