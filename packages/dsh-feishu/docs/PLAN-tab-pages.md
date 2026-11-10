# 计划：飞书任务集三个 tab 页面（关系菜单两级化 / 洞察 / 运行）

> 本文件是**每小时自动推进**的主计划（用户睡前口径：每小时触发一次、每次都要设计+规划任务+用 agent team、
> 至少 review 一次才开始开发、自己 review、不要打扰他）。
> 每轮循环：读本文件 → 更新「本轮进度」→ 设计/评审 → 派活 → 实现 → 自验 → 提交。

## 0. 用户原文（三条需求）

1. 「左侧只需要一个侧边栏，不能有两列，当前的两列需要放在一页。当前第二列变成二级菜单，一级菜单叫关系。」
2. 「需要添加一个洞察 tab，使用 dashboard 的风格配置一个更全面的洞察页面，需要填满，布局好看。」
3. 「还需要加一个运行 tab。也是 dashboard，参考 adventure 里的首页有一个气泡组件，把这个组件拿过来，
   作为正在运行的 session 显示的前端界面，有一个任务就有一个气泡，如果在运行就是绿色，其他的卡片需要你设计下。」

## 1. 现状（代码事实，避免凭记忆）

- 骨架：`OverviewPanel.js` = rail（`.fo-rail`：`.fo-brand` 品牌区 + `.fo-featnav` 功能导航 + `.fo-rail-foot`）+ `.fo-main`（头部：面包屑 + 搜索 + 动作）。
- 功能注册表：`features.js` → `createFeatures(deps)` 返回 `[{id,label,hint,icon,Component}]`，今天只有 `graph`；rail 导航、正文渲染、store 的 `feature` 全从它派生。
- 「关系图」功能页：`GraphFeature.js` → `.fo-feature-bar`（范围列折叠 + 说明 + 范围）+ `.fo-feature-body`（`.fo-scope-column` 范围树 | `.fo-canvas-area` 画布）。
  **这里就是用户说的「两列」**：rail 一列 + 页面内范围树一列。
- 数据面：`GET /api/overview`（瘦快照：tasks/relations/groups/workspaces/stats + revision）、`GET /api/overview/revision`、`POST /api/workspace-groups`；
  本轮新增 `GET|POST /api/overview/organize`（一键整理，仅出建议）与 accept/reject。
- 任务字段（瘦快照里现成的）：`id,no,title,done,workspaceKey,workspaceTitle,workspacePath,blocked,ready,started,suspended,sessionId,predecessors,successors,sourceTasks,derivedTasks,blockedBy`。
  **没有 `running`**——运行 tab 需要它，见 §2.4。
- 宿主能力位：`deps.host = { canOpenSession(), openSession(sessionId, expectedTitle) }`（走 `uiWorkspace.openSession`，切后读回核对）。
- 参考项目：`/Users/kp/DEV/Claudeadventure`（Claude Manager），本地跑在 http://localhost:5599/；风格提取见 `docs/STYLE-borrowed-claude-manager.md`。
  气泡实测（`src/app/pages/Dashboard.tsx:69/81/91`）：`w-16 h-16 rounded-full bg-<色>-500/20 border-2 border-<色>-500 shadow-[0_0_20px_…]`，圈里放数字/图标；
  状态点 `w-3 h-3 rounded-full`（绿=完成 / **蓝 + animate-pulse = 运行中** / 红=失败），列表行是 `p-4 rounded-xl bg-white/5 hover:bg-white/10`。

## 2. 设计决策（本轮口径）

### 2.1 单侧边栏 + 两级菜单（需求 1）
- **一件事两个层级**：一级菜单 = 功能（今天：`关系`；洞察/运行是另外两个一级项，见 §2.2/§2.3）；二级菜单 = **该功能自己的范围**。
- 具体到「关系」：一级项 `关系` 可展开，二级项 = `全部任务` / 各自定义目录 / `未分组`（未分组下再列项目）。二级项就是现在的范围树（含拖拽入组、右键菜单、键盘 ARIA tree），**原样搬进 rail**，页面内不再有 `.fo-scope-column`。
- 页面因此变成单列：画布独占 `.fo-main` 剩余空间（task-13 的「画布铺满」口径不回退）。
- 折叠：rail 的一级项可折叠（记住展开态，落 store `nav`）。范围列的折叠按钮（`.fo-feature-bar`）随之删除——范围选择已经在 rail 里。
- 为什么把范围树放 rail 而不是做成下拉框：拖拽入组与右键菜单需要一列可见列表；下拉框撑不住（且这是用户在 task-14 里已经接受过的取舍）。

