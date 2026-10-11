# 咒语书 · 从「一个侧边栏站点」到「对话里随时可用」

这份文件是**定时开发任务的唯一计划入口**。每轮开工先读它，收工前改它。

---

## 一、终局要什么（用户原话拆成的四条验收）

| # | 验收 | 判定方式 |
|---|---|---|
| A | **侧边栏可以预览** | 右侧栏「咒语书」tab 里能翻 332 条咒语，预览是真跑的（不是截图/录屏） |
| B | **点击可以查看** | 从侧边栏点一条 → 直接看到那一条的详情（描述 / 图版 / 代码 / 边界），不用手动找 |
| C | **随时可以应用到 dsh 对话里** | 侧边栏里点「应用」，这段咒语的任务书当场进当前会话的输入框（可选择再编辑，或直接发） |
| D | **可以被引用自动实现** | 在对话里提到一条咒语（`@` 引用 / `/spell` / 或模型自己去查），模型自动拿到机制与边界并按**对方项目那套栈**实现 |

各处现状（2026-10-12）：

| 验收 | 现状 | 还差什么 |
|---|---|---|
| A | ✅ 已成立 | 无 |
| B | 大半（条目页在侧边栏里已能正常呈现：embed 跨页记住了） | 深链 `?spell=<slug>`（M3-2） |
| C | ✅ 已实现，站点侧真浏览器验通 | 宿主侧插进输入框那一下，待真 GUI 验 |
| D | 大半（`spellbook_lookup` 已实现、10 条测试全绿） | 真机验「模型会不会主动用」；深链 / `/spell` / `@` 是另外三条路 |

A 已经成立。C 在 2026-10-12 那轮做完了（站点侧已在真浏览器里验通）。
D 的宿主 Tool 也做完了（`spellbook_lookup`）。B 只差深链。

---

## 二、现状（recon 结论，别重做）

- **宿主** `src/plugin/index.ts`：只做一件事——把 `dist/` 挂到 `/dsh-spellbook/` 前缀。
  路径规范化后判越界、只认 GET/HEAD、`no-store`。**完备，本轮不用动。**
- **客户端** `src/plugin/client.js`：只是 iframe + 主题 postMessage（`dsh-spellbook-theme`）。
  **它对「应用」一无所知**——这是最大的一块空白。
- **站点** `src/site.js`：已有 `copyText()` 一键复制（写剪贴板）。
  `postMessage` 只用于**接收**主题（站内 259 行 `doc.contentWindow.postMessage` 是往外层预览文档发的）。
  **站点没有向宿主回话的出口**——C 的缺口就在这。
- **咒语文本** `shared/prompt.mjs` 的 `buildPrompt()`：已经是给 AI 的任务书（效果 / 机制 / 边界 / 示例），
  每条同时落在 `dist/spell/<slug>/prompt.txt`。
  **复用这一份，绝不在插件里另拼一个版本**——那会变成第二个真相。
- **隔离底线**：332 个预览文档靠 `sandbox="allow-scripts"` 隔开；
  外层那个 iframe **故意不加 sandbox**（嵌套 sandbox 往下取并集，外层写 `allow-same-origin` 会把预览的同源隔离一并撤掉）。
  `test/plugin.test.mjs` 钉住了这条，**不许为了让新功能好写而放宽**。

---

## 三、关键 API 事实（本轮 recon 的收获，照抄，不要再摸一遍）

### 3.1 把文本送进对话 —— `conversation.input.left` 的 `inputActions`

这是「应用到对话」的官方入口。客户端 slot `conversation.input.left`
（`purpose: "Compact controls at the left of the composer tool row."`，
`scope: session`，注册字段 `{id, order, label?}`，`replaceRisk: none`）
的 standard props 里带 `inputActions: InputActions`：

```js
inputActions = {
  captureInsertion: () => ({ ...caretSpan, draftRev }),   // 抓当前选区 + 草稿版本
  insertText: (text, span) => boolean,                    // 版本一致才插；一次可撤销的纯文本编辑
  setDraft: (text) => void,                               // 整段替换
  addAttachments: (ids) => void,
  removeAttachment: (id) => void,
  pruneAttachments: (ids) => void,
  submit: () => void,                                     // 发送
}
```

