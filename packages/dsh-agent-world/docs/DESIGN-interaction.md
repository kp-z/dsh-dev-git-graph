# DESIGN-interaction — 交互地图与入口收敛（R1b / task-2）

> 作者：designer。写于 R86 团队轮次 R1。
> 定位：**实现说明书**。developer 按本文改 `web/` 即可，不需要再设计。
> 红线：本文只描述交互与判据；**任何一条都不允许新增第二条等价路径**。
>
> 依据来源：`docs/RESEARCH-reuse.md` 本轮尚未产出（截至本文写作时该文件不存在），
> 因此依据改用**通用游戏 UI 惯例**（RimWorld / Two Point Hospital / The Sims 的同类做法，逐条注明出处性质）。
> 若 RESEARCH-reuse.md 后续落地并给出更优结论，**以其为准**，本文相应小节标注需复核。

---

## 一、结论先行（TL;DR）

| # | 结论 |
|---|---|
| **C1** | **全场景只有一个「聚焦某人」动作**：`focusAgent(agentId, source)`。场景点人、看板成员卡、侧边栏列表三处入口**都调它**，不各自实现。 |
| **C2** | **重复入口 = 看板成员卡按钮「💬」与"点人"**。两者当前都做「选中 + 开对话」，但**保留哪一个：删掉 💬 按钮**，对话入口只留「选中后按 Enter」。 |
| **C3** | 「聚焦 → 默认进**移动档**」是唯一默认（R80）。**开对话必须显式要**：`open(agentId, 'chat')`，只有 Enter 或点「对话」页签能到。 |
| **C4** | 看板成员卡**头部点击目前只改看板自身的 `selected`，不碰场景**——这是**漏接**，不是重复入口；修法 = 让它也调 `focusAgent`。 |
| **C5** | 键盘归属以**焦点**为唯一判据（`document.activeElement`），不新增"是否在对话中"布尔量。引擎已有 `isTextInputFocused()`，复用它。 |

---

## 二、现状盘点（改之前先对齐事实）

以本文写作时的代码为准（`main.js` @ Oct 18 00:48, `board.js` @ Oct 17 12:40, `dialogue-ui.js` @ Oct 17 23:53, `scene-phaser.js` @ Oct 18 00:48）。

| 入口 | 代码位置 | 现在做了什么 | 问题 |
|---|---|---|---|
| 点场景里的 Agent | `scene-phaser.js:1599` `sprite.on('pointerup')` → `selectAgent(actor.id)` + `actorPick(agent.id)`；`main.js:123` `onActorPick` → `openDialogueFor` → `dialogue.toggle()` | 选中 + 镜头跟随（`startFollowSelection`，420ms pan）+ **开对话** | ① 与 R80「默认进移动档」矛盾；② 同一处**两条语义**（选中 + 对话）粘在一个手势上；③ 行内注释「R72：点人只开对话，**不动镜头**」**已过期**（`selectAgent` 现在就 `startFollowSelection()`），注释会误导后续实现者 |
| 看板成员卡「💬」按钮 | `board.js:392-403` → `main.js:142` `onMemberPick` → `selectAgent` + `openDialogueFor` | 选中 + 开对话 | **与上行完全重复**（同一组副作用，只是触发点不同） |
| 看板成员卡头部点击 | `board.js:404` `head.addEventListener('click', ...)` → `select({kind:'member'})` | **只改看板自身高亮** | **漏接**：点了卡片，场景无反应、镜头不动。用户预期「点卡片 = 镜头过去」，这里没做到 |
| 侧边栏 Agent 列表 | **不存在**（`#board` 在 `header.topbar` 内，`index.html:63`） | — | 待 R2 新建。**必须复用 C1 路径** |
| 回车 / Esc | `main.js:544-568` | Enter：选中 → `dialogue.open(agentId,'chat')`；Esc：`dialogue.close()` + `clearSelection()` | 语义正确，保留 |

