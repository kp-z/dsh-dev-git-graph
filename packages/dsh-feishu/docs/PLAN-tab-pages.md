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

## 4b. 第 5 轮的设计评审批注（每轮开发前的那一次 review）

**本轮要做的事**：把洞察页从「只有当前快照口径」升级到「含历史指标」（用户原话是「更全面」）。

**为什么不去新写一条宿主路由**：宿主已经有 `GET /api/insight/stats?days=N`（面板用的同一套，
`index.js:10029`），返回 `series / board / distribution / fulfillment / quality / delayBuckets / datasets`。
新写一条只会制造第二套口径 —— 复核上一轮已经因为「两个地方各说各话」抓过一次 bug
（workspaceKey 口径不一致）。所以本轮**只加客户端取数**，宿主零改动。

**为什么不用 `/api/insight/diagnose`（那条会烧 token 出 AI 叙述）**：洞察页要的是**数字**，
数字是确定性的、可离线测；AI 叙述属于「点一下才生成」的动作，不该在打开页面时自动发生
（也符合循环口径「不写飞书、不擅自调用模型」）。所以本轮只接 stats，叙述留给以后显式的按钮。

**风险与对策**
1. **旧宿主没有这条路由**（面板被独立更新时）→ 必须降级：保留现有六个面板 + 一行可读提示 + 重试；
   不允许整页空掉。这条写进了任务的验收。
2. **形状漂移**：`stats` 里的字段是宿主内部聚合，未来可能改名 → 所有新纯函数一律**防御式取值**
   （缺字段、类型不对、空数组都要返回可渲染结构），并在测试里钉「空 stats / 只有 series / 坏形状」三种。
3. **数字会骗人**：`onTimeRate` 在 `tracked=0` 时是无意义的，`cycleP85Days` 在样本为 0 时也不该显示
   「0 天」→ 一律显示「暂无样本」，不许拿 0 冒充数据（这跟上一轮「不猜时长」是同一条纪律）。
4. **不要把 `board` 再加一张卡**：它与现有状态 donut 语义重复，正是用户上一轮抱怨的「多余的标签」。

**结论**：按上面的口径做，写范围限制在洞察页自己的三个文件（`InsightFeature.js` / `insightView.js` /
`test/insightView.mjs`），`api.js` 由 lead 加好方法，避免与其它写者冲突。

## 4c. 「气泡群」组件的口径（用户第二次指正后的定版）

第 7 轮我把「空气泡水位」理解成了参考站的**经验值水位条**（`BaseView.tsx:87-97`），用户随即指正：
「不对啊，这个参考的组件不对，应该是如图的组件」。他给的截图里，红色箭头指向的是
**Claude CLI Status 卡片里的 AVAILABLE MODELS 气泡群**。所以定版口径是：

**组件 = 一组大小不等、散点错落的圆形气泡**（不是条状元件的液面填充）
| 项 | 实测/目测值（来自截图 1844×1026，卡片区域裁剪后估算） |
| --- | --- |
| 数量与档位 | 8 个气泡，**三档尺寸**；最大直径 ≈ 最小圆的 **2.5 倍** |
| 排布 | **散点/星座式**，两排交错，**互不重叠**；水平边缘间距 30~50px，上下排垂直间距 60~80px |
| 活跃态 | 半透明绿填充（≈ green-500 15%）+ 亮绿边（≈ green-400 50%）+ **外发光晕**（blur 20~30px、绿 40%）+ 中心略亮的径向球感 |
| 非活跃态 | 深灰半透明填充（≈ zinc-700 30%）+ **1px 白 10% 描边** |
| 文字 | 写在圆内、居中，11~13px，白色/浅灰；两行时行高紧凑；圆外不挂小字 |
| 没有的东西 | **没有连线、没有液面/水位线、没有内嵌面板**（气泡直接落在卡片底色上） |

**为什么写这一节**：我连续两轮把「用户指的东西」认错（先当成悬浮卡、再当成水位条）。
教训是——**用户给图时，先用视觉工具量图（数量/尺寸/排布/颜色/有没有某视觉元素），
再去代码里找对应实现**；找不到对应实现就照图复现，而不是拿一个「名字听起来像」的现成组件去套。
这一条以后每轮 review 都要过一遍。

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

**第 3 轮（02:00–02:15，独立复核 + 逐条修）**

- [x] **task-20 独立只读复核完成**：报告 `docs/REVIEW-tab-pages-round1.md`（25KB）。
      结论：需求 1/3 与三条红线**成立**；需求 2 的六面板/纯函数/填满成立，但「看全局」在搜索态下不成立；
      新样式表零测试覆盖是最缺口。复核者还确认上一轮的 revision 哈希漏洞已修。
- [x] **R1（我的接线 bug）**：仪表盘拿到的是 keyword 过滤后的 tasks 而 relations 没过滤
      （live 复现 ghosts 0→3、KPI 52→25）→ 改成传未过滤 tasks；搜索框与「返回全部任务」按钮改成
      只在声明 `search:true` 的功能（今天只有关系图）下渲染。
- [x] **R2**：新增 `test/dashboardStyles.mjs`（7 条：零字面量颜色 / 令牌 ⊆ 14 / fd-·fr- 前缀 /
      reduced-motion 关动效 / 呼吸只挂 is-running / 网格 auto-fit+1fr），挂进 test 链与 `test:dashboard`。
- [x] **R3**：`fr-` 的 reduced-motion 全部加 `!important`（不再靠源码顺序）。
- [x] **R4**（NODE_H=88）按复核结论保留（常量自洽、不溢出；代价是长标题固定截断），已写进口径。
- [x] **R5a**：运行页 hint 补上「运行态来自宿主内存，重启后清零、会话恢复后自愈」。
- [x] **顺手修三个真问题**：项目分布横条因 `fd-tone-undefined` 全回退同一色（现指 `--fo-deco-N`）；
      气泡跳会话没传任务标题导致「切后核对」退化（现与画布节点同口径，并有测试钉住）；
      insightView 注释「kpis 4-5」与实际 6 个不符。
- [x] **补上复核指出的覆盖缺口**：气泡交互 4 条断言（点=选中开详情 / ↗ 调 host.openSession(id,title) /
      没绑会话 disabled + title / 每气泡都有按钮）。
- [x] 提交 `60409fd`；`npm test` exit 0、offline **80 JS + 7 Python** 全绿；overviewPanel 200 全绿。

**第 4 轮（02:30–02:45，每小时循环的第一轮真正推进）**

- [x] **补上运行页缺失的真实起点**：新增 `state.sessionRunSeen`（sessionId → 第一次**观察到**这条会话在跑的时刻），
      观测点两处（宿主报活动时 + 面板每次取快照时扫一遍，不写盘）；快照任务项加 `runningSince` 并进 revision；
      `runsView` 的时长起点改成 `runningSince || startedAt` 并带来源（「观察到运行」/「开工时间」/「未记录开始时间」）。
      提交 `e0ddcd1`；runsView 28 → 30、overviewRoute 加假 agents 服务钉住 `running=true` + `runningSince>0` + 幂等 + 进哈希。
- [x] **live 复核**：插件重载后真快照里 running 任务（就是本会话 T516451）出现 `runningSince`，
      再取一次快照数值不变（幂等）；运行页「运行时长 Top 5」实测同时出现三种来源：
      「开工时间 18 天 3 小时」/「观察到运行 9 秒」/「未记录开始时间」。