### 2.2 洞察页（需求 2）
仪表盘风格，**填满**主区（CSS grid，`grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))`，行高 `auto`，最后一行用 `grid-auto-rows: 1fr` 撑满）。
面板（数据全部来自现有瘦快照，纯函数计算，便于离线测）：
1. **KPI 条**（4~5 个气泡式指标卡）：任务总数、完成率、阻塞中、就绪待开工、挂起。
2. **状态分布**：donut（完成 / 就绪 / 阻塞 / 挂起）——用 SVG 弧线手绘，不引图表库。
3. **项目分布**：横向条（每个 workspace/目录的任务数 + 完成率），按数量排序，Top 8 + 其余归「其他」。
4. **关系概览**：依赖边数 / 来源边数 / ghost（未同步端点）数 + 最长依赖链深度。
5. **阻塞榜**：被阻塞任务 Top 5（含「等谁」的名称）。
6. **最近动态**：最近完成/最近开始/最近挂起的任务清单（时间倒序，各 5 条）。
- 「全面」的边界：只做**能由本地快照真实推出**的指标，不编造履约/工时（那要走 `feishu_insight` 工具，属于后续增量，本轮不做）。

### 2.3 运行页（需求 3）
- **气泡组件**（照 reference 的形制，用宿主令牌重写）：圆形气泡，直径 64px（小屏 56），`border: 2px`，`background: color-mix(状态色 20%, transparent)`，`box-shadow: 0 0 20px color-mix(状态色 40%, transparent)`；圈内放**任务编号**（等宽数字）或状态图标。
  状态：**运行中 = 绿 + 呼吸（pulse）**（用户口径「如果在运行就是绿色」）、等待中 = idle 灰、阻塞 = error 红、已挂起 = warn 黄、已完成 = success 绿（静态，不呼吸）。
  气泡下方：任务标题（12px，两行截断）+ 项目名 + 耗时；点气泡 = 选中该任务（右侧详情抽屉，复用 DetailPanel）。
- **其他卡片**（我设计，dashboard 风格）：
  a. **运行概览**：运行中 / 等待 / 挂起 / 今日完成 四个计数卡（气泡式小圆 + 数字）。
  b. **会话活跃度**：按「最近 N 分钟内有活动」分档的条形（需 host 提供 `activityAt`，见 §2.4；拿不到就只显示「已绑定会话数」）。
  c. **运行时长 Top**：`now - startedAt` 最长的 5 条（横向条）。
  d. **异常提醒**：`suspended` 且挂起原因存在的、`blocked` 且前置已完成的（需要人看一眼的）。
- 数据来源：瘦快照 + §2.4 新增的 `running` / `activityAt`。

### 2.4 宿主侧新增（本轮唯一非前端改动）
- `overviewView()` 的任务项加 `running: boolean`（由 `liveSessionState()` 判定）与 `activityAt: number`（该会话最近活动时间，取不到为 0）。
- 这两项进 revision 哈希（否则「运行中」变了页面不刷）；`running` 是「看得见的状态」，符合既有的哈希口径。
- 单独一条路由不做：洞察用现有快照 + 纯函数算。

### 2.5 写范围与冲突避免（重要）
- 共享文件（`OverviewPanel.js` / `GraphFeature.js` / `TreeNav.js` / `features.js` / `styles.js` / `client.js`）= **单写者**，串行。
- 新页面写成**自包含功能模块**（`InsightFeature.js` / `RunsFeature.js` / `Bubble.js` + `dashboardStyles.js`），本轮不碰共享文件；集成（features.js 注册 + client.js 注入 dashboard CSS）由 lead 在共享文件空出来之后一次做完。
- 这样可以让两个 teammate 真并行：canvas-node-dev 做「关系菜单两级化」，dashboard-dev 做两个新页面的模块。

## 3. 任务分解