> ⚠️ **另有同类重复已存在，本文一并收敛**：`dialogue-ui.js` 自身在输入框内也处理 Esc（`:414`）与全局 `main.js:544` 的 Esc 是**同一条语义的两处实现**。两者**不必合并**（输入框内的 Esc 必须能先被输入框吃掉，否则中文输入法取消候选会误触发解锁），但**必须共用同一个 `requestUnlock()`**，不许各写一遍 `close() + clearSelection()`。

---

## 三、状态模型（唯一真相）

「谁被聚焦」「面板什么档」两者**可以不一致**，这是现状最大的概念混淆源。定义两个正交状态：

### 3.1 两个状态量

| 状态量 | 归属 | 取值 | 权威来源 |
|---|---|---|---|
| `selectedAgentId` | 场景 | `null` \| `agentId` | `scene-phaser.js`（已有，勿新增副本） |
| `mode` | 对话面板 | `'move'` \| `'chat'` | `dialogue-ui.js`（已有 `currentMode`） |

**关键约束**：`mode` 只在 `selectedAgentId !== null` 时有意义。`selectedAgentId === null` 时面板必须关闭。

### 3.2 状态表（唯一合法的 5 个状态）

| 状态 | `selectedAgentId` | 面板 | `mode` | 镜头 | 键盘归属 | 引擎移动 |
|---|---|---|---|---|---|---|
| **S0 空闲** | `null` | 关 | — | 自由（可拖/可推） | 相机（`FixedKeyControl`） | 关 |
| **S1 聚焦·移动档**（默认） | `id` | 开 | `move` | 锁定跟随 `id` | **角色**（WASD 走选中者） | **开** |
| **S2 聚焦·对话档** | `id` | 开 | `chat` | 锁定跟随 `id` | **输入框** | 关 |
| **S3 聚焦·面板收起** | `id` | 关 | — | 锁定跟随 `id` | 角色 | 开（同 S1） |

> **S3 存不存在？** 现状 `Esc` 同时 `close()` + `clearSelection()`，所以 S3 不可达。**本文决定：保持不可达**（Esc 一步到底），但状态机仍列出它，因为「点场景空白」可能只触发 `clearSelection` 而不 `close`（见 §5.3 的坑）。实现时若出现 S3，视为 bug：**必须由 `requestUnlock()` 一并收掉**。

### 3.3 状态图

```
                    ┌──────────────── focusAgent(id) ────────────────┐
                    │  (场景点人 / 看板卡 / 侧边栏卡 三条入口都走这条)   │
                    ▼                                                │
   ┌────────┐                                              ┌──────────────────┐
   │   S0   │                                              │  S1 聚焦·移动档   │◄──┐
   │ 空闲   │                                              │  (默认落点)       │   │
   └────────┘                                              └──────────────────┘   │
       ▲                                                     │        ▲          │
       │  requestUnlock()                                    │        │          │
       │  (= Esc / 解锁按钮 / 点空白)                          │ Enter  │ ←点「移动」页签
       │                                                     ▼        │          │
       │                                             ┌──────────────────┐        │
       └─────────────────────────────────────────────│  S2 聚焦·对话档   │────────┘
                                                     │  (焦点在 textarea)│
                                                     └──────────────────┘
                                                        点「对话」页签 ↑↓ 同 Enter
```

**三条入口合并后的形态**：

```
[场景 sprite.pointerup]  ─┐
[看板成员卡 head click]  ─┼─►  focusAgent(agentId, source)  ─► selectAgent(id)
[侧边栏列表卡 click]     ─┘        （同一个函数，无分支）        ├─ syncSelectionRing()
                                                              ├─ startFollowSelection()  ← 420ms pan + follow
                                                              └─ dialogue.open(id, 'move')  ← 默认移动档
```

---

## 四、重复入口判定与收敛（**本文核心**）

### 4.1 重复对 ①：场景点人 ⨯ 看板「💬」按钮

| 维度 | 点场景里的 Agent | 点看板「💬」 |
|---|---|---|
| 副作用 | `selectAgent` + `openDialogueFor` | `selectAgent` + `openDialogueFor` |
| 反馈 | 高亮圈 + 420ms 镜头平移 + 面板弹出 | 高亮圈 + 420ms 镜头平移 + 面板弹出 |
| 可撤销 | Esc / 点空白 | Esc / 点空白 |

