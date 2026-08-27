# 发布 dsh-mermaid-comm 到官方市场

插件发布到 DSH 官方市场的路径：**npm 发布 → GitHub 仓库 → 向 awesome-dsh-plugin 提 PR**。
本文档是逐步骤指引；需要你有 npm 账号和 GitHub 账号（当前机器均未登录）。

## 前置：已完成并验证

- `package.json`：license(MIT)、repository、homepage、keywords、files 含 LICENSE、`prepublishOnly` 构建钩子 ✅
- `README.md`：发布用英文版（功能/安装/架构/安全/开发）✅
- `LICENSE`：MIT ✅
- `npm pack` 产物完整：host+client+chunk+cordis.patch.yml+README+LICENSE ✅
- tarball 安装到隔离 profile 验证：dsh 组合树能发现、chunk 定位正确 ✅

## 第 1 步：注册/登录 npm 并发布

```sh
# 1. 注册账号（无账号时）https://www.npmjs.com/signup
# 2. 登录
npm login

# 3. 发布（自动触发 prepublishOnly 构建）
cd /Users/kp/DEV/dsh-plugins/packages/dsh-mermaid-comm
npm publish --access public

# 4. 验证
npm view dsh-mermaid-comm
```

> 包名 `dsh-mermaid-comm` 已确认未被占用。
> 以后更新版本：改 `version`（如 0.1.1 → 0.1.2），再 `npm publish`。

## 第 2 步：创建 GitHub 仓库并推送

```sh
# 1. 在 GitHub 建公开仓库 aaron1zhang/dsh-mermaid-comm（或你的用户名）
#    https://github.com/new
#    （可以勾选 README，也可以不勾，用本地推送）

# 2. 本地推送（当前目录就是 git 仓库，但注意 lib/ 被 gitignore，源码 + 配置入库即可）
cd /Users/kp/DEV/dsh-plugins
git remote add origin git@github.com:aaron1zhang/dsh-mermaid-comm.git
git push -u origin main

# 3. 配置 SSH key（当前 git@github.com 认证失败，因为公钥没加到账号）
#    查看公钥：
cat ~/.ssh/id_ed25519.pub
#    把它粘贴到 GitHub → Settings → SSH and GPG keys → New SSH key
#    验证：
ssh -T git@github.com   # 应显示 Hi <user>! You've successfully authenticated
```

> 若你希望**整个 workspace**（含 templates/docs/scripts/example-tool）也公开，
> 直接推整个仓库即可；若只想发布**插件包本身**，可以把包目录单独建仓。

## 第 3 步：向 awesome-dsh-plugin 提 PR

1. Fork [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
2. 编辑 `README.md`，在 **Docs & Rendering** 分类（按字母序）加一行：

```markdown
- [aaron1zhang/dsh-mermaid-comm](https://github.com/aaron1zhang/dsh-mermaid-comm) - Make the AI default to Mermaid diagrams in development conversations: global prompt guidance, mermaid_validate syntax check, and automatic chat-fence rendering to sanitized SVG.
```

3. （可选）编辑 `README.zh.md` 对应分类加中文行：

```markdown
- [aaron1zhang/dsh-mermaid-comm](https://github.com/aaron1zhang/dsh-mermaid-comm) - 让 AI 在开发交流中默认用 Mermaid 图表达：全局提示词引导 + mermaid_validate 语法校验 + 对话流代码围栏自动渲染为净化 SVG。
```

4. 提交 PR。合并后 1 天内自动进
   [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 和 dsh 内置市场。

## 市场条目元数据（提交 PR 时参考）

- **分类**：Docs & Rendering
- **name**：`dsh-mermaid-comm`
- **owner**：`aaron1zhang`（以实际 GitHub 用户名为准）
- **url**：`https://github.com/aaron1zhang/dsh-mermaid-comm`
- **npm**：`dsh-mermaid-comm`（有 npm 包时市场显示 `dsh plugin add dsh-mermaid-comm`）
- **en 描述**：Make the AI communicate with you using Mermaid diagrams by default in development conversations — prompt guidance, syntax validation, and automatic SVG rendering of chat code fences.
- **zh 描述**：让 AI 在开发交流中默认用 Mermaid 图表达：全局提示词引导 + mermaid_validate 语法校验 + 对话流代码围栏自动渲染为净化 SVG。

## 发布后自检

```sh
# 从市场装回验证（在任意 profile）
dsh plugin --profile web add dsh-mermaid-comm
dsh --profile web --dump-config | grep mermaid-comm   # 组合树有 entry
```

---

> 注意：`README.md` 里的 `How it works` 用了一个 mermaid flowchart。
> 若 GitHub 预览不渲染 mermaid，可考虑换成 ASCII/图片——但 dsh 市场站点
> (awesome-dsh-plugin.com) 能渲染 mermaid，所以保留没问题。