行为约束（原文）：`insertText` **仅在 `draftRev` 未变且编辑器允许编辑时**生效，返回 `false` 就是被拒；
`adjudicating` / `submitting` / `disposed` 三种相位下一律拒绝。
——所以**异步拿到文本后不能想当然地插**：要么当场 `captureInsertion()` 拿新鲜 span，
要么把被拒的结果留成给用户手动点的按钮。**插入被拒必须可见，不许静默。**

### 3.2 其它已确认的接口

- **侧边栏** `dsh-better-sidebar@0.19.1`（web profile 装的版本）：
  `registerTab(spec)` / `openTab(seed, scope?)` / `activateTab(tabId, scope?)` / `closeTab`。
  现有注册：`{id:'spellbook', title:'咒语书', order:26, single:true, icon, component}`。
- **站点深链**：站点是目录式路由 `/dsh-spellbook/spell/<slug>/`，
  加 `?spell=<slug>` 这种深层参数在站点侧解析即可（B 的抓手）。
- **斜杠插入事件**：客户端有 `slash/input-insert-text`（`{text, span, continue}`）——
  D 的第二条路（`/spell <slug>`）可以挂这里。
- **引用装饰**：composer 内部有 text-ref lexicon（"No-pipeline lexicon: zero text-ref decorations"）——
  即 `@` 引用的渲染层。D 若要真做成 `@` chip 得碰这里，**优先级低于 3.3**。

### 3.3 D 的最稳一条路：宿主侧 Tool

模型本来就会调工具。所以「引用即用」落地最稳的形态是**宿主注册一个 Tool**，
让模型在用户说「用咒语 neon-glow」时能自己取到那份任务书。这不需要碰 composer 内部渲染。
两个候选 Tool：`spellbook_lookup`（按关键词/slug 查，返回 prompt 全文）与 `spellbook_list`（按类别列）。

---

## 四、里程碑（按此顺序做，M1→M2 是主线）

### M1 · 架桥：站点 → 宿主

- 站点侧：条目面板加「应用到对话」按钮，`window.parent.postMessage({type:'spellbook:apply', slug, mode:'insert'|'send'}, origin)`。
- 宿主侧：`client.js` 监听 `message`，**只认自己那个 iframe 的 `contentWindow` 与本站 origin**（现在 `entryUrl()` 用的是相对路径，origin 对比要写对）。
- **回执**：插入成功/被拒后回一条消息给站点，站点上显示出来。没有回执的桥等于没有桥。
- 验收：`test/plugin.test.mjs` 里新增协议形状测试（消息类型、必需字段、拒绝非法来源）。
  手动端到端：侧边栏里点一次，输入框里真的出现那段咒语。

### M2 · 应用：接进 composer

- 客户端注册 `conversation.input.left` 一个「咒语书」按钮（`order` 取 10 之后的空位，别抢 `prompt-library` 的 10/11）。
- **难点是跨注册的通道**：侧边栏 tab 与 composer 按钮是两次独立 `register`，不在同一棵组件树里。
  需要一个模块级的 `pendingApply` 总线（含订阅），侧边栏写、composer 侧读并调 `inputActions`。
  这是本里程碑真正的设计重头，**先写这条通道再写 UI**。
- 两个动作要分开：**插入**（进输入框，用户可改再发）与**直接发送**（`submit()`）。
- `insertText` 返回 `false`（版本变了/正在提交）时：重取 `captureInsertion()` 重试一次，仍失败就留成按钮提示用户。
- 验收：侧边栏 → 应用 → 输入框出现 → 可编辑 → 发送成功。两种模式都过。

### M3 · 引用即用（D）

按性价比做，做完一条再做下一条：

1. **宿主 Tool**（见 3.3）——最稳，且不需要动 composer 内部。需要读 `content/effects/*.md` 或构建产物。
2. **站点深链** `?spell=<slug>` + 侧边栏内跳转（B 的收口）。
3. **`/spell <slug>`**（挂 `slash/input-insert-text`）。
4. **`@` 引用 chip**——最贵，最后做，做不动就如实记下。

