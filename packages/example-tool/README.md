# dsh-example-tool

DSH 插件开发示例：**最小工具类插件**。

- 用 `defineTool` 注册模型可见工具：
  - `example_git_status`：查询 git 工作区状态（只读）
  - `example_echo`：回显文本（验证安装）
- 演示：插件模块契约（`name`/`inject`/`apply`）、配置 schema（schemastery）、
  `output` 声明与 `render`。

## 安装

```bash
# 在工作区根目录
pnpm build
pnpm install:web          # 或：dsh plugin --profile web add dsh-example-tool
# 重启 dsh web 后验证
```

## 卸载

```bash
pnpm remove:web           # 或：dsh plugin --profile web remove dsh-example-tool
```

## 配置

在 profile 的 `cordis.patch.yml`（或 `$DSH_HOME/cordis.patch.yml`）中覆盖：

```yaml
- id: example-tool
  config:
    enableGitStatus: true
    timeoutMs: 5000
```

## 验证

在 dsh web 会话中让模型调用 `example_echo`，返回 `[example-tool] <text>` 即安装成功。