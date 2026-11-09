# dsh-ios-skin v0.3.0 发布与验收（Deep Fusion 重设计）

面向维护者的发布手册：构建、测试、运行时审计、装进 profile、npm 发布、验收清单、已知限制。
配合 [README](../packages/dsh-ios-skin/README.md) / [README.zh](../packages/dsh-ios-skin/README.zh.md) 与 [CHANGELOG](../packages/dsh-ios-skin/CHANGELOG.md) 使用。

## 0. 当前状态

| 项 | 值 |
|---|---|
| 包名 | `dsh-ios-skin` |
| 版本 | **0.3.0**（`packages/dsh-ios-skin/package.json`；版本号由 lead 统一 bump，收到通知后落） |
| 目标宿主 | `@deepseek-ai/dsh-client-ui-theme` **0.2.1-rc.2**（DSH 0.2.x） |
| 许可 / 作者 | MIT / kp-z |
| npm | **0.3.0 未发布**；npm 上最新仍是 `0.1.0`（2026-09-13 的旧实现） |
| 市场 | 若 `awesome-dsh-plugin` 已收录，仍指向 0.1.0；待 0.3.0 发布后更新条目 |
| 运行时审计 | **双场景全绿**（最终构建 `abc971af`）：新 UI 127 项 122 pass / 0 fail / 0 warn / 5 info；干净回归 51 项 50 pass / 0 fail / 0 warn / 1 info；均退出码 0、defects=0 |
| 设计方向 | **C「Deep Fusion」** 正式落地：品牌蓝 `#4D6BFE`/`#6E87FF`、中性偏蓝玻璃、激活 dock 表面 1px 品牌光带、画布 `#F0F2F7`/`#12141A`；A/B 留在 `docs/design-v3/` 备选 |
| 实现形态 | 纯客户端主题插件：token 层 + 材质层，无服务端行为、无配置项 |

## 1. 版本策略

- 遵循 semver，但这里的「破坏性变更」主要指**官方 DSH / `dsh-client-ui-theme` 升级**：
  - 官方 token 增删改名、组件局部类名或 hash 规则变化 → 材质层可能失效（token 层通常仍工作）。
  - 这类升级后即使插件代码没改，也应重新跑第 2、3 节的测试与审计，再决定是否发新版。
- 发版时同步更新三处：`package.json` 的 `version`、本文件的第 0 节、`CHANGELOG.md`。
- npm 上已发布过 0.1.0；0.2.1 是首个「两层液态玻璃」实现（minor），0.2.2 是新 UI 适配（minor），0.3.0 是 Deep Fusion 完整视觉重设计（视觉 breaking；token API 与主题服务交接不变）。
- 插件自身没有可持久化的主题选择：第三方主题 id 是进程内扩展，不跨内置 settings schema（详见第 7 节）。

## 2. 构建、测试、类型检查

所有 `pnpm` 命令都必须带 `--config.verify-deps-before-run=false`，否则 pnpm 的依赖检查会先撞上本地 SQLITE store 错误：

```sh
cd /Users/kp/DEV/dsh-plugins

# 构建：tsc 产出 lib/index.js + lib/index.d.ts，并复制 src/client.js → lib/client.js
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin build

# 契约测试：37 项
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin test

# 类型检查（只含 host 半的 src/index.ts；client.js 是运行时模块，由契约测试覆盖）
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin typecheck
```

产物至少应包含：

```
packages/dsh-ios-skin/lib/index.js
packages/dsh-ios-skin/lib/index.d.ts
packages/dsh-ios-skin/lib/index.js.map
packages/dsh-ios-skin/lib/client.js      # 与 src/client.js 逐字节一致
```

> `lib/` 是发布产物。改完 `src/client.js` 后必须重新 build，否则装进 profile 的还是旧样式。

## 3. 运行时审计（真实 GUI）

审计脚本 `scripts/verify-ios-skin-runtime.mjs` 由 verifier 维护，跑完浅色/深色、无障碍降级、与未启用插件基线的对比；失败时退出码非 0（1 = 断言失败，2 = 环境/自动化错误），并输出 JSON 摘要。它需要一个已经在运行的开发服务器（默认从 `.tmp-ios-teams/server-3099.log` 里取带 token 的 URL）：