### M4 · 收口

- 端到端一条线：侧边栏点开 → 看详情 → 应用 → 进对话 → 模型照机制实现。
- 每轮收工：`npm test`（`node --test test/`）、`npm run typecheck`、必要时 `node build.mjs`。
- **真 GUI 里验一次**（见第六节）；验不了就如实写"未验"，不许拿"测试过了"顶替。

---

## 五、不变量（破坏任何一条都算这轮白做）

1. 外层 iframe **不加 `sandbox`**；产物里**不许出现 `allow-same-origin`**。
2. 咒语文本**只有 `shared/prompt.mjs` 一个来源**；站点复制的、prompt.txt、送进对话的必须是同一份。
3. 宿主只端 `dist/`，不在插件里重新渲染站点（第二套渲染器 = 第二个真相）。
4. 路径不许出 `dist/`；只认 GET/HEAD。
5. 失败必须可见——插入被拒、协议不合法、工具查不到，都要报出来，不许静默 catch 掉。
6. 不改 `dsh-better-sidebar` / DSH 本体，只用自己的 slot 与 service。

---

## 六、验真 GUI（2026-10-12 已接通，别重装）

**你看的那个 GUI 是桌面端 Electron，走的是 `desktop` profile**（不是 web）。
接通方式已就位，**不要重装、不要重跑 install**：

| 环节 | 状态 |
|---|---|
| `~/.dsh/profiles/desktop/package.json` | `dependencies` 加 `"dsh-spellbook": "link:/Users/kp/DEV/dsh-plugins/packages/dsh-spellbook"`，`dsh.profile.bundles` 加 `"dsh-spellbook"` |
| `~/.dsh/profiles/desktop/node_modules/dsh-spellbook` | 手工软链 → 本地包（**等价于 `link:` 语义**） |
| 备份 | `package.json.bak-spellbooklink-20261012-004124`（要回退就换回它 + 删软链） |
| 解析验证 | 已验：`require.resolve('dsh-spellbook')` 从 profile 里解析到 `lib/index.js` ✓ |

**⚠️ 千万别在 `~/.dsh/profiles/desktop` 里跑 `pnpm install`。**
那个 node_modules 是 `pnpm@10.18.3` 用一个**已经不存在的临时 store** 装的
（记的是 `<repo>/.tmp-desktop-upgrade/.pnpm-store/v10`），换任何别的 pnpm 都会要求
`Aborted removal of modules directory` —— 也就是把 400 多个包全部清空重装，
那会把正在跑的 app 弄坏。**改依赖只能手改 package.json + 手建软链。**

于是本地改动**经软链直接进 GUI**：改 `src/` → 重建 `dist/`/`lib/` → 刷新页面就能看到。
路径别再往 web profile 上想（那边装的是注册表拷贝版，跟这里无关）。

**验的步骤**：桌面端重载一次 → 右侧栏「+」里应出现「咒语书」→ 点进去能翻条目。
重载之后 profile 的 `cordis.patch.yml` 里才会合成出 spellbook 那段（现在还没有）。

---

## 七、每轮工作循环（定时任务照这个走）

每个窗口只做**一件能独立验收完的事**：

1. `git -C /Users/kp/DEV/dsh-plugins status --short -- packages/dsh-spellbook` —— 确认上一轮收干净了。
2. 读本文件，取**最靠前的未完成项**（M1 → M2 → M3 → M4）。
3. 做。改前先读要改的文件。
4. `npm test` + `npm run typecheck`（在 `packages/dsh-spellbook/` 下）。
   **基线（2026-10-12 测过）：`npm test` 188/188 通过、`typecheck` 干净。**
   这两条现在都跑得起来了：本包自己的 devDeps（`@types/node`、`typescript`、`@deepseek-ai/cordis`）
   已经用 `pnpm install --ignore-workspace --no-lockfile` 装进 `packages/dsh-spellbook/node_modules`，
   与根 workspace 隔离（根里只有 tsdown + typescript，没碰过）。**别在根目录跑 `pnpm install`。**
