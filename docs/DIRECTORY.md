# DSH 插件工作区 —— 目录规范

> 目标：任何新增插件或脚本都有明确的落位，文件职责单一、命名一致，review 时不需要猜。

## 顶层目录

| 路径 | 职责 | 规则 |
|---|---|---|
| `packages/` | 所有插件包（pnpm workspace 成员） | 一包一个目录，包名用 kebab-case，目录名与包名一致 |
| `scripts/` | 开发/构建/安装脚本 | 只放 `.sh`（bash）或 `.mjs`（node），不放一次性命令 |
| `docs/` | 规范与参考文档 | 与代码同步维护 |
| `templates/` | 脚手架模板 | 由 `new-plugin.sh` 引用，模板里用 `<placeholder>` 标注需替换处 |

## 插件包内目录规范（packages/<name>/）

```
packages/<name>/
├── src/               # 源码（TS）
│   ├── index.ts       # 入口：导出 { name, inject, apply }
│   └── ...            # 按功能拆分；工具注册、配置、路由分文件
├── lib/               # 构建产物（gitignore，不提交）
├── cordis.patch.yml   # 插件 bundle patch（insert 本插件 entry）
├── package.json       # 含 dsh.bundle.patch 声明
├── tsconfig.json      # extends 根 tsconfig.base.json
├── README.md          # 插件说明
└── docs/              # 插件专属文档（可选）
```

### 命名规范

| 对象 | 规范 | 示例 |
|---|---|---|
| 包名（npm） | kebab-case，可用 `dsh-` 前缀表意 | `dsh-example-tool` |
| entry id | kebab-case，短、稳定、全局唯一 | `example-tool` |
| 工具名（模型可见） | `snake_case`（工具/参数都走 LLM 命名惯例） | `example_query` |
| 源码文件 | kebab-case.ts | `tool-example.ts` |
| 插件模块导出 | 固定三件套 `name` / `inject` / `apply` | — |

### cordis.patch.yml 规范

每个插件包的 patch 文件只做一件事：**insert 本插件的 entry 行**。不要在里面写别的插件的覆盖。

```yaml
# 每个 bundle 的 patch：把本插件插进 profile 的层栈
- insert:
    - id: example-tool
      name: dsh-example-tool
```

配置覆盖（改其他插件的 config / 禁用某行）应放在 **profile 自己的 `cordis.patch.yml`**，
或用户级 `$DSH_HOME/cordis.patch.yml`，不要放在插件 bundle 的 patch 里。

## 构建产物规范

- 统一构建到包内 `lib/`（官方约定：`main` 指向 `lib/index.js`，`types` 指向 `lib/types/index.d.ts`）。
- `lib/` 一律 gitignore，不允许提交产物。
- 客户端产物（若有）统一 `lib/client.js`，入口在 `package.json` 的 `exports["./client"]` 声明。

## 脚本规范

- `scripts/*.sh` 统一支持 `bash scripts/<name>.sh <profile>`，默认 profile 为 `web`。
- 脚本必须是**可重复执行**的（幂等）：重复安装/卸载不应产生副作用或报错。
- 每个脚本开头要有注释块说明用途、参数、是否破坏性。

## 文档规范

- 根 README：工作区总览 + 快速开始。
- `docs/DIRECTORY.md`：本文件（目录规范）。
- `docs/DEVELOPMENT.md`：开发规范（工具链、生命周期、profile 策略）。
- `docs/REFERENCE.md`：dsh 插件 API 速查。
- 每个插件包自带 `README.md`，说明用途、配置项、暴露的工具。