```sh
# 先按上一节启动 3099 端口的隔离 profile，然后：
node scripts/verify-ios-skin-runtime.mjs
# 或显式给 URL：
node scripts/verify-ios-skin-runtime.mjs --url "http://127.0.0.1:3099/?token=…"

# 需要自定义产物位置时：
node scripts/verify-ios-skin-runtime.mjs --out-dir docs/assets/ios-skin \
  --json .tmp-ios-teams/runtime-audit.json --dom-classes .tmp-ios-teams/dom-classes.md
# 默认截图目录就是 docs/assets/ios-skin/
```

结论与缺陷表记录在 [ios-skin-runtime-audit.md](ios-skin-runtime-audit.md)。发布前该脚本必须全绿，或剩余项在审计文档里有书面化的「不修理由」。

**本轮状态（最终构建 `abc971af`）**：51 项检查 **50 pass / 0 fail / 0 warn / 1 info，退出码 0、defects=0**。历史记录（v0.2.2 构建 `298cc19b`）：51 项检查 50 pass / 0 fail / 1 info。首轮审计发现 5 个缺陷（`_pane` 子串吞 `_panel*`、`_menu` 命中 `_menuAnchor`、侧栏 rail 多余阴影、reduced-transparency 的 blur 复位失效、contrast:more 的 token 被 inline 压过），已全部修复并在真实 GUI 复跑验证；证据见审计文档与 `.tmp-ios-teams/runtime-audit.json`。

### 3.1 新 UI 场景（better-sidebar + Agent Teams，v0.2.2 引入，v0.3.0 沿用）

标准壳的 3099 场景已不能代表当前 GUI。v0.2.2 起增加新 UI 场景（隔离 profile `awteamfull`，better-sidebar 0.28 + agent-team + agent-world，端口 3098），审计脚本用 `--url`/`--profile` 指向该场景并输出 `newui-*.png`：

```sh
# 服务（Lead 已搭好；重启时）：
DSH_HOME=/Users/kp/DEV/dsh-plugins/.tmp-ios-teams/home ELECTRON_RUN_AS_NODE=1 \
  "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  --profile awteamfull --port 3098 --no-open

# 新 UI 审计（失败退出码非 0；--scenario newui 会自动映射 3098 + awteamfull）
/opt/homebrew/opt/node@22/bin/node scripts/verify-ios-skin-runtime.mjs --scenario newui
```

两条门禁都必须 defects=0、退出码 0：

```sh
# 1) 干净 profile 回归（iosdev / 3099）
node scripts/verify-ios-skin-runtime.mjs
# 2) 新 UI（awteamfull / 3098；better-sidebar + Agent Teams）
node scripts/verify-ios-skin-runtime.mjs --scenario newui
```

**本轮状态（最终构建 `abc971af`）**：127 项检查 **122 pass / 0 fail / 0 warn / 5 info，退出码 0、defects=0**。历史记录（v0.2.2 构建 `298cc19b`）：107 项检查 102 pass / 0 fail / 5 info。首轮发现 5 个新 UI 缺陷（D1 `_slot` 图标槽、D2 `_pane`/`_card` 命中 better-sidebar、D3 `_surface` 布局壳、D4 右栏双玻璃、D5 底部工作台缺材质）已全部修复并复跑验证。截图：`newui-light.png`、`newui-dark.png`、`newui-agent-team.png`、`newui-agent-team-dark.png`、`newui-bottom-panel.png`。

若要在本机手工复核，可从工作区隔离 profile 启动（路径按本机安装位置替换）：

```sh
DSH_HOME=/Users/kp/DEV/dsh-plugins/.tmp-ios-teams/home \
ELECTRON_RUN_AS_NODE=1 \
"/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
"/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js" \
--profile iosdev --port 3099 --no-open
# stdout 里的 http://127.0.0.1:3099/?token=… 可直接打开
```

浏览器里至少人工确认：

- `document.body.classList.contains('dsh-ios-skin')` 为 true；
- `document.getElementById('dsh-ios-skin-style')` 存在；
- 控制台没有 `[dsh-ios-skin] material layer is inert: …` 警告；
- 浅色 body 上 `--dsw-alias-bg-base` 解析为 `#F0F2F7`，深色为 `#12141A`。

### 3.2 v0.3.0 设计还原度审计

v0.3.0 是完整视觉重设计，除运行时行为外还要验证**实现与设计稿一致**。verifier（task-18）在真实新 UI 上把最终实现的 computed 值与 `docs/design-v3/direction-c.css` 的预览值逐项对齐，并更新审计脚本的期望值：