**判定：完全重复。合并到「点人」这一条物理动作上。**

**保留哪一个：保留「点人」+ 键盘 Enter，删除「💬」按钮。**

理由（三条，逐条可验证）：

1. **光标语义一致**：`💬` 是"对这个人做一件事"的动词按钮，而点卡片本身已经是"聚焦到这个人"。同一个对象上"点它"和"点它上面的按钮"给出**同一个结果**时，按钮就是噪声——这正是用户说的"同一功能做两份"。RimWorld / Two Point Hospital 的同类做法是：**选中单位后，动作在检视面板里**（RimWorld 的 inspect pane 底部一排命令、TPH 的病人卡点开才出现动作），**不在列表项上挂动作按钮**。列表项的唯一动作是"选中/聚焦"。
2. **`💬` 会诱导误触**：它在 `head` 里、紧挨成员名，`event.stopPropagation()` 才没串到 `select`。这类"卡片内嵌按钮 + 阻止冒泡"的写法每加一个按钮就要再防一次冒泡，属于**易腐结构**。删掉即根除。
3. **对话本来就有唯一快捷键**：`Enter`（已有，`main.js:557`）。对话入口 = "选中 → Enter"，两步、零视觉噪声、键盘可达。**不额外提供鼠标直达对话**——因为 R80 已定"点人默认进移动档"，鼠标直达对话会**绕过默认档**、制造第二个默认。

> **代价与补偿**：删掉 `💬` 后，鼠标用户想对话需要「点人 → 点面板『对话』页签」（面板打开即含页签，见 `dialogue-ui.js` 的 `$modeChat`/`$modeMove`）。这不是多一条路径，**是 S1→S2 的既有转移**，不构成重复入口。

### 4.2 重复对 ②：看板成员卡 head click ⨯ 侧边栏列表 click

现状 head click **只改看板高亮**（`select({kind:'member'})` 不进场景）。它**不是重复入口，是漏接**。

但它与新建的侧边栏列表**会**变成重复：R3 把看板搬进侧边栏后，**看板成员卡就是侧边栏 Agent 列表的"任务流程图"档**，同一批 member 会在两档视图里各出现一次。

**判定：不是两个入口，是同一组件的两档视图。收敛方案 = 一个 `<AgentCard>` 渲染件、一个 `focusAgent`。**

理由：用户原话"侧边栏可只显示 Agent 列表，也可显示任务流程图"。两档是**同一份数据的两种投影**，不是两个功能。因此：

- 渲染：两档共用 `web/ui/sidebar.js` 里的**同一张卡片构造函数**（`renderAgentCard(agent)`），不各写一份 —— 对应 PLAN 二(a) 的红线"同一份渲染代码"。
- 行为：两档的卡片点击**都只调** `focusAgent(agentId, 'sidebar')`。
- `source` 参数**只用于埋点/调试门面**（`__agentWorld.lastFocusSource`），**不参与分支**。若实现里出现 `if (source === 'board')`，即视为违反本文。

### 4.3 三条 `clearSelection` 路径 ⨯ 两条 Esc 实现

| 路径 | 现状 |
|---|---|
| `Esc`（全局，`main.js:549`） | `dialogue.close()` + `clearSelection()` 各写一遍 |
| `Esc`（输入框内，`dialogue-ui.js:415`） | `close()` + `options.onUnlock?.()` → `main.js:154` → `clearSelection()` |
| 「取消锁定」按钮（`$unlock`，`dialogue-ui.js:429`） | `options.onUnlock?.()` → `clearSelection()` |
| 点场景空白（`clearSelection` 直调） | `scene-phaser.js:615` → `clearSelection()` |

**判定：语义相同（= 解锁），但四条落点分散，其中全局 Esc 那条还额外承担 `close()`。收敛为单一 `requestUnlock()`。**

```
requestUnlock()
  ├─ dialogue.close()          ← 幂等（已 close 再 close 无害）
  ├─ scene2d.clearSelection()  ← 已有，内部负责 notifyMoveSettled + 位置交还
  └─ 焦点回场景容器（让引擎重新接管键盘）   ← 现状缺失，见 §5.4
```

