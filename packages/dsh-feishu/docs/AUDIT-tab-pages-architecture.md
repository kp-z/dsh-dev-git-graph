# 飞书任务集 tab 页面：架构级体检（2026-11-11）

这份文档回答一个具体问题：**为什么改了很多轮样式，用户在实机上还是看到「不对」？**
按「症状 → 根因 → 修法 → 怎么验」组织，每条都能落到文件与行。

---

## 0. 一句话结论

这个面板有三层「看不见的假设」，每一层都曾让改动在实机上失效：

| 层 | 错误的假设 | 实际事实 |
| --- | --- | --- |
| **投递** | 改了 `src/`、`pnpm build:client` 之后，宿主就在跑新代码 | 客户端包在插件 **apply 时只读一次**；重建后必须 disable→enable（或重启 DSH） |
| **布局** | 响应式按**浏览器视口**判断就行 | 这块面板的宽度由**宿主侧栏的 tab** 决定，与视口无关 → 必须用 `@container` |
| **配色** | 宿主永远深色 | 宿主有亮/暗两套；写死颜色在亮色下必然崩 → 表面/文字必须**从令牌派生** |

---

## 1. 「气泡不是圆的」

- **症状**：实机上气泡是方角；本地预览（我用真 Chromium 挂载同一份组件）却是正圆。
- **根因（两层）**：
  1. **宿主对 `button` 有通用圆角样式**，把 `.frx-orb { border-radius: 9999px }` 顶掉了。
  2. **更关键的是包是旧的**：宿主进程 11-10 09:37 启动，`lib/client.iife.js` 11-11 13:17 才重建 ——
     运行中的进程一直加载 apply 时读进去的那份旧包。
- **修法**：
  - 样式层：`.frx-orb { border-radius: 50% !important; aspect-ratio: 1/1; }`（不再依赖特异度运气）。
  - 投递层：重建后**必须重载插件**。本次由 lead 执行 `plugin_manager set_plugin disable → enable`。
- **怎么验**：DevTools 里 `.frx-orb` 的 computed `border-radius` 应为 `50%`、宽高相等；
  若为 `0px` 或方角，先怀疑包没重载，而不是 CSS 写错。

---

## 2. 「侧栏展开太宽」「折叠时图标没对齐」

- **根因**：
  1. `--fo-rail-w: 288px` 抄的是参考站**整页 aside** 的宽度；我们只是宿主侧栏里的一个 tab，
     288 会把正文挤到很窄。
  2. 收起态只隐藏了文字 `.fo-nav-label`，**caret（▾）没藏** → 图标被 caret 挤偏，看起来「没对齐」。
- **修法**：展开 288 → **232px**（窄面板断点 212 / 196）；收起 56 → **52px**，并且
  `.fo-nav-caret` 一起 `display: none`、`gap: 0`、图标 `margin: 0 auto` 居中。
- **怎么验**：`overviewPanel.mjs` 里两条断言（`--fo-rail-w: 232px`、收起态 caret 隐藏）。

---

## 3. 架构层：响应式必须按「容器」而不是「视口」

这是这次体检最重要的发现，也是「各种问题」反复出现的公共原因。

- **事实**：面板挂在 `betterSidebar` 的 tab 里，宽度 = 宿主侧栏宽度（可能 600px），
  而屏幕上视口是 1440px。所有 `@media (max-width: 1080px)` 在这种组合下**永远不触发**，
  于是该收的不收、该换行的不换行。
- **修法**：
  - `.fo-root` 与 `.frx-page` 挂 `container-type: inline-size`（+ `container-name`）；
  - 断点写成 `@container fopanel (max-width: …)` / `@container frxpage (max-width: …)`；
  - 详情栏 / 整理抽屉这类固定列改 `clamp()`：`clamp(260px, 30%, 336px)`。
- **现状**：`grep '@media'` 只剩 `prefers-reduced-motion`（那是全局媒体特性，本来就该用 @media）。
- **怎么验**：把宿主侧栏拖窄，rail 应降到 196px、四列网格应降成 2 列 —— 不需要改窗口大小。

---

## 4. 配色：亮色模式为什么会「浅灰字压白底」

- **根因**：为了「和参考项目完全一致」，运行页曾经把 `rgba(255,255,255,.5)`、`#9ca3af` 这类值写死，
  那套值只在深色底上成立。
- **修法**：把**表面 / 文字 / 描边**全部改成从宿主令牌派生
  （`--dsw-alias-label-primary/secondary`、`bg-layer-1/2`、`border-l1/l2`、`bg-overlay`、`bg-base`），
  亮暗自动跟随；**只有气泡的品牌绿/蓝光晕保留参考项目原值**（语义色，两种模式下都成立）。
  好处是也不必猜宿主用 `.dark` 类还是 `prefers-color-scheme`。
- **怎么验**：切到亮色后检查 `.frx-text` 的 computed color 应变成深色（跟随 `label-primary`）。

---

## 5. 剩下的已知风险（下一轮可做）

1. **重建→重载的纪律没有自动化**：现在靠人记得 toggle 插件。可以在 `build:client` 之后打印一句提醒，
   或者写一个 `pnpm run reload:plugin` 脚本调 `plugin_manager`。
2. **z-index 分散在 4 张表**（5/10/20/21/30/60/61）：浮层（`.frx-orb-tip` 30）与抽屉（60/61）目前不冲突，
   但没有统一的分层表，以后加浮层容易撞。
3. **`dashboardStyles.js`（`fd-`/`fr-`）没有容器断点**：它的网格用 `auto-fit` 自适应，暂时够用；
   但如果以后加固定列，同样要迁到 `@container`。
4. **气泡墙在很窄的 tab 里可能偏挤**：`.fr-bubbles/.frx-bubbles` 有 `max-width: 560px`，
   8 个气泡的最小可用宽度约 480px；tab 更窄时应减少展示数量（现在是固定取前 8）。

---

## 5b. 怎么一眼判断「页面跑的是不是最新包」（构建号）

这个插件反复出现「改了 → 重建 → 刷新 → 看起来没变」。为了不再靠猜，客户端现在带**构建号**：

- `scripts/stamp-build.mjs` 在 `build:client` 前把 git short sha + 构建时间写进 `src/client/buildInfo.js`；
- 面板根节点有 `data-build="<sha> · <时间>"`；
- 图标选择器标题显示「项目图标 · 1461 个」+ 右侧构建号。

判断方法：
- DevTools：`document.querySelector('.fo-root').dataset.build` → 与最新提交比对；
- 或者打开图标选择器看标题右侧那串；
- 看不到新构建号 = 包没换：先 `Cmd+R`，再不行 `Cmd+Q` 完全退出 DSH 重开
  （plugin_manager 的 disable→enable 只重载宿主半体，客户端文件在某些宿主版本里是启动时缓存的）。

## 6. 每次改样式的验收清单（照着做就不会「改了没生效」）

1. `node --check` 改过的文件；
2. `pnpm run build:client`（必须，`lib/client.iife.js` 是宿主真正加载的产物）；
3. `npm test` + `npm run test:offline`；
4. **重载插件**（`plugin_manager` disable → enable），再刷新页面；
5. 真 Chromium 量 computed 值，**不要只看截图**：
   `border-radius` / `overflow` / `grid-template-columns` / `color` 的 computed 值才是事实。