5. 能验就真 GUI 里验一次；验不了写下"未验 + 为什么"。
6. `git add packages/dsh-spellbook && git commit`，**只提交本包**（工作区里还有别的包 49 个文件的未提交改动，别顺手扫进来）。
7. 回来改本文件：做完的打勾、新发现的坑补进第三节、下一步写清。

**改不动的时候**：把卡点写进这份文件的末尾「卡点」一节，宁可留下一条清楚的路障，也不要造一个没验过的半成品。

---

## 八、进度

- [x] **M1 架桥：站点 → 宿主**（postMessage 协议 + 回执 + 测试）—— 2026-10-12 完成，与 M2 一并做的
- [x] **M2 应用：接进 composer**（跨注册通道 + 插入/直接发送）—— 同上
- [x] **M3-1 宿主 Tool：`spellbook_lookup`** —— 2026-10-12 完成（宿主侧在真 GUI 里接入仍待验）
- [ ] M3-2 站点深链 `?spell=<slug>` —— 优先级低（B 已被「行内跳转 + embed 已记住」覆盖）
- [ ] M3-3 `/spell <slug>` —— **暂缓**，查清了：没有可注册的命令 API（理由见下）
- [ ] M3-4 `@` 引用 chip —— 最贵，最后做；D 已由 M3-1 的 Tool 覆盖
- [ ] M4 端到端收口 + 真 GUI 验证（**卡在重载**，见第九节）

### 已完成的两步，各自钉在哪

**M1+M2 合成一步做完了**，因为只有桥没有消费者的话，这条路上没有任何东西可验 ——
回执存在的全部意义就是告诉站点「插进去了没有」，而没人插的时候它只能一直回 no-sink。

- 站点出口：`src/site.js` 的 `initApply()`。请求带 `requestId`，回执按 id 对上，**超时也算失败**
  （4s），失败文案分原因（宿主没应 / 没有会话 / 插入被拒 / 请求被拒 / 取咒语失败）。
  失败比成功多留一秒（2.6s vs 1.6s），因为它更需要被看见。
- 宿主入口：`src/plugin/client.js` 的 `handleApplyMessage()`。三重校验 —— 来源必须是侧边栏那个
  iframe（宿主页面上还有 300 多个同源的预览文档）、原点必须是本站、载荷形状必须对。
- 那条**跨注册通道**：`spellbookFrame` 与 `composerSinks` 两个模块级变量。侧边栏 tab 与
  composer 槽位注册在树上两个互不相干的位置，却跑在同一个模块实例里 —— 原先以为这里要
  写一条外部总线，实际上不需要。这是本功能唯一一处隐式耦合，已写在代码注释里。
  **`composerSinks` 是栈不是单个变量**：那个槽位是 session 作用域的，分屏或同时开着
  两个会话就有两个实例；用单个变量时，任何一个卸载都会把 sink 置空，另一个明明还活着 ——
  表现是「点应用回『没有会话』，可会话就开着」。栈是「谁在最后谁说话」，而切会话时
  `actions` 变了、effect 重跑，当前那个会被重新推到栈顶，正好就该它说话。
- composer 槽位 `spellbook-apply-seat` **不画任何东西**：它的全部价值是 props 里的 `inputActions`。
  在输入框旁边再摆一个按钮等于把同一件事做成两个入口，而那个入口只能列 slug、看不了东西。
- 插入被拒会**重取一次 span 再试**（`captureInsertion()` → `insertText()` ×2），
  一次就放弃会让「点了没反应」变成常态。

**顺带修掉一个挡住 B 的既有 bug**：站内导航丢查询串，条目页因此丢掉 `?embed=1` ——
那截「书封」刊头会重新冒出来、明暗也不再跟宿主。现在 embed 记进 `sessionStorage`
（按标签页/iframe 隔离，另开标签页看站不受影响）。**没有这一步，条目页上的应用按钮
根本不会出现**（它和其余嵌入态样式共用 `:root[data-embed]` 这条判据）。