四条调用点全部改调 `requestUnlock()`，**不许再各自写 `close()+clearSelection()`**。输入框内的 Esc 仍要**先**判 `isComposing`（中文候选取消不得解锁）——这条是**前置过滤**，不是第二条路径。

---

## 五、逐条交互规格（触发 → 反馈 → 可撤销性）

### 5.1 点场景里的 Agent（R80：选中 + 镜头锁定 + **默认移动档**）

| 项 | 规格 |
|---|---|
| **触发** | `pointerup`，且 `pointer.getDistance() <= 5`（排除拖拽）、`pointer.getDuration() <= 700`（排除长按）。**沿用现值，不改**（`scene-phaser.js:1599` 区段） |
| **反馈** | ① 脚下青色高亮圈（已有 `syncSelectionRing`）；② 镜头 420ms `Sine.easeInOut` 平移至该 agent 居中，`camerapancomplete` 后接 `startFollow(lerp .12)`（已有 `startFollowSelection`）；③ 面板打开，**`mode='move'`**，输入框**不聚焦**（`dialogue-ui.js:252` 的 `if (nextMode === 'chat') $input?.focus()` 已正确）；④ `setMovementEnabled(true)` |
| **可撤销** | `Esc`（= `requestUnlock()`）；点场景空白；再点**同一个** agent **不**切换（幂等，不 toggle）；再点**另一个** agent 直接改聚焦（不先解锁） |
| **与现状差异** | 现在会 `openDialogueFor` → `toggle` → 默认 `move`。**toggle 语义要改成 `open`**：再点同一个人不该关掉面板（见下） |

> **`toggle` → `open` 的必要性**：现状 `openDialogueFor` 调 `dialogue.toggle(agentId)`（`main.js:295`），同一人再点一次会**关面板但保持选中**（进入不合法的 S3）。改用 `open()` 后，"再点同一人"= 重新聚焦、面板保持打开、`mode` 不变（若在 chat 档则**不降回 move**——鼠标点人不应把人踢出正在打字的状态）。

### 5.2 看板成员卡点击（现在也走选中）

| 项 | 规格 |
|---|---|
| **触发** | 卡片 `head` 的 `click`（**不是** `💬`，`💬` 删除） |
| **反馈** | 与 §5.1 **完全相同**（同一条 `focusAgent`），另加：卡片 `active` 高亮（`board.js` 已有的 `selected.kind==='member'` 样式） |
| **可撤销** | 同 §5.1 |
| **实现改动** | `board.js:404` 的 `head` click 里，在 `select(...)` 之后追加 `options.onMemberPick?.(row.member.id)`，并把 `onMemberPick` 的实现改为**只调 `focusAgent`**（不再自带 `selectAgent`+`openDialogueFor` 两行） |

> **未分配行的特例**：`row.member.id === null`（"未分配"）**不可聚焦**——它没有场景实体。卡片渲染为不可点（无 `active` 态、`cursor: default`、`aria-disabled="true"`）。这是**唯一**允许分叉的条件，判据是 `id === null`，不是 `source`。

### 5.3 侧边栏 Agent 列表点击（**新入口，必须复用同一条路径**）

| 项 | 规格 |
|---|---|
| **触发** | 列表卡片 `click`（整卡可点，**卡内不放任何动作按钮**——§4.1 的理由同样适用） |
| **反馈** | 与 §5.1 完全相同 |
| **可撤销** | 同 §5.1 |
| **禁止** | ① 侧边栏**不许**自己维护"当前选中"高亮，必须读 `scene2d.selectedAgent()`（同一真相）；② 不许出现"点侧边栏 = 只高亮不移动镜头"的降级版本 |
| **两档一致性** | 「Agent 列表」档与「任务流程图」档的成员卡走**同一个** `renderAgentCard` + 同一个 `focusAgent` |

### 5.4 回车 = 开始对话、Esc = 解锁（R80 已定）

