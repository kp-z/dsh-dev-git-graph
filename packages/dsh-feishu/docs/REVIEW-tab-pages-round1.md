# 独立复核：本轮三个 tab 页面（关系两级菜单 / 洞察 / 运行）

- 任务：`task-20`（只读复核）
- 复核者：`overview-rewrite-reviewer`
- 时间：2026-11-11 02:00 CST
- 工作区：`/Users/kp/DEV/dsh-plugins`，被测版本 `e2f9924`（自报，未跑 git）
- 只读声明：**未修改任何 `.js` / `.mjs` / `package.json`**；唯一写入是本报告文件。未跑 `git`。全部取数都是 GET。`npm run test:offline` 的第一段是 `build:client`（会重写 `lib/client.iife.js`），我改为直接跑 `node test/offline.mjs`；产物哈希前后一致可证未改动：
  `lib/client.iife.js` sha256 = `2d9cc7573777ee348831ad89a645edd138b76e08da6b9efd83af325f3c39ee92`（跑前 = 跑后）。
- 产物新鲜度：`lib/client.iife.js` mtime 01:51:56 晚于所有 `src/**` 最后修改（features.js 01:48:09、OverviewPanel.js 01:47:57），且产物里已含 `fr-breathe` / `洞察` / `运行概览`，即当前产物与源码同代。

## 结论速览

| 复核项 | 判定 | 一句话 |
|---|---|---|
| 需求 1：只剩一个侧边栏 + 两级菜单 | **成立** | `.fo-scope-column` 在 src 里 0 处；正文单列 `minmax(0,1fr)`；二级菜单渲染在 `aside.fo-rail` 内；拖拽/右键/ARIA/键盘全保留 |
| 需求 2：洞察页六面板 | **成立** | 6 个 `fd-panel` 全部渲染；数字全来自纯函数 `buildInsight`；有空态；真 Chromium 实测末行零空洞 |
| 需求 2 附加：数字是否"看全局" | **部分不成立** | 不受「范围」影响，但**受搜索词影响**；且「未同步端点」在搜索态虚高（实测 0 → 3，100%） |
| 需求 3：运行页气泡口径 | **成立** | 一任务一气泡；优先级 suspended→blocked→running→started→done→idle；运行中 success 令牌+呼吸；已完成静态；reduced-motion 关动效；四张卡齐 |
| 需求 3 附加：气泡交互 | **成立（仅代码级）** | 点=选中开详情；↗/双击=开会话；无 sessionId 时 disabled + title。**测试零覆盖** |
| 三条样式红线（19 个 src 文件） | **成立** | 字面量颜色 0；令牌恰好 14 且无未知/无未用；所有规则与 className 都在 `fo-`/`fd-`/`fr-`/`dfe-` 前缀下 |
| 红线回归防护 | **不成立（新样式表）** | `dashboardStyles.js`（22KB / 364 条）没有任何测试 import 它 |

---

## 1) 需求 1：只剩一个侧边栏（rail），页面不再有第二列

**结论：成立。**

- **`.fo-scope-column` 真的没了（src 里 0 处）**
  ```
  $ grep -rn "fo-scope-column" --include=*.js --include=*.mjs --include=*.html .
  （src/ 下 0 命中；命中只在）
  test/overviewPanel.mjs:409   ← 断言用的查找器
  test/overviewPanel.mjs:836   ← 断言「不存在」
  docs/PLAN-tab-pages.md:18/33/74/153 ← 计划文本
  src/client/GraphFeature.js:9/10     ← 注释（说明删了）
  ```
  `styles.js` 里连一条 `.fo-scope-column` CSS 规则都不剩（`grep -c` → **0**）。
- **正文只有一列**：`src/client/styles.js:261-266`
  ```css
  .fo-body { display: grid; grid-template-columns: minmax(0, 1fr); ... }
  .fo-root[data-detail="1"] .fo-body { grid-template-columns: minmax(0, 1fr) 336px; }
  ```
  即：默认只有主内容一列，只有打开右侧详情时才多 336px。功能页正文只有一块：`GraphFeature.js:79-97` = `.fo-feature` → `.fo-feature-bar`（可选）+ `.fo-feature-body` → **只有** `.fo-canvas-area`。
