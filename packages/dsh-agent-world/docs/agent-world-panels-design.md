# Agent World · 任务面板 / Agent 列表面板 设计规范

> 口径：**只写文档**。范围 `web/styles/sidebar.css` + `components.css`、`web/ui/sidebar.js`、`web/ui/board.js`、`web/main.js`。
> 现状：`sidebar.js` 已有四挂载位（graph / officialTasks / officialAgents / graphMeta）；`board.js` 已有旧看板的节点/边/状态色；`main.js` 的 `renderOfficialTasks` 是**文字行 + 4 个文字按钮 + prompt()** —— 用户嫌啰嗦的就是这一段。
> 策略：**不新增浮卡/面板**，任务用图 + 卡片说话、操作收成图标；Agent 面板只放人和入口，不复制任务。

## 1. 方向与签名元素

- 方向沿用 `tokens.css` 的「夜班办公室 / Night Shift」：暗底、凸起卡片、台灯琥珀 vs 屏幕青；**不新增任何全局色值**。
- **签名元素 `.aw-ribbon`（值班状态带）**：任务面板标题下一条 6px 高的水平带，**每张任务一段**（按依赖深度排序），底色直接取 `--st-done / --st-in_progress / --st-ready / --st-blocked / --st-pending`。它是"这班还剩多少"的一句话，同时是选中态的双向指示器（悬停/点击段 ↔ 高亮对应卡片）。键盘用户不依赖它（见 §6），因此它 `aria-hidden="true"`，不做假 a11y。
- 克制：除此以外不加装饰。旧看板的圆角、`--lit` 受光顶边、`box-shadow`、状态点全部复用，不再另造一套卡片。

## 2. 局部 token（全部挂在 `#sidebar` 上，不污染 `:root`）

| 变量 | 值 | 用途 |
|---|---|---|
| `--aw-gap` / `--aw-pad-x` / `--aw-pad-y` | `6px` / `12px` / `10px` | 卡片间距、面板内边距 |
| `--aw-ribbon-h` / `--aw-ribbon-gap` | `6px` / `2px` | 状态带高度与段间距 |
| `--aw-row-h` | `40px` | Agent 行高（头像 22 + 两行文字） |
| `--aw-icon` | `16px`（按钮 32×32，`margin:-8px` 外扩命中区） | 图标尺寸 / 命中区 |
| `--aw-radius` | `var(--r-md)` | 卡片与输入框（面板仍是 `--r-lg`） |
| `--aw-card` / `--aw-card-hover` | `var(--panel-2)` / `var(--panel-3)` | 任务卡、Agent 行 |
| `--aw-hair` | `var(--edge-soft)` | 分隔线（只用 1px，不加粗） |
| `--aw-focus` | `var(--screen)` | `:focus-visible` 环 + `--glow-accent` |
| `--aw-danger` | `var(--st-failed)` | 仅错误图标 stroke，文字仍是 `--ink-0/1` |
| `--aw-fs-card` / `--aw-fs-meta`；`--aw-task-min` / `--aw-agents-min` | `12.5px` / `11px`（mono，tabular-nums）；`200px` / `148px` | 卡片标题 / 编号计数；两块折叠后的最小高度 |

字体：标题 `--ui-font` 13px/650；id、计数、耗时一律 `--mono-font` 11px。**面板里不再出现整句中文描述**。

## 3. 布局（上下常驻，同时可见）

```
#sidebar (宽 600 / 520 / 300 三档，折叠=列宽 0，保持现状)
┌ .sidebar-body  display:flex; flex-direction:column; gap:10px ─────────────┐
│ ┌ .sidebar-panel.sidebar-panel-graph   flex:1 1 56%; min-height:200px ─┐ │
│ │ head  任务        12 张 · 4 完成   [⚙2] [⌄]   ← meta 由 board 写     │ │
│ │ ▍.aw-ribbon  ████████▓▓▓▓▒▒▒▒░░░░  （12 段，6px）                     │ │
│ │ .aw-jobs  ⟳ 2 后台任务 · 3m12s          ← 可选，无则整行不渲染          │ │
│ │ .aw-board (flex:1; overflow:auto; 点阵底 + 旧 board 画布)              │ │
│ │   lane1        lane2         lane3                                    │ │
│ │  ┌──────────┐  ┌──────────┐                                           │ │
│ │  │● t-3     │─▶│● t-7     │   ← .board-node / .board-edge 原样        │ │
│ │  │标题两行…  │  │标题两行…  │     状态色 = applyNodeColors()            │ │
│ │  └──────────┘  └──────────┘                                           │ │
│ │ ─ .aw-inspector（选中才出现，44px）t-3 · 标题 · 小青 · 待办  [✓][↺][→] │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ ┌ .sidebar-panel.sidebar-panel-agents  flex:1 1 44%; min-height:148px ─┐ │
│ │ head  Agent 列表   5 人 · 2 忙碌              [＋] [⌄]                │ │
│ │ .sidebar-official-agents → .aw-composer（＋ 展开，Enter 建 / Esc 收起）│ │
│ │ (头像) 小青   工程师   ●忙碌                        [→]  ← 选中任务时 │ │
│ │ (头像) 阿岚   审查     ●待命                              才有指派入口 │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
窄档（≤900px，--sidebar-w:300px）：两块仍是上下；ribbon 4px；节点标题 1 行；
`.aw-board` 横向可滚（节点 min-width:104px）；图标按钮只在 hover/focus/选中行显示。
```

