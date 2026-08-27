# DSH 插件开发规范

> 面向在本工作区开发 dsh 插件的开发者。核心内容：插件生命周期、工具链、profile 策略、质量红线。

## 1. 插件生命周期（一个插件的完整流程）

```
脚手架（new-plugin.sh）
  → 写 src/index.ts（name/inject/apply）
  → 声明 cordis.patch.yml + package.json 的 dsh.bundle.patch
  → pnpm build（产出 lib/）
  → 安装到目标 profile（dsh plugin --profile <name> add <pkg>）
  → 启动 profile 联调
  → 修改后：重装（reinstall-in-profile.sh）
  → 满意后：移除/发布
```

## 2. 插件模块契约（强制）

每个插件模块**必须导出**这三个标识符，否则 Loader 无法加载：

```ts
export const name = 'example-tool'        // entry id（稳定、唯一）
export const inject = ['tools']           // 依赖的 service 列表
export function apply(ctx: Context, config?: ExampleConfig) {
  // 在此注册工具 / 事件 / 服务
}
```

- `name`：Loader entry 的 id，kebab-case，全局唯一，配置覆盖靠它定位。
- `inject`：声明即校验——缺失的 service 会导致插件加载失败（fail-loud），不要写运行时 `ctx.get()` 兜底核心依赖。
- `apply`：同步注册副作用，函数体结束后由 cordis 生命周期管理清理；需要异步清理用 `ctx.effect(() => () => dispose())`。
- 可选 `config`：插件配置类型，配 schemastery schema 才会被 `dsh` 校验与暴露到设置页。

### 两个实战踩坑（务必注意）

1. **`config` 可能是 `undefined`**：Loader 传入的 config 是 patch 里的**原始值**，不会自动填充 schema 的 `default`（default 只影响设置页/校验）。`apply` 必须写成 `(ctx, config = {})` 并用 `??` 兜底默认值，否则未配置时直接 `config.x` 会 `TypeError` 崩掉整个 profile 加载：
   ```ts
   export function apply(ctx: Context, config: Partial<MyConfig> = {}) {
     const { enabled = true, timeoutMs = 5000 } = config
   }
   ```
   参考官方 `dsh-tool-bash`：`function apply(ctx, config = {})` + `config.enableRunInBackground ?? true`。

2. **schemastery 没有 `z.infer`**：用全局命名空间推导 schema 类型：
   ```ts
   import z from '@deepseek-ai/schemastery'
   export const MyConfig = z.object({ enabled: z.boolean().default(true) })
   export type MyConfig = Schemastery.TypeT<typeof MyConfig>   // 不是 z.infer<...>
   ```
   且带 `default` 的字段会被推成必填，所以 `apply` 参数用 `Partial<MyConfig>`。

## 3. 工具类插件：`defineTool` 范式（强制使用）

注册模型可见工具**必须**用 `@deepseek-ai/dsh-tools` 的 `defineTool`，不要手写裸 schema：

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'example-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'example_query',
    description: '查询示例仓库状态。',
    parameters: {
      path: { type: 'string', required: true, description: '绝对路径' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // args 有类型；exec.signal 用于协作取消
      return 'OK'
    },
  }))
}
```

### defineTool 红线

1. **`output` 必填**：`{ schema, render }`。`render` 决定模型/UI 看到的 content。
2. **参数用 DSL 对象**：`{ type, required, description }`；支持 `oneOf`/`enum`/嵌套。
3. **错误处理**：参数错误用抛 `ToolArgsError`（或直接抛普通 Error，会被规范化为 isError）；不要在 execute 里吞异常返回假数据。
4. **取消**：长任务必须观察 `exec.signal`，在取消后停止工作并 settle，禁止悬挂。
5. **返回值**：必须符合 `output.schema` 声明的 JSON 类型，否则注册失败/运行时报错。
6. **并发**：默认保守（串行）。只有确认 body 无共享状态竞态时才声明 `isConcurrencySafe`。

### 工具可见性

- `ctx.tools.register()` 在普通插件 context 注册 = 全局可见（所有 agent）。
- 在 `agent.ctx` 注册 = 仅该 agent 可见，可同名 shadow 全局工具。
- 用 `ctx.tools.restrict(filter)` 可对单 agent 做 allow/deny 掩码。

## 4. 配置项与设置页

需要可配置项时用 schemastery schema + settings 服务：

```ts
import z from '@deepseek-ai/schemastery'

export const ExampleConfig = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().default(10000),
})

// 在 apply 中：config 已按 schema 校验
export function apply(ctx: Context, config: z.infer<typeof ExampleConfig>) { ... }
```

要暴露到 Web 设置页（插件配置卡片）：
- 用 `installSettingsSection(ctx, namespace, Schema, entry, { setSource, onChange })`。
- `namespace` 用 `settingsNamespace('my-plugin')` 生成。
- 客户端用 settings 卡片呈现（见 [REFERENCE.md](REFERENCE.md)）。

## 5. 需要 HTTP 路由 / 服务

```ts
export function apply(ctx: Context) {
  ctx.inject(['webServer', 'loader'], (host) => {
    host.effect(() => mountMyRoutes(host), 'my-plugin: http routes')
  })
}
```

- `webServer` 是宿主提供的 HTTP 服务；`loader` 是插件加载器。
- 用 `ctx.effect()` 注册清理逻辑，避免热重载/卸载时泄漏路由。

## 6. 工具链

| 环节 | 工具 | 说明 |
|---|---|---|
| 编译 | `tsc`（NodeNext） | 产出 `lib/types/` 声明 + 可执行 JS |
| 打包 | `tsdown`（可选） | 客户端 bundle（浏览器产物）用 |
| 类型 | `tsc --noEmit` | `pnpm typecheck` |
| 依赖 | `pnpm` | workspace + 安装到 profile |
| 运行时 | node >= 22 | 与 dsh 要求的 node 版本对齐 |

服务端插件（纯 Node 工具）建议 `tsc` 直出；带浏览器端 UI 的插件才需要 `tsdown` 打客户端 bundle。

## 7. profile 策略（重要）

- **开发默认目标 `web`**：直接在 GUI 里验证工具是否出现在模型工具列表。
- **联调建议独立 profile**（如 `devtest`）隔离：
  ```bash
  dsh plugin --profile devtest add dsh-example-tool
  dsh --profile devtest
  ```
- **不要**用 `dsh plugin add` 之外的方式手工改 `dsh.profile.bundles`；reconcile 逻辑会自动把声明了 `dsh.bundle` 的依赖加进层栈。
- 官方 bundle（`@deepseek-ai/dsh-base` 等）永远来自 dsh 安装目录，不装进 profile；profile 的 node_modules 只放树外插件。

## 8. 质量红线

1. 提交前必须过 `pnpm typecheck`。
2. 工具描述写清楚**副作用**（是否写文件/改配置/联网），让模型能判断。
3. 插件卸载必须干净：`ctx.effect`/dispose 清理所有注册、路由、定时器。
4. 不吞异常：能 fail-loud 就 fail-loud，错误信息可诊断。
5. 版本号遵循 semver；`dsh.bundle.patch` 路径变更要同步 bump。

## 9. 验证清单

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm build` 产出 `lib/`
- [ ] `dsh plugin --profile web add <pkg>` 后，重启 web 能看到工具
- [ ] 工具调用符合输出 schema，UI 渲染正常
- [ ] 卸载后 profile 干净（`dsh plugin --profile web remove <pkg>`）