- **二级菜单真在 rail 内**：`OverviewPanel.js:874` 是唯一的 `aside.fo-rail`（`aria-label="功能导航"`），`:890-920` 里 `features.map` 出一级项按钮，`:917` `open ? h(feature.SubNav, {...}) : null` 把二级菜单渲染在该一级项**内部**（同一 `<div class="fo-featnav-group">`），不是页面里另起一列。SubNav 定义在 `features.js:99-102`：`.fo-subnav` 里挂 `TreeNav`（`compact: true`，根类 `.fo-scope`，`data-compact="1"`）。
- **一级项「关系」可展开/收起，展开态落 store**：`OverviewPanel.js:894` 展开条件 = 可展开 && 是当前项 && `navOpen[feature.id] !== false`（默认展开）；`:905-911` 点击当前已展开项 → 翻转 `navOpen`；`:902-903` 同步 `aria-current=page` / `aria-expanded`；`:291-295` 从 store 键 `nav` 读入、`:402` 写回。
- **二级项覆盖 全部任务 / 目录 / 未分组**：`TreeNav.js:269-288` 渲染 `all` 行 + 目录行 + 未分组行（未分组下继续列项目），测试 `test/overviewPanel.mjs:828` 断言文本含「全部任务」与「未分组」。
- **拖拽 / 右键 / 键盘 ARIA 全保留**：`TreeNav.js:150-152`（`role=treeitem`、`aria-level`、`aria-selected`）、`:159`（`draggable`）、`:163-170`（`onContextMenu`、dragStart/Over/Leave/Drop）、`:201-231`（↑↓/Home/End/←→/Enter/F2/Shift+F10）、`:284-287`（`role="tree"` + `onKeyDown`）。测试 `test/overviewPanel.mjs:826-827`、`:878-884`。
- **测试实跑**：`node test/overviewPanel.mjs` → **195 passed, 0 failed**，其中直接相关的三条：
  - `:836` 「关系页单列：`.fo-scope-column` 不存在，画布是唯一的主内容块」→ `blocks.length === 1` 且是 `.fo-canvas-area`
  - `:809-829` 「rail 两级菜单：一级项「关系」（可展开）+ 它的二级菜单就是范围树」→ 一级项数 == 注册表长度、默认展开、`.fo-subnav` 挂在 rail 里、ARIA tree 原样
  - `:861-876` 收起/展开 + `store.data.get('nav').graph === false/true`
- **画布变宽**：删掉的是原 248px 范围列（`styles.js` 旧版 `248px minmax(0,1fr)`，现已无该规则），与 `docs/PLAN-tab-pages.md:153` 的「536 → 776，正好 +240」自洽。

## 2) 需求 2：洞察 tab

**结论：六面板与纯函数成立；「看全局」这条在搜索态下不成立（见风险 R1）。**

- **六个面板都渲染**（`InsightFeature.js:142-243`）：`panel(0,'kpi')` → 全宽 KPI 行、`panel(1,'status')` donut、`panel(2,'projects')` 项目分布、`panel(3,'relations')` 关系概览、`panel(4,'blockers')` 阻塞榜、`panel(5,'recent')` 最近动态（三列）。测试 `test/overviewPanel.mjs:2128-2129` 断言 `.fd-page` 在、`.fd-panel` ≥ 5。
- **数字全部来自纯函数**：`InsightFeature.js:130` `const view = buildInsight(ctx.snapshot || ctx)`，之后所有面板只读 `view.*`；`insightView.js` 零 import、零副作用（不碰 DOM/store/fetch）。测试 `test/insightView.mjs` → **32 passed, 0 failed**，覆盖互斥四桶、`sharePct` 恰好 100、项目分布 Top8+其他、关系概览、阻塞榜 Top5、最近动态时间倒序、今日完成退化口径、500 任务压力。
- **空态可读**：`InsightFeature.js:132-139`「还没有任务可以洞察 / 等飞书任务同步进来…」（`role="status"`）。
- **布局真的填满**：CSS 规则 `dashboardStyles.js:33-39`（`.fd-page`: `grid-template-columns: repeat(auto-fit, minmax(240px,1fr))` + `grid-auto-rows: 1fr` + `gap:12px`），末行铺满靠 `spansForTail`（`InsightFeature.js:44-57`）在最后一格上 `grid-column: span N`（`:147`）+ `.fd-panel[data-span="all"]` 的 `grid-column: 1/-1`（`:57`）。
  - 算法侧（node 实跑）：`cols=2→[1,1,1,1,2]`、`cols=3→[1,1,1,2,1]`、`cols=4→[1,1,1,1,4]`、`cols=6→[2,1,1,1,1]`，每组和 == 列数。
  - 真 Chromium 实测（我把**与 dashboardStyles.js 完全同形的布局规则**注入到当前浏览器标签页，用真实 grid 几何量末行右边缘与内容区右边缘之差）：W=1200/992/776/536/400 五档，`lastRowFilled=true`，`lastRowDelta=0`（零空洞）。这是"同一套布局规则"的量测，不是宿主实页截图——实页需要 GUI 认证（见第 7 节）。

