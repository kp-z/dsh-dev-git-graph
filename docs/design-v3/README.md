# dsh-ios-skin v3 — 三个重设计方向（预览用）

> **决策（2026-10-22）：已选 C「Deep Fusion」作为 v0.3.0 正式方向；A/B 保留在 `docs/design-v3/` 作为备选，随时可换。**
>
> 目的：不是给 v0.2.2 打补丁，而是从三个完整方向里选一个作为下一版的基础。
> 三份 CSS 都是**独立、完整、可直接注入真实 GUI** 的覆盖样式：自带浅/深两套 design token、自有材质层、自有签名元素与无障碍降级；互相用不同的 body class 隔离，同一时刻只启用一套。

## 文件

| 文件 | 方向 | body class | 一句话差异 |
|---|---|---|---|
| [direction-a.css](direction-a.css) | Glass Cast / 玻璃铸件 | `ios-v3-a` | 低饱和蓝灰**静态环境场**画布 + 高透玻璃 + **双 rim 折射边** + 宽而浅的阴影 |
| [direction-b.css](direction-b.css) | System Quiet / 系统克制 | `ios-v3-b` | 表面几乎**不透明**、材质退后；只有侧栏/工具栏薄玻璃；**0.5px 发丝结构**、阴影几乎不可见、圆角 12 |
| [direction-c.css](direction-c.css) | Deep Fusion / 品牌融合 | `ios-v3-c` | **DeepSeek 蓝 `#4D6BFE`** × iOS 材质；中性偏蓝玻璃；**激活面板顶部 1px 品牌渐变光带**（签名） |

注入（真实 GUI / verifier 的 awteam-preview @3097，干净 profile，无正式主题）：

```js
// 1) 把对应 CSS 注入 head 末尾
const style = document.createElement('style');
style.dataset.iosV3 = 'a';               // a | b | c
style.textContent = cssText;
document.head.appendChild(style);
// 2) 只加一套 body class；三套互斥
document.body.classList.add('ios-v3-a');
// 3) 深色：沿用 DSH 自己的属性
document.body.setAttribute('data-ds-dark-theme', '');   // 移除即浅色
```

- token 声明全部带 `!important`：这样即使页面上残留旧主题的 inline `overrideTokens` 值（`body[style]` 里的 `--dsw-*`），变体仍能生效。若正式 `dsh-ios-skin` 已安装，建议先删掉 `style#dsh-ios-skin-style` 与 `body.dsh-ios-skin` 再预览（更干净）。
- 所有选择器都带 `body.ios-v3-x` 前缀；不会影响其它变体与未启用时的官方外观。

## 三套参数对照

| | A Glass Cast | B System Quiet | C Deep Fusion |
|---|---|---|---|
| 画布 | 静态渐变 `#E9EDF4 → #F4F6FA`（深 `#0A0C10 → #12151C`） | 纯色 `#F2F2F7` / `#000` | 纯色 `#F0F2F7` / `#12141A` |
| 圆角 | 14px | **12px** | 14px |
| 玻璃透明度 | thin .50 / regular .58 / thick .66（深 .48/.56/.66） | **仅栏**：白 .72 / 深 `#1C1C1E` .72；浮层/卡片 **不透明** | thin .58 / regular .62 / thick .70（深 .64/.70/.78） |
| blur | 24 / **32px**（深 32） | **只有栏 16px**，浮层 none | 30px（深 **28px**） |
| rim / 边 | **双 rim**：外 `0 0 0 1px rgba(255,255,255,.5)` + 内 `inset 0 0 0 1px rgba(0,0,0,.08)` | **0.5px 发丝** `rgba(60,60,67,.12)` / 深 `rgba(235,235,245,.18)` | 外 1px 白 rim + 内 1px 品牌色 rim（`rgba(77,107,254,.12)` / 深 `rgba(122,146,255,.22)`） |
| 阴影 | 宽而浅（26px/100px 两层） | **几乎不可见**：`0 0 0 .5px hairline`（最多 1px 2px 4%） | 中性偏蓝、比 A 收敛 |
| 强调色 | `#007AFF` / 深 `#0A84FF` | `#007AFF` / 深 `#0A84FF` | **`#4D6BFE`** / 深 `#6E87FF`，选中态 8–12% 填充 + 1px 品牌边 |
| 签名 | 双 rim 折射边 + 环境场 | 精确发丝 + 平面结构（44px 节奏由 DSH 自身提供，本主题不改尺寸） | 激活 `[data-dockkit-pane-active]` / `[data-dockkit-float-active]` 顶部 1px 品牌渐变光带 |

