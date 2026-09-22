# DSH 插件开发工作区

DeepSeek Harness（dsh）插件开发的标准工作区模板。包含目录规范、开发规范、构建/安装脚本，
以及插件示例与完整插件（`defineTool` 注册模型可见工具）。

目标 profile：**web**（`$DSH_HOME/profiles/web`）。

## 目录结构

```
dsh-plugins/
├── package.json            # workspace 根（脚本聚合：build/typecheck/install）
├── pnpm-workspace.yaml     # pnpm workspace 配置（packages/*）
├── tsconfig.base.json      # 各包共享的 TS 编译基线
├── .gitignore
├── docs/
│   ├── DIRECTORY.md        # 目录规范
│   ├── DEVELOPMENT.md      # 开发规范
│   ├── REFERENCE.md        # dsh 插件 API 参考速查
│   └── DESIGN-mermaid-comm.md  # dsh-mermaid-comm 设计文档（含存储/持久化）
├── scripts/
│   ├── install-to-profile.sh   # 构建 + 安装到指定 profile
│   ├── remove-from-profile.sh  # 从 profile 卸载
│   ├── reinstall-in-profile.sh # 重装（开发联调用）
│   └── new-plugin.sh           # 脚手架：从 templates/ 生成新插件包
├── templates/
│   └── tool-plugin/        # 工具类插件模板（new-plugin.sh 使用）
├── apps/
│   └── spellbook/          # 咒语书 · 前端效果库（独立站点，非 workspace 成员）
└── packages/
    ├── example-tool/       # 最小工具插件示例
    ├── dsh-mermaid-comm/   # 让 AI 优先用 Mermaid 图交流的插件（MVP：prompt 引导 + 校验工具）
    └── dsh-dev-git-graph/      # 会话 Git Graph 面板（移植 vscode-git-graph，自动绑定会话工作区）
```

## 快速开始

```bash
# 1. 安装 workspace 依赖（首次）
pnpm install

# 2. 构建所有插件
pnpm build

# 3. 安装到 web profile（构建产物会被拷贝到 $DSH_HOME/profiles/web）
pnpm install:web

# 4. 验证：重启 dsh web，在会话里调用示例工具
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm build` | 构建所有插件包 |
| `pnpm typecheck` | 类型检查所有插件包 |
| `pnpm install:web` | 构建并安装全部插件到 web profile |
| `pnpm remove:web` | 从 web profile 卸载全部插件 |
| `pnpm reinstall:web` | 重装（开发联调） |
| `bash scripts/new-plugin.sh my-plugin` | 从模板生成新插件包 |
| `pnpm --filter <pkg> run dev` | 单个插件的 watch 构建 |
| `pnpm dev:site` | 启动咒语书本地预览（默认 `127.0.0.1:5180`，改内容自动重建） |
| `pnpm build:site` | 构建咒语书 → `packages/dsh-spellbook/dist/` |
| `pnpm test:site` | 咒语书的解析与校验测试 |

## 咒语书 · 前端效果库

`packages/dsh-spellbook/` 是一个独立站点（**不是** workspace 成员，不参与 `pnpm -r run build`）：
把「一句话能带来什么前端效果」沉淀成可检索的库。一条咒语 = 一段描述 + 一段示例代码，
描述负责说清机制，代码负责证明它跑得起来，图版里跑的是真实代码。

零运行时依赖、零 CDN、字体自托管。内容即唯一真相，`shared/` 里的解析与校验不依赖 DOM，
将来会被 DSH 插件直接复用（插件的目标是自动匹配咒语并在沙盒里预览）。

详见 [packages/dsh-spellbook/README.md](packages/dsh-spellbook/README.md)。

## 目标 profile 选择

默认面向 `web`。开发/联调时建议用一个独立 profile（如 `devtest`）隔离，避免污染真实 web profile：

```bash
dsh plugin --profile devtest add <pkg>   # 创建独立 profile 并安装
dsh --profile devtest                    # 启动该 profile
```

见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 的「profile 策略」章节。

## 规范文档

- [目录规范](docs/DIRECTORY.md)
- [开发规范](docs/DEVELOPMENT.md)
- [API 参考速查](docs/REFERENCE.md)