## 3) 需求 3：运行 tab

**结论：口径与视觉全部成立；气泡交互只在代码级成立（测试没覆盖）。**

- **一个任务一个气泡**：`runsView.js:113` `tasks.map(...)` 逐任务产出一个 bubble，`Bubble.js:36-68` 每个渲染一个 `.fr-bubble-item`。
- **状态优先级正是要求的那条**：`runsView.js:20` `STATE_ORDER = ['suspended','blocked','running','started','done']`，`:52-55` 顺序命中，都不中 → `idle`（未开始）。测试 `test/runsView.mjs:68` `deepEqual(STATE_ORDER, ['suspended','blocked','running','started','done'])`，`:72-90` 逐级验证（全开时挂起赢 / 去挂起后阻塞赢 / 去阻塞后运行中赢 / started 在 done 前 / 全无 → 未开始）。
- **运行中 = 绿色 + 呼吸**：数据层 `STATE_META.running = { tone:'success', breathing:true }`（`runsView.js:25`）；DOM 层 `Bubble.js:30-31` 加 `fr-tone-success` + `is-running`，`:49` 渲染 `.fr-bubble-pulse`；CSS 层 `dashboardStyles.js:257` `.fr-tone-success{--fr-tone:var(--fr-ok)}` → `:220` `--fr-ok: var(--dsw-alias-state-success-primary)`（绿色令牌），`:300` `.fr-bubble.is-running{animation:fr-breathe 2.4s ...}`，`:307-310` 呼吸关键帧，`:301-306` 外圈 ping。测试 `test/runsView.mjs:95-104`（只有 running 会呼吸）、`:200-201`（`tone==='success'`、`breathing===true`）。
- **已完成 = 静态绿**：`runsView.js:27` `done:{ tone:'success', breathing:false }`；测试 `test/runsView.mjs:103-104` 明确断言 `done.breathing === false`「已完成是静态绿色，不呼吸」。
- **prefers-reduced-motion 关掉动效**：`dashboardStyles.js:412-418`
  ```css
  @media (prefers-reduced-motion: reduce) {
    .fd-panel, .fr-panel { animation: none; }
    .fd-bar > i, ..., .fr-bar > i { transition: none; }
    .fr-bubble.is-running, .fr-stat-ring.is-running, .fr-bubble-pulse { animation: none; }
    .fr-bubble:hover { transform: none; }
  }
  ```
  生效机理是**同特异度 + 块在文件最后**（`:300`/`:357`/`:301` 在前），因此成立；但无 `!important` 且无测试（见 R2/R3）。*注：`test/overviewPanel.mjs:556-563` 的 reduced-motion 断言带 `!important`，那查的是 `styles.js` 的 `fo-` 段，不是这份。*
- **四张尾部卡都在**：`RunsFeature.js:133` 运行概览（4 个计数卡）、`:143` 会话活跃度（四档横条）、`:155` 运行时长 Top5、`:176` 需要人看一眼；加上 `:115` 气泡墙共 5 个 `.fr-panel`。测试只断言到 `.fr-page` 与 `.fr-group`（`:2142-2145`），面板数我是读代码确认的。
- **点气泡 = 选中/跳会话，没会话时 disabled + title**：`Bubble.js:45` 单击 → `onSelect(id)` → `RunsFeature.js:86` → `ctx.onOpenTask` → `OverviewPanel.js:819/564-567` `openTask` → `setDetailId` → 右侧详情抽屉（`:1000-1013`）；`Bubble.js:46` 双击 / `:57-65` 的 ↗ → `onOpenSession(sessionId)`；`:61` `disabled={!bubble.canOpenSession}`（`runsView.js:131` `canOpenSession = Boolean(sessionId)`），`:62` title「这个任务没有绑定会话」，`:63` aria-label 同步。**注意：没有任何测试点过气泡或断言 `.fr-bubble-go` 的 disabled/title**（`grep -n "fr-bubble" test/*.mjs` → 只有 1 处，`overviewPanel.mjs:2143` 数 `.fr-bubble-item` 个数）。