| id | 内容 | 写范围 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| task-17 | 关系一级菜单 + 二级菜单（单侧边栏，删掉页面内范围列） | OverviewPanel / GraphFeature / TreeNav / styles / test/overviewPanel | task-16（同一批文件在别的任务手上） | 单列布局；一级项「关系」可展开收缩；二级项=范围树全功能（拖拽/右键/键盘）；`.fo-scope-column` 不再存在；断言覆盖 |
| task-18 | 洞察页（dashboard，填满） | **新文件** InsightFeature.js + insightView 纯函数 + test/insightView.mjs | 无（新文件） | 6 个面板都渲染；数字与纯函数一致；空数据不崩；三条样式红线 |
| task-19 | 运行页 + 气泡组件 | **新文件** RunsFeature.js / Bubble.js / runsView 纯函数 + test/runsView.mjs | task-20（要 `running`） | 气泡状态映射正确（运行=绿+呼吸）；其他 4 张卡；空/坏数据不崩 |
| task-20 | 宿主：`running` + `activityAt`（进 revision） | index.js + test/overviewRoute.mjs | 无 | 接口返回两字段；写操作/会话变化能改 revision；offline 全绿 |
| task-21 | 独立复核本轮成果（只读） | 无（写一份报告） | 17/18/19 完成 | 逐条对照需求给证据；列风险 |

## 4. 自审（**开发前必须做的那一次 review**，lead 自己写）

**R0 结论：计划可执行，但有三处必须先钉死，否则会在实现阶段返工。**

1. **需求 1 的「二级菜单」有歧义，风险最高。** 两种读法：(a) 二级项 = 范围（全部/目录/项目）；(b) 二级项 = 关系功能内部的子视图（图/列表/建议）。
   我的判断是 (a)：用户说「当前第二列变成二级菜单」，而当前第二列**就是范围树**；一级菜单叫「关系」也印证了「一级=功能、二级=功能内的范围」。
   反证检查：如果按 (b) 理解，范围树就没地方放了，而拖拽入组是用户明确要求保留的能力——所以 (a) 是唯一自洽的读法。
   **若下一轮或用户反馈推翻，只需改 rail 的渲染来源（features.js 里给功能加 `subItems`），不影响画布。**
2. **运行页的「运行中」在宿主里没有现成字段**，必须由 `liveSessionState()` 推导（task-20）。风险：该状态是宿主内存态，重启后一段时间内可能全是「等待中」。
   对策：气泡状态以「`suspended` → `blocked` → `running` → `started` → `done` → 就绪」的顺序判定，并在页面注明「运行态来自当前宿主实例」。这条要在 test 里钉住优先级。
3. **并行写文件的风险**：洞察/运行页要注册到 `features.js`、CSS 要进 `styles.js`——这两个文件是共享单写者。已按 §2.5 把新页面写成自包含模块，本轮**不碰**共享文件，集成留给我在 task-17 之后一次做完。若发现必须改共享文件，则降级为串行（宁可慢一小时，不要合并冲突）。

**其他自查（逐条过）**
- 可测性：三个页面都能用现有「迷你 React runtime + 固定 fixture」测（component 断言）+ 纯函数断言（insightView/runsView）；host 侧用 isolatedHome 的路由测试。
- 不违反既有硬约束：三条样式红线（零字面量颜色 / 恰好 14 个 `--dsw-*` / `fo-` 前缀）在 dashboard 里同样适用——**气泡的发光一律 `color-mix(in oklab, var(--dsw-alias-*) X%, transparent)`**，不许写 rgba。
- 不引依赖：donut / 条形全部手绘 SVG/div，不引图表库（插件包体积与宿主一致性都要求这样）。
- 回退路径：三个新页面都是**新增文件 + 注册表加条目**，出问题删条目即回退，不影响关系图。
- 用户睡觉 → 不提问。三处歧义按 §2 的判断做，并在提交信息里写明「按 (a) 读法实现」。
- 每轮必须留痕：本文件的「本轮进度」+ git 提交 + 测试输出，方便用户醒来一次性看懂。

## 5. 本轮进度

**第 1 轮（2026-11-11 01:2x–01:5x，用户睡前那一轮）**

