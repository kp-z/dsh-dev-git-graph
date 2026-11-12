# DSH Plugins

**DeepSeek Harness**（`dsh`）插件集合 —— 一个插件一个包，pnpm monorepo 组织。
每个包都独立装进 dsh profile；这个工作区存在的意义，是让多个插件能并排开发、构建和联调。

- 仓库地址：<https://github.com/kp-z/dsh-plugins>
- English: [README.md](README.md)

## 插件清单

「安装参数」一列是 `dsh plugin --profile web add …` 的参数，说明见[安装](#安装)。

| 包 | 做什么 | 安装参数 | npm | 文档 |
| --- | --- | --- | --- | --- |
| `dsh-agent-world`<br>`0.1.0` | 把多智能体协作搬进一座可视化 **3D 小镇**：每个真实 subagent 是一个会走动的角色，每件任务是一张可被拾取的工单，每次调度是一次空间上的移动与协作。内容库层、模块协议与模拟内核已就位；当前能看见的是 2D 俯视调试视图，**3D 场景还没接上**。 | `file:packages/dsh-agent-world` | 未发布（`private`） | [README](packages/dsh-agent-world/README.md) |
| `dsh-contract-butler`<br>`0.1.0` | 协议管家：从代码里反向抽出边界契约（输入输出的形状），盯着它随版本演化，再拿运行时的真实载荷去对照声明——让「AI 写实现、人管约定」有一个可被人审阅的单一出处。 | `file:packages/dsh-contract-butler` | 未发布 | [README](packages/dsh-contract-butler/README.md) |
| `@kpeace/dsh-daily`<br>`0.10.4` | **日报**插件：每日主动推荐多类型新闻，可用自然语言调教推荐偏好，索引网页与 YouTube / 哔哩哔哩视频，在右侧栏以常驻网页呈现——点一条就到了。 | `@kpeace/dsh-daily` | 0.10.4 | [README](packages/dsh-daily/README.md) |
| `dsh-dev-git-graph`<br>`0.1.4` | 会话页里的 **Git Graph 面板**：源码级移植 [mhutchie/vscode-git-graph](https://github.com/mhutchie/vscode-git-graph) 1.30.0，自动绑定当前会话工作区，渲染提交图（分支彩线、提交信息、日期、作者、refs），右键可执行原扩展的全部 git 操作。 | `dsh-dev-git-graph` | 0.1.3（本仓 0.1.4 未发） | [README](packages/dsh-dev-git-graph/README.md) |
| `dsh-feishu`<br>`0.20.1` | 飞书同步：配置个人授权后，定时把飞书任务与文档同步到本地；任务可直接开成 DSH 会话，进展、预期与协作结果再写回飞书。 | `file:packages/dsh-feishu` | 未发布（`private`；npm 上同名包是别的东西） | [README](packages/dsh-feishu/README.md) |
| `dsh-ios-skin`<br>`0.3.0` | DSH Web GUI 的 **iOS 26 液态玻璃（Liquid Glass）** 主题：官方设计 token 全面重调 + 真正的一层磨砂玻璃材质，支持浅色/深色、降低透明度与高对比度。当前版本叫「Deep Fusion」。 | `dsh-ios-skin` | 0.1.0（本仓 0.3.0 未发） | [README](packages/dsh-ios-skin/README.md) |
| `dsh-mermaid-comm`<br>`0.3.1` | 让 AI 在开发交流中**优先用 Mermaid 图**表达：对话输入框的勾选按钮控制 prompt 引导，`mermaid_validate` 校验语法，输出闸门自动修复或摘掉画坏的图，Mermaid 图库把图按版本存进工作区。渲染由 [`dsh-mermaid`](https://github.com/MrmoLabs/dsh-mermaid) 承担。 | `dsh-mermaid-comm`（连同 `dsh-mermaid`） | 0.3.1 | [README](packages/dsh-mermaid-comm/README.md) |
| `dsh-spellbook`<br>`0.2.5` | **咒语书**·前端效果库：右侧栏一个「咒语书」tab。一条咒语 = 一段说清机制的描述 + 一段真实跑得起来的示例代码（图版里跑的是真代码，不是录屏）；点一下就把那条咒语送进对话输入框，模型也能用 `spellbook_lookup` 查回来。 | `dsh-spellbook` | 0.2.5 | [README](packages/dsh-spellbook/README.md) |
| `dsh-tab-split`<br>`0.1.0` | 会话**视图分屏**：新增一个「分屏」视图 tab，把已入驻的视图（对话 / Git 树 / …）拆成并排窗格。默认仍是官方单视图，点分屏按钮才激活。 | `file:packages/dsh-tab-split` | 未发布 | [README](packages/dsh-tab-split/README.md) |
| `dsh-example-tool`<br>`0.1.0` | **最小工具类插件示例**：用 `defineTool` 注册 `example_git_status` 与 `example_echo`，演示插件模块契约、配置 schema 与 `output` / `render` 声明。写新插件从这里起步。 | `file:packages/example-tool` | 未发布 | [README](packages/example-tool/README.md) |

## 安装

```bash
# 装一个插件到指定 profile（例子用 web）
dsh plugin --profile web add <上面表格里的「安装参数」>

# 卸载
dsh plugin --profile web remove <包名>

# 重启 dsh（或重载该插件），新 entry 才会被读到
```

- **从 npm 装**：直接给 npm 包名（`dsh plugin --profile web add @kpeace/dsh-daily`）。
- **从克隆装**：给路径，例如在仓库根目录执行
  `dsh plugin --profile web add file:packages/dsh-contract-butler`（绝对路径 `file:/…` 同样可以）。
- **整个工作区一起装**：`pnpm build && pnpm install:web` 构建全部包并装进 `web` profile；
  `pnpm remove:web` 再全部卸掉。
- **联调用一个独立 profile**，别污染真实 profile：
  `dsh plugin --profile devtest add <pkg>`，再 `dsh --profile devtest`。
- 有几个包的安装有额外前提，装之前先看它自己的 README：`dsh-daily`（必须装成真实目录，
  不能用符号链接）、`dsh-feishu`（启用它的 bundle 并授权飞书 CLI）、`dsh-dev-git-graph`
  （依赖 `dsh-better-sidebar`）、`dsh-mermaid-comm`（与 `dsh-mermaid` 配套）。

## 仓库结构

| 路径 | 是什么 |
| --- | --- |
| `packages/<name>/` | 一个插件一个目录——这就是包的布局，位置不变。每个包自己带 `package.json`、`src/`、构建产物（`lib/`）、资产和 `README.md`。 |
| `package.json` | workspace 根：聚合脚本（`build` / `typecheck` / `install:web` / …）。 |
| `pnpm-workspace.yaml` | pnpm workspace 配置，`packages/*`。 |
| `tsconfig.base.json` | 各包共享的 TypeScript 编译基线。 |
| `docs/` | 目录规范、开发规范、dsh 插件 API 速查，以及各插件的设计文档。 |
| `scripts/` | 安装 / 卸载 / 同步 / 脚手架脚本，以及 Desktop 兼容性体检。 |
| `templates/` | `scripts/new-plugin.sh` 使用的 `tool-plugin` 模板。 |

一个包永远只住在 `packages/<name>`，profile 解析的是它 `package.json` 里的名字；
工具产出（`pnpm build` → `lib/`）不会挪动源码位置。

## 开发

本工作区是一个**独立的 pnpm workspace**，不是 dsh profile 自己的 `pnpm-workspace.yaml`。
各包在开发期在这里做依赖解析与联调；发布 / 安装则通过
`dsh plugin --profile <profile> add <pkg>` 装进 `$DSH_HOME/profiles/<profile>`。
如果某个包需要被 dsh 以 `file:` 依赖直接引用，也可以把 profile 目录并进来，但那会拖入
web app 的整棵依赖树——推荐保持独立。

要求 Node.js >= 22。

```bash
pnpm install        # 解析 workspace 依赖
pnpm build          # 构建所有包（pnpm -r run build）
pnpm typecheck      # 类型检查所有包
pnpm install:web    # 构建并安装全部插件到 web profile
```

| 命令 | 说明 |
| --- | --- |
| `pnpm build` | 构建所有插件包（各包用 `tsc` 产出 `lib/`，并拷贝自己的资产）。 |
| `pnpm typecheck` | 类型检查所有插件包。 |
| `pnpm install:web` | 构建并安装全部插件到 `web` profile。 |
| `pnpm sync:web` | 把构建产物补进 `web` profile，包括硬链接副本缺失的新文件。 |
| `pnpm sync:web:check` | 只检查副本与源码是否一致；有差异退出码 1。 |
| `pnpm remove:web` | 从 `web` profile 卸载全部插件。 |
| `pnpm reinstall:web` | 重装（开发联调用）。 |
| `pnpm --filter <pkg> run dev` | 单个插件的 watch 构建。 |
| `bash scripts/new-plugin.sh my-plugin` | 从 `templates/` 生成新插件包。 |
| `pnpm dev:site` / `build:site` / `test:site` | 咒语书站点的预览 / 构建 / 测试。 |

动手改之前，有两条约定值得先知道：

- **新增文件后必须 `pnpm sync:web`**：profile 里放的是硬链接副本，上次同步之后新增的文件
  不会再自动出现。
- **`peerDependencies` 就是兼容性闸门**：在 DSH Desktop（Electron）上，凡是声明了
  `@deepseek-ai/dsh*` 版本范围、且该范围不接纳当前 runtime 的插件，会在 profile 启动前被
  静默 `disabled`——现象是「插件消失了」，而不是报错。用
  `node scripts/verify-desktop-plugin-gate.mjs` 体检某个 profile：它直接调用 App 里生产同款的
  `evaluatePluginCompatibility()`，不会与实际行为漂移。

## 规范与参考

- [目录规范](docs/DIRECTORY.md)
- [开发规范](docs/DEVELOPMENT.md) —— 插件生命周期、模块契约、profile 策略、质量红线
- [dsh 插件 API 参考速查](docs/REFERENCE.md)