## 4) 三条红线（自己 grep，剥注释后判定）

方法：读全部 19 个 `src/**/*.js`，先剥 `/* */` 与 `//`，再匹配 `#hex|rgb()|hsl()`、`--dsw-*`、以及 `g('token', pct)` 调用点；CSS 单独解析（先把 `${...}` 插值换成占位符，避免把自定义属性声明误判成选择器）。

| 红线 | 结果 | 证据 |
|---|---|---|
| 零字面量颜色 | **成立** | 19 个文件全部 `literal colour hits: 0`（新文件 `dashboardStyles.js` / `insightView.js` / `InsightFeature.js` / `runsView.js` / `Bubble.js` / `RunsFeature.js` / `features.js` / `GraphFeature.js` 全是 0） |
| 恰好 14 个 `--dsw-*` 令牌 | **成立** | 去重后 `distinct real tokens: 14`，`not in official 14: []`，`official 14 unused: []`（与宿主 `BUILTIN_INSPECT_TOKENS` 逐名一致：13 个 alias + `--dsw-specific-sidebar-fill`） |
| 类前缀 | **成立** | `dashboardStyles.js` 140 条规则、`styles.js` 224 条规则，`without plugin prefix: 0`、`bare/global selectors: 0`；所有 className 字面量都在 `fo-`/`fd-`/`fr-`（旧右侧栏 `dfe-`）之下；无宿主类名泄漏（`dsw-`/`dsh-`/css-module 哈希 → 0 命中） |

**`g(token, pct)` 助手的调用点**（这是要点：它拼的是 `var(--dsw-alias-${token})`，必须看调用点）：
`dashboardStyles.js:16` 定义 `const g = (token,pct) => color-mix(in oklab, var(--dsw-alias-${token}) ${pct}%, transparent)`，全部调用点共 8 处，token 分别是
`border-l1`（:21, :102, :140, :212, :369）、`border-l2`（:22, :213）、`bg-layer-1`（:23, :214）、`bg-layer-2`（:24, :215）、`bg-base`（:25, :216）
→ 全部落在官方 14 个之内，没有任何 `g()` 调用越界。`options` 计数（`--fr-*`/`--fd-*` 中间变量）+ 直接书写的 8 个 `--dsw-alias-*` 一起构成那 14 个。

## 5) 风险清单（5 条，按严重度）

### R1【中】搜索词会串进仪表盘，且洞察页「未同步端点」在搜索态虚高 — 建议修
- 依据：
  - 头部搜索框是**共享骨架**，在三个功能页都在（`OverviewPanel.js:956-966`），且 `keyword` 落 store（`:321`、`:400`）、切功能时**不清空**（全文无 `setKeyword('')` 于切换路径；`:963` 只有 Esc 清空）。
  - `OverviewPanel.js:422-429` `visibleTasks` = `tasks` 按 keyword 过滤；`:835` 把它作为 `featureCtx.tasks` 交给功能页；而 `:836` 的 `relations` **没有**跟着过滤。`InsightFeature.js:130` / `RunsFeature.js:84` 都用 `ctx.snapshot || ctx` → 读到的是被过滤的 `ctx.tasks`。
  - `insightView.js:257` `ghosts = relations.filter(edge => !ids.has(from) || !ids.has(to))`，`ids` 来自（过滤后的）tasks → 搜索时几乎每条关系都会算成"端点缺失"。
  - 实跑（live GET `/dsh-feishu/api/overview` → 52 任务 / 3 关系，再用同一份快照喂 `buildInsight`）：
    ```
    全量：ghosts=0  ghostPct=0    statusMix=[done:48, blocked:0, suspended:1, ready:3]  KPI 任务总数=52
    搜索「🧪 」后（tasks 52→25，relations 仍 3）：ghosts=3  ghostPct=100  statusMix=[done:23,...]  KPI 任务总数=25
    ```
  - 与文案冲突：`features.js:108` 写「看全局，不跟范围走」，`OverviewPanel.js:833-834` 注释写「不受当前范围**与搜索**影响」，实际搜索会影响。