**验证**：新增 `test/apply.test.mjs` 8 条，全绿（总 196）。另外在真浏览器里起 `serve.mjs`、
造了一个同源宿主 iframe 跑通了整条站点侧路径 —— 点「应用到对话」发出的确实是那份 2459 字的
`prompt.txt`，回 `ok` 时按钮显示「已进输入框」、回 `rejected` 时显示「插入被拒」。
**宿主那半边（真的插进输入框）仍未在真 GUI 里验过** —— 需要重载 App，留给下一轮。

**注意 `dist/` 与 `lib/` 都是 gitignore 的**：改完 `src/` 必须 `npm run build`，
否则 GUI 里读到的还是旧产物（它读的就是这两个目录）。`npm test` 现在会先跑
`build:plugin`（编译 + 拷 client.js）—— 因为测试读的是 `lib/`，不重建就会拿旧代码
测出一片**假绿**。改到站点（`src/site.js` / `src/render/` / `src/styles/`）时，
`npm run build` 全量构建仍然要自己跑，`npm test` 不含这一步。

---

### M3-1 宿主 Tool（2026-10-12）

新增 `src/plugin/tool.ts` + `test/tool.test.mjs`（10 条）。要点：

- **检索复用站点那一套**：`dist/rank.mjs` 的 `buildIndex` + `rank`，配
  `dist/search-index.json`。不另写打分 —— 「你在侧边栏搜到的是这条、模型拿到的
  却是另一条」是没人会发现的一类不一致。测试里独立跑一遍 rank 作对照。
- **slug 全等要短路**：`RANK_COLUMNS` 是
  `['title','when_text','tags','mechanisms','code_text','description']` —— **没有 slug 那一列**。
  所以「用咒语 neon-glow」这种最典型的引用形式走检索是搜不到的。测试钉住了前提本身
  （断言 rank 搜不到 slug），哪天 RANK_COLUMNS 变了会有人被叫醒。
- **正文取 `dist/spell/<slug>/prompt.txt`**，与站点「抄咒语」抄走的是同一份文件。
- **手写 ToolDefinition，不 import `@deepseek-ai/dsh-tools`**。理由写在 tool.ts 顶部：
  `defineTool` 只是便利封装（注册表收的就是裸 JSON Schema），而它是**静态 import** ——
  解析不到就会让宿主半边整个挂掉，连 `dist/` 那条路由一起没。同仓库的
  `dsh-mermaid-comm` 确实静态 import，但它装在 desktop profile 的 `dependencies` 里、
  却**不在 `dsh.profile.bundles` 里，从没被加载过**，证明不了这条路走得通。
  代价是参数校验自己写了十几行，换来的是：那个 import 成不成立，书都照样能看。
- `tools` 按**可选服务**取（`ctx.get('tools')`），取不到时 `console.warn` —— 不静默。

#### 一个反直觉的发现：分数高低说明不了相关性

实测（这是设计依据，别丢）：

| 查询 | 最高分 | 命中依据 |
|---|---|---|
| `一个绝对不存在的效果词牌` | **58.5**（hamburger-morph） | 机制：「三条线共用同一个**绝对**定位原点…」 |
| `发光` | **4.2**（neon-glow，正确的那个） | 标签：「发光」 |

罕见词「绝对」撞上「绝对定位」，让一条毫不相干的咒语拿了 13 倍的分。
所以**任何分数阈值都是错的解法**。现在的做法是把 `rank` 的 `why` 交给模型：
候选行末尾带「命中：标签「发光」」/「命中：机制「…绝对定位…」」。
`render` 出的是前者，`hamburger-morph` 那条一眼就能看出不对。

后续若有人想「优化相关性」，先回来看这张表。

#### 修掉一个静默的假否定（2026-10-12 第二个窗口）

`category` 参数原本是自由字符串，而 `rank` 的章节过滤是**精确相等**
（`rank.mjs:147`：`if (category && doc.category !== category) continue`）。
于是「材料」这种一字之差会让结果直接变 0 条 —— 模型只会看到「库里没有」，
然后得出「这库办不到」的结论。**这是最坏的一种错：不报错的假否定。**

现在三条路都兜住了：

