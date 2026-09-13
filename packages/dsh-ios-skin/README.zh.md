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

- 通过 DSH 官方 `--dsw-alias-*` 主题变量接入，而不是重建官方组件；
- 以 iOS system background、system blue 和 SF Pro 字体栈建立清晰层级；
- 页面、面板、浮层和插件 surface 使用不同透明度、模糊半径、细边框与阴影，形成克制的液态玻璃层次；
- 输入框、代码、终端和可编辑正文保持稳定的高对比度表面，避免透明背景影响阅读和编辑；
- 支持 `backdrop-filter` 的浏览器使用磨砂玻璃，不支持时自动回退到半透明实体背景；
- 只通过官方 sidebar footer slot 提供设置入口，不监听 body 子树、不移动或隐藏官方节点、不接管模型、会话和输入交互；
- 支持浅色、深色、跟随系统三种外观，并尊重系统的减少动画设置。

## 开发

```sh
pnpm --filter dsh-ios-skin typecheck
pnpm --filter dsh-ios-skin test
pnpm --filter dsh-ios-skin build
```