- [x] 计划 + 自审（本文件 §0–§4）——已提交 `4425c01`
- [x] 每小时循环已建：`schedule-3ce1d66b`（`FREQ=HOURLY`，02:30 起每小时，投递到本会话）
- [x] **task-20 宿主 `running` / `sessionTurn`**：已实现并进 revision 哈希；offline 全绿；live 复核
      `GET /dsh-feishu/api/overview` → 52 任务、**running 2 条**（含本会话 T516451 turn 23）、字段形状齐全
- [x] `api.js` 加 `organize / organizeView / organizeAccept / organizeReject`（一键整理 UI 的前置）
- [x] 派活与开工：
      - **task-15/16**（canvas-node-dev）：节点卡片化 + 拖动/聚焦/跳会话、一键整理 UI —— 进行中
      - **task-17**（同上，依赖 task-16）：关系一级菜单 + 范围二级菜单（单侧边栏单列）
      - **task-18/19**（overview-react-dev，team 名额已满所以复用）：洞察页、运行页（气泡墙）—— 只写新文件
      - **task-20**（复核，只读）：待 17/18/19 完成后派给空闲的 reviewer
**第 1 轮追加（同一小时内继续推进）**

- [x] **task-15 完成并提交**（`964b031`）：画布节点做成 workflow 式卡片（264×88 / rx12 / 2px 描边 / 三段结构）、
      拖动吸附 40px 网格（落 store `nodePos`）、聚焦（其余节点 dim 到 0.28）、节点与详情都能「打开会话」、
      删掉 `.fo-stats` 计数胶囊与图头计数等重复标签；overviewPanel 121 → 163、overviewLayout 17 → 24
- [x] **一键整理的真机验收（零副作用那条）**：live `POST /api/overview/organize`（scope=QVIZ 后端主线开发）
      → `candidates: 5`、`complete: true`、`dropped: 0`，模型回答**一条建议都没提**并说明
      「标题和描述未明确给出候选任务间的等待关系」——这正是「宁少勿错」的预期行为，也证明生成阶段确实零写入。
- [x] **真机验收捞出一个真 bug 并修掉**：`organizeScopeTasks` 原来用 `workspaceKeyOf(rawTask)`，
      而 `/api/overview` 用的是 `workspaceKeyOf(enrichWorkspace(task, workspaceList()))`；
      原始任务只有 `meta.workspace`、没有 workspaceId 时两者算不出同一个 key → 按项目筛出 0 条
      （第一次真机跑就报「没有足够的任务可以整理」）。现已统一走 enrich 版本。

- [x] **task-18（洞察 tab）完成，lead 已独立验过**：新文件 `insightView.js`（纯函数）/ `dashboardStyles.js`（`fd-` 前缀）/
      `InsightFeature.js` / `test/insightView.mjs`；`node --check` 全过、纯函数 28 条断言、
      字面量颜色 0（唯一 grep 命中是注释里写的「#hex / rgb() / hsl()」）、用到 8 个令牌全在白名单内。
      **接线按住不动**：`features.js` 在 canvas-node-dev 手上（task-17），等它落地我立刻注册 `insight` + 注入 dashboardStyles。
- [x] **补任务级时间戳**（`0c10078`）：快照任务项加 `createdAt/startedAt/completedAt/suspendedAt`，`completedAt`、`startedAt` 进哈希。
      洞察页的「最近动态」与运行页的「跑了多久」从此有真实时间可用（不再拿编号倒序冒充）。
- [ ] **注意**：`test/insightView.mjs` 此刻是红的（24/28），原因是 overview-react-dev 正在按上面的新字段改「最近动态」——
      属在飞状态，等它回报。lead 已提交的 host 改动与路由测试是绿的（overviewRoute / organizeRoute 单独跑均 OK）。

- [x] **task-16（一键整理 UI）完成并提交**（`b741ff0`）：建议抽屉（340 宽、作为 `.fo-body` 第三列）、
      逐条/全部接受与拒绝、evidence 引用块、影响预览、dropped 折叠、错误条 role=alert；
      overviewPanel 163 → 191。真机点接受 → `overview()` 重拉、计数与状态都变。