- [x] **给用户的真实数据截图**（本机真 React + 真组件 + 通过代理取真快照，1600×919）：
      `/Users/kp/Downloads/tab-1-relation-v2.jpg`（单列 + rail 两级 + 52 个节点）、
      `tab-2-insight-v2.jpg`（洞察六面板）、`tab-3-runs-v2.jpg`（运行：52 气泡、1 个绿色呼吸、5 张卡）。
- [x] 验证：offline 80 JS + 7 Python、`npm test` exit 0。

**第 5 轮（03:30–04:00）：洞察页「更全面」+ 端到端抓到一个接线缺陷**

- [x] **洞察页接历史指标**（`9127822`，task-21 = overview-react-dev）：
      `api.insightStats(days)` → 宿主已有的 `/api/insight/stats`（复用同一套口径，不新造第二套）；
      新增四个面板：吞吐趋势（28 柱 + 活跃折线，手绘 SVG）/ 履约（准时率环 + 逾期 + 平均早/晚 X 天）/
      延期原因（横条 + 平均天数）/ 质量·周期（提前·准时·延迟 + 中位数·P85）；
      降级四态（旧宿主 / 失败 / 7s 超时 / 形状怪）都只加页头一行 `role="status"` + 重试，
      六个快照面板原样保留；0 样本一律「—」，不拿 0 冒充数据。
- [x] **端到端抓到并修掉一个接线缺陷**（`414c0ff`）：`OverviewPanel.adaptApi` 的白名单没有 `insightStats`，
      于是洞察页在真机上**永远**显示「历史指标不可用」——单元级验证（直接渲染 InsightFeature）看不见，
      只有从面板真挂载才暴露。修好补了 3 条接线断言（调用参数、新面板渲染、失败降级），
      并把其中一条从 async-check 改成先挂载再同步断言（避免断言失败被 Promise 吞掉）。
- [x] **真机复核（真数据 52 条任务）**：`data-history=1`，10 个面板
      关键指标 / 状态分布 / 项目分布 / 关系概览 / 阻塞榜 / 最近动态 / 吞吐趋势 / 履约 / 延期原因 / 质量·周期；
      趋势 28 柱 + 1 折线；延期原因「其他/未写 7 次 平均 2.2 天」；履约「已完成 13 / 逾期 1 / 延期记录 6」。
      截图 `/Users/kp/Downloads/tab-2-insight-v3-history.jpg`（真数据）。
- [x] 证据：overviewPanel 200 → 203、insightView 47、runsView 30、offline 80 JS + 7 Python、`npm test` exit 0。

**第 6 轮（09:55 起，用户醒来说「继续」）：一键整理支持撤销**

- [x] **接受可回退**（`4846f26`）：宿主 `undoOrganizeItems` + `POST /api/overview/organize/undo`；
      做法是对那条边的**下游任务**做定向 replace（保留同方向其它边、只去掉这一条），先 refresh 再 replace；
      建议单加 `undone` 状态与计数；客户端抽屉出现「撤销已接受 N」按钮（有已接受条目时），
      撤销后同样重拉快照让边立刻从画布消失。
- [x] 为什么必须做：设计稿 §9.1 的最高风险是「写错一条 depends_on = 后继永远开不了工」，
      没有撤销就只能去飞书手删。
- [x] **同一类坑又抓到一次**：`adaptApi` 白名单这次漏的是 `organizeUndo`（上一轮漏的是 `insightStats`）
      → 所以补的是**断言**（面板测试钉住撤销链路），不是只补方法。
- [x] 证据：organizeRoute +5 条撤销断言；overviewPanel 203 → 207；offline 80 JS + 7 Python；npm test exit 0。

**第 7 轮（10:00–10:20，用户醒来后的两条新口径）**

用户口径（原文）：「侧边栏运行排第一，洞察第二，关系第三。运行里面你使用的 UI 不是我想要的悬浮 UI，
布局要和 adventure 首页一样，你需要找下有一个空气泡水位的组件需要完全复现，运行完成的任务不需要在卡片里显示。」

- [x] **侧边栏顺序**（`a816969`）：注册表 = runs / insight / graph，顺序即优先级，第一项同时是默认落地页；
      测试改成顺序感知（mountPanel 新增 startFeature，main 用 null 验真实默认），并钉住顺序与「运行没有二级菜单」。
      顺手修掉自己引入的 `},,` 双逗号（数组空洞会让 rail 出现空项）。
- [x] **找到「空气泡水位」= 参考站 `BaseView.tsx:87-97` 的经验值水位条**，在 `Bubble.js` 里做成 `createWaterLevel`：
      16px/999px/1px 描边/overflow hidden 轨道 + 三段渐变填充 + 横扫高光（2.4s 循环）+ 1s/.3s easeOut 入场；
      另做 8px 迷你版给 KPI 卡。**一处口径我自己裁了**：参考站是「首尾同色、中间换色相」，
      我按「完全复现」保留这个结构（我原本在任务里写「三色全不同」是误读）。
- [x] **运行页改成 adventure 首页布局**（`9d6ce6e`）：水位 hero + 5 张 KPI 卡（64px 圆球 + eyebrow +
      迷你水位条）→ 气泡墙 → 执行历史列表（40px 头像块 + 状态点 + #编号·相对时间 + 详情）→
      活跃度/时长 + 待人工（双列小块，`spansForTail(2, cols)` 每排铺满）。
- [x] **完成任务完全不上页**：`buildRuns` 入口过滤 done 并回 `skippedDone`；KPI 分母/分组/气泡/执行历史/
      时长/告警全部基于未完成；「已完成」分组与「今日完成」卡删除。真机 `skippedDone=48`。
- [x] **真机抓到组件 bug 并修掉**：把 `var()` 写进 `@keyframes` 的 width，Chrome 解析成 fallback 0%
      → 动画结束水位条永远是空的（实测 0px，去掉动画才回到 50%）。改成 `transform: scaleX(0→1)` 入场，
      宽度只由 `--fr-water-pct` 决定，并补了断言（keyframes 里不许 var()、轨道几何、高光在动）。
- [x] 证据：runsView 31、overviewPanel 208、dashboardStyles 8、offline 80 JS + 7 Python；
      真机 50% → 528px / 100% → 99.6px / 0% → 0px。

**第 8 轮（用户醒着，连续三轮指正后定版）：运行页整页照参考项目取值重做**

用户连续三句口径：「先找到对应的气泡墙的代码直接搬过来包括这个页面的布局」→「搬的还不对，整个风格都不对，
也不是圆形，水位线也不对，整个运行页面的卡片布局样式和大小都不对」→「卡片的布局要自适应，不要出现一行里会有空白部分」。

- [x] **定位真正的参考实现**：`kp-z/open_adventure`（私有，`gh repo clone` 拉到 `/tmp`）的
      `frontend/src/app/components/ClaudeModelBubbles.tsx` + `WaterLevel.tsx` + `pages/Dashboard.tsx`
      + `components/ui-shared.tsx`（GlassCard）。我前两版都错在**用自己的样式体系重画**，所以永远差一层。
