# PR 物料：dsh-dev-git-graph 进 DSH-better-sidebar 内置推荐目录

目标仓库：[omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)
方式：fork 后修改 2 类文件，跑 `tests/plugin-list.spec.ts` 通过后提 PR。

## 1. src/client/plugins-tabs.ts（按字母序，插在 dsh-better-sidebar-starter 之后）

```ts
{
  id: 'dsh-dev-git-graph',
  name: 'dsh-dev-git-graph 提交图',
  url: 'https://github.com/kp-z/dsh-dev-git-graph',
  description: () => t('pluginDevGitGraphDesc'),
  install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add dsh-dev-git-graph',
},
```

## 2. src/client/locales.ts（zh）与 locales-en 等语言文件补键

```ts
pluginDevGitGraphDesc: 'vscode-git-graph 忠实移植的提交图 Tab：自动绑定会话工作区，checkout/merge/rebase/push/tag/stash 全套 git 操作，明暗主题跟随；装了 better-sidebar 注册原生 Tab，未装回退右侧 overlay 面板',
pluginDevGitGraphDesc: 'A faithful vscode-git-graph port as a sidebar tab: auto-bound to the session workspace, full git operations (checkout/merge/rebase/push/tag/stash), light/dark theming; registers a native tab with better-sidebar and falls back to an overlay panel without it',
```

其余 17 个语言按仓库惯例补译文或英文（键：`pluginDevGitGraphDesc`，en 文案见上）。

## 3. 校验

```sh
# 仓库根目录
pnpm vitest run tests/plugin-list.spec.ts
```

数据完整性（id 唯一 / url 存在 / install 前缀 `cd ~/.dsh`）由该 spec 守护。

## 附：插件仓库上架前置（已完成）

- 能力层：`dsh-dev-git-graph@0.1.1` 已内置 `ctx.betterSidebar.registerTab`（可选探测，未装回退 overlay）
- `package.json`：optional peerDependency `dsh-better-sidebar >= 0.12.0`、keywords 含 `dsh-better-sidebar`
- 待办：GitHub repo `kp-z/dsh-dev-git-graph` → Settings → Topics 加 `dsh-better-sidebar`