| 键 | 前置条件 | 动作 | 反馈 | 可撤销 |
|---|---|---|---|---|
| `Enter` | 焦点**不在** `textarea/input/contenteditable`；`selectedAgentId !== null` | 面板关 → `open(id,'chat')`；面板开 → `setMode('chat')`（`main.js:557` 现状即此，**保留**） | 输入框现身并聚焦；`setMovementEnabled(false)` | `Esc` 回 S0；点「移动」页签回 S1 |
| `Enter` | `selectedAgentId === null` | **不拦，不动作**（现状 `return`，保留——不能凭空给一个 agent 开对话） | 无 | — |
| `Esc` | 焦点不在输入框 | `requestUnlock()` | 高亮圈消失、镜头解锁、面板收起 | 不可撤销（终态 S0） |
| `Esc` | 焦点**在**输入框 且 `isComposing` | **放过**（输入法取消候选） | 无 | — |
| `Esc` | 焦点在输入框 且 非 composing | 本地 `close()` + `requestUnlock()` | 同全局 Esc | 不可撤销 |

> **焦点回场景**（现状缺失）：`requestUnlock()` 后 `document.activeElement` 可能仍停在某个按钮上（如「解锁」按钮被点后仍是 `body` 或该按钮）。若落在**可聚焦元素**上，WASD 会被该元素吞（虽然引擎只排 `INPUT/TEXTAREA`，但 Tab 焦点在按钮上时空格/回车会重复触发它）。`requestUnlock()` 里显式 `canvasEl.focus()`（或 `document.activeElement.blur()`）。判据：Esc 之后立刻按 `Enter` **不应**重新打开上一人的对话。

### 5.5 键盘移动与对话输入框互斥（R80 已定）

**唯一判据：`isTextInputFocused()`（`scene-phaser.js:1052`）。不新增布尔量。**

| `mode` | 焦点位置 | 引擎读 WASD | `tickManualMovement` | 相机 `FixedKeyControl` |
|---|---|---|---|---|
| `move` | 非文字输入 | ✅ | 走选中者（`movementEnabled && !textFocus && moveKeys`，`scene-phaser.js:1107`） | ❌（`isFollowing()` 为真，`:711` 跳过） |
| `chat` | `textarea` | ❌ | `lastReason='text-focus'` 短路 | ❌（`:711` 同样排除） |
| 无选中 | 任意 | ❌ 角色不动 | — | ✅ 推相机 |

**互斥契约（实现时必须成立的三条）**：

1. **`setMode('chat')` ⇒ `$input.focus()`**；**`setMode('move')` ⇒ `$input.blur()`**（`dialogue-ui.js:296-303` 已实现，**保留，勿绕过**）。
2. **`open(id,'move')` 不得抢焦点**（`:252` 已有守卫，**保留**）。这条是"选中了却走不动"的唯一根因，任何 UI 改动不得破坏。
3. **面板 `close()` 必须 `$input.blur()`**（`:266` 已有）。否则焦点留在 `hidden` 的 textarea 上，引擎永远以为用户在打字 → 键盘全废、且**无任何视觉提示**。

> **为什么用焦点而非布尔量**：布尔量（如 `isChatting`）与真实焦点会漂移——`hidden` 的输入框仍可持焦点，`blur` 也可能被浏览器异步处理。焦点是**浏览器自己的真相**，引擎直接读它就不会有两份状态。这是 D56「能用现成的别自己搞」在输入域的体现。

---

### 5.6 本文引用的 API 已逐个核对（防止说明书指向不存在的函数）

| 引用 | 是否存在 | 出处 |
|---|---|---|
| `dialogue.isOpen()` | ✅ | `dialogue-ui.js` 门面 `isOpen: () => currentAgentId !== null` |
| `dialogue.agentId()` | ✅ | 同上 |
| `dialogue.mode()` | ✅ | 同上（返回 `'chat' \| 'move'`） |
| `dialogue.open(id, mode?)` | ✅ | 省略 mode 时**默认 `'move'`**（`mode === 'chat' ? 'chat' : 'move'`）——正好等于 R80 的默认档，无需改签名 |
| `dialogue.close()` / `toggle()` | ✅ | `toggle` 语义见 §5.1，本文只改**调用方**，不改面板内部 |
| `scene2d.selectAgent` / `clearSelection` / `selectedAgent` / `setMovementEnabled` | ✅ | 全部在 `scene-phaser.js` 门面导出（`:2273-2278`） |
| `scene2d.manualState()` | ✅ | 诊断门面，含 `lastReason` / `textInputFocused`（维权 A5/A7 用） |
| `__agentWorld.lastFocusSource` | ❌ **待新增** | 本文新增字段（§6 `focusAgent` 步骤 4），不存在属正常 |