| 情况 | 行为 |
|---|---|
| 章节名对不上 | 按全书查，并把真实章节名（现算的）一起交出去 |
| 章节名对、那一章里没有 | 给全书候选，并说清这不是它要的那一章 |
| 章节名对、也有 | 正常筛，不加多余的话 |

章节名单**只有构建产物一个来源**（从 `search-index.json` 的 docs 现算），
代码里不写死 —— 有一条测试专门守着「那六个名字不许连成一串出现在 tool.ts 里」。
描述里只举例（「比如『材质』『动效』」），因为举例是提示，名单是数据。

#### 修掉一个自己造出来的回归 + 应用入口挪到检索结果里（2026-10-12 第三个窗口）

**回归**：第 2 轮把 `initPromptCopy` 改成只读 `data-prompt-url`（理由是地址由模板给，
不在 JS 里按 slug 拼 —— 目录页与条目页深度不同），**却漏了 `site.js` 里检索结果
那一个按钮**。它在浏览器里 `fetch(undefined)` → 404 → 显示「没取到」，不报错。
当时的测试只断言了模板那一处，所以没拦住。

现在有一条**扫所有按钮出现处**的测试（`src/site.js`、`src/render/pages.mjs`、
`dist/index.html`、条目页产物）：凡带 `data-prompt=` / `data-apply=` 的按钮，
必须同时带对应的 `-url` 属性。这类「靠约定配对的属性」就该这么守。

**顺带把应用入口放进了检索结果**（`.hit-tools` 里第三个按钮）。理由：
检索是这本书的主用法（「说一句你要什么 → 找到那条 → 抄走」），而原先要应用
必须点进条目页 —— **一离开，检索结果就没了**。现在 `.hit-tools` 是
`预览 / 抄咒语 / 应用` 三个，按钮组本来就存在，加第三个不动排法。

**真浏览器验过两遍**（dev server + 同源宿主 iframe）：
- embed 下搜「发光」→ 17 条命中 → 首条的三个按钮齐全，`data-prompt-url` 与
  `data-apply-url` 都在 → 点「应用」发出的确实是那份 1079 字的 prompt，回执 ok 后
  按钮显示「已进输入框」。
- 独立打开（清掉 sessionStorage 后、无 `?embed=1`）→ `apply` 是 `display: none`
  且不占位，而「抄咒语」仍是 `block` —— 抄录在哪都有用，应用只在能应用的地方出现。

#### 应用入口第三处：放大预览对话框（2026-10-12 第四个窗口）

目录的每一行仍然没有直接的应用按钮（理由见上一节末尾：卡片竖排 flex 与条列三列网格
两套排法都动不得）。但**放大预览对话框**给了目录一条不用点进条目页的路：
回到目录 → 点缩略图 → 看活的预览 → 应用。

对话框全书共用**一份**（`renderIndex` 里那一个 `<dialog>`），所以 slug 与取址由
`initPeek` 在打开那一刻填 —— 并且必须把上一条留下的「已进输入框 / 插入被拒」
清掉，否则下一条会顶着上一条的结果开场。这两件都验过（见下）。

顺带挡了一个安静送错东西的陷阱：模板里那个按钮的取址先空着（等 `initPeek` 填），
而 `fetch('')` 会把**当前这一页**（HTML）当成咒语送出去，且那是 200、不报错。
现在 `initApply` 见到空取址直接报「没配地址」，不 fetch。

**真浏览器验过两遍**（dev server + 同源宿主 iframe）：
- embed 下打开第 1 条 → 标题「半透明叠层」、按钮启用、取址
  `spell/layered-translucency/prompt.txt` → 点它发出那份 2459 字的 prompt，
  按钮显示「已进输入框」；关掉再打开第 4 条 → 标题与取址都换成了
  `relative-color-alpha`，**文案回到「应用到对话」、`is-done` 也清掉了**。
- 独立打开（清掉 sessionStorage、无 `?embed=1`）→ 按钮 `display: none`、
  占位 0，而「看这一条的全文」照旧，无横向溢出。

