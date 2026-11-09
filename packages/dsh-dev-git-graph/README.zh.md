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
| VS Code 专属命令 | `openFile` / `openTerminal` / `createPullRequest` / `createArchive` 等返回「暂不支持」（`viewDiff` 见下节，已支持） |
| 状态持久化 | 前端 localStorage（原扩展用 workspaceState），`setGlobalViewState` 等直接 ACK |
| 仓库来源 | 自动绑定当前会话工作区（无工作区时 tab 显示提示） |

## 点文件 / 提交的 diff 行为

点提交树里「未提交的更改」或某个提交内的文件，会打开 **better-sidebar 原生 DiffTab** ——
与侧边栏「文件变动」tab 点文件/提交走同一条链路（同一套 `SidebarDiffRef` 与页签 id 语法），
因此**同一个文件在两侧会聚焦同一个页签**，不会重复开。

| 点哪里 | 打开的页签 | diff 内容 |
|---|---|---|
| 未提交的更改 → 文件 | `diff:w:<repo>:u:<path>`，标题为文件名 | 该文件的工作区改动（`git diff -- <path>`；未跟踪文件按全文新增渲染） |
| 提交内 → 文件 | `diff:c:<repo>:<hash>`，标题为 `<短hash> <提交标题>` | 该提交的整份 patch（`git show`），与「文件变动」点历史提交一致 |

已知边界（better-sidebar 0.19.1 的能力上限，非本插件退化）：

- **提交内点单个文件显示的仍是该提交的整份 patch**：原生 `SidebarDiffRef` 的 commit 形态没有
  路径字段，`git.commit-diff` 也不带 pathspec；「文件变动」自己的提交预览同样是整提交 patch。
  若要「只显示这一个文件」，需要插件自渲染 diff 视图（未实现）。
- **不做暂存/未暂存区分**：git-graph 的未提交变更不区分索引态，统一按未暂存打开；原生 DiffTab
  自带「diff 为空则换另一侧」回退，观感与「文件变动」一致。
- **提交对比（compare）按 `to` 提交的 patch 展示**。
- 右键「View Diff with Working File」按该文件**当前工作区改动**展示（原生只能表达「工作区改动」
  或「整提交 patch」，无法表达「提交 vs 工作文件」）。

## 构建与安装

```bash
# 构建（web 前端 tsc → media/ 合并；host tsc → lib/；client.js 拷贝）
pnpm --filter dsh-dev-git-graph build

# 类型检查
pnpm --filter dsh-dev-git-graph typecheck

# 测试（diff 载荷映射 + diff 桥契约）
pnpm --filter dsh-dev-git-graph test

# 安装到 web profile（本地 file: 依赖）
dsh plugin --profile web add file:/Users/kp/DEV/dsh-plugins/packages/dsh-dev-git-graph
# 重启 dsh web 生效；会话页出现「Git 树」tab
```

### Better Sidebar 集成（前置依赖）

本插件的唯一 UI 入口是 [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) 右侧栏的原生 **Git Graph** tab（「+」菜单，单例去重、经 `scope.repoRoot`/`scope.cwd` 自动绑定会话工作区；点文件 diff 直接打开内置 DiffTab）。需先装 better-sidebar——未装时本插件不注册任何 UI。

```bash
# 一行完整安装（先 better-sidebar，再本插件）
cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add dsh-dev-git-graph
```

## 许可

前端与数据层来自 **mhutchie/vscode-git-graph**，许可见 `vendor/git-graph/LICENSE`（MIT）。
本插件的 host 集成代码按 MIT 发布。