- [x] **task-18/19（洞察 + 运行）完成并提交**（`9803383`）：洞察六面板（donut 手绘、最近动态用真实时间戳、
      今日完成 KPI）；运行页气泡墙（64px 圆、运行中绿色 + `fr-breathe` 呼吸、已完成静态、未开始虚线）、
      运行概览四卡、会话活跃度四档、时长 Top5、「需要人看一眼」。insightView 32 / runsView 28 全绿。
      lead 独立复核：剥掉注释后字面量颜色 0、29 处 color-mix 全 in oklab、`g()` 助手只收白名单内 token。
      `client.js` 已把 dashboardStyles 注入进同一个 ctx.effect（卸载一起移除）。
- [x] **`npm test` 全链 + offline 都绿**：offline 79 JS + 7 Python；`npm test` exit 0。
- [ ] **唯一剩下的一步（下一轮第一件事）**：task-17（rail 两级菜单 + 单列）落地后，由 lead 接线：
      `features.js` 追加 `insight` / `runs` 两项（图标自绘、label「洞察」「运行」）+ OverviewPanel 给这两个功能
      传 ctx（`{tasks, relations, workspaces, stats, now, selectedOn...}` / `onOpenSession: 走 host.openSession`），
      然后：build + 三个页面真机复量 + 提交 + 派 task-20 只读复核。

**第 2 轮（01:45–02:00，三条需求全部落地）**

- [x] **task-17 完成并提交**（`e2f9924`）：rail 两级菜单（一级「关系」可展开；二级 = 范围树，compact 形态
      行 30px / 缩进 24-48）；页面单列（`.fo-scope-column` 删除，画布 536 → **776px**，正好 +240）；
      拖拽/右键/键盘 ARIA 一行未改、断言全绿。
- [x] **接线完成**：`features.js` 追加 `insight` / `runs`（自绘 enchantchart / 气泡图标），
      `OverviewPanel.featureCtx` 补 `tasks/relations/groups/workspaces/stats/now`；
      面板测试改成**按注册表长度驱动**（不再写死 1/2 项），并加了接线断言：
      点「洞察」→ `fd-page` + ≥5 面板 + KPI 有真实数字；点「运行」→ `fr-page` + `fr-bubble-item` + 分组；
      切回「关系」→ 画布与二级菜单都回来。overviewPanel 191 → **195**。
- [x] **验证**：`npm test` exit 0；`npm run test:offline` → **79 JS + 7 Python** 全绿；
      产物含三个功能与 `fd-page`/`fr-page` 样式；live 快照 revision 正常（52 任务 / running 1 / done 48）。
- [x] 已派 **task-20 独立只读复核**（overview-rewrite-reviewer）。

**第 2 轮捞出的两个真实数据缺口（写给下一轮的自己）**

1. **`startedAt` 几乎没人有**：live 52 条任务里只有 **2 条**有开始时间（48 条已完成里 47 条有 completedAt）。
   所以运行页的「运行时长 Top5」目前大都是「未记录开始时间」（实现已优雅降级，不猜轮次）。
   要真做起来，需要宿主在**观察到会话从 idle 变 running 的那一刻**记一次 startedAt（几行改动，
   但属于新写路径，要连测试一起补——不要偷偷改）。
2. **`running` 是宿主内存态**：DSH 重启后全部变「等待中」直到会话再次活跃；运行页已注明口径。
   若用户觉得别扭，可以在宿主落一个「上次活跃时刻」的水位（`state.sessionSeen` 已有轮次，但没有时间）。

- [ ] 下一轮要做的（入口）：
      1. 收 task-18/19（新文件）→ 我接线：`features.js` 注册 `insight`/`runs` 两个功能项 +
         `client.js` 注入 `dashboardStyles.js`；用迷你 React harness 给两个功能页补组件级断言
      2. 收 task-15/16/17（canvas-node-dev 串行三个任务），合并前先跑 `test:offline`
      3. 三件都落地后：真 Chromium 复量三个页面 → 提交 → 派 task-20 只读复核
      4. 时间够就做「一键整理」的真机验收（点一次按钮、看建议单、接受一条、确认关系真的出现）

**已知风险（下一轮先看这里）**：team 成员上限 8 个，已满 → 新工作必须复用现有成员；teammate 有两次
「动手前就崩」的记录 → 派活时都要给「一步步做、每步落地就回报」的约束，并且我自己保留兜底实现。