```sh
# 依赖两套服务（3098 awteamfull / 3099 iosdev）与最新构建
node scripts/verify-ios-skin-runtime.mjs --scenario newui
node scripts/verify-ios-skin-runtime.mjs
```

还原度检查项：画布/token 色值、三档玻璃 rgba、blur、外白 + 内品牌 rim、radius、激活光带（只应在 `[data-dockkit-pane-active]`/`[data-dockkit-float-active]` 出现）、选中态品牌填充、header 平面、真圆 50%、文字面不透明、a11y 降级。允许合理差异（overrideTokens 与预览 `!important` 的解析路径不同），但视觉关键值必须一致；差异表记录在 [ios-skin-runtime-audit.md](ios-skin-runtime-audit.md) 的 v0.3.0 章节。

**本轮状态（最终构建 `abc971af`）**：还原度审计通过——激活 dock pane/浮动标签页有 1px 品牌渐变光带、非激活表面没有；激活 tab 文字使用品牌强调色；双 rim、`blur(30px)`/`blur(28px)`、radius 14、`#F0F2F7`/`#12141A` 画布与品牌蓝均与 C 预览 computed 一致；`currentTag` 修复后正文对比度最小 5.99:1（浅）/ 7.75:1（深）。新增常驻断言：`v3-brand-band-active/inactive`、`v3-active-tab-color`、`v3-text-contrast`（含 margin warn）。截图已按最终构建重拍，v0.2.2 旧图归档在 `docs/assets/ios-skin/v022/`。

## 4. 演示页重建

`docs/ios-glass-demo.html` 是构建产物，不要手改：

```sh
node scripts/build-glass-demo.mjs
```

- 官方主题包从已安装应用或工作区解包副本读取。官方包在 `app.asar` 内时普通 Node 读不到，需要先解包，或用 `DSH_THEME_CLIENT` 指向解包后的 `dsh-client-ui-theme` 目录（或其中的 `lib/client.js`）。脚本会打印实际使用的路径与版本。
- 页面里的版本号、token 数、玻璃规则数、契约测试数都从源码读取，不再手写；生成后在文件头留有来源注记。
- 重建后自检：

```sh
grep -n "generated by scripts/build-glass-demo.mjs" docs/ios-glass-demo.html
grep -n "dsh-ios-skin v0.3.0\|契约测试通过" docs/ios-glass-demo.html
grep -c "_composerSeat\|_dockHintCard\|data-dsh-desktop-mode" docs/ios-glass-demo.html   # > 0
grep -c "data-team-panel\|data-dockkit-strip\|data-dockkit-pane-active" docs/ios-glass-demo.html  # > 0（新 UI + 品牌光带演示）
grep -c "dsh-ios-skin v0.3.0" docs/ios-glass-demo.html                                 # > 0
! grep -q "v0.2.0" docs/ios-glass-demo.html
```

**每次 `src/client.js` 定稿后都要重跑本步**，否则演示页会和插件实际行为漂移。

## 5. 安装到 profile

### 5.1 正常安装

```sh
cd /Users/kp/DEV/dsh-plugins
pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin build

dsh plugin --profile web add file:/Users/kp/DEV/dsh-plugins/packages/dsh-ios-skin
# 重启 dsh web
```

重启后在浏览器确认第 3 节的四个检查项。卸载：

```sh
dsh plugin --profile web remove dsh-ios-skin
# 重启 dsh web
```

### 5.2 硬链接副本的坑（最容易卡住）

`file:` 依赖装进 profile 时，pnpm（`nodeLinker: hoisted`）按 `package.json` 的 `files` 白名单做一份**硬链接副本**：

- 已存在的文件被原地重写（`tsc`/`cp` 的常规行为）→ inode 相同，profile 自动同步；
- **新增文件是全新 inode，没有任何环节会把它链接进 profile** → 副本静默缺文件；
- 后果：入口引用了新模块 → 运行时 `ERR_MODULE_NOT_FOUND`；DSH 是「插件树加载失败就整体不启动」，表现为 **`dsh web` 直接打不开**，而报错指向一个源码里明明存在的文件。

对策：**每次 `pnpm build` 之后跑同步**（`scripts/install-to-profile.sh` 已内置这一步）：

```sh
pnpm sync:web                 # 把 packages/dsh-ios-skin 的产物同步进 web profile
pnpm sync:web:check           # 只检查不写盘，有差异退出码 1，可当提交/发布门禁
node scripts/sync-profile-links.mjs web --prune   # 额外清理源码已删除的文件
```