**不变量清单也扩了**：那条「凡带取址属性的按钮必须成对」的测试原来按 `data-apply=`
（带等号）找，会**跳过**对话框里那个裸 `data-apply` 的按钮 —— 而它恰好是最需要守的
（取址是运行时才有的）。改成按属性名判存在（结尾必须是 `=` / 空白 / `>`，
否则 `data-apply` 会把 `data-apply-url` 也算命中）。现在四份文件、341 个按钮全覆盖。



#### 「抄咒语」这条路补验（2026-10-12 第五个窗口）

这是第 2 轮改过取址、却一直只验了「属性在不在」的那条路。补验结论：

| 验的什么 | 怎么验的 | 结果 |
|---|---|---|
| `prompt.txt` 取得到吗 | 页内直接 fetch | ✅ 200，2459 字，开头就是「任务：把…」 |
| 目录行的「抄咒语」 | 脚本点击 | ✅ 标签走 抄咒语 → 取… → **已抄走** → 复位（**真点击**才算，见下） |
| 检索结果的「抄咒语」 | 脚本点击 | 取址对（`spell/neon-glow/prompt.txt`），但标签停在「没抄成」 |

**「没抄成」不是 bug，是脚本点击没有用户手势。** 换成真点击（CDP 输入）之后
标签是「已抄走」。这条区分很有用：`没取到` = 取址错，`没抄成` = 取址对但剪贴板被拒。
两个标签分开，才让上面那次判断有依据。

**侧边栏里那一下没直接点过**（工具点不进 iframe 内部），但前提逐个查过：
同源 iframe 的 `permissionsPolicy.allowsFeature('clipboard-write')` 是 **true**，
那份文档 `hasFocus()` 也是 **true**，而顶级页面上的真点击已验证能抄走。
所以判断是「应当成立」，不是「已验」—— 记在这里免得下次当成已验。

**老代码里的这个区分值得学**：一个动作失败时，把「取不到」和「拿到了但用不了」
分成两句话。合成一句「失败」的话，上面那次判断就只能靠翻源码了。

#### 目录每行加应用按钮：**决定不做**（2026-10-12 定）

前后按住过三次，现在可以关掉这个议题了：

放大预览对话框那个入口（第四个窗口做的）已经把「在目录里不点进条目页就能应用」
这件事解决了 —— 点缩略图 → 看活的预览 → 应用。再加一个行内按钮，多出来的价值
只是「少点一次缩略图」，而要动的却是两套排法（卡片竖排 flex 与条列三列网格），
`.row-copy` 的 `margin-top:auto` 与 `order` 正是它们的关键。

**要重新考虑的话**，先读「侧边栏尺寸下的实测」那一节；两套排法的写法都在那里。
连怎么写也记下来了：把 `.row-copy` 与新按钮收进一个 `.row-tools`，卡片下给它
`order:3; margin-top:auto; align-self:flex-end; display:flex`，条列下它自然成为
第三格 —— 与 `.peek-actions` 同一手法。但**前提是先有实测条件**。



#### 还没做的

- **`/spell <slug>`（M3-3）暂缓，理由已查清**：客户端只有 `slash/input-begin-command`、
  `slash/input-consume-token`、`slash/input-insert-reference`、`slash/input-insert-text`、
  `slash/popup` 这几个**内部事件**，没有可注册的 slash 命令 API（客户端 Service 目录里
  也没有 commands 之类的服务）。挂上去就是建在没文档的内部事件上，而这条我验不了。
- **system prompt 注入**：`dsh-mermaid-comm` 用 `inject = ['tools','systemPrompt']`
  让模型知道有这条工具。现在只靠工具描述，应该够（工具列表本来就在模型眼前），
  但如果真机验下来模型不主动用，这就是下一条路。那需要 `@deepseek-ai/dsh-system-prompt`。

---

### 侧边栏尺寸下的实测（2026-10-12，为下一步铺路）

用 dev server + 同源 iframe 复现侧边栏宽度（400–420px）量的：