---

## 六、必须删除/新增的清单（给 developer）

| 动作 | 文件 | 位置 | 说明 |
|---|---|---|---|
| **删** | `web/ui/board.js` | `:392-403` 整个 `talk` 按钮块 | 重复入口（§4.1） |
| **改** | `web/ui/board.js` | `:404` head click | 追加 `options.onMemberPick?.(id)`，使看板点击也走 `focusAgent` |
| **删** | `web/ui/board.js` | `:81` 注释"点成员卡上的对话按钮" | 描述已失效 |
| **改** | `web/main.js` | `:142` `onMemberPick` | 收缩为**只调 `focusAgent`**，不自带 `selectAgent`/`openDialogueFor` |
| **改** | `web/main.js` | `:123` `onActorPick` | **改为空或删掉**：`selectAgent` 已在 `scene-phaser.js:1599` 内调用，`actorPick` 是第二条语义通道。若保留（供夹具），只调 `focusAgent`（幂等） |
| **改** | `web/main.js` | `:293` `openDialogueFor` | `dialogue.toggle` → `dialogue.open(id,'move')`（§5.1 的 S3 规避） |
| **新增** | `web/main.js` | 新函数 `focusAgent(agentId, source)` | **本文的单一入口**。见下方签名 |
| **新增** | `web/main.js` | `requestUnlock()` | §4.3 的单一解锁入口 |
| **改** | `web/main.js` | `:549-566` Esc/Enter | Esc 改调 `requestUnlock()`；Enter 逻辑不变 |
| **改** | `web/ui/dialogue-ui.js` | `:415` 输入框 Esc | 改调传入的 `options.onUnlock`（已是 `requestUnlock`），**删掉本地 `close()`**——避免 `close` 执行两次 |
| **改** | `web/scene/scene-phaser.js` | `:1599` 区段注释 | 「R72：点人只开对话，**不动镜头**」**已与代码不符**（`selectAgent` 现在会 `startFollowSelection`）。改为「点人 = 聚焦（选中 + 镜头平移跟随）；默认移动档」 |
| **新建** | `web/ui/sidebar.js` | — | 两档视图 + **共用** `renderAgentCard`；点击只调 `focusAgent`（R2 范围） |

### `focusAgent` 规格

```
focusAgent(agentId: string, source: 'scene' | 'board' | 'sidebar')
  → boolean    // false = 该 agent 此刻不可聚焦（无实体/已下线）

前置：agentId 非空；agent 在场景里存在精灵（否则 return false，不报错、不开面板）
步骤（顺序不可乱）：
  1. if (scene2d.selectAgent(agentId) !== true) return false
  2. dialogue.open(agentId, 'move')     // 幂等：已打开则只切到 move？
     ⚠️ 修正：若已 open 且 mode==='chat'，**不降档**（鼠标点人不应把人踢出打字）
        即：if (!dialogue.isOpen() || dialogue.agentId() !== agentId) dialogue.open(agentId,'move')
  3. render(true)                        // 气泡避让重算（现有约定）
  4. debug.lastFocusSource = source      // 仅供诊断门面，不参与分支
  5. return true
```

> `source` 的**唯一用途**是 `__agentWorld.lastFocusSource`，供真机核验"三个入口都走到了同一个函数"。**任何按 `source` 分叉的行为都违反本文。**

---

## 七、验收判据（reviewer 用；每条可真机复现）