其他 profile 把 `web` 换成对应名字。**不要手工编辑 profile 里的副本**——下次同步会被覆盖，且会掩盖真实漂移。

若 profile 是手工拷进去的（例如隔离审计环境），每次 build 后必须重新复制：

```sh
cp -R packages/dsh-ios-skin/lib packages/dsh-ios-skin/package.json \
      packages/dsh-ios-skin/cordis.patch.yml \
      <profile>/node_modules/dsh-ios-skin/
```

## 6. npm 发布

### 6.1 状态

- `dsh-ios-skin@0.1.0` 已于 2026-09-13 发布（维护者 `kpeace`），内容是旧的 token 皮肤实现。
- **0.3.0 尚未发布**；在发布前，`npm view dsh-ios-skin version` 仍返回 `0.1.0`。
- 市场（awesome-dsh-plugin / 内置市场）若已收录，条目指向 npm 包，因此会继续解析到 0.1.0，直到发布 0.3.0。

### 6.2 发布前待办（`package.json` 由 lead 统一改，不在本文档的写入范围）

- [x] `version` 已是 `0.3.0`（lead 已 bump）。
- [x] 已加 `LICENSE` 文件（MIT），并已加进 `files`。
- [x] `CHANGELOG.md` 已加进 `files`。
- [x] `files` 白名单为 `["lib", "cordis.patch.yml", "README.md", "README.zh.md", "CHANGELOG.md", "LICENSE"]`，不含 `src/`、`test/`。
- [ ] 补 `repository` / `homepage`（可选但市场条目需要仓库地址）——由 lead 决定。
- [ ] 加 `prepublishOnly": "pnpm run build"`，保证每次发布都会先刷新 `lib/`——由 lead 决定（加之前 npm publish 前必须先手工 build）。

`package.json` 的 version 已由 lead bump 到 0.3.0；`files` 已包含 `CHANGELOG.md` 与 `LICENSE`（MIT）。

### 6.3 发布步骤

```sh
cd /Users/kp/DEV/dsh-plugins/packages/dsh-ios-skin
pnpm --config.verify-deps-before-run=false run build

# 先看包内容，别直接发
npm pack --dry-run
npm pack                     # 生成 dsh-ios-skin-0.3.0.tgz 用于本地验证

# 本地 tarball 装进隔离 profile 验证（推荐）
dsh plugin --profile devtest add file:./dsh-ios-skin-0.3.0.tgz
# 启动 devtest，确认皮肤生效，然后 remove

npm login                    # 需要维护者 kpeace 账号
npm publish --access public

# 验证
npm view dsh-ios-skin version   # 应为 0.3.0
npm view dsh-ios-skin dist.tarball
```

发布后把市场条目（如已收录）的描述同步为 0.3.0 的文案；提 PR 的流程与元数据格式见 [RELEASE-dsh-dev-git-graph.md](RELEASE-dsh-dev-git-graph.md) 的第 3 节。

## 7. 验收清单（发布前逐项打勾）

