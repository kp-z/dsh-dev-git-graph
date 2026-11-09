# dsh-ios-skin

**Deep Fusion（品牌融合）** —— 为 DeepSeek Harness Web GUI 提供的 DeepSeek 品牌化液态玻璃主题。

v0.3.0 是一次完整的视觉重设计：架构不变（官方 token 交接 + 材质层），但调色板、玻璃与签名全部围绕 DeepSeek 品牌蓝重建。

当前版本 **v0.3.0** —— Deep Fusion。对应官方 `@deepseek-ai/dsh-client-ui-theme` **0.2.1-rc.2**（DSH 0.2.x）。

## 截图

为避免暴露内部信息，截图已移除；主题功能、安装和使用说明保留。

主题分两层，这也是它能「全面」而不是只改几个按钮的原因：

1. **Token 层** —— 把官方 `--dsw-*` 设计 token（背景、边框、标签、按钮、markdown、滚动条、elevation、shadow、specific 表面）整体重调为 Deep Fusion 取值：纯色画布 `#F0F2F7` / `#12141A`、DeepSeek 品牌蓝、中性偏蓝玻璃与配套分隔线。官方组件读这些 token，所以全应用的表层会一起跟着变，主题不需要点名任何一个组件。宿主提供主题服务（`ctx.theme.overrideTokens`）时，token 以校验过的 `{ light, dark }` 成对形式交给服务，并在卸载时释放；没有该服务、或服务拒绝这一层时，同样的声明随插件样式表注入。两种路径都以 `src/client.js` 为唯一事实来源。
2. **材质层** —— 提供玻璃本身：中性偏蓝的磨砂模糊、外 1px 白 rim + 内 1px 品牌 rim、克制的 elevation，以及 Deep Fusion 的签名（激活 dock 表面顶部 1px 品牌渐变光带）。表面靠组件局部类名模式 *和* 语义/ARIA 钩子（`header`、`nav`、`aside`、`[role=dialog]`、`[role=menu]` 等）双重命中。这一层天生是尽力而为的：它依赖官方内部组件名（见[已知限制](#已知限制)），所以加载时会做一次只读探测，一个都没命中就明确报警。

## 动什么、不动什么

| | |
|---|---|
| 只画 | 背景、边框、模糊、阴影、圆角、颜色、字体族、品牌 rim 与签名光带 |
| 绝不动 | 结构、布局、尺寸、位置、指针事件、滚动 |
| 明暗 | 跟随宿主已有的 `body[data-ds-dark-theme]`，没有独立开关 |
| 主题 API | 可选走 `ctx.theme.overrideTokens` 交接 token；不可用时回退为整张样式表 |
| 签名 | 激活的 dock pane / 浮动标签页顶边 1px 品牌渐变光带；选中态 10–12% 品牌填充 + 1px 品牌边 |
| 无障碍 | `prefers-reduced-transparency`、`prefers-contrast: more`、`prefers-reduced-motion`，以及 `@supports` 回退到不透明材质 |
| 可读性 | `pre`、`code`、`input`、`select`、`textarea`、`contenteditable` 保持近乎不透明——玻璃不会牺牲阅读和输入的对比度 |
| 卸载 | 移除自己的 `<style>` 和 body class，并释放 token 层，不留残留 |

以下边界是刻意的，不是缺口：页面级 header 保持**平面**（它属于页面平面，不是卡片）；真圆控件——头像、圆形图标按钮——保留 `border-radius:50%`；承载文字/可编辑表面使用实体材质。签名只画在已有边缘上，不新增几何、不拦截输入。

不使用 React，不注册 observer，不用定时器，不读写 storage，不注册 slot：插件只注入一张样式表，给 `body` 加一个 class，并在加载时做一次只读选择器探测（只为报告材质层是否失效）。

## 设计语言

- **色板** —— 浅色：画布 `#F0F2F7`、抬升表面 `#F0F4FF`、文字 `#171A21`、品牌 `#4D6BFE`；深色：画布 `#12141A`、抬升表面 `#1C2230`、文字 `#F2F4F8`、品牌 `#6E87FF`。选中态使用 10–12% 品牌填充 + 1px 品牌边；激活标签文字改用更强的品牌色（浅 `#2F4BD9` / 深 `#9DB0FF`），保证选中项仍过 AA 对比度。
- **材质** —— 三档中性偏蓝玻璃：`thin` `rgba(240,244,255,.58)`、`regular` `rgba(240,244,255,.62)`、`thick` `rgba(244,247,255,.70)`（深色 `rgba(28,34,48,.64)`、`rgba(28,34,48,.70)`、`rgba(34,41,58,.78)`），浅色 `blur(30px)`、深色 `blur(28px)`。浮层带外 1px rim——浅色白 `rgba(255,255,255,.55)`、深色品牌 `rgba(122,146,255,.22)`——再加内 1px rim（浅色 `rgba(77,107,254,.12)`、深色 `rgba(0,0,0,.35)`）。栏保持最薄材质、不加投影。
- **签名** —— 激活的 dock pane（`data-dockkit-pane-active`）与浮动 dock 标签页（`data-dockkit-float-active`）在顶边画一条 1px 品牌渐变光带（`#4D6BFE → #9BB0FF → transparent`，`background-size:100% 1px`）。光带只画在已有边缘上，不新增布局、边框或命中区域。默认单 pane 会话可能要选中标签或把标签拖出成浮窗后才能看到它。
- **画布** —— 一个纯色（浅色 `#F0F2F7`、深色 `#12141A`），背后什么都不动。玻璃比画布亮一档且偏蓝，靠这一档自己浮起来。
- **几何** —— 全局统一一个圆角（`--dsh-ios-radius:14px`），所有矩形表面共用；只有真圆（头像、圆形图标按钮）例外。宿主已设 `--dsw-corner-shape: superellipse(1.5)`，因此这个圆角会渲染成超椭圆（squircle）。
- **桌面壳** —— DSH Desktop 可开启 macOS 原生毛玻璃，此时壳会把页面设为透明（`data-dsh-desktop-mode="extended" | "advanced"`）。主题会识别这一点，把侧栏也保持透明，让真实系统材质透出来，而不是在原生材质上再叠一层背景；当壳报告材质为 `off` 时不做这个交接，侧栏保留自己的玻璃。

### 与 v0.2.2 的差异

| | v0.2.2 | v0.3.0 Deep Fusion |
|---|---|---|
| 色板 | iOS 系统蓝 `#007aff` / `#0a84ff`，画布 `#e5e5ea` / `#000` | DeepSeek 品牌蓝 `#4D6BFE` / `#6E87FF`，画布 `#F0F2F7` / `#12141A`，中性偏蓝标签色 |
| 玻璃 | 中性白/黑 `.60` / `.72` / `.86` | 中性**偏蓝** `.58` / `.62` / `.70`（深色 `.64` / `.70` / `.78`；thick `rgba(244,247,255,.70)` / `rgba(34,41,58,.78)`） |
| Rim / 边 | 0.5px 白色高光 rim | 外 1px rim（浅色白、深色品牌）+ 内 1px rim（浅色品牌、深色黑） |
| 签名 | 无 | 激活 dock 表面顶边 1px 品牌渐变光带；品牌化选中态 |
| 架构 | token 交接 + 材质层 | 不变（103 对 `overrideTokens`、同样的分组与无障碍降级） |

## 新 UI 兼容

当前 GUI 在标准壳之外多了两块更大的界面：**dsh-better-sidebar**（文件树、编辑器、标签、变更/diff、任务、旁路对话，以及底部工作台与浮动窗口）和 **Agent Teams** 面板/roster。材质层按这些插件公开的结构命中，而不是猜 hash：

| 新表面 | 处理 |
|---|---|
| better-sidebar 宿主与文件树（`[data-dsh-better-sidebar]` / `[data-dsh-panel-host]` 子树） | 保留插件自己的 token 表面；通用的 card/header/rail/bar 规则对这些子树排除 |
| DSH 右栏内容面（dockkit pane body） | 交给 dockkit 自己的不透明 token 底；主题只给右栏标签条 `thin` 玻璃 |
| 底部工作台（`[data-dsh-bottom-panel]`） | 只补 `regular` 玻璃填充与模糊——边框、圆角、阴影归 better-sidebar 自己 |
| dockkit 标签条（`[role=tablist]`、`[data-dockkit-strip]`） | `thin` 玻璃 |
| dockkit 浮动标签页（`[data-dockkit-float]`）、Agent Teams 浮层（`[data-team-panel]`）、markdown TOC 弹层（`[data-dsh-md-toc-panel]`）、better-sidebar 浮动窗口（`role=dialog`） | `regular` 玻璃，配双 rim 与浮层阴影 |
| 激活的 dock pane / 浮动标签页（`data-dockkit-pane-active` / `data-dockkit-float-active`） | 顶边 1px 品牌渐变光带 |
| 编辑器 / diff / 变更 / 任务 / 旁路对话 / subagent 面板 | 不再额外叠玻璃——这些是承载文字的面板，保留各自基于 token 的背景（主题已重调 token），可读性不受影响 |
| 标签、文件树行与图标槽（`jJkEga_slot`）、pane body/card、编辑器 header 按钮、roster 行/成员文字、内联触发器（如 Agent Teams trigger） | 平面——自身不上玻璃、不加阴影 |
| 平面 header 内部的导航/标签条（`header *`、`[role=banner] *`） | 从 thin/rail 组排除——header 里的面包屑 nav 或会话标签条保持平面 |
| 页面 header、真圆控件、文字/可编辑表面 | 边界不变：平面 / 50% / 不透明 |

新 UI 表面优先使用插件公开的稳定钩子——better-sidebar 的 `data-dsh-*` 属性（`data-dsh-better-sidebar`、`data-dsh-bottom-panel`、`data-dsh-md-toc-panel` 等）、dockkit 的 `data-dockkit-*`、Agent Teams 的 `data-team-panel`，以及 `[role=tablist]`/`[role=dialog]` 等语义 role；旧 DSH 表面仍按组件局部类名命中，better-sidebar 的子树则刻意退出这套泛匹配。官方或插件升级若改名，某个表面仍可能失去材质；加载时的 inert 探测会在一个都匹配不上时报警。

## 安装

```sh
# 在工作区根目录：先构建
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin build

# 装进目标 profile
dsh plugin --profile web add file:/path/to/dsh-plugins/packages/dsh-ios-skin
# 重启 dsh web
```

本地 `file:` 包在 profile 里是**硬链接副本**。重新构建会原地重写已有文件，但**新增文件永远不会被链接进 profile**——每次 `pnpm build` 之后必须跑 `pnpm sync:web`（或重装），否则 profile 副本会静默过期。详见 `docs/DEVELOPMENT.md` 第 7 节。

卸载：

```sh
dsh plugin --profile web remove dsh-ios-skin
# 重启 dsh web
```

## 已知限制

- **主题不是内置外观项。** 第三方主题 id 是官方主题包的进程内扩展，不跨内置 settings schema。它不会出现在「设置 → 外观」里，也不会作为偏好持久化；只要插件被加载就生效。要关掉就移除插件。
- **签名光带只在激活态出现。** 它画在激活的 dock pane 与浮动标签页上；默认单 pane 会话可能完全看不到，直到选中标签或把标签拖出。它只画、不改变几何。
- **材质层依赖官方内部组件类名。** 官方前端用 CSS-module hash 生成类名；升级改名后玻璃可能不再出现。这不会崩，所以加载时会做一次只读探测：已知局部类名一个都没命中时，控制台会打印 `[dsh-ios-skin] material layer is inert: …`。此时 token 层、无障碍回退和可读性下限仍然工作，只是材质层失效。
- **新 UI 覆盖范围是刻意收窄的。** better-sidebar、dockkit 与 Agent Teams 是插件或前端内部实现，不属于官方主题规范。主题只保证上表列出的表面有玻璃（底部工作台、浮动窗口、标签条、团队面板）；编辑器/diff/变更/任务/旁路对话等更丰富的视图保留各自基于 token 的表面，better-sidebar 的内部布局也保留自己的 token 样式（整棵子树退出泛类名匹配）。dockkit / better-sidebar 升级若改了钩子，个别表面仍可能退回无主题状态；加载探测会在一个都匹配不上时报警。
- **不是所有表面都有玻璃。** 材质层覆盖栏、侧栏、面板、对话框、菜单、toast、卡片和用户气泡；header 平面、真圆保持正圆、文字/可编辑表面保持不透明，都是刻意设计。
- **只有 Apple 平台上的字体才真正是 iOS 字体。** 字体链把设置里选中的字体放在最前，再用 iOS 栈（`-apple-system` / SF Pro / SF Mono）兜底；其他平台上兜底为 `system-ui` 和平台等宽字体，观感接近但不会逐字节一致。
- **桌面壳联动仅限桌面端。** 它依赖桌面壳设置的 `data-dsh-desktop-mode` / `data-dsh-desktop-material`；浏览器构建没有这些属性，侧栏直接保留自己的玻璃。
- **新 UI 钩子只对当前契约成立。** `data-dsh-*` / `data-dockkit-*` 钩子来自 better-sidebar 0.28 与 DSH 0.2.1-rc.2 前端；升级改名会让对应表面退回无主题状态（加载探测会在一个都匹配不上时报警）。
- **dockkit 浮动标签页只在标签被拖出成浮窗时存在。** 默认布局没有 `[data-dockkit-float]` 元素，因此真实 GUI 审计的默认场景不会触发它；规则本身由选择器与契约测试覆盖。
- **新 UI 规则的排除语法依赖 Selectors 4。** better-sidebar 子树用 `:not([data-dsh-better-sidebar] *):not([data-dsh-panel-host] *)` 这类复杂 `:not()` 排除；已在 Chromium（DSH Desktop 与 Chrome）验证，未在 Safari 实测。
- **没有配置项。** 没有 config schema、开关或按外观分开的设置；这种简单是刻意的。

## 开发

```sh
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin typecheck
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin test
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin build

# 用真实样式表重新生成自包含演示页
node scripts/build-glass-demo.mjs
```

本工作区里 `--config.verify-deps-before-run=false` 是必需的：pnpm 的依赖检查会先撞上本地 SQLITE store 错误，脚本根本跑不到。

演示页生成器从已安装的官方主题包里抽取 token 层，并通过运行 `src/client.js` 拿到插件样式表，所以 `docs/ios-glass-demo.html` 不会和插件实际发布的内容漂移。官方包若在 `app.asar` 里（普通 Node 读不到），请先解包，或用 `DSH_THEME_CLIENT` 指向解包后的路径；脚本会列出它尝试过的候选路径。
