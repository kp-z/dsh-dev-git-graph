# DSH 插件 API 参考速查

> 面向开发时的快速查表。完整契约以各官方包的 README 为准
> （`node_modules/@deepseek-ai/dsh-*` 内均有 `README.md`）。

## 核心包

| 包 | 用途 |
|---|---|
| `@deepseek-ai/cordis` | 元框架：`Context`、DI、事件、作用域 |
| `@deepseek-ai/cordis-plugin-loader` | 插件加载器（entry 管理） |
| `@deepseek-ai/dsh-tools` | 工具注册表 + `defineTool` + 执行管道 |
| `@deepseek-ai/schemastery` | 配置 schema（zod 风格） |
| `@deepseek-ai/dsh-settings` | 设置项注册（`installSettingsSection`） |
| `@deepseek-ai/dsh-agent` | Agent 模型 |
| `@deepseek-ai/dsh-llm` | LLM 适配、`HarnessError` |

## Cordis Context 常用能力

| 能力 | 用法 |
|---|---|
| 注册插件 | `ctx.plugin(Module, config)` |
| 提供服务 | `ctx.provide(name, impl)` |
| 获取服务 | `ctx.get(name)` / `inject` 声明 |
| 事件 | `ctx.on(event, cb)` / `ctx.emit(event, data)` |
| 作用域 | `ctx.extend(meta)`（子上下文）、`ctx.isolate(name)`（隔离服务） |
| 生命周期 | `ctx.effect(() => () => dispose())` |
| 依赖注入 | `ctx.inject(['a','b'], cb)` 等待服务可用后回调 |
| 日志 | `ctx.logger(name)` |

## defineTool 选项

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

defineTool({
  name: 'snake_case_tool',
  description: '…（写明副作用）',
  parameters: { /* DSL */ },
  output: { schema, render, presentationMeta? },
  timeoutMs?: number,
  isConcurrencySafe?: (args) => boolean,
  execute: async (args, exec) => JsonValue,
})
```

- `exec.signal`: `AbortSignal`（协作取消）
- `exec.agent`: 当前 agent（可用于按 agent 分支）
- `output.render(args, value)` → `[{ type: 'text', text }]`（或 images 等 content 块）

## ToolExecutionResult（execute 返回/管道产物）

- 成功：`{ isError: false, value, content, meta? }`
- 失败：`{ isError: true, error: { message, info? }, content }`
- 参数校验失败自动得到 `ToolArgsError`（`INVALID_ARGS`）。

## 工具执行管道（tools/）

```
tools/pre-execute (可扩展 allow/deny/ask 门)
  → tools.guard() 守卫
  → tools/execute (超时/重试/埋点 wrapper)
  → tools/post-execute (改内容/值/附加 context)
  → output.render → tools/result (只读通知)
```

## UI 呈现意图（presentCall / presentResult）

返回 `card` 类型，让 Web UI 不特判工具名即可渲染：

| card | 场景 |
|---|---|
| `generic` | 通用围栏代码块 |
| `terminal` | 命令行执行（output/exitCode/signal） |
| `diff` | 代码 diff |
| `read` | 文件读取（行号窗口） |
| `search` | grep/glob 搜索结果 |
| `web` | web 搜索/抓取 |

## 插件配置声明（package.json）

```jsonc
{
  "name": "dsh-example-tool",
  "type": "module",
  "main": "./lib/index.js",
  "types": "./lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-runtime"] },
    "skills": ["./skills/my/SKILL.md"]
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "*"
  }
}
```

## 安装/管理命令

```sh
dsh plugin --profile web add <pkg>        # 安装并 reconcile bundles
dsh plugin --profile web remove <pkg>     # 卸载
dsh plugin --profile web why <pkg>        # 依赖关系
dsh --dump-config --profile web           # 查看组合后配置树
dsh --dump-default-config --profile web   # 只看 bundle 层
```

## 关键事实

- bundle 解析顺序：**dsh 安装目录优先，profile node_modules 次之**。
- 层栈：bundle patches → profile `cordis.patch.yml` → home `cordis.patch.yml` → `--patch` 覆盖。
- patch 是**整行替换** config（不合并），所以模式相关的差异放各模式 bundle，不要放共享层。