- [x] `pnpm --config.verify-deps-before-run=false --filter dsh-ios-skin build` 成功，`lib/client.js` 与 `src/client.js` 一致（最终 md5 `298cc19b…`）。
- [x] 契约测试 37/37 通过。
- [x] 双场景运行时审计全绿：newui 122 pass / 0 fail / 5 info（127 项）；clean 50 pass / 0 fail / 1 info（51 项）；均退出码 0。
- [x] 设计还原度审计通过：computed 值与 `docs/design-v3/direction-c.css` 关键值一致；品牌光带只在激活态出现，非激活无光带。
- [x] 真实 GUI 截图已按 v0.3.0 最终构建重拍（6 张 runtime + 5 张 newui，含浅/深色、设置浮层与无障碍场景）；v0.2.2 旧图归档在 `docs/assets/ios-skin/v022/`，README 相对路径均可打开。
- [x] 新 UI 截图存在：`newui-light.png`、`newui-dark.png`、`newui-agent-team.png`、`newui-agent-team-dark.png`、`newui-bottom-panel.png`；README「新 UI 兼容」引用可打开。
- [x] 新 UI 场景审计通过（按新设计期望值）：122 pass / 0 fail / 5 info，退出码 0、defects=0。
- [x] 干净 profile 回归审计全绿：50 pass / 0 fail / 1 info，退出码 0。
- [x] 控制台无 error、无 `material layer is inert` 警告（审计 console 0 error / 0 pageerror / 0 主题警告）。
- [x] 降低透明度 / 高对比度 / 减少动态效果模拟下，材质按预期退化为不透明、无动画（审计 PASS）。
- [x] 与「移除 body class + style」的基线对比：rect 位移 0、结构属性差异 0，差异只在主题应改的项上（审计 PASS）。
- [x] 页头保持平面；真圆控件仍为正圆；`pre`/`code`/`input`/`textarea` 保持近乎不透明（审计 PASS）。
- [x] 演示页已用最终 `src/client.js` 重建为 v0.3.0：103 tokens / 38 rules（10 条 glass）/ 37 tests；品牌蓝、蓝调玻璃、激活光带可见。
- [x] `README.md` 与 `README.zh.md` 描述一致，数字与实现一致（103 对 token 交接 / 37 项契约测试 / 已知限制）。
- [ ] 干净 profile 安装 → 重启 → 生效；卸载 → 重启 → 无残留（无 `<style id="dsh-ios-skin-style">`、无 body class）。
- [ ] `pnpm sync:web:check` 无差异。
- [ ] `npm pack` 内容正确（第 6.2 节字段修完后）。
- [x] 本文件第 0 节、`CHANGELOG.md` 与 `package.json` 版本一致（0.3.0）。

## 8. 已知限制

完整列表以 README 的 *Known limitations* / *已知限制* 为准，发布时必须保持一致：

- 第三方主题 id 是进程内扩展，**不跨内置 settings schema**：不会出现在设置页、不会持久化为偏好；删插件即关闭。
- 签名光带只画在激活的 dock pane / 浮动标签页顶边；默认单 pane 会话可能看不到，选中或拖出标签后才出现（paint-only）。
- 材质层依赖官方内部组件类名 / hash，官方升级可能让它静默失效；加载时的只读探测只在「一个都没命中」时报警，不保证逐个表面都命中。
- v0.3.0 为**视觉 breaking**：调色板、玻璃、rim 与签名全换；token API 与 `ctx.theme.overrideTokens` 交接保持不变。
- better-sidebar / dockkit / Agent Teams 的 `data-dsh-*` / `data-dockkit-*` 钩子属当前契约（better-sidebar 0.28、DSH 0.2.1-rc.2）；升级改名会让对应表面退回无玻璃（有 inert 告警）。
- better-sidebar 内部 tabBar / 编辑器 / diff 正文仍走插件自己的 token 表面；右栏内容交 dockkit 不透明底，主题只给右栏标签条 thin 玻璃（刻意边界，不是漏覆盖）。
- 新 UI 规则的 `:not([data-dsh-better-sidebar] *):not([data-dsh-panel-host] *)` 依赖 Selectors 4；DSH Desktop 为 Chromium，Safari 未实测。
- 刻意不做玻璃的边界：页面 header 平面、真圆保持 50%、`pre`/`code`/`input`/`select`/`textarea`/`contenteditable` 近乎不透明。
- 非 Apple 平台字体回退到 `system-ui`，观感接近但不是 SF Pro / SF Mono。
- 桌面壳毛玻璃联动只在桌面端（依赖 `data-dsh-desktop-mode` / `data-dsh-desktop-material`）。
- 无配置项、无开关、无分外观设置。
- dockkit 浮动标签页只在标签被拖出时出现，默认布局不触发该表面。

## 9. 回滚

```sh
# 从 profile 撤掉插件
dsh plugin --profile web remove dsh-ios-skin
# 重启 dsh web

# npm 侧：已发布版本不能删除，只能发新版；如需紧急回退可 npm deprecate
npm deprecate dsh-ios-skin@0.3.0 "Superseded by 0.3.1; see CHANGELOG"
```

若升级后 DSH 直接打不开，先怀疑 profile 副本缺文件（第 5.2 节）：`pnpm sync:web:check` 看差异，再决定同步还是先移除插件。

## 10. 发布产物清单

npm tarball 应包含：

```
lib/index.js
lib/index.d.ts
lib/index.js.map
lib/client.js
cordis.patch.yml
README.md
README.zh.md
CHANGELOG.md
LICENSE
package.json
```

不应包含：`src/`、`test/`、`tsconfig.json`、工作区脚本与文档。