- [x] **新增 `src/client/runsExactStyles.js`**（`.frx-` 前缀、独立 style id、卸载一起移除）：
      卡片 = GlassCard 原值（rgba(255,255,255,.05)/blur 12px/1px 白 10%/radius 16/padding 24/shadow-xl）；
      网格 = 4 列 + gap 24 + `clamp(320px,(100vh-220px)/3,520px)` 行高、状态卡跨 2 列、窄屏自适应；
      气泡 = 8 个散点位 + 55/52/48/45/38/35/32/28 + float(-8/-4/-10px) + border-2 + 绿/蓝/暗三态光晕；
      水位 = clipPath 圆裁剪 + 填充 rgba(34,197,94,.2) + SMIL 波浪线 3s，**圆 overflow:hidden**（上一版是 visible，
      所以看不出「装液体」——这是「水位线不对」的直接原因）。
- [x] **取舍记录**：这张表**故意不遵守**「只用 14 个宿主令牌」，按参考项目原始色值写死（用户口径「颜色要和参考
      项目完全一致」优先于内部约定），但严格收敛在 `.frx-` 前缀与独立 style id 里，不污染宿主。
- [x] **整页重写**：页头 → 第一行[运行状态(跨2列)：图标/标题/版本/刷新 + 可用任务气泡墙 + 两个小盒] +
      [未完成任务：大数字 + 迷你柱图 + pills] + [运行中] → 第二行[执行历史(跨2列)] + [快捷操作(跨2列, 2×2)]。
- [x] **行内零空白**：实测第一行 3 张卡合计 1112px = 容器 1112px；第二行 2 张卡合计 1112px。
- [x] 证据：overviewPanel 207、runsView 40、dashboardStyles 9、insightView 47、offline 80 JS + 7 Python、
      `npm test` exit 0；提交 `d3276ec`。
- [ ] **待用户定口径**（已问，未答）：① 气泡「当前」用蓝还是全绿；② 两张小卡要不要换成真实趋势图
      （复用 `/api/insight/stats` 的 series）。

**第 9 轮（用户实测三条反馈 + 文档更新）**

- [x] **亮色模式**：`runsExactStyles.js` 原来把表面/文字写死成深色主题的浅灰与白色透明层 →
      亮色下是浅灰字压白底。现在这些全部**从宿主令牌派生**（label-primary/secondary、bg-layer-1/2、
      border-l1/l2、bg-overlay），亮暗自动跟随；只有气泡的品牌绿/蓝光晕保留参考项目原值（语义色）。
      好处是不用猜宿主用 `.dark` 类还是 `prefers-color-scheme`。
- [x] **rail 与卡片留白**：`.frx-page` 从 `padding: 24px 0 0` 改成 `16px 20px 28px`。
- [x] **气泡不是圆的**：宿主对 `button` 的通用样式会顶掉 `9999px` → 改成 `border-radius: 50% !important`
      + `aspect-ratio: 1/1`，实测 55×55 / radius 50%。
- [x] **文档**：README 的「飞书任务集」一节整段重写（三个 tab 的分工、气泡墙与水位的语义、一键整理的
      建议→接受→撤销链路、为什么是 React 而不是 iframe、以及各接口边界），旧版还停留在「只有一棵树 + 一张图」。
- [x] 提交 `9cff68d`（代码）+ 本轮文档提交；证据：overviewPanel 207 / dashboardStyles 9 / offline 80 JS + 7 Python。

**第 10 轮（13:20–13:40，用户要求「从架构上系统性地检查」）**

- [x] **架构体检报告**：新增 `docs/AUDIT-tab-pages-architecture.md`。结论是三层的「看不见的假设」：
      ① **投递层**：客户端包在插件 apply 时只读一次（宿主 11-10 09:37 起、包 11-11 13:17 才重建
      → 实机一直跑旧包，这是「气泡不是圆的」的真因）；② **布局层**：响应式按视口判断，但这块面板宽度
      由宿主 tab 决定 → 必须 `@container`；③ **配色层**：写死颜色在亮色模式必崩 → 表面/文字从令牌派生。
- [x] **rail 宽度 288 → 232**（288 是参考站整页 aside 的口径），窄面板断点 212 / 196。
- [x] **收起态图标对齐**：原来只藏文字没藏 caret → 图标被挤偏；现在 caret 一起隐藏、gap 归零、居中，宽度 52。
- [x] **@media → @container**：`.fo-root` / `.frx-page` 挂 `container-type: inline-size`；
      详情栏/抽屉列改 `clamp(260px,30%,336px)`。全仓现在只剩 `prefers-reduced-motion` 用 @media。
- [x] **插件已重载**（disable → enable），实机现在加载的是新包。
- [x] 证据：overviewPanel 207（含容器查询与收起的断言）、dashboardStyles 8、npm test exit 0、
      offline 80 JS + 7 Python；提交 `d0dbb3e`。
- [ ] **下一轮候选**（按价值排序）：
      1) 把「重建 → 重载插件」做成脚本/提醒（现在靠人记，是这次事故的直接原因）；
      2) 统一 z-index 分层表（现在 5/10/20/21/30/60/61 分散在 4 张样式表）；
      3) 气泡墙在 <480px 的 tab 里减少展示数量（固定取前 8 个在窄框里会挤）。

**第 11–12 轮（15:19–15:40，用户实机反馈驱动的连续修正）**

- [x] **气泡改为内联 SVG 画圆**（`c0f6b24`）：前两轮都在 CSS 层加固（!important → inline → span），
      宿主仍能把盒子拉成圆角矩形。改成 `<svg viewBox="0 0 100 100">` + `<circle>` 后，形状是几何属性，
      任何样式表/宿主 reset 都改不了；水位与数字都在同一层 SVG 里（clipPath + SMIL 波浪线 + `<text>` 居中）。
      水位填充 46%、水面线 2.5px/96%，球面高光移到水位之前（否则糊掉水位）。
- [x] **左侧栏入口改名**（`52a20f3`）：「飞书任务集」→「任务」；只改显示文案，代码标识
      （`feishu-overview` / `dsh-feishu` / 路由）一律不动。
- [x] **气泡群往中心收一档**（`1e4d34a`）：参考项目那张卡只占 4 列里的 2 列（~520px），
      我们面板更宽，照抄 8 个点会摊开；现在按「向 50% 压缩 22%」重算点位、容器 520→430×112，
      实测最小间隙 17px 不重叠。
- [x] **本机可视化验证路径修好**：`/tmp/ovmock`（真 React + 真组件 + mock 快照 + 绝对路径静态服务），
      可以量 computed 值与像素（气泡 55/52/48/45、circle r=44、数字偏移 0、容器 430×112、间隙 17px）。
- [x] 证据：overviewPanel 207、dashboardStyles 8、client.mjs CLIENT_OK、npm test 0、
      offline 80 JS + 7 Python。

**第 13–15 轮（16:00–16:35，交互与侧栏的连续收口）**

- [x] **气泡单击即跳会话**（`bac3e48`）：有会话的泡单击直接 `host.openSession`（原来要双击）；
      没会话的泡退化成「选中看详情」。测试按新口径重写。
- [x] **hover 浮层不再被裁**（`b6d2c30`）：卡片为玻璃效果带 `overflow:hidden`，浮层原来挂在气泡
      **上方**被卡片顶边裁掉 → 改到气泡下方，并按气泡左右位置自适应平移（-85%/-50%/-15%）。
- [x] **侧栏结构**（`12b7659`）：去掉侧栏底部的「刷新 + 折叠」两个按钮；折叠按钮就是顶部 logo；
      刷新挪到正文头部做成图标按钮。
