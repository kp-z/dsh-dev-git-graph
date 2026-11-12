# DSH 插件工作区 —— 目录规范

> 目标：任何新增插件或脚本都有明确的落位，文件职责单一、命名一致，review 时不需要猜。

## 顶层目录

| 路径 | 职责 | 规则 |
|---|---|---|
| `packages/` | 所有插件包（pnpm workspace 成员） | 一包一个目录，包名用 kebab-case，目录名与包名一致 |
| `apps/` | 独立可运行的站点/应用（**不是** workspace 成员） | 目前为空、预留；一应用一目录；自带 `build`/`dev` 脚本；不参与 `pnpm -r run build` |
| `scripts/` | **工作区级**开发/构建/安装脚本 | 只放 `.sh`（bash）或 `.mjs`（node）；插件专属脚本放回该插件的 `scripts/` |
| `docs/` | **工作区级**规范与参考文档 | 与代码同步维护；插件专属文档放回 `packages/<name>/docs/` |
| `templates/` | 脚手架模板 | 由 `new-plugin.sh` 引用，模板里用 `<placeholder>` 标注需替换处 |
| `archive/` | 已停用但值得留作参考的实现 | 只进不出：不再修改、不再被引用 |
| `artifacts/` | 生成的交付物（文档导出、截图等） | 生成物优先不进版本库；确需入库时按批次建子目录 |
| `tsconfig.base.json` | 各插件 `tsconfig.json` 的 `extends` 目标 | **必须保留**：6 个包直接 extends 它 |

> `apps/` 与 `packages/` 的分界：**要成为插件**的放 `packages/`，**只是网页**的放 `apps/`。
> 站点刻意不进 workspace，这样根目录的 `pnpm -r run build` 和插件安装流程都不受影响。

### 根目录禁止清单 🚫

本仓库曾长期「既是 workspace 根、又是 `dsh-dev-git-graph` 的插件根」，于是同一份插件源码在根目录和包内各存一份，
并各自演进、逐渐分叉（2026-09 清理时，根副本落后包内两个多月）。**根目录不得出现下列任何一项**，
它们只属于 `packages/<name>/`：

| 禁止出现 | 原因 |
|---|---|
| `src/` | 插件源码只在包内。根副本会与包内分叉，改错文件也不报错 |
| `cordis.patch.yml` | 同上；根目录那份会被误当成某个插件的 bundle patch |
| `vendor/` | vendored 第三方资源落位是**包内** `src/vendor/`（见下文） |
| `tsconfig.json`、`web.tsconfig.json` | 编译范围只应落在包内；根级 tsconfig 会顺手把上面的残留一起编译 |
| `lib/`、`dist/`、`node_modules/` | 构建产物与依赖一律 gitignore |

## 应用内目录规范（apps/<name>/）

> `apps/` 目前是空的。下面这套站内形态当前由 `packages/dsh-spellbook/`（咒语书）承担——它既是站点又是插件包，
> 站点部分沿用同一套约定；将来出现「只是网页、不做插件」的项目，再落 `apps/<name>/`。

以 `packages/dsh-spellbook/`（咒语书）为准：

```
apps/<name>/
├── content/           # 内容源：一条内容一个文件，是唯一真相
├── shared/            # 与宿主无关的纯逻辑（解析、校验），未来插件直接复用
├── src/               # 只负责渲染与样式，不含内容
│   ├── render/        #   html 生成
│   ├── styles/        #   css
│   └── site.js        #   浏览器侧行为
├── test/              # node --test
├── build.mjs          # 读 content → 校验 → 产出 dist/
├── serve.mjs          # 本地预览，改动自动重建
└── dist/              # 构建产物（gitignore）
```

规则：

- 内容与渲染分离。加一条内容只动 `content/`，不碰 `src/`。
- `shared/` 里不许出现 DOM、不许出现框架。宿主（插件）与浏览器用同一份解析与校验。
- 零运行时依赖。站点不引入框架、不引 CDN，字体自托管。

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

### 面板第三方资源（vendored）

面板是宿主路由吐出来的网页，**运行期不依赖 CDN**：要用的前端组件随包发布，落位固定在
`src/vendor/`（源，入库）→ 构建同步到 `lib/vendor/`（运行时读的那份，随 `files` 发布）。

- 一个组件一个目录级命名空间；另起 `src/vendor/README.md` 记**版本 / 来源 URL / sha256 / 许可**。
- 许可原文一并入库（如 `LICENSE.tabulator`）。上游是 MIT 也要放，别只写在 README 里。
- 宿主侧只开一条**只读白名单路由** `/vendor/:file`（精确文件名 → MIME；未命中 / 穿越一律 404，
  磁盘缺失才 500 且带可读路径），并给 `immutable` 长缓存——面板引用时带 `?v=<版本>` 当缓存钥匙。
- 资源加进 `src/vendor/` 必须同时改白名单：`test/vendor.test.ts` 会逐个文件核对
  「在白名单里 + 路由取得到 + src 与 lib 逐字节一致」，漏改就在这里红。
- **参照实现**：`packages/dsh-contract-butler`（Tabulator 6.5.3，MIT，`src/vendor/README.md`
  里记着三个文件的 sha256）。
- 落位是**包内** `src/vendor/`。`packages/dsh-dev-git-graph/vendor/`（包根、无 `src/` 前缀）是早期遗留，
  待迁移到 `src/vendor/`；新插件不要照它抄。

## 脚本规范

- `scripts/*.sh` 统一支持 `bash scripts/<name>.sh <profile>`，默认 profile 为 `web`。
- 脚本必须是**可重复执行**的（幂等）：重复安装/卸载不应产生副作用或报错。
- 每个脚本开头要有注释块说明用途、参数、是否破坏性。

## 文档规范

`docs/` 只放**工作区级**文档。三类内容分开，别再混着长；已有文件按此迁移，新文件直接按目标落位：

| 类别 | 目标落位 | 现状 |
|---|---|---|
| 规范 / 参考 | `docs/` 根 | `DIRECTORY.md`、`DEVELOPMENT.md`、`REFERENCE.md`、`RELEASE.md` ✅ 已就位 |
| 插件专属（发布指引、设计稿、调研） | `packages/<name>/docs/` | 仍在 `docs/` 根，靠 `dsh-<插件名>` 前缀区分；**待迁移** |
| 预览 / 资产（HTML、设计稿 CSS） | `docs/assets/<主题>/` | 仍在 `docs/` 根（`ios-glass-demo.html`、`design-v3/` 等）；**待迁移** |

- 根 README：工作区总览 + 快速开始。
- 每个插件包自带 `README.md`，说明用途、配置项、暴露的工具。
- 插件专属文档在迁移之前，文件名必须带 `dsh-<插件名>` 前缀（如 `RELEASE-dsh-ios-skin.md`），
  否则将来无法按前缀判断该归哪个包。
