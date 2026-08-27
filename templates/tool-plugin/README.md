# <plugin-name>

由 dsh-plugins 模板生成的 DSH 工具类插件。

- 通过 `defineTool` 注册模型可见工具。

## 安装 / 卸载

```bash
pnpm build
pnpm install:web      # 或 dsh plugin --profile web add <plugin-name>
pnpm remove:web       # 或 dsh plugin --profile web remove <plugin-name>
```

## 验证

在 dsh web 会话中让模型调用 `<entry-id>_echo`。