## A. Glass Cast / 玻璃铸件

- **Palette（light）**：`#E9EDF4` `#F4F6FA` `#EEF1F6` `#FFFFFF` `#007AFF` `#1B1D22`
- **Palette（dark）**：`#0A0C10` `#12151C` `#14171F` `#F4F6FA` `#0A84FF` `#14171F`
- **材质**：thin/regular/thick = `.50/.58/.66`，blur 24/32px；`--dsw-alias-bg-base` 设为 `transparent`，让静态蓝灰环境场透过 app frame 显示；所有文字承载面（input/textarea/pre/code、CodeMirror、xterm、markdown code block）显式刷回不透明表面。
- **签名**：每个浮层/卡片/菜单的 `box-shadow` 都是「外 1px 白 rim + inset 1px 暗 rim + 两层宽浅环境阴影」；rim 在深色改为白 `.20` + 黑 `.45`。
- **取舍**：透明度最高、视觉最有「液态玻璃」感，但**性能最贵**（每层 32px backdrop blur，大面积叠加）；浅色 secondary 文本在玻璃上约 **4.14:1**（≥3:1 的次要文字线，未到 4.5）；激活 tab / 当前页文字已换用更深的 `--v3-accent-strong`（浅 `#0064D2`，深 `#5AA6FF`），AA 4.9:1+；`bg-base:transparent` 是为环境场服务的刻意选择，非文字面若没有自带不透明底会透出渐变（当前审计覆盖的编辑器/输入/终端均已被显式刷成不透明）。

## B. System Quiet / 系统克制

- **Palette（light）**：`#F2F2F7` `#FFFFFF` `#000000` `#007AFF` `#1C1C1E`
- **Palette（dark）**：`#000000` `#1C1C1E` `#FFFFFF` `#0A84FF` `#2C2C2E`
- **材质**：只有侧栏/工具栏/标签条/rail 用薄玻璃（白 `.72` / 深 `#1C1C1E .72`，blur **16px**）；浮层、菜单、卡片、底部工作台全部**不透明表面**（`#FFFFFF` / `#1C1C1E`），backdrop-filter none。
- **签名**：0.5px 发丝结构——浮层/卡片 `box-shadow: 0 0 0 .5px hairline`，侧栏右边、标签条下边、底部工作台上边各一条 `inset 0 ±.5px 0 hairline`；阴影只剩 hairline 与 4% 的 1px 投影。
- **取舍**：**性能最便宜**（少量 16px blur）、文字对比最强（primary 18.8–21:1，secondary 3.6–6.0:1，深色 tertiary 3.8:1）；视觉最「Apple 原生」，但玻璃感和品牌辨识度最弱。DSH 的 44px 控制节奏本身由组件决定，本主题不碰尺寸/间距，只做发丝与平面。

## C. Deep Fusion / 品牌融合