- [x] **尺寸一致性**（`8ffdded` + `23ff3fc`）：两次「大小不一致」的根因都是「各自写死尺寸」——
      第一次是收起态只改 width/height 而 `flex: 0 0 40px` 仍生效；第二次是展开态 logo 40 vs 一级项 44。
      现在收敛成单一变量 `--fo-rail-item`（展开 44 / 收起 36），logo 与一级项共用，测试改成
      断言「两边都引用同一变量」，再写死尺寸会直接红。
- [x] 证据：overviewPanel 207、npm test 0、offline 80 JS + 7 Python；本机预览实测两种状态
      （展开 logo 44×44 / 一级项 44 高；收起两者 36×36；图标均 20×20）。

**第 16–18 轮（16:40–17:30，项目图标系统）**

用户口径：「气泡显示的是任务编号，能不能显示 logo；调研下能不能下载一套图标做本地 logo，
每个项目配一个」→「这只有 18 个太少了，而且很难和项目关联」→「可以现在开始适配吧」。

- [x] **调研结论**（不引依赖、可离线）：Lucide（ISC，~1600）最适合内置；Tabler MIT 大而全、
      Phosphor MIT 多字重、Heroicons MIT 300 个、simple-icons CC0 是品牌商标不适合内部项目。
- [x] **图标集扩到 1461 个**（`268fd65`）：`scripts/gen-lucide-icons.mjs` 从 lucide-static 生成
      `src/client/lucideIcons.js`（压成极简标记，约 276KB，产物入库）。bundle 206KB → 467KB。
- [x] **解决「很难和项目关联」三件事**：① 搜索（英文 id + ~120 个中文别名）；
      ② **按项目名推荐**（QVIZ→图表、MvizLite→盒子、DSH→拼图…）；③ **8 色**（图标上色，气泡可分）；
      另加 **Emoji 页**（0 字节开销，🐛☁️🎮 更好认）。
- [x] **适配到界面**（`b8ba71c`）：运行页气泡（图标/emoji/编号三选一，颜色作用于图标描边）、
      关系树项目行（配了图标就把色点换成图标）。
- [x] **构建号**（`f0dd1bd`）：`scripts/stamp-build.mjs` 把 git sha + 时间写进客户端；
      面板根节点 `data-build`、图标选择器标题显示「项目图标 · 1461 个」+ 构建号。
      原因：反复出现「改了/重建了/刷新了但看起来没变」，光看界面分不清是样式没生效还是加载了旧包。
- [x] 证据：overviewModel 23、overviewPanel 207、npm test 0、offline 80 JS + 7 Python。

**第 19 轮（17:40，颜色收敛）**

- [x] **气泡图标改回正常文字色**（`a632b61`）：用户口径「颜色太难看，就是正常文字颜色就行」——
      去掉自动配色（`autoIconFor` 不再给颜色）、图标 tint 一律留空（用 `label-primary`）、
      图标选择器里删掉「颜色」那一行，避免误导。
- [x] 文档：README 增加「项目图标」一节（1461 个 Lucide + Emoji、开箱自动推断、右键手动配置、纯本地存储）。

**第 20–21 轮（18:30–19:45，运行页的显示口径与可读性）**

- [x] **挂起任务彻底不上运行页**（`c62fc97` 先只从气泡墙剔除 → `7c5d316` 改为入口过滤）：
      用户先问「为什么多了一个『车位』的任务」（那条是 T513644 车位流排查，suspended），
      再明确「挂起的也不显示」。现在 done 与 suspended 都在入口过滤，KPI 四卡、分组去掉 suspended、
      告警只留「前置都完成却仍阻塞」；新增 `skippedSuspended` 计数便于自证。
- [x] **气泡图标缩小**（`7c5d316`）：占圆内 54/100 → **32/100**，线宽反向补偿保持视觉粗细。
- [x] **气泡放大显示**（`7c5d316`）：标题行右侧「小/中/大」三档（0.85/1/1.3），
      气泡直径与容器（430×112 → 最大 559×146）同步缩放。
- [x] **测试口径同步**（改断言不放宽）：runsView 的 GROUP_ORDER/KPI_KEYS 去掉 suspended，
      MIX 夹具的分母（5）、已绑会话（4）、活跃度分档（1/1/1/1）、历史排序、400 条总量（291）全部重算。
- [x] 证据：runsView 30、overviewPanel 207、dashboardStyles 8、npm test 0、offline 80 JS + 7 Python。

**第 22 轮（20:30，小步收尾）**

- [x] **气泡放大档位持久化**（`1e114b5`）：档位存宿主 store 键 `runsZoom`（0.5~2 之外回落 1），
      重开面板/刷新后保持；新增两条断言（三档存在、点「大」后 store=1.3 且高亮切换）。
- [x] 证据：overviewPanel 209、npm test 0、offline 80 JS + 7 Python。

**第 23–26 轮（21:30–次日 10:00，用户逐条验收）**

用户这一轮的每一条口径与落地：
- [x] 「气泡里的图标太大了要小很多」→ 图标占圆内 54/100 → **32/100**（`7c5d316`）。
- [x] 「不要搞档位，我要的是图标变小其他的都不变」→ 我把「小/中/大」放大档位**整个撤掉**
      （`8d011b8`，连 store 键与样式一起删），只留图标变小。
- [x] 「『运行 / N 条未完成任务 · …』这一行都不需要显示」→ 删掉运行页整条页头（`38703df`），
      被过滤的数量改挂根节点 `data-skipped-*`。
- [x] 「运行状态卡片右上的刷新按钮去掉」→ 删除，刷新仍走内容头部（`c829b11`）。
- [x] 「发光和布局要和参考气泡卡片对齐，气泡不要那么集中」→ 补齐两层外发光 + 内发光 + 顶部内高光
      （可跳过 compress）、容器 430×112 → **560×132**，散点用参考原值（`29f4fb0`）。
- [x] 「QVIZ / revision … 这个信息好像也不需要」→ 头部副标题整条删除。
- [x] 「气泡里的水面动画和效果都失效了」→ 两个真因：① **`color-mix()` 放 SVG 表现属性不生效**
      （水面/波浪/发光全不可见）→ 改用参考原值 rgba；② 水位原来只在 running 时画，
      真实数据 0 条在跑 → 改成**每个泡都画**，水位=已跑时长÷最长者（10% 视觉下限）
      （`b6e4be6`）。
- [x] 顺手修好别人留下的过期断言：`relationStats` 多了 `temporalEdges` 后两处期望没同步（`c12d324`）。
- [x] 把工作区里未提交的「时间先后边」实现整理成一次提交（`6977066`，见 §3 时间兜底任务）。
- [x] 构建号改成取**提交时间**（`8e227c1`）：之前写构建时刻，每跑一次 build 就重写文件、工作区永远 dirty。

**第 27–30 轮（10:30–11:40，气泡视觉收口 + 验收并行工作流）**

- [x] **气泡不变量测试**（`27a9b3e`）：把这几天的坑钉成静态断言 —— orbSvg 里不许出现 `color-mix()`、
      水位必须画在每个泡上（不许套 running 三元）、两层外发光必须带高斯模糊、
      图标 ≈1/3（32/100）、已删元素（放大档位/页头/卡片刷新/revision）不许复活。
      断言前先去掉注释（第一版被「解释为什么不能用 color-mix」的注释误判）。