## 4. 任务面板 DOM 与行为

```
.sidebar-panel-graph
├ header.sidebar-region-head        ← 已有，不动；meta = `{n} 张 · {done} 完成`
├ .aw-ribbon[aria-hidden]           ← board.js 新增 renderRibbon()，n=0 时 hidden
│   └ i.aw-ribbon-seg[data-status][data-task]  ← flex:1 1 0; background:var(--st-X)
├ .aw-jobs[hidden 默认]              ← 紧凑条：i.aw-job-dot + span 文案 + b.aw-job-time
│   └ .aw-job[data-job]（展开最多 3 行，仍在这一条内，max-height 0→auto）
├ .sidebar-official-tasks           ← **只放一行通知**（fallback / 错误），不放任务行
└ #sidebar-task-graph (.aw-board)   ← board.js renderGraph() 原样入驻
    └ .board-node（= 任务卡：dot + 短 id + 标题 2 行 + 进度条）
        └ .aw-node-actions（hover/选中/focus-within 时出现：✓ 完成 / ↺ 重开 / → 指派）
```

- **任务是图节点**：直接复用 `renderGraph()` 的 `board-node/board-edge/board-dot/board-node-progress`，不改几何、不改箭头。
- **操作只走图标**：`.aw-icon`（32×32、`--aw-card` 底、`--aw-hair` 边、`--aw-radius`），`aria-label` 用完整动宾（"把 t-3 标记完成"），`title` 同文。默认 `opacity:0`，卡片 hover / `.is-selected` / `:focus-within` 时 `opacity:1`。
- **选中 = 检查器**：`.aw-inspector` 单行，`#id`（mono）+ 标题（1 行省略）+ 负责人 + 状态；不再渲染 `board-detail` 那段多行产出文字（侧边栏模式下 `renderDetail()` 直接 return）。
- **后台任务**：`team.jobs = [{id,label,startedAt}]` 存在才渲染 `.aw-jobs`；标题旁角标 `.aw-badge` 显示数字，`hidden` 当 0。没有新面板、没有 toast。
- **数据接线**：`main.js` 删除任务行渲染，改为 `board.setTaskActions(map)`（`taskId → {revision, ownerName}`）与 `createBoard({ onTaskAction })`；`onTaskAction({taskId, action})` 复用现有 `postTeamTask`。图与官方任务同一批 id 时**以图为唯一渲染**，不再重复出卡片。

## 5. Agent 面板

- `renderMembers()` 保留：`li.board-member`（头像 / 名字 / 角色 / `.board-status-block` 状态）、`role="button"` + `tabindex=0` + Enter/Space、`--rail` 头像底色。
- **删除 `.board-chips` 整段**（含 `chipNodes`、`refreshState` 里 chip 分支）：任务不再在成员行里重复一遍。
- `.board-member.is-unowned` 保留，内容改成 `未分配 + <b>3</b>` 角标；点击 = 选中第一张未指派任务（指派入口，不是任务列表）。
- **新建任务**：Agent 面板头部 `＋` 按钮展开 `.aw-composer`（inline，`input.aw-composer-input` + `button` 提交），Enter 提交 / Esc 收起；负责人 = 当前聚焦的成员行（无则未指派）。**删除 `prompt()`**。
- **指派**：选中某张任务后，每个成员行右端出现 `→`（`aria-label="把 t-3 指派给 小青"`），点击调用 `onAssign(taskId, memberId)`；再次点击同一行无副作用。
- 不重复任务板内容：面板内不出现任务标题、不出现状态带、不出现依赖边。

## 6. 交互 / 键盘 / 动效

- hover / selected：`.board-node:hover`、`.board-member:hover` → `--aw-card-hover`，`transition: background var(--t-hover) var(--ease), border-color …`，不位移不放大；`.is-selected` → `border-color: var(--board-select)` + `box-shadow: var(--glow-accent)`，`.aw-ribbon-seg.is-active` 同加 `outline:1px solid var(--screen); outline-offset:1px`。
- `:focus-visible` → `outline: 2px solid var(--aw-focus); outline-offset: 2px`，**不要 `outline:none`**。图表卡用 roving tabindex：↑↓←→ 在节点间移动焦点（按 `data-depth` 与 y 序），Enter 选中，Esc 清空选中并回到上次卡片。
- 折叠：每块 header 右侧 `button.aw-caret[aria-expanded]`，只切 `.is-collapsed`（`flex:0 0 auto`，内容 `display:none`），状态存 `localStorage['agentWorld.panelCollapsed']`；整列折叠仍走 `sidebar.setCollapsed()`，`onExpand` 保持现有 rAF+120ms 兜底重画。
- 动效：只允许 `--t-hover`（140ms）/ `--t-expand`（220ms）做底色与高度；`@media (prefers-reduced-motion: reduce)` 里 `.aw-ribbon-seg, .aw-icon, .aw-jobs, .aw-composer { transition:none }`，`.aw-job-dot` 停转，禁止平滑滚动。