- **Palette（light）**：`#F0F2F7` `#F0F4FF` `#FFFFFF` `#4D6BFE` `#171A21`
- **Palette（dark）**：`#12141A` `#1C2230` `#1A1D26` `#6E87FF` `#F2F4F8`
- **材质**：中性偏蓝玻璃：`rgba(240,244,255,.58/.62/.70)`，深色 `rgba(28,34,48,.64/.70/.78)`；blur 30px（深 **28px**，更沉稳）；rim 外侧白、内侧品牌色（`rgba(77,107,254,.12)` / 深 `rgba(122,146,255,.22)`）。
- **签名**：`[data-dockkit-pane-active]` / `[data-dockkit-float-active]` 顶部画一条 1px 品牌渐变光带（`#4D6BFE → #9BB0FF → transparent`，`background-size:100% 1px`，不改布局）；`[aria-selected='true']` / `[aria-current='page']` 用 inset 1px 品牌边，选中态背景走 8–12% 品牌填充 token。
- **取舍**：品牌识别最强、深浅一致；浅色 secondary 5.0:1 达标，深色 6.8:1；激活 tab / 当前页文字用 `--v3-accent-strong`（浅 `#2F4BD9` 6.0:1，深 `#9DB0FF` 8.1:1）；品牌蓝 `#4D6BFE` 作为正文链接在浅色约 5.05:1（深色 `#6E87FF` 约 8.8:1）。品牌光带只在激活态出现，若审阅时没有激活的 dock pane（默认单页），这条签名在截图里可能不可见——可先把标签拖成一个 dock/浮窗再看。

## 三套共享的设计保证（只画不接管）

- **不碰布局**：不写 width/height/margin/padding/position/display/overflow/pointer-events；边框一律用 `box-shadow` 画，避免 0.5px border 改变盒模型。
- **header 保持平面**：`header`/`[role=banner]` 及其内部的 nav/tablist/toolbar 一律透明、无 blur、无阴影。
- **真圆不压方**：不对 `button/[role=button]/[role=tab]/[role=menuitem]` 设 border-radius，官方 `border-radius:50%` + `corner-shape:round` 原样保留（合成页实测圆形控件仍为 `50%`）。
- **文字承载面不透明**：`pre/code/input/select/textarea/[contenteditable]`、CodeMirror `.cm-editor/.cm-scroller`、xterm、`.md-code-block`、Tiptap/markdown 面全部 `backdrop-filter:none` + 不透明表面。
- **第三方工作台不重绘**：better-sidebar 整棵树（`[data-dsh-better-sidebar]` / `[data-dsh-panel-host]`）退出泛类名匹配；它的底部工作台只补 glass 填充 + blur，不写 border/radius/shadow；`[data-dockkit-strip]` 只是 thin，dockkit 布局壳/浮窗零件不碰。
- **激活态文字可读**：激活 tab / 当前页文字统一用 `--v3-accent-strong`（A/B 浅 `#0064D2`、C 浅 `#2F4BD9`；深 `#5AA6FF` / `#9DB0FF`），把浅色激活 tab 的 3.55–3.87:1 提到 ≥4.9:1（paint only）。
- **无障碍降级**：`prefers-reduced-transparency`（全部 blur 关、玻璃 token 变不透明）、`prefers-contrast: more`（分隔线与次要文字加强，`!important` 压过 inline token）、`prefers-reduced-motion`（无过渡/动画）、`@supports not backdrop-filter`（材质退化为不透明）。
- **深色**：跟随 DSH 的 `body[data-ds-dark-theme]`，没有独立开关。

## 已知限制 / 预览期取舍

1. 三套都是**预览样式**，不在 npm 包里、不参与正式构建与契约测试；正式 `src/`、`test/`、`lib/` 未改动。
2. 依赖当前新 UI 的稳定钩子（`data-dsh-*`、`data-dockkit-*`、`[data-team-panel]`、`role=*`）与少量 DSH 局部类名；官方改版可能让某类表面退回无材质。三套的 inert 缺口靠人工截图复核，没有运行时探针。
3. token 用 `!important` 是为了压过残留的旧主题 inline 值；若同时启用多套变体，后注入的 class 生效，请一次只留一个 `ios-v3-*`。
4. A 的 `--dsw-alias-bg-base:transparent` 会刻意让环境场透出；文字面已单独刷不透明，但如果未来 DSH 新增依赖 bg-base 当不透明底的可读表面，需要补进 A 的不透明面清单。
5. 三套都未做 Safari 实测（复杂 `:not()`、`backdrop-filter` 在 Chromium/桌面壳可用；DSH Desktop 为 Chromium）。
6. 对比度是「token 与合成后的典型表面」的静态计算；玻璃叠在真实内容上时以 verifier 的程序化抽检为准（正文 4.5:1 / 次要 3:1 目标）。