- [x] **对齐参考项目**（`08e34c3`）：三个真因 —— ① 按状态分绿/灰 → 真实数据 0 条在跑，整片灰扑扑；
      ② 发光是硬边圆环（参考是带模糊的 box-shadow）；③ 水位用「跑了多久」→ 只有少数任务有开始时间，
      全挤在底部。改法：球色按状态、发光加 feGaussianBlur、水位改用**项目完成占比**。
- [x] **去掉气泡顶上的灰线**（`4a0816a`）：参考的 `inset 0 1px 0 white/40` 只有 1px，
      我用 1.8 单位宽的弧去模仿 → 放大后变成一条明显灰线；直接删掉并禁止复活。
- [x] **状态色口径**（`3db73b3`）：运行=蓝 / 报错（阻塞）=黄 / 完成=绿；描边、外发光、内发光、水位
      全部跟状态色；历史行的状态文字与小圆点走同一个 `stateClass()`（单一出处）。
      注：飞书任务没有「报错」字段，用 `blocked` 代替，已在提交信息里标注待用户确认。
- [x] **验收并行工作流**（`04a4176`）：共享工作区里长期未提交的一批改动（关系页按钮进画布浮动卡片、
      画布缩放平移聚焦、temporal 边点线+图例、DetailPanel/model/layout 配套、测试 +154 行）
      在全套绿之后统一入库。
- [x] 证据：npm test 0、offline 83 JS + 7 Python、overviewPanel 216、runsOrbInvariants 10、dashboardStyles 8。

**第 31 轮（12:30，滚动与防复发）**

- [x] **运行页恢复上下滚动**（`41813ab`）：宿主 `.fo-feature-host` 是 `flex:1 + min-height:0` 但**自己不滚**，
  `.frx-page`（气泡卡 + 三个统计卡 + 历史 + 动作卡）没设 overflow → 超出一屏就被裁掉。
  改成 `.frx-page` 自己滚（`flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain`）。
  本机把 `.fo-feature-host` 压到 300px 实测：`clientHeight=300 / scrollHeight=1020`，`scrollTop` 0→150 生效。
- [x] **钉住这条不变量**（`b0b2ba4`）：`.frx-page` 必须同时有 `overflow-y:auto` / `min-height:0` /
  `overscroll-behavior:contain`，否则测试直接红（这类问题在界面上「看不出错」，只能靠断言）。
- [x] 顺带确认洞察页没有同类问题：`.fd-page` 早就带了 `overflow:auto`。
- [ ] 注意：本轮 `b0b2ba4` **尚未推到远端** —— `ghssh`（ssh.github.com:443）连接被对端关闭，
  重试 5 次都失败；本地提交已在，等网络恢复再推。

**第 32 轮（13:30，提交准备 + 阻塞记录）**

- [x] 复核工作区里那个 `awesome-dsh-plugin` 提交目录：本地已有分支 `add-kp-z-dsh-feishu` + 提交
      `f95d79d`（README 单行新增，放在 Notifications & Integrations），符合上游「一行一条、
      链接真实仓库」的 Contributing 规范。
- [x] 写了一份**待提交材料**：`PR.md`（PR 标题/正文 + 现状表 + 阻塞说明）与 `submit.sh`
      （一条命令：查网络 → 确认 gh 凭据 → 确保 fork → 推分支 → 开 PR；任一步失败即停）。
      `bash -n` 通过；实跑在第 1 步正确拦下（网络不通）。
- [x] **两个阻塞**（都不是代码问题）：① 网络 —— `ssh.github.com:443` 与 `https://github.com`
      都不通（`Connection closed by 20.205.243.160` / `SSL_ERROR_SYSCALL`）；
      ② 凭据 —— `gh auth status` 报 `The token in keyring is invalid`（账号 kp-z）。
      恢复后 `cd .submission-awesome-dsh-feishu && ./submit.sh` 即可。
- [ ] 另：提交 `b0b2ba4 / 4316a20 / 8953c95` 仍**未推到远端**（同一个网络问题）。

**第 33–34 轮（14:00–15:30，状态对话气泡 + 离线渲染通道）**

用户口径：「正在运行状态的气泡最好悬浮一个状态对话气泡，可以同步当前运行状态」→
「给我个例子」→「只有一行的小的」→「再小一点在右上」→
「**不显示计时，显示状态**，枚举几个状态，**对话气泡样式**，贴**泡沿外**，
运行中和运行完都可以显示，但是**没有新消息可以自动消失**」。

- [x] **状态对话气泡**（`f705074`）：新增 `src/client/sessionPulse.js`（纯逻辑 + SSE 订阅）——
  状态枚举：刚开工 / 运行中 · 第 N 轮（蓝）、已完成（绿）、被阻塞 / 已挂起（黄，**sticky 不消失**）；
  「等待输出」故意不显示（否则每个泡都挂一句，气泡墙变列表）。
  同一条状态不重置计时 → 静默 8s 自动消失；订阅宿主已有 SSE `/api/sessions/activity`（phase/turn），
  没有 EventSource 时安静降级。渲染在泡沿外右上角（`left: calc(100% + 6px)`），带尾巴指泡沿；
  靠右的泡（left ≥ 55%）自动翻到左上角。
- [x] **离线渲染通道**（`c6c8641`）：`scripts/render-runs-preview.mjs` 用迷你 React 在 Node 里渲染
  真实 RunsFeature + 真实样式 → `.runs-preview.html` → 本地 Chrome 截图，**全程不需要网络**
  （网络断掉时这是唯一能复核视觉的手段）。它当场抓到一个真 bug：序列化器不支持 children 里的
  嵌套数组，状态泡在组件树里、产物里却被静默丢弃（真机上就是「看不见」）。
- [x] 测试：`test/sessionPulse.mjs` 19 条 + overviewPanel 3 条渲染断言（219）。

**第 36 轮（16:30–17:30，网络恢复后的收尾）**

