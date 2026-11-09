# dsh-ios-skin 运行时审计（真实 DSH Web GUI）

> 审计对象：`dsh-ios-skin` **v0.3.0「Deep Fusion」**，运行时实际加载的 `lib/client.js`
> **最终构建**：md5 `abc971af92ec0fe1b41dd89c55c205c1`（`src = lib = 运行时 profile` 三者一致，2026-10-22 11:09 +08:00）
> 干净 profile 回归：**51 项 / 50 pass / 0 fail / 0 warn / 1 info，退出码 0**
> 新 UI（better-sidebar 0.28 + Agent Teams）：**127 项 / 122 pass / 0 fail / 0 warn / 5 info，退出码 0**
> 宿主：DeepSeek Harness **0.2.1-rc.2**，隔离 profile `iosdev`（干净回归）/ `awteamfull`（新 UI）· 执行者：verifier（Agent Team）
> 脚本：`scripts/verify-ios-skin-runtime.mjs` · 复跑时间：2026-10-22

## 一句话结论

v0.3.0 重设计（方向 C「Deep Fusion」）在真实 GUI 上**两场景全绿、0 缺陷**：
干净 profile **50 pass / 0 fail / 1 info**、新 UI **122 pass / 0 fail / 5 info**，两者退出码 **0**。
设计还原度：与 `direction-c.css` 预览实测可对比的 **32 项 token 全部一致**，材质/签名/几何 13 项中 12 项一致、
1 项为 notes 声明的有意差异（深色光带 55% 停靠色 `#9BB0FF → #8CA0FF`）；**无意外视觉差异**。
v0.2.2 历史缺陷（D1–D5、D7）全部保持修复；v0.3.0 首轮发现的 Agent Teams `currentTag` 对比度缺陷（D8）已修复并复验。

**本模型没有视觉能力**：所有结论来自 computed style、CSSOM 规则匹配、几何 rect、内联 token 原文比对、
CDP media emulation、`getComputedStyle` alpha 计算与 console 事件。截图只是给人的交付物，不是判定依据。

## 汇总

| 项 | 值 |
|---|---|
| 检查项 | 干净 profile **51**（50 pass / 0 fail / 0 warn / 1 info）；新 UI **127**（122 pass / 0 fail / 0 warn / 5 info）；二者退出码 **0** |
| 去重后缺陷 | **0**（v0.2.2 的 D1–D5/D7 与 v0.3.0 首轮的 D8 均已修复并复验） |
| 设计还原度 | token **32/32 一致**；材质/签名/几何 **12/13 一致**，1 项 notes 有意差异；详见 `.tmp-ios-teams/v030-alignment.md` |
| 构建/契约 | `src = lib = profile = abc971af…`；契约测试 **37/37**；token handover **103 对**（105/114 语义覆盖，不倒退） |
| 深色路径 | 真实走「设置 → 外观 → 深色」，`body[data-ds-dark-theme]` 与 inline token 同步切换 |
| 签名 | 激活 dockkit pane 顶部 **1px 品牌渐变**（`background-size:100% 1px`）；非激活 pane 无渐变；默认布局无 float，float 分支空过 |
| 无障碍 | reduced-transparency / contrast:more / reduced-motion 全部生效；正文/次要文字 AA 见下表 |
| console | 0 error、0 pageerror、0 主题警告（唯一 404 为复制历史会话缺 git 数据的环境噪音） |
| 基线 | 移除主题后 rect 差异 **0**、结构属性差异 **0**；恢复后 token round-trip 一致 |
| 截图 | 6 张干净 profile + 5 张新 UI（v0.3.0 重拍）；v0.2.2 旧图保留在 `docs/assets/ios-skin/v022/` |

## 复跑

```sh
# 1) 构建并同步到隔离 profile（theme-dev 改完代码后必须做）
cd /Users/kp/DEV/dsh-plugins
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin build
for p in iosdev awteamfull; do
  cp -R packages/dsh-ios-skin/lib packages/dsh-ios-skin/package.json packages/dsh-ios-skin/cordis.patch.yml \
    .tmp-ios-teams/home/profiles/$p/node_modules/dsh-ios-skin/
done

# 2) 启服务（URL 会打印到 stdout；脚本自动从日志取最后一个 token URL）
#    iosdev → 3099；awteamfull → 3098（3097 是 awteam-preview 方向预览环境，不含正式主题）

# 3) 审计（失败退出码非 0）
/opt/homebrew/opt/node@22/bin/node scripts/verify-ios-skin-runtime.mjs            # 干净 profile（iosdev / 3099）
/opt/homebrew/opt/node@22/bin/node scripts/verify-ios-skin-runtime.mjs --scenario newui   # 新 UI（awteamfull / 3098）
```

