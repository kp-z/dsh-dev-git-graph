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

A 已经成立。**B/C/D 目前一条都没有**——这是后面所有工作的落点。

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

- [ ] M1 架桥：站点 → 宿主（postMessage 协议 + 回执 + 测试）
- [ ] M2 应用：接进 composer（跨注册通道 + 插入/直接发送）
- [ ] M3-1 宿主 Tool：`spellbook_lookup` / `spellbook_list`
- [ ] M3-2 站点深链 `?spell=<slug>`
- [ ] M3-3 `/spell <slug>`
- [ ] M3-4 `@` 引用 chip
- [ ] M4 端到端收口 + 真 GUI 验证

---

## 九、卡点

（空）

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