- 建议（二选一）：
  1. `featureCtx` 给仪表盘传**未过滤**的 `tasks`（另开 `allTasks`），搜索只作用在关系页；或
  2. 明确把 keyword 当全局过滤，则：`ghosts` 用全量 task id 判定（新增 `ctx.allTaskIds`），并在洞察页头部显示「已按搜索「x」过滤（52→25）」的提示条。
- 这是本轮我认为**最值得修**的一条：它会让用户在搜索后看到一整屏"看起来坏了"的数字（100% 端点缺失）。

### R2【中】`dashboardStyles.js` 22KB / 364 条 CSS 零测试覆盖 → 红线无回归防护
- 依据：`grep -rn "dashboardStyles" test/*.mjs` → **0 命中**；`test/overviewPanel.mjs:29` 只 `import { CSS } from '../src/client/styles.js'`，所有 CSS 断言（含 `:556-563` 的 reduced-motion、`:500-502` 的 `.fo-rail`）都只解析 `fo-` 那份。测试对 `fd-`/`fr-` 的覆盖只有 DOM 级三条（`:2128`、`:2129`、`:2142`）。
- 影响：我这次独立复核确认三条红线在 `fd-`/`fr-` 上**今天成立**，但任何人下次在 `dashboardStyles.js` 里写一个 `#fff`、引一个不存在的新令牌、或起一个裸选择器，CI 都不会红。
- 建议：在 `test/overviewPanel.mjs` 里加同款断言（或新增 `test/dashboardStyles.mjs`）：import `CSS` → 零字面量颜色 / `--dsw-*` ⊆ 14 个 / 每条规则以 `.fd-`|`.fr-` 开头 / `mediaBody('(prefers-reduced-motion: reduce)')` 里含 `fr-breathe`·`fr-ping`·`fr-panel` 的关闭声明。

### R3【中低】`fr-` 的 reduced-motion 靠"源码顺序"生效，无 `!important`，且无断言
- 依据：`dashboardStyles.js:412-418` 的关闭声明与 `:243`（`.fr-panel`）、`:300`（`.fr-bubble.is-running`）、`:357`（`.fr-stat-ring.is-running`）、`:301`（`.fr-bubble-pulse`）**特异度相同**，靠"块在文件最后"取胜；对比 `styles.js` 的 `fo-` 段用的是 `animation: none !important`（测试 `:559-562` 也按 `!important` 断言）。
- 影响：今天行为正确；但以后任何追加到文件末尾（`:419` 之后）或特异度更高的动画规则都会**静默**压过它，且 R2 说明没有测试会拦。
- 建议：`fr-` 段也改成 `animation: none !important` / `transition: none !important`，并补 R2 的断言。

### R4【中低】节点高度是常量 `NODE_H=88`（复核 lead 已知项 (a)：**成立**，但机制比"为了列基线对齐"更强）
- 依据：`src/overview/layout.js:49-50` `NODE_W:264, NODE_H:88`；卡片行基线写死在 `layout.js:84-86`（`ROW_EYEBROW:24 / ROW_TITLE:46 / ROW_META:66`）；节点坐标按固定步长铺开（`:397-398` `x = PAD + col*(NODE_W+GAP_X)`、`y = originY + PAD + row*(NODE_H+GAP_Y)`）；画布尺寸也按常量算（`:406-411`）。渲染侧 `GraphView.js:259-278` 用绝对坐标画 rect/text，**标题单行**且按预算截断（`layout.js:55 TITLE_WIDTH:13`、`layout.js:88 META_WIDTH:20`）。
- 补充判断（我的增量结论）：因为所有文字都是**按预算截断后放到固定基线**，卡片**不会溢出/不会重叠**，常量是自洽的；代价是 ① 长标题永远只能显示约 13 个汉字（有省略号，`model.js:61-73` 用 `ELLIPSIS` 参与测量，不是硬切）；② 卡片永远不能因内容变高；③ 若以后把宿主字号偏好接进来（宿主 `ui-theme` 有 text 10–22px 的字号设置），当前 SVG 文字是固定 `px`，比例不会跟着变——不会溢出，但也不会跟随宿主。
- 建议：接受并写进口径（注释已有），或让 `layout` 返回 `h` 并让 `GraphView` 用 `node.h` 绘制（改一行即可让未来"两行标题"落地）；若要跟宿主字号，需把 `.fo-node-title { font-size: 12px }` 换成 `rem/em` 并同步缩放 `NODE_H`。