产出：

- `.tmp-ios-teams/runtime-audit.json` / `runtime-audit-newui.json` — 完整证据（每个 check 的 expected/actual、surface computed style、基线与可读性采样）
- `.tmp-ios-teams/dom-classes.md` / `dom-classes-newui.md` — 真实 class / data 钩子清单
- `.tmp-ios-teams/v030-alignment.md` — 设计还原度差异表；`.tmp-ios-teams/v030-expected-c.json` / `v030-actual.json` — 预览基线 vs 实现实测
- `docs/assets/ios-skin/*.png` — 11 张全页截图（见文末索引）

脚本参数：`--scenario clean|newui`、`--url`、`--out-dir`、`--json`、`--dom-classes`、`--profile-client`、`--headed`。
期望 token 值从 **profile 里实际被浏览器加载的 `client.js`** 推导；`src` 领先于已安装产物时输出 `profile-sync` 警告。

## v0.3.0 重设计（Deep Fusion）

### 设计 → 实现

| 设计基准（`direction-c.css`） | v0.3.0 实现 | 实测 computed（浅 / 深） |
|---|---|---|
| 画布 `--v3-canvas` / `--v3-base` | `--dsw-alias-bg-base` | `#F0F2F7` / `#12141A`（body 背景 `rgb(240,242,247)` / `rgb(18,20,26)`） |
| 玻璃 `--v3-glass-thin/glass/thick` | `--dsh-ios-glass-thin/glass/glass-thick` | `.58/.62/.70` / `.64/.70/.78`（中性偏蓝） |
| 品牌 `--v3-accent` / strong / soft / border / band-end | `--dsh-ios-brand/-brand-strong/-brand-soft/-brand-border/-brand-band-end` | `#4D6BFE` / `#2F4BD9` / `rgba(77,107,254,.10)` / `rgba(77,107,254,.38)` / `#9BB0FF`；深 `#6E87FF` / `#9DB0FF` / `.20` / `.44` / `#8CA0FF` |
| `--v3-rim-outer` / `--v3-rim-inner` | `--dsh-ios-rim` / `--dsh-ios-rim-inner` | 外白 `rgba(255,255,255,.55)` + 内品牌 `rgba(77,107,254,.12)`；深外 `rgba(122,146,255,.22)` + 内 `rgba(0,0,0,.35)` |
| `--v3-radius` | `--dsh-ios-radius` | 14px |
| `--v3-blur` | `--dsh-ios-blur` | 30px / 28px（`--dsw-mask-blur` 同步 30/28） |
| `--v3-surface` | `--dsh-ios-surface` | `#FFFFFF` / `#1A1D26`（文字面不透明） |
| 激活态签名 | `[data-dockkit-pane-active]` / `[data-dockkit-float-active]` 的 1px 渐变光带 | 浅 `linear-gradient(90deg, rgb(77,107,254), rgb(155,176,255) 55%, transparent)`；深 `rgb(110,135,255) → rgb(140,160,255)`；`background-size:100% 1px` |

### 设计还原度（实际实现 vs C 预览，真实 GUI）

| 项 | 结果 |
|---|---|
| Token（两边都测到的 key） | **32 / 32 一致** |
| 材质 / 几何 / 签名 | **12 / 13 一致**；1 项为 notes 有意差异（深色光带 55% 停靠色 `#9BB0FF → #8CA0FF`，`transparent` 的 alpha 表示写法不同但视觉等价） |
| body 背景 / rail / dock strip / dialog / bottom panel | 全部逐项一致（bg、`backdrop-filter blur30/28 saturate1.8`、radius 14px、dialog 双 rim shadow） |
| header 与 header 内 nav/tabs | 三套构建均为 transparent / backdrop none / radius 0；`header-nested-flat` 浅/深 pass |
| 激活 tab | color `rgb(47,75,217)`（深 `rgb(157,176,255)`），inset 品牌边 `rgba(77,107,254,.38) 0 0 0 1px inset`（深 `.44`）；`v3-active-tab-color` 四场景 pass |