## 7. 空态 / 错误态

- 任务空：`.aw-board` 内 `.aw-empty`（1px 虚线 `--edge-soft` + `--r-md` + 居中一行）`还没有任务`，副行 `在下面的 Agent 列表点 ＋ 新建`；ribbon / jobs / inspector 全部 `hidden`。有任务但无依赖时不画空图，改单列滚动的 `.board-node` 列表（同一渲染），顶部不写文案。
- Agent 空：沿用 `.board-empty` 文案「还没有成员。世界启动后，这里会列出每个人。」+ `＋` 仍可用（允许空团队建第一张任务）。
- 错误：`.aw-error`（28px 行，`i[data-icon=x]` 用 `--aw-danger` stroke + 文字 `--ink-1` + `button.aw-icon` 重试），不弹窗、不占两行；重试调用所在面板的加载函数。

## 8. 复用 / 删除清单（B 与 Lead 照此改）

| 文件 | 复用（不改逻辑） | 删除 / 改造 |
|---|---|---|
| `web/ui/sidebar.js` | `createSidebar`、`REGIONS`、`mounts()` 七个键、`onExpand` 兜底 | `graph` 面板 content 增加 `.aw-ribbon` / `.aw-jobs` 挂载位并加进 `mounts`；header 加 `.aw-caret`；`createNullSidebar` 同步新键 |
| `web/ui/board.js` | `renderGraph` 全段、`applyNodeColors`、`renderMembers` 行骨架、`refreshState` 状态分支、`setPalette` | 删 `.board-chips` 渲染与 `chipNodes`；侧边栏模式下 `renderView`（分组/筛选 chip）与 `renderDetail`（多行产出）不渲染；新增 `renderRibbon` / `.aw-node-actions` / `.aw-inspector` / `setTaskActions` / `onTaskAction` |
| `web/main.js` | `postTeamTask`、`loadTeamPlan`、计数写入 `#sidebar-region-meta-graph`、`board.update` | 删 `renderOfficialTasks` 里的 task 行循环与 `actionButton/run`；删 `renderAgentActions` 的两个 `prompt()`，换成 `.aw-composer` + `onAssign`；`renderTeamPlan` 只写一行 `.aw-notice` |
| `web/styles/sidebar.css` | 面板卡面、`#sidebar [hidden]`、折叠整列 | `.sidebar-body` 由两列 grid 改 flex column；断点里删两列规则；加 `.aw-*` 与 reduced-motion |
| `web/styles/components.css` | `.board-node/-edge/-dot/-status-block`、`.board-empty` | `.team-task-row/-label/-actions/-action/-create` 整段删；`.sidebar-official-*` 只保留通知样式 |

## 9. 实现顺序与验收

1. **CSS 先行**（无 JS 可回滚）：`sidebar.css` 改 flex 上下 + token + caret/焦点/reduced-motion；此时界面应"旧内容新骨架"。
2. `sidebar.js`：加 ribbon/jobs 挂载位与 caret（含 `createNullSidebar`、`stats()` 加 `ribbon` 段数）。
3. `board.js`：mount 模式删 chips/view/detail，加 ribbon + inspector + 图标操作 + `setTaskActions`。此时用 mock team 数据即可看效果。
4. `main.js`：删文字行与 prompt，接 `onTaskAction` / `onAssign` / jobs；`renderTeamPlan` 降级成通知。
5. 验收：
   - `pnpm --filter dsh-agent-world test` 与 `build` 通过；`node --test test/` 无新增红。
   - DOM：`#sidebar .aw-ribbon-seg` 数量 == 任务数；`#sidebar .board-node` 可见且可滚；`.board-member` 内**无** `.board-chip`；`#sidebar-official-tasks` 内**无** `.team-task-row`。
   - 行为：点段选中卡片、点卡片出检查器、✓ 调用一次 `postTeamTask('update', complete)`、`＋` 建任务后图与 ribbon 各 +1、空白团队不崩。
   - `grep -n "prompt(" web/main.js` 无输出；新增 CSS 无十六进制色值。
   - 1440×900 / 1080 / 900 / 300px 四档：`sidebar.overflow()` 的 `clipped` 为 `[]`，两块同时可见，整列折叠后展开图仍重画。
   - 无新增浮层节点（`.dialogue` / 新 `position:fixed` 元素为 0）。

## 10. 自检（写完代码再读一遍）

1. 面板里还有整段中文说明吗？有就删。
2. 同一个任务是否出现在两处（图 + 列表）？状态色是否只来自 `--st-*` / `--board-*`，JS 里有没有新色值？
3. 键盘能走完：卡片 → 图标按钮 → 成员行 → 新建输入框，每处 `:focus-visible` 都看得见；关掉动画后 ribbon / jobs 仍可读。