### R5【低】(a) 运行态来自宿主内存（复核 lead 已知项 (b)：**成立**） + (b) 4 处样式注入仍未挂 `ctx.effect`（上一轮遗留，已扩大）
- **(a) 成立且有更准的机制**：`index.js:4482-4484`
  ```js
  /* 运行 tab 的口径：「运行中」= 这条会话此刻真的在跑（宿主内存态，重启后清零）… */
  running: Boolean(task.sessionId) && live.get(asString(task.sessionId))?.kind === 'running',
  ```
  `live` 来自 `liveSessionState()`（`index.js:3450-3466`），它读的是 `service(ctx,'agents').list()` 的 agent 相位——**纯内存**。DSH 重启后 agents 为空 → `running` 全 false → 这些任务落到 `started`（`task.started === true`，本地持久化）→ 气泡显示「等待中」。而且 `running` 已在 revision 哈希里（`index.js:4505`），所以重启后**会立刻刷新**成等待中，不会滞留旧值。
  评价：语义上没错（"此刻真的在跑"），但用户视角会像"运行页坏了"。建议在运行页 hint / `hint` 字段加一句「宿主重启后运行态清零，会话恢复后自愈」，或从会话日志回放未结束的 turn 作为兜底。
- **(b) 旧账未清，且从 3 处变 4 处**：`src/client/client.js:43`、`src/client/sidebar-tab.js:30`、`src/client/styles.js:684` 之外，本轮新增 `src/client/dashboardStyles.js:429-431`（`host.appendChild(el)`）；四处都只做"幂等插入"，**没有**返回清理函数、也没进 `ctx.effect`（`client.js` 的 `ctx.effect` 只包了 slots 的 disposer）。官方 `references/ui-plugin.md:13` 要求 styles 在 `apply` 里用 `ctx.effect` 注册并返回清理。影响小（`fo-`/`fd-`/`fr-`/`dfe-` 前缀 + 幂等 id），但插件禁用/热重载后宿主文档里会长期留着 4 个 style 标签。
  建议：`ctx.effect(() => { const el = injectStyles(document); return () => el && el.parentNode && el.parentNode.removeChild(el) })` 统一收口（四个注入器都返回元素或布尔，需要小改）。

### 另外两条"小账"（不单列，供顺手修）
- `InsightFeature.js:173` `className: \`fd-list-row fd-tone-${row.tone || row.tone}\`` —— 两个分支同一个表达式，`row.tone` 在 `insightView.js:219-252` 里**从未赋值**，所以每行都得到不存在的类 `fd-tone-undefined`，`--fd-tone` 不设 → `.fd-bar-split > i/b`（`dashboardStyles.js:141-142`）回退到 `--fd-brand`，**项目分布的所有横条都是同一种品牌色**；而 `insightView.js:228` 算好的 `deco`（项目分色槽）在组件里**没有被使用**（`grep deco InsightFeature.js` → 0）。修法：改用 `decoVar(row.deco)`（`styles.js` 已有）或 `fd-tone-${row.tone || 'brand'}`，或按 `data-deco` 在 CSS 里给色。
- `insightView.js:134` 注释写「kpis 4-5 个气泡指标卡」，实际返回 **6 个**（`insightView.js:182-189`：total/done/blocked/ready/suspended/todayDone），注释漂移，建议改注释。

## 6) 复跑命令与**实际输出**

我实际跑的是（全部 exit=0）：

```
$ node test/insightView.mjs        → insightView.mjs: 32 passed, 0 failed        EXIT=0
$ node test/runsView.mjs           → runsView.mjs: 28 passed, 0 failed           EXIT=0
$ node test/overviewPanel.mjs      → overviewPanel.mjs: 195 passed, 0 failed     EXIT=0
$ node test/overviewRoute.mjs      → OVERVIEW_API_OK                             EXIT=0
$ node test/organizeSuggestions.mjs→ organizeSuggestions.js: 20 passed, 0 failed
                                     ORGANIZE_SUGGESTIONS_OK                     EXIT=0
$ node test/offline.mjs            → OFFLINE_OK: 79 JavaScript files + 7 Python suites;
                                     live smoke excluded                          EXIT=0
```