notes 声明的有意差异已逐项验证：token 走 `overrideTokens` inline（sheet 不重复颜色，实测 103 对 / body inline 106 个 `--*`）、
私有刻度沿用 `--dsh-ios-*`（无 `--v3-*`）、`--dsw-font-family` 由 `var(--dsh-ios-font)` 驱动、深色块补齐
`--dsw-alias-border-inverted` / `--dsw-shadow-lv*` / `--dsw-mask-blur` / `--dsw-menu-backdrop-filter`（浅色独有剩 6 个）、
rim 全部用 `box-shadow`（`border-width: 0`）。完整对照见 [`.tmp-ios-teams/v030-alignment.md`](../.tmp-ios-teams/v030-alignment.md)。

### 新增 / 更新的常驻断言

- `v3-brand-band-active` — 激活 dockkit pane 必须出现 1px 品牌渐变（四场景）。
- `v3-brand-band-inactive` — 非激活 pane / 非激活 float 不得有品牌渐变。
- `v3-active-tab-color` — 激活 tab 文字 = `--dsh-ios-brand-strong`，选中态带 1px 品牌 inset rim。
- `v3-text-contrast` — 真实可见文字（视口内 + `elementFromPoint` 命中；玻璃背景祖先 alpha 合成近似）正文 ≥4.5:1、次要 ≥3:1，失败列 worst 元素。
- `v3-text-contrast-margin` — comfort 目标正文 ≥4.8、次要 ≥3.1（不足记 warn）。
- `tokens-ios-values` 已替换为 C palette + 私有刻度（`--dsh-ios-*`）期望值；`overlay-material` 改为按 **box-shadow rim** 判定；
  `elevation-inherited` 改为 C 的 soft shadow（浅 `2px 12px + 22px 56px`、深 `2px 14px + 24px 62px`，仍含 `.5px` 描边）；
  `contrast-more` 增加 label-tertiary 期望；`header-nested-flat` 忽略 inset-only 选中环（不是 elevation）。

### 可读性（真实可见文字，AA 阈值）

| 场景 | 正文字体样本 min / median | 正文 <4.5 | 次要 min / median | 次要 <3 |
|---|---|---|---|---|
| 浅色主界面 | **5.99** / 15.54 | 0 | 3.16 / 3.26 | 0 |
| 浅色 + Agent Teams | **5.99** / 15.54 | 0 | 3.16 / 3.26 | 0 |
| 浅色 + 底部工作台 | **5.99** / 15.54 | 0 | 3.16 / 3.26 | 0 |
| 深色 + Agent Teams | **7.75** / 14.75 | 0 | 3.31 / 3.81 | 0 |

对比修复前 v0.2.2 基线（浅色正文 <4.5 有 14/64 可见项），v0.3.0 为 **0**。

### 无障碍降级（实机媒体查询）

- **reduced-transparency**：`stillBlurred: []`，三档玻璃私有变量翻为不透明（`#FFFFFF` / `#1A1D26` / `#242A36`）。
- **contrast:more**：浅色实测 `border-l1 rgba(23,26,33,.28)`、`label-secondary #171A21`、`label-tertiary rgba(23,26,33,.64)`；
  深色实现值 `rgba(235,235,245,.28)` / `#F2F4F8` / `rgba(235,235,245,.66)`（CSS 提供并由契约测试覆盖；审计实机以浅色为准）。
- **reduced-motion**：控件 `transition-duration: 0s`；`@supports not backdrop-filter` 回退不透明表面。

## 两场景结果

### 干净 profile（iosdev / 3099）

51 项检查：**50 pass / 0 fail / 0 warn / 1 info，退出码 0**，defects 0。覆盖插件激活/inert 探针、token 交接、
材质分组、平面/真圆/可读面、浮层 rim（box-shadow）、elevation 逐元素、header 平面、基线几何 0 位移、console 干净、
reduced-transparency / contrast:more / reduced-motion。唯一 info 为 `selector-coverage`。

### 新 UI（awteamfull / 3098）