| # | 判据 | 怎么验 |
|---|---|---|
| A1 | **单一入口**：三个入口（场景点人 / 看板卡 / 侧边栏卡）都置 `__agentWorld.lastFocusSource` 为对应值，且 `__agentWorld.selectedAgent()` 相同 | 依次点三处，读门面 |
| A2 | **镜头 420ms 平移**：点卡片后镜头在 ~420ms 内把该 agent 居中（计时器或录屏帧差） | PLAN 二(b) 的判据 |
| A3 | **默认移动档**：点卡片后 `dialogue.mode() === 'move'` 且 `document.activeElement` **不是** textarea | 页内读 |
| A4 | **`💬` 已消失**：看板/侧边栏成员卡内**无任何按钮元素**（`querySelectorAll('.board-talk')` 为空） | DOM 查询 |
| A5 | **Enter 开对话**：聚焦后按 Enter → `mode==='chat'`、焦点在 textarea、`movementEnabled===false` | `__agentWorld.scene2d.manualState()` |
| A6 | **Esc 一步解锁**：任意状态下按 Esc → `selectedAgentId===null`、面板 `hidden`、`textInputFocused===false` | 同上 |
| A7 | **互斥**：`chat` 档按住 W 三秒 → agent 位置不变、`lastReason==='text-focus'`；`move` 档按住 W → 位置变化 | `manualState().lastReason` |
| A8 | **无 S3**：任何操作序列后不存在「`selectedAgentId!==null` 且面板关闭」，除非正在 420ms pan 中 | 遍历操作 |
| A9 | **未分配行不可点**：`aria-disabled="true"`、点击无任何状态变化 | DOM + 门面 |
| A10 | **中文输入法**：在 chat 档用拼音输入、按回车选词 → **不发送**（`isComposing` 守卫仍在） | 真机输入 |

---

## 八、依据与出处

| 决策 | 依据 | 性质 |
|---|---|---|
| 列表项只承载「选中/聚焦」，动作放在检视面板 | RimWorld：`inspect pane` 底部命令条；列表（`colonist bar`）点击仅选中并跳镜头 | 通用游戏 UI 惯例 |
| 不给列表项挂"动作按钮 + `stopPropagation`" | Two Point Hospital：房间/员工列表点击仅定位；动作在房间面板内 | 通用游戏 UI 惯例 |
| 一个手势一个结果（点人=选中，不兼开对话） | The Sims：点角色=选中并显示社交菜单，**镜头跟随**与**交互菜单**分离；不点两次同一结果叠加 | 通用游戏 UI 惯例 |
| 焦点即键盘归属 | 浏览器原生语义；本项目 `isTextInputFocused()` 已如此实现 | 代码既有约定（D56） |
| 删除重复入口而非"保留但默认隐藏" | PLAN 一（易用支柱反面）："同一功能做两份"；PLAN 二(a) 红线"同一份渲染代码" | 项目路线 |

> **待复核**：`docs/RESEARCH-reuse.md` 本轮未产出。若其给出 Phaser 原生 `Input` 更省的接法（例如用 `scene.input.on('gameobjectup')` 统一收口，替代每个 sprite 挂 `pointerup`），§6 的「场景点人」实现方式应改为其建议，但**§4 的入口收敛结论不受影响**（那属于信息架构，与引擎接法无关）。

---

## 九、卡点与已知风险

1. **`RESEARCH-reuse.md` 缺失** —— 本轮依据降级为惯例。若其后续结论与本文冲突，以它为准并复核 §8。
2. **并行开发**：`web/main.js`、`web/index.html`、`web/styles/layout.css` 由另一 Agent 高频改动（`main.js` 于 00:48 刚改过）。developer 落 §6 前**必须重读**，尤其 `main.js:142-166` 与 `:540-568` 两段——行号会漂移，**以函数名为锚**（`onMemberPick` / `focusAgent` / `requestUnlock`）而非行号。
3. **`toggle → open` 的语义变更**需要同步改任何夹具/调试门面里依赖 `toggle` 的用例（本轮未核查夹具）。
4. **删 `💬` 会移除 R76 的"花名册删掉后的对话入口"**。须确认 R76 的替代路径（= 选中后 Enter / 面板页签）在**鼠标-only** 场景可达：面板一开就带 `$modeChat` 页签，可达。**但若未来新增"未选中也能对话"的需求，必须回到本文重新设计，不许私加按钮。**
