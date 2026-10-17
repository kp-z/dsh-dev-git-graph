# RESEARCH — 「侧边栏整合 + 列表聚焦 + 交互简化」有哪些现成方案可以用

> 作者：skill-finder（R1，task-1）。**只调研，不动代码。**
> 纪律：D57「能用现成的就别手写」。每条结论四段固定：**结论 / 证据 / 我们该怎么用 / 不适用在哪**。
> 取证时间：2026-10-18 01:01–01:32，以**磁盘现状**为准（§6 有对应哈希）。同工作区有另一个 Agent 在并行改
> `web/scene/scene-phaser.js` / `web/main.js` / `web/index.html` / `web/styles/layout.css`）。

---

## 0. 三条先给结论（验收要求的"至少三条明确建议"）

| # | 问题 | 建议 | 依据 |
|---|---|---|---|
| **A** | 侧边栏挂在哪？ | **R2–R5 挂在页面内 `<aside>`（agent-world 自己那页）**，不是 DSH 右侧栏 tab。理由：本插件的包**根本没有客户端半体**（无 `dsh.client`、无 `lib/client.js`），挂 DSH tab 要先补一套客户端 bundle + iframe 桥，才换来"列表与场景跨文档"这个负资产——而镜头聚焦**必须同文档**。DSH tab 留作 M7-7 的第二步（见 §1.4） | §1.2 / §1.3 / §2.1 |
| **B** | 用什么渲染？ | **复用 `web/ui/board.js` 的 `createBoard()` 与它的 `el()/svgEl()` 手写 DOM，不引 React、不引新框架**。成员列表的渲染函数 `renderMembers()` 已经在（`board.js:363`），要的是**把它从"只在展开浮层里画"改成"给定容器就画"**，而不是重写一份 | §2.2 / §2.3 |
| **C** | 列表点击如何触发镜头聚焦？ | **不要新写动画**。链路已经全通：卡片点击 → `selectAgent(agentId)`（`scene-phaser.js:964`）→ `startFollowSelection()`（`1033`）→ 引擎 `camera.pan(...)` 420ms + `camerapancomplete` 后 `startFollow`（`1025/1043/1050`）。**唯一缺的一环**：`head.addEventListener('click')`（`board.js:404`）现在只调 `select()`，**没有回调出去**；补一个 `onMemberSelect` 选项，接到 `main.js` 已有的 `scene2d.selectAgent`（`main.js:157-160` 同一个函数） | §3.1 / §3.2 / §3.3 |

> 一句话：**A 是"先别去挂 DSH tab"，B 是"别新写渲染"，C 是"别新写相机"——三条都是删工作量。**

> ✅ **与用户口径一致**：用户对"侧边栏"的要求是**页面内的**侧边栏（团队会话记录中的原话意为"侧边栏指的是页面内的那种"）。
> 所以 A 不只是"本轮成本更低"——**DSH 右侧栏 tab 不是本产品的目标形态**，M7-7 那条（BACKLOG 说"挂 DSH 右侧栏 tab"）
> 若要继续，得先跟用户确认口径，别按旧条目直接动手。

---

## 1. DSH 侧边栏插件 `dsh-better-sidebar`：它怎么注册 tab、怎么渲染列表、点击怎么回调

### 1.1 注册 tab 的契约（`ctx.betterSidebar.registerTab(descriptor)`）

**结论**：服务名是 `betterSidebar`，方法 `registerTab(descriptor)`，返回 disposer（cordis 在 fiber 销毁时自动调，HMR 安全）。descriptor 里我们需要的字段只有 `id / title / icon / order / single / component`；`component` 拿到的是 `{ ctx, store, scope, tab, visible, ... }`。

**证据**
- 契约与设计说明：`~/.dsh/profiles/web/node_modules/dsh-better-sidebar/lib/types/client/service.d.ts:1-22`（"published to the cordis context as `ctx.betterSidebar`"、"consumers declare it in `inject`"、"returning a disposer that cordis auto-invokes on fiber disposal (HMR-safe)"）
- 方法签名：同文件 `:540` `registerTab(descriptor: TabDescriptor): () => void;`；相邻还有 `registerFileViewer` / `registerFileIcon` / `getTabs` / `openTab(:624)` / `activate(:532)` / `has(:534)`
- `TabDescriptor` 字段：同文件 `:146` 起（`id` `title` `icon` `order` `hidden` `single` `dedupeKey` `createTab` `settings` `badge` …）
- 组件 props：同文件 `:128` `TabComponentProps`（`ctx` `store` `scope` `tab` `visible` `onOpenDiff` `onSubagentJump` …）
- 官方 README 的最小示例：`~/.dsh/profiles/web/node_modules/dsh-better-sidebar/README.md:313-318`
  ```ts
  export const inject = ['betterSidebar']
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'my-plugin:db', title: 'Database', component: ({ scope }) => <DbView sessionId={scope.sessionId} /> }))
  ```

