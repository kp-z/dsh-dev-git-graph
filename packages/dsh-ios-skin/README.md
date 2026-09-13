# dsh-ios-skin

为 DeepSeek Harness 提供遵循 iOS 设计语言的主题皮肤。

- 不修改官方组件结构，仅注入 CSS 变量和主题样式；
- 支持浅色、深色、跟随系统三种外观；
- 通过左侧官方 footer slot 提供主题设置入口；
- 不监听 `document.body`，不影响模型、输入框、会话和 workspace 分组。

## 安装

```sh
dsh plugin --profile web add file:/path/to/dsh-plugins/packages/dsh-ios-skin
# 重启 dsh web
```

## 设计原则

- SF Pro 风格字体栈与清晰的层级；
- 8px 基础间距与 iOS 风格圆角；
- 半透明层级、轻量阴影和系统蓝色强调色；
- 触控友好的最小按钮尺寸；
- 深色模式使用接近 iOS system background 的分层黑色，而非纯黑。

## 开发

```sh
pnpm --filter dsh-ios-skin typecheck
pnpm --filter dsh-ios-skin test
pnpm --filter dsh-ios-skin build
```
