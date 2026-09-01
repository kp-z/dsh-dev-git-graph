# 发布 dsh-dev-git-graph 到官方市场

插件发布到 DSH 官方市场的路径：**npm 发布 → GitHub 仓库 → 向 awesome-dsh-plugin 提 PR**。
本文档是逐步骤指引；需要你有 npm 账号和 GitHub 账号（当前机器均未登录）。

## 前置：已完成并验证 ✅

- `package.json`：license(MIT)、author、repository、homepage、keywords、files 含 LICENSE+vendor LICENSE、`prepublishOnly` 构建钩子 ✅
- `README.md`：发布用英文版（功能/安装/架构/安全/开发）；`README.zh.md` 中文版 ✅
- `LICENSE`：MIT（含 vscode-git-graph © mhutchie 归属）✅
- `npm pack` 产物完整（39 文件）：lib + media + cordis.patch.yml + 双 README + 双 LICENSE ✅
- tarball 安装到隔离 profile（devtest）验证：组合树能发现 `git-graph` entry、media/lib 落位正确 ✅
- 包名 `dsh-dev-git-graph` 已确认未被占用（npm 404）✅

## 第 1 步：注册/登录 npm 并发布

```sh
# 1. 注册账号（无账号时）https://www.npmjs.com/signup
# 2. 登录（交互式，需浏览器/终端）
npm login

# 3. 发布（自动触发 prepublishOnly 构建）
cd /Users/kp/DEV/dsh-plugins/packages/dsh-dev-git-graph
npm publish --access public

# 4. 验证
npm view dsh-dev-git-graph
```

> 以后更新版本：改 `version`（如 0.1.0 → 0.1.1），再 `npm publish`。

## 第 2 步：创建 GitHub 仓库并推送

```sh
# 1. 在 GitHub 建公开仓库 aaron1zhang/dsh-dev-git-graph（或你的用户名）
#    https://github.com/new

# 2. 本插件在 monorepo（dsh-plugins workspace）里，两种方式任选：
#    A. 整个 workspace 公开（含 templates/docs/scripts/其他插件）：
cd /Users/kp/DEV/dsh-plugins
git remote add origin git@github.com:aaron1zhang/dsh-plugins.git
git push -u origin main
#    B. 只发插件包本身：把 packages/dsh-dev-git-graph 单独建仓（用 git subtree split 导出）：
#       git subtree split --prefix=packages/dsh-dev-git-graph -b git-graph-only
#       git push git@github.com:aaron1zhang/dsh-dev-git-graph.git git-graph-only:main

# 3. 配置 SSH key（当前 git@github.com 认证失败，因为公钥没加到账号）
cat ~/.ssh/id_ed25519.pub
#    粘贴到 GitHub → Settings → SSH and GPG keys → New SSH key
ssh -T git@github.com   # 应显示 Hi <user>! You've successfully authenticated
```

> 注意 `package.json` 的 `repository`/`homepage` 指向 `aaron1zhang/dsh-dev-git-graph`——
> 若你选方案 A（整库公开），发布前请把这两个字段改成实际仓库地址（如 `.../dsh-plugins`，
> 并加 `"directory": "packages/dsh-dev-git-graph"`）。

## 第 3 步：向 awesome-dsh-plugin 提 PR

1. Fork [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
2. 编辑 `README.md`，在 **Git & SCM**（或 Tools）分类（按字母序）加一行：

```markdown
- [aaron1zhang/dsh-dev-git-graph](https://github.com/aaron1zhang/dsh-dev-git-graph) - A Git Graph panel for DSH Web: a faithful port of vscode-git-graph, auto-bound to the session workspace, with full git operations (checkout/merge/rebase/push/tag/stash).
```

3. （可选）编辑 `README.zh.md` 对应分类加中文行：

```markdown
- [aaron1zhang/dsh-dev-git-graph](https://github.com/aaron1zhang/dsh-dev-git-graph) - DSH Web 会话 Git Graph 面板：vscode-git-graph 的忠实移植，自动绑定会话工作区，支持全部 git 操作（checkout/merge/rebase/push/tag/stash）。
```

4. 提交 PR。合并后 1 天内自动进
   [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 和 dsh 内置市场。

## 市场条目元数据（提交 PR 时参考）

- **分类**：Git & SCM（若无则用 Tools）
- **name**：`dsh-dev-git-graph`
- **owner**：`aaron1zhang`（以实际 GitHub 用户名为准）
- **url**：`https://github.com/aaron1zhang/dsh-dev-git-graph`
- **npm**：`dsh-dev-git-graph`（市场显示 `dsh plugin add dsh-dev-git-graph`）
- **en 描述**：A Git Graph panel for DSH Web — a faithful port of vscode-git-graph, auto-bound to the session workspace, with full git operations and light/dark theming.
- **zh 描述**：DSH Web 会话 Git Graph 面板——vscode-git-graph 的忠实移植，自动绑定会话工作区，支持全部 git 操作并适配明暗主题。

## 发布后自检

```sh
# 从市场装回验证（在任意 profile）
dsh plugin --profile web add dsh-dev-git-graph
dsh --profile web --dump-config | grep git-graph   # 组合树有 entry
# 重启 dsh web，会话页出现「Git 树」tab
```

---

> 注意：本插件含 **vendor/git-graph**（vscode-git-graph © mhutchie, MIT）源码级移植，
> LICENSE 与 README 均已做归属声明，发布合规。