**我们该怎么用**：M7-7 真要挂 DSH tab 时，照 `packages/dsh-spellbook/src/plugin/client.js:252-288` 的**形状**抄（不是抄它的 iframe）：`try { betterSidebar = ctx.betterSidebar || ctx.get('betterSidebar') } catch { ... }`（cordis 4.x 对未声明服务名 `ctx.get` 会硬抛，必须 try/catch，见 `packages/dsh-dev-git-graph/src/client.js:240-247` 的注释），然后 `registerTab({...})` + `ctx.effect(() => dispose)`。

**不适用在哪**：
1. **本包现在没有客户端半体**。`packages/dsh-agent-world/package.json` 的 `dsh` 块**只有** `bundle.patch`（实测：`python3 -c "json.load(...)['dsh']"` → `{"bundle":{"patch":"./cordis.patch.yml"}}`），而 spellbook / git-graph / better-sidebar 三家都有 `dsh.client: { platform: 'web', inject: [...] }`（`packages/dsh-spellbook/package.json:62-67`、`packages/dsh-dev-git-graph/package.json:60-65`、`.../dsh-better-sidebar/package.json:47-55`）。也就是说"注册 tab"这件事本身要先造一整个客户端 bundle。
2. **`registerTab` 的 component 是 React 组件**（`ReactNode` / `React.createElement`）。agent-world 的 UI 是**零框架手写 DOM**（`web/ui/board.js:63` `el()`），要坐进 tab 就只能 iframe 或重写成 React —— 两者都和「同一份渲染代码」红线（PLAN §二(a)）冲突。
3. **本机 profile 里确实装了 `dsh-better-sidebar@0.25.0`**（`~/.dsh/profiles/web/package.json` dependencies 实测含 `"dsh-better-sidebar": "0.25.0"`），所以依赖不是障碍；障碍是 **agent-world 的客户端半体不存在**。

### 1.2 它自己怎么渲染侧栏列表、点击怎么回调

**结论**：它**没有**提供一个"给我一个数组、我给你渲染成可点列表"的通用组件。它自己的 tab 条是 `TabBar.tsx` 里的 `tabs.map(...)` → 一个 `div[title][draggable]` → `onClick={() => onActivate(tab.id)}`。也就是说：**"点击列表项 → 回调 id"这个模式是一行 `onClick`，没有任何需要复用的框架代码**。

**证据**
- `~/.dsh/profiles/web/node_modules/dsh-better-sidebar/src/client/TabBar.tsx:218` `{tabs.map(tab => (`
- 同文件 `:239` `onClick={() => { onActivate(tab.id) }}`；`:61` `onActivate: (tabId: string) => void`
- 选中态是 `clsx(css.tab, active === tab.id && css.tabActive)`（`:221-222`）——**class 切换，不是状态机**
- 列表容器 `:218` `className={css.tabList}`（CSS Modules）

**我们该怎么用**：B 建议的正面理由——`board.js` 的 `renderMembers()`（`board.js:363`）**已经是**"数组 → `ul/li` → 每行 `head` 挂 `click`"的完整实现，而且比 TabBar 多了"状态文字就地刷新不必重建整块"（`memberStateNodes`，`:381-388`）。**直接搬位置，不搬代码。**

**不适用在哪**：`TabBar` 是 React + CSS Modules（`css.tabList`），且带拖拽重排 / 中键关闭 / 右键菜单那一整套 DSH tab 语义。我们只需要"列表 + 选中 + 一个回调"，抄它等于把一个 tab 条的负担背过来。DSH tab 的顺序/持久化由宿主 store 管，我们的侧边栏不需要。

### 1.3 DSH tab 要拿到我们的页面，只有 iframe 一条路（spellbook 的实证）

**结论**：spellbook 的 `SpellbookView` 就是一个 `<iframe src="/dsh-spellbook/?embed=1&theme=...">`。它明确写了**为什么**这么做，其中一条正是"别写第二套渲染器"。这对我们是**反例**：iframe 里的列表**点不到**父文档里的 Phaser 相机。