采样的关键行（原样）：

```
insightView.mjs
  ok  大量任务（500 条 / 200 条关系）也能算，且状态和守恒
  insightView.mjs: 32 passed, 0 failed
runsView.mjs
  ok  STATE_ORDER 就是口径顺序（改口径只动这张表）
  ok  每个状态都有元信息（label/tone/breathing/dashed），运行中才会呼吸
  ok  气泡字段：编号/标题/项目/状态/是否呼吸/会话可用性/时长
  runsView.mjs: 28 passed, 0 failed
overviewPanel.mjs
  ok  关系页单列：.fo-scope-column 不存在，画布是唯一的主内容块   ← 需求 1 主断言
  ok  rail 两级菜单：一级项「关系」（可展开）+ 它的二级菜单就是范围树
  ok  点一级项收起：二级菜单从 DOM 消失、折叠态落 store 键 nav、画布不动
  ok  切回关系图：scope / 选中项都还在（状态没被功能切换清掉）
  ok  切到「洞察」：正文是洞察页（fd- 面板），画布与二级菜单都卸载
  ok  切到「运行」：气泡墙渲染，运行中的气泡带 is-running
  ok  prefers-reduced-motion：关掉动画、过渡与位移，渐变也不再淡入   ← 注意：只覆盖 fo- 段
  overviewPanel.mjs: 195 passed, 0 failed
overviewRoute.mjs
  ✓ 目录写操作后 revision 变化        ← 上一轮我提的 revision 漏字段已被修复（见下）
  ✓ 坏 action 返回 400 而不是 500
  OVERVIEW_API_OK
organizeSuggestions.js: 20 passed, 0 failed / ORGANIZE_SUGGESTIONS_OK
OFFLINE_OK: 79 JavaScript files + 7 Python suites; live smoke excluded
```

**两点必须说明的偏离**：
1. `npm run test:offline` 的定义是 `pnpm run build:client && node test/offline.mjs`（`package.json:77`）。它的第一段会**重写** `lib/client.iife.js`（一个 `.js` 文件），与你"不要改动任何 .js"冲突，所以我只跑了第二段 `node test/offline.mjs`。为证明没动过产物，我记录了跑前/跑后哈希，**完全一致**：`2d9cc757…3c39ee92`。如需严格按原命令复核，请自行跑一次 `npm run test:offline`（它会重建产物，应当字节一致，因为 src 最后修改 01:48:09 < 产物 01:51:56）。
2. 全程未跑 `git`（遵嘱），所以"版本 = `e2f9924`"是**采信你的说法**，不是我核实的。上面所有 file:line 都是当前工作区内容。

**顺带确认上一轮的结论已被修**：我上一轮报的「revision 哈希漏 `suspended`/`sessionId`」已经补上——`index.js:4503-4508` 的哈希现在含 `suspended, sessionId, running, completedAt, startedAt`，且注释（`:4500-4502`）明确写了这是修那个洞；`test/overviewRoute.mjs` 也新增了「目录写操作后 revision 变化」断言。这条可以从我上一轮的风险清单里划掉。

## 7) 验证限制（请据此判断结论强度）

1. **宿主 GUI 页面打不开**：我的浏览器会话访问 `http://127.0.0.1:63873/` 返回「dsh web authentication required」。因此无法在**宿主真实页面**上截图/量测「洞察/运行」两页的真实像素与真实列数（`ctx.columns` 走 `ResizeObserver` → `grid-template-columns`）。
   我用的替代：(a) 插件自己的页面 `http://127.0.0.1:63873/dsh-feishu/panel` **可打开**（无认证），我在该标签页里注入了一份**与 `dashboardStyles.js` 同形的布局规则**做真 Chromium 量测（结果见 §2），这是"同一套 grid 规则"的量测，不等于宿主实页量测；(b) 列数/跨度算法在 node 侧直接 import 真实模块验证（`spansForTail` 是导出的）。
2. **气泡交互、四张尾卡的存在**只有代码级证据（§3），没有测试也没有点击回放。
3. 所有 HTTP 都是 **GET**（`/dsh-feishu/api/overview` 一次），没有触发任何写接口；`node test/offline.mjs` 内部用隔离 HOME 跑写用例，未动 live state。