- [x] **远端恢复，积压 11 个提交一次性推上去了**（`41813ab..bcb834f`）。
- [x] **awesome-dsh-plugin 的 PR 已经存在**：[#21](https://github.com/Anil-matcha/awesome-dsh-plugin/pull/21)
      （state=OPEN、mergeable=MERGEABLE、作者 kp-z）；fork `kp-z/awesome-dsh-plugin` 的
      `add-kp-z-dsh-feishu` 分支已同步。
- [x] **状态对话气泡真机复量**（真 Chromium + mock 快照）：两个运行中的泡各挂一句「刚开工」，
      左边泡挂右上角、右边泡（left≥55%）自动翻到左上角，尾巴指向泡，23px 高 / 48px 宽，未被裁。
- [x] `sessionPulse` 纳入 `npm test` 显式清单（`9c13d01`）——`test:offline` 会自动发现，
      但 `npm test` 是手工清单，不加就会漏。
- [x] 本地可视化草稿（设计稿 / 预览产物）全部进 `.gitignore`。

**第 37 轮（18:30，验收并行工作流：画板卡片对齐 adventure）**

用户口径：「一键整理改成『建议』按钮放在右上，画板卡片样式完全对齐 adventure 的 workflow，
里面按钮也要一致，只是功能可以修改」。

- [x] 这批改动由并行工作流写完但**一直未提交**（作者停手 4 小时以上），本轮做验收后入库
      （`949e25b`）：
      - 画布浮动卡片内部顺序对齐参考站 WorkflowEditor —— **左侧分段控件**（缩放 −/100%/+）、
        **右侧动作**（适应 / 复位布局）+ **主按钮「建议 N」**（运行中「分析中…」）；
      - 「一键整理」文案改为「建议」，title 写清「先出建议再落库」；
      - styles 新增 49 行、**零字面量颜色**（全走 `g('...')` 令牌）、保持 `fo-` 前缀。
- [x] 验收证据：真 Chromium 读 DOM —— `.fo-canvas-card` 存在，按钮顺序
      `− / 100% / + / 适应 / 复位布局 / 建议`；套件 overviewPanel 219、npm test 0、offline 84 JS + 7 Python。
- [ ] **未完成**：视觉复核 —— 本轮视觉后端不可用（`VISION_BACKEND_UNAVAILABLE_THIS_TURN`），
      只有 DOM 证据；恢复后补看一眼卡片与按钮样式是否真的贴合参考站。

**第 38 轮（19:30，补上第 37 轮的视觉复核）**

- [x] **画板卡片视觉复核完成**（真 Chromium + 视觉模型）：卡片里从左到右是
      `− / 100% / + / 适应 / 复位布局 / 建议✦`；**「建议」在卡片最右侧、是唯一的主按钮**
      （蓝色实心底 + 白字 + 火花图标），与参考站「左边分段控件、右边主按钮」的结构一致。
      → 第 37 轮标记的「未完成：视觉复核」清零。
- [ ] **新发现（只记录，不改）**：视觉复核同时指出画布的**图名与节点离得很远** ——
      分组标题（如「QVIZ 插件开发 3」「未分组 后端 2」）贴在左侧，而节点成堆落在右侧/中下方，
      中间大片空白。看代码这是**按依赖深度分列**的必然结果（`x = PAD + column*(264+64)`，
      孤立节点全在第 0 列、链条深的节点被推到很右），而 mock 数据边很少，所以显得空。
      真机上是否同样明显**需要用户确认**；在确认之前不动布局（这块刚由并行工作流改过）。

**第 39 轮（20:30，接线契约）**

- [x] **补「客户端↔宿主」契约测试**（`4e2b50d`）：状态对话气泡依赖两条隐性约定，改坏不会报错、
      只会「状态不再更新」：① 客户端订阅 `/dsh-feishu/api/sessions/activity` 而宿主内部注册的是
      `route === '/api/sessions/activity'`（前缀由宿主路由层加）——测试自动去前缀后比对；
      ② 客户端读 `phase`/`turn`，宿主 sessions 项构造为 `{ id, alive, phase: item.kind, turn: item.turn }`。
      顺手钉住 activityFeed 帧里有 `revision`。sessionPulse 19 → 21 条。
- [x] 证据：sessionPulse 21、offline 84 JS + 7 Python。

**第 40 轮（21:30，让「运行完也能显示状态」真正成立）**

用户的两句口径互相拉扯：「运行中和运行完都可以显示（状态）」vs「运行完成的任务不需要在卡片里显示」。
同时成立只能靠**短暂停留**：

- [x] **「刚做完」的任务在气泡墙上留 25 秒**（`5694275`）：
      - `runsView` 新增 `recentDoneMs` 选项 + `justDone` 输出：完成时间在窗口内**且有 completedAt**
        的任务生成绿泡（没有完成时刻的不猜）；`justDone` **只给气泡墙用**——
        KPI 分母 / 分组 / 执行历史 / 时长 Top 一律不含（3 条断言钉住）；
      - 顺手把气泡行构造抽成 `toBubble(task)`，未完成与刚做完共用一套字段；
      - `RECENT_DONE_MS = 25s`：绿泡上会先挂 8 秒「已完成」状态泡，然后整颗泡自己消失；
        想彻底不显示把它改成 0 即可（有断言保证 0 时行为与旧版一致）。
- [x] 证据：runsView 30 → 33、overviewPanel 219、npm test 0、offline 84 JS + 7 Python。

**第 41 轮（22:30，给「刚做完」做视觉复核，抓到两个真 bug）**

- [x] **离线预览里加一条「5 秒前刚做完」的任务**，肉眼复核第 40 轮那条路径 —— 当场抓到两个问题
      （`3f3614c`）：
      1. **自相矛盾的颜色**：`stateOfTask` 是 running 优先于 done（因为完成的任务本来不上页），
         而刚做完的任务常常还带 running 标记 → 出现「蓝泡（运行中）」+ 状态泡写「已完成」。
         现在刚做完的行显式钉成 done：绿泡 + 「已完成」。
      2. **`map(toBubble)` 把下标当成参数**：`toBubble(task, stateOverride)` 直接传给 `Array.map`
         时第二个参数是下标 → 除第一条外所有气泡 state 变成 1 → 全部退化成 idle。
         这条被 runsView 的分组/KPI 断言当场抓住（断言的价值体现）。
- [x] 验收：离线渲染 DOM 里 slots = running(b1) / started(d1) / blocked(c1) / **done(a1)** / **done(e1)**，
      状态泡 = 刚开工(brand) / 被阻塞(warn) / 已完成(ok) ×2，颜色与文案一致。
- [x] 证据：runsView 34、overviewPanel 219、npm test 0、offline 84 JS + 7 Python。

**第 42 轮（23:30，把离线预览扩到三页）**

- [x] **离线预览从「只有运行页」扩到三页**（`92f73cb`）：用 `features.js` 的真实注册表拿三个
      Component 逐页渲染；ctx 给最小可用集，**某一页缺 ctx 只影响那一页**（错误写进产物的红框里，
      不让整个预览挂掉）。产物里三段各一个 1100×620 视口。
- [x] 本机结果：三段都渲染、无红框；运行页完整；洞察页出 KPI/分布卡（donut 固定 132×132）；
      关系页走空态 —— 因为预览没传 `graphs`，属**预览数据缺口**，非产品问题。
- [ ] 已知预览缺口（下次补）：① 关系页要传 `graphs` / `treeProps` 才有画布；
      ② 洞察页要传 `insightStats` 才能看历史指标卡。
- [x] 证据：npm test 0、overviewPanel 219。

**第 43–45 轮（00:00–00:40，运行页 KPI 去重 + 关系页工具归位）**

- [x] **运行页 KPI 层重新设计**（`36b9799`）：用户「运行卡片下方的已绑定和右上信息是重复的」——
      查出来其实是**三处**重复：已绑会话（状态卡盒子 vs 运行中卡右上）、运行中（状态卡盒子 vs 运行中卡大数字）、
      未完成（状态卡右上 vs 未完成任务卡大数字）。现在状态卡**只负责状态 + 气泡墙**；
      「未完成任务」卡右上从「N 在跑」（跨卡重复）换成自己的口径「N 阻塞 / 没有阻塞」。
      另补静态去重断言（runsOrbInvariants 12 条）。
- [x] **关系页：已完成默认隐藏 + 工具进卡片头部**（`8a8f761`）：用户「默认隐藏已完成，右上的按钮
      应该在卡片的header 里而不是悬浮」。并行工作流写完停手 25 分钟未提交，本轮验收后入库：
      `hideDone` 默认 true（store 键 hideDone）、边两端都必须在画布上（否则留 ghost 线头）、
      浮动 `.fo-canvas-card` 删除、工具挂到 `.fo-graph-head` 的 `.fo-graph-actions`（`position: static`）。
      真 Chromium 验收：`.fo-canvas-card` 不存在；`.fo-graph-actions` 父节点是 `.fo-graph-head`；
      开关「显示已完成 1」且该条确实不在画布上。
- [x] **「运行状态」下方两张卡的 padding / 列数**（`a944058`）：两张卡内部节奏改成固定（头 →14px→ 大数字
      → 唯一自动空隙 → 底部块），第一行网格 `minmax(240px)→(320px)` 保证宽面板 = 2 列（状态卡独占一行、
      下面两张并排等高）。改后实测：列 459.5×2、两张卡 206/206 等高。
- [x] 证据：overviewPanel 223、runsOrbInvariants 12、dashboardStyles 8、npm test 0、offline 84 JS + 7 Python。

**第 46–52 轮（01:00–02:30，运行页整体重做：徽标 → 3×4 网格 → 旭日图）**

用户这一串反馈都是「边看边改」，按时间顺序记录（每步都已入库并推送）：

- [x] `25d4cb1` 已完成的气泡**不挂任何图标**（并修掉它 hover 浮层误写成「未开始 · 水位 x%」的真 bug）；
- [x] `86c19d2` 徽标**抬高**（改锚右上角）、**只有运行中常驻**（其余状态显示一次自动消失，
      过期留**墓碑**，否则每 8 秒闪一次）、删掉与 KPI 重复的四色图例、补回「待处理 / 跑得最久」；
- [x] `502d7cb` KPI 胶囊**移到卡片右上**、删掉卡片底部项目名、右侧补两张**图统计卡**（按项目分布 / 阻塞排行）；
- [x] `ac47504` 整页改成**固定 4 列网格**（不再 auto-fit，跨度落 class 以便容器查询降列）；
- [x] `489f816` 严格 **3 行 × 4 列**：1 行 = 运行状态(2)+项目分布(1)+阻塞排行(1)；
      2 行 = 待处理+跑得最久+**暂缓**+**计时覆盖**（后两张是补的监控盲区：挂起任务完全不显示、
      计时覆盖率决定时长类指标可不可信）；3 行 = 执行历史(2)+快捷操作(2)；
- [x] `bb03ffe` 项目卡改**旭日图**并按**自定义目录合并项目**（复用 `overview/model.js` 的 `groupByCustom`：
      一个目录 = 一个项目、一个 workspace 只属一个目录、没进目录的各自算）。
      顺手修掉预览脚本的真 bug：`VOID` 里塞了 `path/circle/rect`，导致 SVG 被序列化成无闭合标签、
      后一个兄弟元素被解析成它的子节点（旭日图第一版整片不显示）。
- [x] 并行工作流的**关系页批次**（`496496d`）也已入库：画布头部图标化、边悬停可读、侧栏分组成块。
- [x] 证据：runsView 37（含合并规则 3 条）、runsOrbInvariants 20、overviewPanel 225、sessionPulse 22、
      npm test 0、offline 85 JS + 7 Python。

- [ ] **还没做的（用户点过名，等排期）**：
      ① **一键整理**按钮文字颜色看不到；② **接受建议后没有实际生效**（`organizeAccept` 这条链路要查）；
      ③ 关系侧边栏导航的继续打磨；④ 参考项目里还没对的两个细节：气泡 hover 放大 1.1、水位随剩余量变黄/红。

**第 54 轮（03:30，修主按钮可读性；「接受建议没生效」确认已被并行批次修掉）**

- [x] **主按钮看不清**（`065fb94`）：用户报「一键整理按钮，文字颜色看不到」。
      真机量：（浅色主题）「实心品牌蓝 + `bgBase` 文字」只有 **~3.5:1** —— 11px 的字确实糊。
      根因：**单个令牌做不到跨主题都取「与品牌蓝相反」的那一端**（`bgBase` 暗色深/浅色浅，
      `label-primary` 正好相反）。改用「底色 = 品牌色 62% + 底色 38%；文字 = label-primary」，
      实测 **暗 6.85:1 / 浅 4.33:1**，两个主题都过线，观感仍是实心品牌按钮。
      真机复核：浅色 `oklab(0.7568)` 底 + `oklch(0.22)` 字；暗色 `oklab(0.4566)` 底 + `oklch(0.95)` 字。
      新增红线（dashboardStyles 8 → **9**）：禁止主按钮再用 `bgBase` 当文字、要求 label-primary + 品牌混底色。
- [x] **「接受建议后没有实际生效」→ 已不需修**：并行批次 `496496d` 修的就是它
      （`acceptOrganizeItems` 远端不可用时先落本地、不再整条丢掉），
      `test/organizeRoute.mjs` 现在断言了「远端不可用时接受仍成功 / 逐条写明只在本机 /
      接受后关系真的写进 `/api/overview` 的 relations / 撤销后那条边真的没了」—— 全绿。
- [x] 证据：npm test 0、offline 85 JS + 7 Python、organizeRoute ORGANIZE_ROUTE_OK。

**第 55 轮（04:30，对齐参考项目剩下的两项）**

- [x] **水位颜色跟着剩余量**（对齐参考 `WaterLevel.tsx` 绿→黄→红）：`pct>=66` 绿 / `>=33` 黄 / 否则红。
      水位 = 该项目已完成占比，水位低 = 还有越多活没干 → 水色偏暖。**只改水**，
      气泡描边与外发光仍是**状态色**（蓝=跑/黄=阻塞/绿=其余）—— 用户点名过的状态色口径不能被冲掉
      （断言钉住 `stroke` / `glowOuter` 必须还从 `accent` 取）。
      离线复核：mock 项目都在 33–65% → 水面 `rgba(245,158,11,.3)`、波浪 `rgba(245,158,11,.82)`，描边仍是绿。
- [x] **气泡 hover 放大 1.1**（对齐参考 `hover:scale-110`）：作用在 `.frx-orb-slot`（定位锚点）上，
      徽标跟着走不会脱开；用 transform 不改 width/height；`prefers-reduced-motion` 下关掉。
- [x] 证据：runsOrbInvariants 20 → **22**、overviewPanel 227、runsView 37、npm test 0、offline 86 JS + 7 Python。
- [ ] 剩下：关系侧边栏导航的继续打磨（并行批次已做了一版分组成块）。

**第 56 轮（05:30，截图复核抓到真 bug；离线预览补齐关系页）**

- [x] **「计时覆盖」卡渲染出 `undefined 条` / `NaN%`**（`b123f8e`）：截图复核抓到。
      根因：`runsView` 导出的 `longestUntimed` 是**数字**，卡片却按数组取 `.length`。
      同源问题：「跑得最久」卡副标题用了不存在的 `row.timed`，永远显示「都还没有开始计时」。
      修法：口径收敛到纯函数 —— `runsView` 新增 `timedCount` / `untimedCount`
      （`startFrom > 0` 才算有开始时间，两者相加 == 未完成数），卡片只消费数字并兜底。
      新增红线：禁止再引用 `longestUntimed`、口径必须在 runsView（runsOrbInvariants 20 → **23**）。
- [x] **离线预览补齐关系页**：之前预览只渲染 `Component`，而侧栏树是面板渲染的 `SubNav`
      → 关系页永远只有半截。现在两者一起渲染，树走**真模型** `model.buildTree(...)`
      （手写嵌套样例必漂移：入参其实是扁平 rows + byKey + lanes），节点标题字段对齐 `TaskNodeCard`。
      预览现在三页齐全：运行（9 卡）/ 洞察 / 关系（侧栏树 + 画布 3 节点）。
- [x] **顺手验了容器查询**（真 Chromium 量）：容器 1153px → 4 列；700px → 2 列；600px → **1 列**；
      宽面板下每行卡片等高（第 1 行 329 / 第 2 行 349 / 第 3 行 334）。
- [x] 证据：runsView 37 → **39**、runsOrbInvariants **23**、overviewPanel 227、npm test 0、
      offline 86 JS + 7 Python；产物里 `undefined` / `NaN` 出现次数 = 0。

**第 57 轮（06:30，侧栏导航审计 + 设计稿；按「先设计再实施」不动代码）**

用户口径是「关系相关的功能和 UI 要先设计计划再实施」，本轮只做审计与方案，不改代码。

**审计（按 styles.js 的真实尺寸量）**：`.fo-subnav .fo-row` 行高 28–30px、圆角 8、字号 12；
缩进 = `12 + depth * 8`（compact）→ 三层只有 **12 / 20 / 28px**；
`⋯` 菜单 20×20 hover 才出现；`.fo-row-count` hover 时淡出。

| # | 问题 | 证据 |
| --- | --- | --- |
| 1 | **层级差只有 8px**：三层缩进（12/20/28）比一个项目图标（14px）还窄，目录与项目看着「几乎对齐」 | `indent = (depth) => 12 + depth * (compact ? 8 : 14)` |
| 2 | **hover 时 label 宽度跳变**：计数淡出但**仍占位** → 名字突然变宽、整行文字抖动 | `.fo-row:hover .fo-row-count { opacity: 0 }` |
| 3 | **「未分组」与真目录同权重**：同样的分组底块 + 同样的 caret/图标，容易被当成用户建的目录 | `.fo-subnav .fo-row[data-kind="group"]` 统一底色 |
| 4 | **命中区域偏小**：行高 28–30px、菜单 20×20 | 同上 |
| 5 | **缺 ARIA tree 惯例键**：只有上下/左右，没有 Home / End | `keydown` 分支只处理 Arrow* |

**三套方案**（已渲染设计稿 `sidebar-design-options.html`，A 现状 / B 最小改 / C 完整改）：
- **B（推荐先做）**：① 每层 1px **缩进导轨**；② 计数**定宽 44px**（hover 只淡出、不改布局）；
  ③ 「未分组」换成虚线桶图标 + 降透明度。**纯 CSS + 属性，不动交互与数据**。
- **C（B 之上）**：行高 30 → 32px、缩进 8 → 10px、新增「全部展开 / 折叠」入口 + Home/End 键。

**第 58 轮（07:30，给「效果证据」本身加测试）**

侧栏导航（B/C）还等用户挑，本轮不动共享文件，改做**证据链**：离线渲染产物 `.runs-preview.html`
是我每轮唯一能自己看的东西，却一直没人守 —— 上一轮的 `undefined 条 / NaN%` 正是靠人工截图才发现。

- [x] 新增 `test/previewRender.mjs`（6 条，已挂进 `npm test`）：
  ① **可见文本里不许出现 `undefined` / `NaN`**（模板漏字段就是这种形态）；
  ② 运行页 9 张卡齐全 + 跨列卡还在 + KPI 胶囊恰好 4 个；
  ③ 旭日图 1 个 svg + 弧段 ≥ 4 + 徽标只有 dots/alert/clock（已完成不挂徽标是用户口径）；
  ④ 洞察页渲染成功（无红框错误）；
  ⑤ 关系页侧栏有 `aria-level`（真模型 rows）+ 画布 ≥ 3 节点 + 节点标题用 label 而非 id。
- [x] 证据：previewRender 6、npm test 0、offline 87 JS + 7 Python。

- [ ] **下一轮入口（重要）**：
      **等用户挑 B / C 后实施**（涉及 TreeNav.js + styles.js，属共享文件，需确认没有并行写者）；
      其余待办不变：主按钮已修、水位/hover 已对齐、预览三页齐全。
      1) 工作区仍有并发写入（`GraphView.js` / `GraphFeature.js` / `styles.js`，14:13 起）——
         是「一键整理 → 右上『建议』按钮 + 画板卡片对齐 adventure workflow」那条需求，
         别动，等它落定后再验收；
      2) 参考项目还剩两处未对齐（用户未表态）：hover `scale(1.1)`、水位颜色随剩余量变黄/红；
      3) 合并 PR #21 前如需补充证据，可在 PR 里回一条「插件可安装 + 描述属实」的说明。
      1) **远端推送仍未恢复**（`ssh.github.com:443` 被对端关闭），本地累计 **9 个提交**待推；
      2) 网络恢复后：重推 + 用 `submit.sh` 提交 awesome-dsh-plugin（`gh` 令牌也过期了）；
      3) 待用户确认：状态泡的静默时长（现 8s）、是否也显示「已完成」常驻。
      1) 工作区还有 4 个文件是**别的会话/进程**在写（DetailPanel.js / styles.js / overview/model.js /
         test/organizeSuggestions.mjs，时间边 UI 与断言）——不要碰，等它写完或用户指派；
      2) 参考项目还有两处未对齐（用户未表态）：hover `scale(1.1)`、水位颜色随剩余量变黄/红；
      3) 洞察页亮色模式对比度复核（本机 light harness 已能渲染，视检结论见 §4）。
      1) **等用户确认「1461 个」出现在选择器标题里**；若没有 → 客户端包是进程启动时缓存的，
         必须 `Cmd+Q` 完全退出 DSH 再打开（plugin toggle 换不掉）；
      2) 若确认生效，可选：图标也显示在任务卡片/详情标题上；给 Emoji 加中文分类搜索；
      3) 体积取舍：467KB（含 1461 图标）如果觉得大，可砍到 ~400 个常用回到 ~300KB。
      1) 等用户确认侧栏尺寸；若仍有差异，先问「展开还是收起」，两个状态是分开修的；
      2) 「白色样式」在亮色模式下的复核（球面高光在浅底几乎不可见）；
      3) 关系 / 洞察两页的亮色模式对比度复核。
      1) 等用户确认「刷新后气泡是正圆」；若仍不是 → 只可能是新包没加载（让用户看
         `document.querySelector('.frx-orb-slot svg')` 是否存在，存在即新包已生效）。
      2) 「白色样式」的下一轮：亮色模式下球面高光用反向层（现在白光在浅底上几乎不可见）；
      3) 「关系 / 洞察」两页也统一到令牌派生配色（它们在亮色模式下还没复核过）。
      1. 收 task-18/19（新文件）→ 我接线：`features.js` 注册 `insight`/`runs` 两个功能项 +
         `client.js` 注入 `dashboardStyles.js`；用迷你 React harness 给两个功能页补组件级断言
      2. 收 task-15/16/17（canvas-node-dev 串行三个任务），合并前先跑 `test:offline`
      3. 三件都落地后：真 Chromium 复量三个页面 → 提交 → 派 task-20 只读复核
      4. 时间够就做「一键整理」的真机验收（点一次按钮、看建议单、接受一条、确认关系真的出现）

**已知风险（下一轮先看这里）**：team 成员上限 8 个，已满 → 新工作必须复用现有成员；teammate 有两次
「动手前就崩」的记录 → 派活时都要给「一步步做、每步落地就回报」的约束，并且我自己保留兜底实现。