**证据**
- `packages/dsh-spellbook/src/plugin/client.js:9-16`（注释："内容：宿主路由 /dsh-spellbook/ 下的静态站…用 iframe 载入"、"为什么是 iframe 而不是把站点重写成 React 组件…把站点塞进宿主组件树要重写渲染与预览两套东西"）
- `:224-238` `React.createElement("iframe"`, { ref: frameRef, className: "dsh-spellbook-frame", src: urlRef.current, ... })`
- 主题桥：`:19-46`（`?theme=` 管首屏 + `postMessage` 管切换）；`spellbookFrame` 只用来认消息来源（`:61` `:204` `:96-103`）
- 跨文档能力是**明着写的桥**：`:49-59`（"站点（iframe 里那半边）**够不着**对话的输入框 —— 能碰到它的只有这里"）+ `:56-59` 的 `composerSinks` **栈**（注释解释了为什么是栈：分屏/多会话时每个 session 挂一个实例，卸载会互相置空）
- git-graph 同一个模式：`packages/dsh-dev-git-graph/src/client.js:11`（"内容：移植版 git-graph iframe"）、`:13`、`:70`（diff 桥 iframe→父页→原生 DiffTab）

**我们该怎么用**：**别走这条路（本轮）**。如果将来非挂 DSH tab 不可，要接受一个结论：**"点列表 → 镜头聚焦"会变成跨文档消息**（就像 spellbook 的 `spellbook:apply` 那样，`client.js:49-59`），而每次跨文档都是一处需要 requestId + 回执的常规失败分支（`:95-112` 三重校验：来源 / origin / 载荷形状）。为了"点一下卡片把镜头挪过去"付这个代价不值。

**不适用在哪**：spellbook 与 git-graph 都**没有**"列表要驱动父页面的引擎状态"这个需求——spellbook 要的是"把文本放进输入框"，git-graph 要的是"打开 DiffTab"，都是**一次性命令**；我们要的是**连续的空间状态（相机）**，而且用户已经在场景里拖过、缩放过了。跨文档同步相机会变成两份真相。

### 1.4 如果将来一定要挂 DSH tab，正确的接法（M7-7，第二步）

**结论**：用 `openTab` **把宿主导航到我们已有的 `/agent-world/` 页**也可以（`OpenTabSeed.url` 存在），但更稳的是注册 tab + iframe，且 tab 里只放"**只读**的 Agent 列表"，点击通过 postMessage 让父页（如果父页就是 world 页则不成立）……

——实际上这条走不通，原因见 §1.3。**所以 M7-7 的正确形态应该反过来**：DSH tab 里放的是**同一份 `board.js` 渲染的只读看板**（点它只发 `agent_world_focus` 工具调用/命令，不直接动相机），而场景页自己才是镜头的主人。

**证据**
- `OpenTabSeed` 有 `url?: string`（"A URL the tab navigates to on mount (the browser tab's seed)"）：`.../dsh-better-sidebar/lib/types/client/service.d.ts:433`
- `target?: 'right' | 'bottom' | 'side'`、`reveal?`：同文件 `:450` / `:459`
- `openTab(seed, scope?)`：同文件 `:624`
- 我们已有的命令通道：`POST /agent-world/api/command`（`docs/ARCHITECTURE.md:345`），命令种类见 `src/protocol/wire/commands.ts`

**我们该怎么用**：M7-7 若开工，先写**只读**列表 tab（无相机交互），把"聚焦"做成 world 侧自己消费的事件（SSE 已经有 `/api/events`）。这样跨文档只有"单向指令"，没有"共享状态"。

**不适用在哪**：这条**不是**给 R2–R5 的建议，是给 BACKLOG M7-7 的记录。R2–R5 一律走 §0-A。

### 1.5 装 `dsh.client` 半体的实操坑（真要挂时必须知道）

**结论**：客户端 bundle 必须是 `window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => {...} })`，且 **`id` 必须等于 `package.json` 的 `name`**；`dsh.client.inject` 里写的是**服务名**（`slots`/`betterSidebar`），不是包名。注册失败的表现极其隐蔽：**tab 消失，host 侧一切正常**。

**证据**
- `packages/dsh-daily/STATUS.md:530`："`lib/client.js` 存在且含 `__ModuleLoader__.load`（缺了 tab 消失、host 侧却一切正常）"
- `packages/dsh-daily/STATUS.md:1032-1034`：加载器只有两种失败 —— `transport-failed`（bundle 取不到/抛错）与 `not-registered`（"loaded without registering `<id>` via `__ModuleLoader__.load`"）
- `packages/dsh-daily/STATUS.md:1076-1077`："86/86 满足注册 id == 包名"；"`dsh-better-sidebar` 两个版本的 inject：直接读各自 package.json 的 `dsh.client.inject`"
- `PROJECT_MEMORY.md:35`（dsh-dev-agent-mode 的经验）："① `client.inject` 必须用服务名（如 `"slots"`）而非包名；② `client.js` factory 顶层不能访问 ctx（CSS 注入要放 apply 内）"
- 实体参照：`packages/dsh-spellbook/src/plugin/client.js:1-3`（`window.__ModuleLoader__.load({ id: "dsh-spellbook", …})`）、`packages/dsh-tab-split/src/client.js:1-3`（`id: "dsh-tab-split"`）

**我们该怎么用**：本轮不需要。若 M7-7 开工，直接把 `scripts/verify-install.mjs` 那 15 项里的"`lib/client.js` 存在且含 `__ModuleLoader__.load`"搬进本包的校验（`packages/dsh-daily/STATUS.md:525-533` 是清单原文）。

**不适用在哪**：这些坑**全是客户端半体引入的**。R2–R5 不装半体，就一个都不沾。

---

## 2. 本仓库同类实现：抄挂法、抄结构，不抄外壳

### 2.1 `dsh-spellbook` 的挂法全貌（BACKLOG M7-7 说"抄 dsh-spellbook 的挂法"）

**结论**：它的"挂法"其实是**两件事**：①host 侧 `inject: ['webServer']` + 在自己前缀下直出静态站（`/dsh-spellbook/**`）；②客户端半体 `inject: ['slots','betterSidebar']` + `registerTab` + 顺手注册 `tabsplit.pane` 窗格。**第①件我们早就有了**（`/agent-world/` + `src/routes/panel.ts`），第②件本轮不需要。

**证据**
- host：`packages/dsh-spellbook/src/plugin/index.ts:25-28`（`name` / `inject = ['webServer']`）、`:31` `const MOUNT = '/dsh-spellbook'`、`:4-13`（路由与"整站从 dist/ 直出，不在插件里再渲染一遍"的理由）
- 客户端半体：`packages/dsh-spellbook/package.json:62-67`（`dsh.client.platform='web'`、`inject:["slots","betterSidebar"]`）
- 三处注册：`src/plugin/client.js:264`（`registerTab`）、`:292-299`（`slots.inject("tabsplit.pane", ...)`）、`:305-317`（`conversation.input.left`，只为拿 `inputActions`）
- 导出契约：`:331` `exports.inject = ["slots", "betterSidebar"]`
- 对照 agent-world host 已有的一半：`packages/dsh-agent-world/src/index.ts:441` `webServer.register({ kind: 'prefix', path: resolved.routePrefix, handler })`；`src/config.ts:80` `routePrefix: z.string().default('/agent-world')`；`src/routes/panel.ts:100-121`（`/` → `index.html`，`/*` → 静态文件）；`src/index.ts:445` 的启动日志直接把四个 URL 打出来

**我们该怎么用**：**只抄"host 直出静态站"这一半，而且已经抄完了。** `main.js` 已经用 `?debug=1` 挂了一套页内调试门面（`web/main.js:458`（`?debug=1` 才挂的总入口）、`:487` `__agentWorldScene2d`、`:554` `__agentWorldBoard`），这就是"页内自省"的现成入口，侧边栏接完后用它验收（`board.expand()` / `scene2d.selectAgent(id)` / `scene2d.camera()`）。

**不适用在哪**：
1. spellbook 的站点是**构建期产物**（`dist/`，332 条咒语），所以"直出 + iframe"是最优解；我们的 `web/` 是**源码直接服务**（`scripts/copy-web.mjs` 同步到 `lib/web/`），页内改一行就是一行，没有"第二套渲染器"的风险，**所以 iframe 对我们的收益是负的**。
2. 它的 `tabsplit.pane` 注册（`client.js:292-299`）是给分屏做的；我们的场景有 Phaser 画布，塞进分屏窗格会触发一次 `Scale.RESIZE`（见 §3.4），属于无必要的风险。

### 2.2 `dsh-dev-git-graph`：同一个"右侧栏 + iframe + 主题桥"模式，且**没有**页面内 DOM 可抄

**结论**：git-graph 与 spellbook 同构（`registerTab` + iframe + `postMessage` 主题 + diff 桥），但它多一条对我们有用的证据：**host 用 `webServer.register({kind:'prefix'})` 服务自己打包的 `media/`**，路径是 `/dsh-dev-git-graph/gg`，且注释明写"path 不带尾斜杠，`/…/gg` 同时匹配自身与 `/…/gg/...`"。

**证据**
- `packages/dsh-dev-git-graph/src/git-graph/routes.ts:458-479`（`kind:'prefix'`、`path:'/dsh-dev-git-graph/gg'`、注释在 `:459`）
- `:482-495`（`kind:'exact'` 的 API）
- `packages/dsh-dev-git-graph/src/client.js:11-13`（iframe + 主题从父页读 `--dsw-alias-*`）
- `packages/dsh-dev-git-graph/src/client.js:232-296`（`slots.inject('tabsplit.pane')`、`registerTab`、`exports.inject = ["sessions","slots","betterSidebar"]`）

**我们该怎么用**：**结构上抄一点**——它对 `ctx.get('betterSidebar')` 的 `try/catch` 与"未装 better-sidebar 时静默无 UI，不做回退面板"的注释（`client.js:239-247`）是"可选依赖"的标准写法。将来若做 DSH tab，这段直接照抄。

**不适用在哪**：它的整个前端是 `media/` 里的**打包产物**（`scripts/pack-web.mjs`），我们的是 `web/` 源码 + `copy-web.mjs` 原地同步；它的 `serveStatic` 带进程内缓存 + gzip 预压缩（`routes.ts:90-98`），我们不需要（`panel.ts` 的白名单已经够）。

### 2.3 `dsh-mermaid-comm` / `dsh-tab-split`：`slots.inject` 的排队语义（将来有用，本轮不用）

**结论**：`ctx.slots.inject(slotName, fn)` 在目标 slot **尚未声明**时会**排队等待**，声明出现后**同步补注册**。这条对"插件之间互不认识也要能入驻"很关键，但它属于 DSH 官方 slot 体系，**不是** better-sidebar 的。

**证据**
- `packages/dsh-dev-git-graph/src/client.js:280-281`（注释原文："`slots.inject` 在 `tabsplit.pane` 尚未声明时排队等待，声明出现后同步补注册"）
- `packages/dsh-mermaid-comm/src/client.js:167-172`（`ctx.slots.inject(SLOT, () => ctx.slots.register(...))`）
- `packages/dsh-tab-split/src/client.js:22`（`var PANE_SLOT = "tabsplit.pane"`）；`:52-60`（`usePaneViews`：`getVersion` + `useSyncExternalStore` + `entries()`）

**我们该怎么用**：本轮不用。记一笔是因为——如果将来侧边栏想"让别的插件也能往我的列表里塞一行"，DSH 的 slot 体系已经有现成的订阅/版本机制，**别自己发明一套**。

**不适用在哪**：agent-world 当前**没有任何 slot 消费者**（`grep -rn "slots" packages/dsh-agent-world/src` 无命中），而且页面在 iframe/独立页里，拿不到宿主 slot。引入 slot 需要先有客户端半体（回到 §1.5）。

### 2.4 本地参考文档：`REFERENCES.md` 与 `REFERENCE-openclaw-office.md` 对本轮**几乎不适用**

**结论**：这两份都是 **three.js 时代（R66 之前）** 的材料，且主题是"3D 场景怎么建/怎么画"，**没有一条**讲侧边栏、列表、UI 交互或相机聚焦。**本轮不要从这两份里找答案**——会找到一堆已经删掉的 three.js 方案。

**证据**
- `packages/dsh-agent-world/docs/REFERENCES.md:1-9`（"M4 要做 three.js 场景"、"先把本机已有的参考实现整理成地图"）；正文表格全是 `CameraRig.ts` / `pointCloudBuilder.ts` / `OrbitControls` / `troika-three-text` / `EffectComposer`（`:27-45`、`:60-70`）
- 同一份文档 `:311-315` 的三方案（A/B/C）讨论的是**素材与美术方向**（Kenney Furniture Kit、像素风、照预览图摆家具）
- `docs/REFERENCE-openclaw-office.md:14-27`（"渲染/美术：**不要学它**"）+ `:60-67`（结论只有 `idle-behaviors` / `ambient-cycle` / `roaming-manager` / `position-allocator` 四项，全部已记进 BACKLOG M14-1~4）
- 两份文档都**没出现**"sidebar / 侧边栏 / tab / 列表 / 点击 / pan / focus"这组词里的任何一个作为主题

**我们该怎么用**：**跳过**。真正该读的本地参考是**这个仓库自己的三个插件**（§2.1–2.3）和 **better-sidebar 的 README/types**（§1）。

**不适用在哪**：`REFERENCES.md` 里唯一还有价值的是"相机模式/拾取/层级排序"那几行思路，但 Phaser 已经接管了这些（D53/D56），且 `scene-phaser.js:12` 已经把"旧实现 → Phaser 对应 API"做成了一张对照表（`camera.getWorldPoint()` / `camera.worldView` / `sprite.setInteractive()`）。**要看相机，看那张表，不看 REFERENCES.md。**

---

## 3. Phaser 自带能力：引擎有的别手写

> 版本实测：`packages/dsh-agent-world/src/vendor/phaser/phaser.esm.min.js`，`grep -o "3\.[0-9]*\.[0-9]*"` → **3.90.0**（与 D53 记的"Phaser 3.90"一致）。

### 3.1 相机平移 + 跟随：现成链路，**已经在用**，且注释里记了三个坑

**结论**：`camera.pan(x, y, ms, ease, force)` + `camerapancomplete` 事件 + `camera.startFollow(sprite, roundPixels, lerpX, lerpY)` 是引擎现成的三段式：**先平移到位（带动画），到位后再接跟随（每帧 lerp）**。我们已经实现且真机验过，**R4 只需要接一下，不要重写**。

**证据**
- `packages/dsh-agent-world/web/scene/scene-phaser.js:1025` `const CAMERA_PAN_MS = 420`（注释："太短像瞬移，太长像卡住"）——**正好等于 PLAN §二(b) 的 420ms 判据**
- `:1033-1051` `startFollowSelection()`：`camera.stopFollow()` → `camera.off('camerapancomplete')` → `camera.once('camerapancomplete', ...)` → `camera.pan(sprite.x, sprite.y, CAMERA_PAN_MS, 'Sine.easeInOut', true)`
- `:1040-1042` 注释（**关键坑**）："⚠️ `pan()` 的第 6 个参数是**每帧**回调（内部 `_onUpdate`），**不是**"完成回调"。拿它当完成回调用，跟随会在平移的**第一帧**就接管"
- `:1054-1061` `stopFollowSelection()`：`stopFollow()` + `off('camerapancomplete')` + `camera.panEffect?.reset?.()`（"平移还没走完也要停：否则解锁后镜头仍会飘到那个人身上"）
- 引擎侧证据：vendor 里 `pan:function(t,e,i,s,n,r,o){return this.panEffect.start(t,e,i,s,n,r,o)}`，`camerapancomplete` 作为事件常量存在（`src/vendor/phaser/phaser.esm.min.js`，`indexOf('camerapancomplete')` 命中 `t.exports="camerapancomplete"`）
- 选中入口：`:964-970` `selectAgent(agentId)` → `selectedAgentId = agentId` + `syncSelectionRing()` + `startFollowSelection()`；导出在 ``:2304``
- 高亮圈也是引擎的：`:996-1015` `syncSelectionRing()` 用 `activeScene.add.ellipse(...)`，注释："**引擎的 Shape**…而不是自己画 / 贴图"

**我们该怎么用**：**R4 不要碰 `scene-phaser.js` 的相机代码。** 侧边栏卡片点击只需调到 `selectAgent(id)`（它顺手把高亮圈、跟随、解锁路径全走通）。验收用现成门面：`__agentWorldScene2d.selectAgent(id)` / `.following()` / `.camera()`（`web/main.js:487` 起的 `__agentWorldScene2d`）。

**不适用在哪**：`startFollowSelection()` 有一个我们**必须知道**的前置条件——它要求 `actorNodes.get(selectedAgentId)?.sprite` 存在（`:1035-1038` 早退）。也就是说**列表里点了一个"还没建出精灵"的 agent，镜头不会动，且不报错**。这不是缺陷（服务端快照里有的 agent 一定会有精灵），但侧边栏应该在**点不到的时候给可见反馈**（PLAN 支柱"失败可见" S3），而不是静默。

### 3.2 「点列表 → 聚焦」缺的那一环：`board.js` 的卡片点击没有往外回调

**结论**：`renderMembers()` 里 `head.addEventListener('click', () => select({kind:'member', id}))`，`select()` 只做三件（重画详情 / 刷状态 / 重画成员行 + `options.onSelect`），**`onSelect` 只上报 taskId**（member 一律上报 `null`）。所以**没有任何路径能让"点成员卡片"驱动相机**。现有的 `onMemberPick` 只挂在那个 💬 小按钮上（且它会**同时**打开对话面板）。

**证据**
- `packages/dsh-agent-world/web/ui/board.js:404` `head.addEventListener('click', () => select({ kind: 'member', id: row.member.id }))`
- `:936-946` `function select(next)`：`... options.onSelect?.(next === null || next.kind !== 'task' ? null : next.id)` —— **成员点击被折叠成 `null`**
- `:392-403` 💬 按钮：`talk.addEventListener('click', event => { event.stopPropagation(); options.onMemberPick(row.member.id) })`
- `packages/dsh-agent-world/web/main.js:148-161`：`onSelect: (taskId) => { boardSelection = taskId }`、`onMemberPick: (agentId) => { if (typeof scene2d.selectAgent === 'function') scene2d.selectAgent(agentId); openDialogueFor(agentId) }`
- 已有渲染骨架：`:363-390`（`renderMembers` 完整实现：`li.board-member` / `div.board-member-head` / `b` 名字 / `span.dim` 角色 / `span.dim` 状态 / `.active` 类）；`:187`（`ul.board-member-list`，在 `:196` `members.append(membersHead, membersList)`）
- CSS 已有：`web/styles/components.css:918-975`（`.board-members` `.board-member` `.board-member.active` `.board-member-head` `.board-chips`）

**我们该怎么用**（R4 的最小改动，且符合 D57）：
1. 在 `createBoard(options)` 的选项里加一个 `onMemberSelect(agentId)`（与 `onMemberPick` 并列，语义不同：**选中 ≠ 对话**）；
2. `:404` 那行改成 `{ select(...); options.onMemberSelect?.(row.member.id) }`；
3. `main.js` 里 `onMemberSelect: (agentId) => scene2d.selectAgent?.(agentId)`——**不带 `openDialogueFor`**（PLAN §二(d) 要求"同类动作只有一条路径"，点卡片 = 选中+聚焦，💬 = 对话，两条路径各管一件事）。

**不适用在哪**：**别把这个回调直接写成"点一下就开对话"**。README/注释里 R76 记过一次同样的问题——`board.js:390-391`："R76：花名册删掉之后，「点成员对话」的入口移到看板成员卡上——一个独立的小按钮，与「点成员选中看任务」分开，**避免点谁就弹对话**"。R4 沿用这条结论。

### 3.3 相机聚焦的另外两个现成选项：查过、都不该用（避免 designer/developer 重新踩）

**结论**：引擎还有 `camera.centerOn` 与 `camera.zoomTo`，但**本轮两个都不用**。唯一被真机验过的组合是 `pan` + `camerapancomplete` + `startFollow`（§3.1），侧边栏就复用它。

**证据**
| API | 在不在 | 证据 |
|---|---|---|
| `camera.centerOn(x, y)` | 在 | `scene-phaser.js:441`（`camera.centerOn(0, 0)`，配 `centerOnNextApply` 标志位才调） |
| `camera.zoomTo(zoom, ms, ease)` | 在，但我们踩过坑 | `scene-phaser.js:468`（注释里列出带缓动的缩放 API）、`:496-520`（"我原来用 `camera.zoomTo(target, 180, 'Sine.easeOut')`，真机上排查了很久…`camera.zoom` 读出来**始终是 1**"）→ 现在换档用 `camera.setZoom(target)` 直设（`:519`） |
| `Cameras.Controls.FixedKeyControl` / `SmoothedKeyControl` | 存在，但本轮不引入 | `docs/ARCHITECTURE.md:518`（D56 记的 R64 教训原文："不确定某个 API 存不存在就去浏览器里 `import('phaser')` 逐个验，别靠记忆猜…实际 `FixedKeyControl`/`SmoothedKeyControl` 都在"） |

**我们该怎么用**：聚焦**只走 §3.1 那条**。`centerOn` 留给"复位/初帧居中"（它现在就是这么用的，`scene-phaser.js:441`）；`zoomTo` 本 build 缓动不落地，换档一律 `setZoom`；键盘控制器不引入。

**不适用在哪**：
1. `centerOn` 是**瞬移**（无插值），与 PLAN §二(b) 的"420ms 内平移到该 agent 居中"判据直接冲突——用它就没有动画。
2. `zoomTo` 的缓动结果**不落到相机**（R65 真机实测），也就是说写上去看起来"调了"，实际 `camera.zoom` 不变——这是最坏的一类失败（静默）。
3. `FixedKeyControl`/`SmoothedKeyControl` 会与我们已有的按键归属规则打架：现在 WASD 的归属由 `movementEnabled` + `isTextInputFocused()` 决定（`scene-phaser.js:1085-1095`，注释原话："否则 WASD 一边进输入框、一边推相机/推角色，就是两套在抢同一批按键"），再加一个引擎控制器就是**第三套**读同一批按键。PLAN 支柱"稳定"里最忌讳的正是这个。

### 3.4 容器与尺寸：侧边栏出现后画布会自动跟着变（`Scale.RESIZE`）

**结论**：**侧边栏把舞台挤窄，不需要我们调任何尺寸**。`Scale.RESIZE` 监听父容器尺寸，自动同步绘制缓冲区。这正是 R65 换掉"手调 `game.scale.resize()`"换来的能力。

**证据**
- `packages/dsh-agent-world/web/scene/scene-phaser.js:2209-2219`：`scale: { mode: Scale.RESIZE, parent: live.canvas.parentElement ?? undefined, width, height }`；注释（`:2209-2218`）："原来是 `Scale.NONE` + 我们自己调 `game.scale.resize()`…真机实测漏了一次：**画布的绘制缓冲区是 1227×409，而 CSS 显示尺寸是 1227×669**…现在交给引擎：`RESIZE` 会监听父容器尺寸并同步画布缓冲区"
- `:2123-2128`：`resize()` 里**明确禁止**再手调 `game.scale.resize()`
- 布局现状：`web/styles/layout.css:11-18`（`.app { display: grid; grid-template-rows: 48px 1fr 36px; height: 100vh }`）——**只有行定义，没有列定义**；`:133-140`（`.stage { position:relative; overflow:hidden; min-width:0; min-height:0 }`）；`:141-147`（`#town { position:absolute; inset:0; width:100%; height:100% }`）
- `web/index.html:33-34`（`.app` 直接包 `header.topbar` / `main.stage` / `footer.footer`），`:76`（`<main class="stage" id="stage">`）

**我们该怎么用**：侧边栏有两种落法，**都能自动适配**：
- **推荐**：给 `.app` 加 `grid-template-columns: 1fr var(--sidebar-w)`，把 `<aside>` 作为 `.app` 的第 4 个子节点。`.stage` 变窄 → `#town` 的父容器变窄 → `Scale.RESIZE` 自动跟（`scene-phaser.js:2219`）。
- **备选**：`<aside>` 绝对定位浮在 `.stage` 上（像现有的对话面板 `.dialogue`，`layout.css:169-176`；以及缩放/图例那一簇 `.view-controls`，`components.css:347`）。**优点**：零布局风险；**缺点**：遮挡场景（PLAN §二(a) 的目标是"侧边栏 = 唯一的交互面"，遮挡会削弱它）。

**不适用在哪**：**别在侧边栏展开/收起时手动调 `game.scale.resize()` 或改 canvas 的 CSS 尺寸**——`scene-phaser.js:2126-2127` 明确写了那会让引擎走一遍 resize 流程、真机表现是"缩放被重置"（用户刚拖好的视野会被打回）。同理，别给 `#town` 换父节点。

### 3.5 输入：`setInteractive` + `pointerup` 的现成判据（本轮的"交互简化"依据）

**结论**：引擎的 `pointerup` 已经带了"这次是不是拖拽"的判据：`pointer.getDistance() > 5` 就忽略。我们**自己不再记 downX/downY**。交互收敛（PLAN §二(d)）应该建立在这条已有的判据上，而不是再加一套手势识别。

**证据**
- `packages/dsh-agent-world/web/scene/scene-phaser.js:1623-1631`：`entry.sprite.setInteractive({ useHandCursor: true })` + `entry.sprite.on('pointerup', pointer => { if (pointer.getDistance() > 5) return; ... selectAgent(actor.id) })`（`:1630`）
- `:648-659`：`scene.input.on('pointerup', pointer => { const wasDrag = pointer.getDistance() > 5 ... })` + `pointerupoutside`
- `:627`（"点在角色上：不进入拖拽（否则'点人'会变成'拖地图'）"）
- 设计侧已有 `docs/DESIGN-interaction.md`（311 行，designer 的产出）

**我们该怎么用**：侧边栏是 **DOM**，点击用 DOM 的 `click`；场景是 **canvas**，点击用 Phaser 的 `pointerup` + `getDistance`。**两套输入不互相模拟**——不要写"侧边栏点击去构造一个 Phaser pointer"。

**不适用在哪**：`docs/DESIGN-interaction.md:218` 有一条判据值得侧边栏照抄："**焦点是浏览器自己的真相**…引擎直接读它就不会有两份状态"（D56 在输入域的体现）。侧边栏的键盘事件也应该用 `document.activeElement` 判"在不在输入框里"，而不是自己维护 `isTyping` 布尔量——`main.js:573-574`（`keydown` 里读 `activeElement.tagName`）已经是这个写法。

---

## 4. 给 R2 / R3 / R4 的落点建议（可直接照做）

| 轮次 | 建议做法 | 不要做什么 | 证据锚 |
|---|---|---|---|
| **R2 骨架** | 新建 `web/ui/sidebar.js`（`el()` 从 `board.js` 抄一份还是导出共享，由 developer 定）+ `web/styles/sidebar.css`；`<aside id="sidebar">` 作为 `.app` 的第 4 个 grid 子节点；两档视图用 `role="tablist"`（照 `index.html:116-119` 现有的 `.dialogue-modes` 写法） | 不要引 React；不要新增 `dsh.client`；不要动 `#town` 的父节点 | §3.4 / §2.2 |
| **R3 搬看板** | 把 `createBoard()` 的**成员列表**从"看板展开浮层里"改为"侧边栏里"：`parts.membersList` 那块（`board.js:187`）的**容器由外部给**。做法上把 `options.root` 之外的第二个挂载点暴露出来（例如 `options.membersRoot`），**`renderMembers()` 本身一行不改** | 不要复制一份 `renderMembers` 到 `sidebar.js`（PLAN §二(a) 红线："同一份渲染代码"）；不要把 `#board` 从 header 删掉的同时留个残缺的摘要条 | §2.1 / §2.3 |
| **R4 聚焦** | `board.js:404` 那行加一个 `options.onMemberSelect?.(row.member.id)`；`main.js` 的 `createBoard({...})` 里接 `onMemberSelect: (id) => scene2d.selectAgent?.(id)` | 不要碰 `scene-phaser.js` 的 `startFollowSelection`；不要用 `centerOn`（无动画）或 `zoomTo`（本 build 缓动不落地）；不要在卡片点击里顺带开对话面板 | §3.1 / §3.2 / §3.3 |

---

## 5. 结论摘要（给 Leader 看的三句话）

1. **侧边栏挂页面内 `<aside>`**：本包**没有客户端半体**（`package.json` 的 `dsh` 只有 `bundle.patch`），挂 DSH tab 要先造 `lib/client.js` + `dsh.client`，而且 React 组件 + iframe 会让"点列表 → 动相机"变成跨文档消息（spellbook `client.js:49-59` 那套 requestId + 回执）。**收益为负。**
2. **渲染复用 `board.js`**：`renderMembers()`（`:363`）、`.board-member*` CSS（`components.css:918-975`）、`el()/svgEl()`（`:63/:70`）全都在，缺的只是"容器可以由外部给"。**别重写。**
3. **聚焦复用 `selectAgent`**：`scene-phaser.js:964 → 1033 → 1043/1050` 那条 `pan` 420ms + `camerapancomplete` + `startFollow` 链路是真机验过的唯一组合；缺的只是 `board.js:404` 往外一个 `onMemberSelect` 回调。**别新写相机动画。**

**本地参考 `REFERENCES.md` / `REFERENCE-openclaw-office.md` 对本轮不适用**（three.js 时代 + 美术/行为话题），§2.4 已逐条给出证据。

---

## 6. 取证指纹（PLAN §六.3：不记版本，"验证通过"验的是哪个版本都不确定）

行号会漂（本文件写完后 `web/scene/scene-phaser.js` 就被并行 Agent 动过一次，整体后移约 26 行）。
下面是**本文所有行号对应的磁盘快照**（`shasum -a256` 前 16 位）：

| 文件 | sha256[:16] |
|---|---|
| `web/ui/board.js` | `61750766c187753e` |
| `web/main.js` | `55eeed234fd31e8a` |
| `web/scene/scene-phaser.js` | `3a792ead434cc8c8` |
| `web/styles/layout.css` | `18301daef7ef5ab1` |
| `web/styles/components.css` | `867aea77b61b0a8a` |
| `web/index.html` | `f7680ec7993ad0e0` |
| `src/config.ts` | `bc21b4397489d94a` |
| `src/routes/panel.ts` | `f1263b9591dd86b1` |

⚠️ 若 developer 开工时这几个哈希已变，**行号要重新 `grep` 定位，别照抄**——但结论（三种"别自己写"）不受影响，因为它们依赖的是**这些实现存在**，不是行号。

外部取证（不改动，故只记版本）：`dsh-better-sidebar@0.25.0`（`~/.dsh/profiles/web/package.json` 实测）；`phaser 3.90.0`（`src/vendor/phaser/phaser.esm.min.js`）。