127 项检查：**122 pass / 0 fail / 0 warn / 5 info，退出码 0**，defects 0。场景集：
`setup / light / agent-team / bottom / dark / agent-team-dark / reduced-transparency / contrast-more / all / newui-light`。
覆盖 better-sidebar 宿主链、dockkit 布局/pane/strip/float、Agent Teams 面板与 roster、底部工作台、header 平面、
激活光带、激活 tab、可读性与 a11y。5 条 info 为右侧 rail 材质记录与 coverage。

## 缺陷历史与修复

| # | 版本 | 缺陷 | 状态 |
|---|---|---|---|
| D1 | v0.2.2 | `_slot` 误命中新侧栏 `jJkEga_slot`×19（玻璃/阴影套在图标槽） | ✅ 修复（`newui-icon-slots-flat`） |
| D2 | v0.2.2 | `_pane` / `_card` 泛匹配 better-sidebar / dockkit 容器 | ✅ 修复（子树退出 + `_pane` 移除） |
| D3 | v0.2.2 | `_surface` 误命中 dockkit 648×900 布局壳 | ✅ 修复（改稳定钩子） |
| D4 | v0.2.2 | `_panelBody` 双重玻璃（rail + dockkit 自绘） | ✅ 修复（删除 rail `_panelBody`） |
| D5 | v0.2.2 | `[data-dsh-bottom-panel]` 无玻璃/模糊 | ✅ 修复（fill + blur30） |
| D7 | v0.2.2 | 平 header 内部 nav/tablist 被上玻璃 | ✅ 修复（`:not(header *)`） |
| D8 | v0.3.0 首轮 | Agent Teams「当前会话」10px 标签用品牌色 @10% soft 底，实测 **3.93:1** | ✅ 修复（`[data-team-panel]/[role=dialog] [class*='currentTag'] → brand-strong`；复跑最低正文 **5.99:1**） |

v0.2.2 的首轮 5 个核心缺陷（`_pane` 吞 `_panel*`、`_menu` 命中 `_menuAnchor`、rail 卡片阴影、reduced-transparency 失效、
contrast:more 失效）亦全部保持修复。v0.2.2 旧截图与旧指标保留在 旧截图目录（已移除）。

## 截图隐私

本地与发布截图已移除，以避免暴露内部信息。保留程序化验证说明，不以截图作为公开证据。

## 已知限制

- 可读性为 computed 近似：玻璃背景按祖先背景色 alpha 合成，**未做 blur 后像素采样**；用于阈值筛查与横向比较。
- `[data-dockkit-float]` / `[data-dockkit-float-active]` 默认布局不存在，拖出浮窗路径未覆盖（契约测试覆盖 CSSOM）。
- 还原度审计在 1440×900、Chromium 下完成；Safari / 更窄视口未测（与实现 notes 一致）。
- contrast:more 深色值由实现 CSS + 契约测试覆盖，运行时审计实机以浅色媒体查询为准。
- 真圆控件只验证到当前页面实际存在的官方圆控件；更多官方圆角规则在无匹配元素时不逐一枚举。
- 无障碍媒体查询用 CDP `Emulation.setEmulatedMedia` 模拟，非 macOS 系统偏好实机。

## 门禁与后续

- 两条门禁都必须退出码 0 才放行（`src = lib = profile` 由脚本校验）：
  - 干净 profile：`node scripts/verify-ios-skin-runtime.mjs` → **51 项 / 50 pass / 0 fail / 1 info，退出码 0**（iosdev / 3099）
  - 新 UI：`node scripts/verify-ios-skin-runtime.mjs --scenario newui` → **127 项 / 122 pass / 0 fail / 5 info，退出码 0**（awteamfull / 3098）
  - 契约测试：`node --test "test/*.test.js"` → **37/37**
- 任何后续改动（token 层、材质选择器、官方/插件升级）都必须重跑两条审计；脚本会同时校验收包 hash 与 `profile-sync`。
- 官方或新 UI 插件升级导致局部名/钩子变化时：先看 `.tmp-ios-teams/dom-classes.md` / `dom-classes-newui.md` 的命中列，
  再更新选择器；inert 自检探针会在完全无效时打印 `[dsh-ios-skin] material layer is inert`（console-clean 断言会失败）。
- 方向 A/B 的预览 CSS 仍保留在 `docs/design-v3/`，若后续改选方向，可按 `redesign-c-notes.md` 的映射回退/切换。