- **条目页在 400px 下正常**：`scrollWidth == innerWidth`（无横向滚动），刊头 / 应用条 /
  标题 / 描述 / 图版 / 代码块都在 356px 内，唯一「越界」的是 `.skip` 链接
  （故意的，无障碍用的，在 -9999px）。**B 在真侧边栏宽度下是成立的。**
- **嵌入模式默认是卡片视图**（`pages.mjs`：`else if(embed) dataset.view='card'`）。
  卡片下 `.row` 是**竖排 flex**（`spellbook.css:847`）：缩略图(order 1) → 链接(order 2)
  → 抄咒语(order 3，`margin-top:auto` 钉在牌底)。每张牌 208×257。
- **条列视图下 `.row` 是另一套**：`grid-template-columns: minmax(0,1fr) auto auto`。
  两套排法都是调过的。

**所以「目录里每行加一个应用按钮」这件事先按住**：要同时改这两套排法，
而 `.row-copy` 的 `margin-top:auto` / `order` 正是那两套排法的关键。
收益（省一次点击）与风险（把作者调好的牌面弄歪）不对等。
真要做，先量清楚两套，再动。

**一条现成的旁证**：`?embed=1` 的 sessionStorage 是**按 origin 隔离**的 ——
换一个端口起 dev server，sessionStorage 就没了、应用按钮随之消失。
验的时候先确认 origin 一致，否则会把「没记住」误判成「坏了」。

---

## 九、卡点

**当前唯一的卡点：桌面端没重载过，插件根本没装载。**

证据：`~/.dsh/profiles/desktop/cordis.patch.yml` 里没有 spellbook 那段；
`~/.dsh/logs/` 里也没有它。包已装好（link 软链 + bundles 项），只差一次重载。

**重载后照这张清单走一遍（两分钟）：**

| # | 做什么 | 该看到什么 | 验收 |
|---|---|---|---|
| 1 | 右侧栏「+」 | 出现「咒语书」 | A |
| 2 | 点进咒语书，翻几条 | 332 条、缩略图是真在跑的 | A |
| 3 | 随便点一条 | 进条目页，**刊头是收起的**（没有「书封」那截）、明暗跟宿主 | B |
| 4 | 那条页面上点「应用到对话」 | 输入框里出现那段咒语；按钮显示「已进输入框」 | C |
| 5 | 点「应用并发送」 | 直接发出去 | C |
| 6 | 关掉侧边栏再打开，重复 3 | 仍然收起刊头（embed 记住了） | B |
| 7 | 在对话里说：用咒语 `neon-glow` 做个发光标题 | 模型调 `spellbook_lookup`，取回任务书再实现 | D |

第 7 条如果模型没调工具 —— 那就是「工具描述不够」，下一步做 system prompt 注入
（见 M3-1 那节末尾）。

---

## 十、本轮已完成的前置（2026-10-12 00:35–00:50，开工前）

这几件事不在 M1–M4 里，但不做的话后面每一轮都是白干：

1. **摸清现状**：宿主/客户端/站点/咒语文本四条链路的现状与缺口写进第二节；
   关键 API（`inputActions` 契约、better-sidebar 四个方法、`slash/input-insert-text`）
   写进第三节 —— 后面不用再摸一遍。
2. **接通桌面端**：desktop profile 里原本**根本没有** dsh-spellbook。
   已加 `link:` 依赖 + bundles 项 + 手工软链（见第六节），解析验证通过。
   之前所有工作都到不了 GUI，这是最大的坑。
3. **让验证门跑起来**：本包 devDeps 此前从未安装，`npm run typecheck` 一直报
   `Cannot find type definition file for 'node'`。已隔离安装，现基线 **188/188 + typecheck 干净**。
4. **定时任务**：`0 1,3,5,7,8 * * *`（Asia/Shanghai），单一 cron 覆盖用户要的五个点；
   载荷指向本文件，每轮取最靠前的未完成里程碑。

**尚未验证**：桌面端右侧栏里「咒语书」tab 是否真的出现 —— 需要重载一次 App，
而重载会中断你正在用的会话，所以留给你手动做（或第一轮夜间任务做）。

---

_立此文件：2026-10-12。计划基于当轮 recon；后续以代码为准。_
