# dsh-feishu 插件接口契约（v1）

宿主半体（index.js）与面板（panel.html）、侧栏壳（client.js）之间的固定接口。
**改这里之前先改代码注释里的同一段**：面板不读宿主源码，只认这份契约。

## 左侧栏总览（React 槽位）与自定义目录

总览页是**宿主页面里的 React 组件**：客户端半体用 `ctx.slots.register({name:'sidebar.panellist',id:'feishu-overview',order:24,label:()=>'任务'}, 图标)` 与 `{name:'main',key:'feishu-overview'}` 成对注册（两处必须同 key；图标收宿主的 `{size,active}`；label 用 thunk 以便日后接 locale），组件从 `src/client/*.js` 构建成经典脚本 `lib/client.iife.js`（`pnpm run build:client`，tsdown；产物不入库，`pnpm build` / 安装脚本会重建）。**总览页不再有 `/dsh-feishu/overview` 整页路由、不再有 iframe**（右侧栏「飞书」页签仍是 iframe → `panel.html`，那是上一代实现，本轮范围外）：DSH 官方插件实践要求插件页面以 React 组件渲染在槽位里，否则拿不到宿主主题令牌、明暗切换与 locale。样式只消费 `--dsw-*` 主题令牌（13 个 `--dsw-alias-*` + `--dsw-specific-sidebar-fill`，见 `src/client/styles.js`，类前缀 `fo-`），不得自造调色板。

数据面（页面只碰这三个）：
- `GET /api/overview`：瘦快照 `{ok,revision,now,groups,workspaces,tasks,relations,stats}`。`tasks[]` 带 `workspaceKey`（由 `workspaceGroups.js` 的 `workspaceKeyOf` 唯一计算）、依赖/来源摘要与 `blocked/ready/done/suspended/started/sessionId`；`relations[]` 只有 `{from,to,kind}`；`stats` 为 `{tasks,groups,dependencyEdges,provenanceEdges,blocked,ready}`。**不再下发整份 state**（settings/排期/会话水位都不进响应）。
- `GET /api/overview/revision`：只有 `{ok,revision}`，供页面「变了才刷」。
- `POST /api/workspace-groups`：唯一写接口（见下）。

**自定义目录**：用户把若干 workspace 拖到一起、自己取名（如「QV」），于是「多个项目 = 一个项目」，该组在总览里共用一张关系图。

`state.workspaceGroups` 为 `[{id,name,members:string[],labels:{[key]:string},createdAt,updatedAt}]`。`members` 是 `workspaceKeyOf(task)`（`workspaceId || workspacePath || 'name:'+label`），宿主只当不透明字符串，不解析路径、不校验存在性；`labels` 是 key → 名字快照，成员消失后仍能显示人话。**一个 workspace 只能属于一个目录**：create/update/add 都会把它从别的目录摘掉（含 labels）。目录名唯一（忽略大小写与空白，重名报错），名长上限 40，目录数上限 50，单目录成员上限 200。

`POST /api/workspace-groups`：`{action:create,name,members?,labels?,id?}` / `{action:rename|update,id,name?,members?,labels?}` / `{action:add,id,member:key|{key,label}}` / `{action:remove,id,key}` / `{action:delete,id}`；成功 `{ok:true,group,groups}`，失败 400 `{ok:false,error}`。快照里 `state.workspaceGroups` 额外带 `presentMembers`。读盘经 `normalizeGroups()`：坏行、重号、空名、重复成员直接丢掉，不抛。整块操作**只落本地 state.json**，不触发同步、不写飞书。

## 紧凑任务卡

关联为空时不渲染关联区；有依赖显示Tag前置→Tag当前→Tag后置，所有节点字号/字重与任务卡chip一致，来源派生为虚线箭头。编辑器左右Tag端点同排箭头，前置/来源为选择任务→本任务，后置为本任务→选择任务；选择端下拉按需搜索，不允许绕当前任务任意修改其它pair。筛选与立即同步置任务标题行右侧。节点/+N查看局部关联，编辑控件仅在「···」管理入口按需渲染。文档统一短标签菜单；挂起恢复在底栏右侧，原因弹层确认，原API语义不变。次要删除/解绑等收在更多菜单。弹层期间保留任务锚点，关闭后补绘等待中的快照；不破坏keyed缓存。

## 快照与后台工作区写回

`GET /api/state` 不等待自动化目录I/O；返回最新本地快照与缓存排期，后台singleflight更新缓存。前端singleflight读取，按完整显示签名检测变化，任务卡以ID复用；工作区mutation revision拦截旧state响应并重取。

`POST /api/workspaces/bind` 本地成功返回 `{ok:true,workspace?,cleared?,writeBack:{pending:true}}`；不是飞书已写成功。`state.workspaceWrites[taskId]` / 快照 `task.workspaceWrite` 为 `{title,revision,pending,error,at?}`，独立持久化。每task单worker串行写当前版本，旧完成不更新最新元数据，失败待重试；下轮同步最多启动5worker。前端先本地更新并提示待同步，之后加载状态，不等飞书网络。

## 挂起 / 恢复接口

`POST /dsh-feishu/api/tasks/suspension`：`{taskId,action:suspend|resume|status,reason?,writeBack?}`，默认 suspend；status只读。成功返回 `{ok:true,taskId,suspension,warnings,relations}`。外部副作用失败返回 warnings，不丢本地挂起/恢复凭据；恢复核心副作用失败仍 active=true，可重试。

`state.suspensions[taskId]` 独立持久保存 `{active,reason,at,resumedAt,sessionId,archiveOwned,archiveChecked,archived?,unarchived?,schedules:[{record,status:captured|paused|restored|skipped,newId?}],errors,fieldPending?}`。快照 `task.suspension` 默认 `{active:false}`。只归档当前绑定会话，不归档依赖任务会话。恢复只解本次归档；只恢复捕获且仍存在的inactive规则，旧inactive/删除/过期一次性不复活。DSH无pause方法，恢复创建新ID保留旧记录历史。

`feishu_task_suspend` 与HTTP共用同一方法，taskId可从当前绑定取。新操作能力键 `tasks.suspension`，旧Host不显示无法使用的控件。

筛选模型 v2：`{version:2,facets:{completion,handling,progress,dependency,priority,workspace},keyword,open}`，每facet `{mode:all|include|exclude,values:string[]}`。由面板统一声明驱动UI、规则与摘要，同组OR跨组AND；include空=零匹配，exclude空=全匹配。日常默认排除done/suspended；全部任务解除所有条件；不内置仅挂起preset，用户可配置handling include suspended自行保存。条件移除设all，清空全部与恢复默认分开。旧 `{workspace,status,keyword,showSuspended,open}` 自动迁移，storage键保持不变；已选但不在快照的值保留。缺失依赖数据为unknown，不推断ready。每次打开filterOpen=false，忽略旧open:true；详情/摘要仅展开显示。自定义方案保存在独立浏览器key `dsh-feishu:filter-views`，日常/全部/项目与自定义同排，项目视图动态按当前会话工作区ID或路径精确匹配，不提供上下文则零匹配并提示，模板行增加＋图标（新建模板），支持命名新增、更新当前、确认删除。三个内置模板均允许覆盖，覆盖存储在 `dsh-feishu:filter-defaults`，可确认还原当前模板原始配置；项目覆盖保留动态项目范围。清空全部条件使用原始不限规则，不受全部模板覆盖影响；不改变Host数据。

## 任务关系增量接口

`POST /dsh-feishu/api/tasks/relations`：`{taskId, action:get|suggest|set}`，默认 set；get 可带 `refresh:true` 读取飞书原生依赖；suggest 返回 `{ok,proposal}`（只读）。set 接收 `predecessorIds/successorIds/sourceTaskIds` 字符串数组、`mode:merge|replace`（默认 merge）、`reason`、`writeBack`（默认 true）、`fields`（默认 false）。成功返回 `{ok:true,taskId,relations,remote}`；本地保存成功而远端失败时仍 ok=true，`remote.ok=false` 和 error 明确区分。

`state.relations` 是独立于任务过滤的边数组：`{from,to,kind:depends_on|derived_from,source,reason,createdAt,sessionId}`。依赖方向前置 from → 后置 to；来源方向来源 from → 派生 to。`state.relationSync[taskId]` 保存待同步/错误信息；只在完整远端依赖可读且本地没有待写修改时采纳远端。来源关系只本地持久化，fields=true 可投影来源 GUID 到清单文本列。

面板/快照 `task.relations` 为 `{predecessors,successors,sourceTasks,derivedTasks,blockedBy,ready}`；各摘要 `{id,title,done,missing}`。`state.relationStats` 为依赖边数、来源边数、阻塞任务数、就绪任务数。`feishu_task_relations` 默认 get，taskId 可从当前绑定取。

创建工具增加 `followUp/predecessorIds/successorIds/sourceTaskIds/reason/autoRelate`。followUp 保留原会话绑定，新任务不抢占会话，默认记录原任务来源；创建返回 `bound/relations/remote/aiRelations`。非法关系创建前拒绝；远端任务已创建后关系或 AI 失败不声称创建失败。

## 文件分工（写作用域）

| 文件 | 归属 |
| --- | --- |
| `index.js` | 宿主：配置、同步、工具、定时、HTTP 路由 |
| `panel.html` | 面板 UI（自包含单文件） |
| `client.js` | 侧栏页签注册 |
| `package.json` / `cordis.patch.yml` | 包清单与层栈补丁 |
| `locale/*.json` / `icon.svg` | 显示元数据 |

## 挂载点

HTTP 前缀：`/dsh-feishu`（宿主 `webServer.register({kind:'prefix'})`）。

- 面板：`GET /dsh-feishu/panel?theme=dark|light`
- 接口：`/dsh-feishu/api/...`，全部 JSON（除面板 HTML）。

## 数据结构

`settings`（面板可写，落盘 `~/.dsh/dsh-feishu/settings.json`）：

```json
{
  "autoSync": true,
  "syncIntervalMinutes": 30,
  "cliPath": "feishu-sync-cli",
  "cliBackend": "lark-cli",
  "larkCliPath": "lark-cli",
  "larkDomains": "task,docs,wiki,drive",
  "larkAccountMode": "enterprise",
  "larkScopes": "task:task:read task:task:write drive:drive docx:document wiki:wiki",
  "cliIndexUrl": "https://pypi.example.com/simple",
  "tasks": { "includeCompleted": false, "keyword": "", "dueWithinDays": 0 },
  "docs": { "watch": ["https://example.feishu.cn/wiki/xxx"], "excerptChars": 600 },
  "taskFields": { "workspace": "工作区", "trigger": "触发条件", "legacyAuto": "自动开工" },
  "autoStartMode": "off",
  "autoStartPrompt": "你有一条来自飞书的任务：\n标题：{{title}}\n截止：{{due}}\n链接：{{url}}\n\n{{description}}\n\n请先复述你的理解，再开始处理。",
  "maxAutoStartPerRun": 1
}
```

`state`（宿主只读快照，落盘 `~/.dsh/dsh-feishu/state.json`）：

```json
{
  "auth": { "ok": true, "checkedAt": 1790000000000, "detail": "任务接口可用" },
  "cli": { "backend": "feishu-sync", "found": true, "version": "1.1.3", "path": "/Users/me/.local/bin/feishu-sync-cli" },
  "clis": {
    "feishu-sync": { "backend": "feishu-sync", "found": true, "version": "1.1.3", "path": "/Users/me/.local/bin/feishu-sync-cli" },
    "lark-cli": { "backend": "lark-cli", "found": false, "version": null, "path": null }
  },
  "lastSyncAt": 1790000000000,
  "lastError": null,
  "syncing": false,
  "apiVersion": 4,
  "tasks": [
    {
      "id": "guid",
      "title": "摘要",
      "description": "",
      "done": false,
      "due": "2026-09-24",
      "start": "2026-09-22 09:30",
      "startTs": 1790000000000,
      "end": "2026-09-24",
      "endTs": 1790208000000,
      "dueTs": 1790208000000,
      "url": "https://applink.feishu.cn/client/todo/detail?guid=...",
      "seenAt": 1790000000000,
      "firstSeenAt": 1790000000000,
      "isNew": true,
      "started": false,
      "sessionId": null,
      "startedAt": null,
      "linkSource": null,
      "sessionAlive": false,
      "error": null
    }
  ],
  "docs": [
    {
      "url": "https://example.feishu.cn/wiki/xxx",
      "title": "标题",
      "lastModified": 1790000000000,
      "excerpt": "正文前若干字",
      "seenAt": 1790000000000,
      "error": null
    }
  ]
}
```

`isNew`：本次同步第一次见到的任务（面板打「新」标，用来提示「自动拿过来做」的目标）。

任务自带的配置（写在描述里，见下）解析后放在 `meta`：`{ workspace, auto }`；
### 逾期自动归因（v0.19）

预期过了还没完成 → 让模型给一个可核对的「为什么晚」，人只需要认或改。存在独立表里：

```jsonc
// state.delayAttributions[taskId]
{ "expectedAt": 0, "bucket": "estimate", "reason": "原估两天，实际拆出五个子任务",
  "evidence": "改期记录 3 次", "confidence": 0.8, "at": 0, "source": "ai" }
// state.delayAttempts[taskId] = { expectedAt, at }   ← 失败 6 小时退避，别每轮同步烧 token
```

- 触发：`sync()` 末尾 `attributeOverdueTasks()`（一轮最多 3 条）；也可
  `POST /api/delay/attribute {force?, taskId?, max?}` 手动触发。
- 只处理「已过预期、未完成、这一次预期还没归因过」的任务；**预期改了（重承诺）旧的归因自动失效**，
  会重新归因一次（`attributionView` 用 `expectedAt` 对齐）。
- 快照里以 `task.delayAttribution = {bucket, label, reason, evidence, at, source}` 出现，
  面板在预期芯片旁渲染 `🤖 估时不准`（悬停给依据）。
- 延期原因统计（`delayPatterns`）：人工写过的改期原因**优先**，没有人工记录时才用 AI 归因补桶，
  且 `ai` 字段单独计数。
- 桶：dependency / scope / interrupt / estimate / environment / review / other（`DELAY_BUCKETS`）。

### 工作区绑定：id 为主键（v0.15）

工作区名字在 DSH 里**可以改、也不唯一**（不同目录允许同名），所以名字不能当主键。

```jsonc
// state.workspaceLinks[taskId]
{ "id": "workspace-uuid", "path": "/Users/kp/DEV/x", "title": "工作区名字",
  "boundAt": 0, "titleSyncedAt": 0, "stale": false }
```

解析顺序（`workspace.js` 的 `matchWorkspace`，纯函数）：

1. `binding.id` 在 registry 且 `path` 一致 → 命中（改名不断链）；
2. 否则 `binding.path` 命中 → 命中并重绑新 id（工作区被删掉重建）；
3. 否则文本**精确**等于 title 或 path → 首次绑定；
4. 否则文本归一化（去括号/空格/标点、小写）后精确相等 → 首次绑定；
5. 否则 **失效**：`workspaceError`，卡片红字，不尝试开工。

**已删除**：标题包含匹配、路径后缀匹配、未登记绝对路径兜底——这三种会静默开错目录。
未登记路径改为显式动作：`POST /api/workspaces/register {taskId, path}` → `registry.create()`。

能力探测：`GET /api/capabilities` → `{ok, version, features[]}`。面板是静态文件、随刷新更新，
宿主要重启才换代码；面板开局探一次，探不到（旧宿主 404）就顶部显示「重启 DSH」提示条并禁用新按钮。

换绑：`POST /api/workspaces/bind {taskId, workspaceId}`（面板点工作区标签 → 下拉）。
按 id 写入 `state.workspaceLinks[taskId]`，同步改 `task.meta.workspace`，并立刻
`set_custom_field` 把新名字写回飞书（失败不阻塞本地绑定，返回 `writeBack.error`）。

改名同步：每轮同步对账一次（`registry.list()` 是内存投影），发现 registry 的 title 与绑定不一致
且飞书字段正好是旧名字时，用 `set_custom_field` 把新名字写回（一轮最多 5 条，失败下轮重试）；
`ensure_select_options` 会把新名字补进单选选项。

工作区解析结果单独放 `workspaceName / workspaceTitle / workspaceId / workspacePath / workspaceError / workspaceStale / workspaceCanRegister`。

### 清单自定义字段（首选配置来源）

任务所在清单上建两个字段，插件按 `settings.taskFields` 里的名字去认：

| 字段名（默认） | 类型 | 取值 |
| --- | --- | --- |
| 工作区 | 文本 | 已登记的工作区标题（或路径）；未登记的绝对路径要先「登记为工作区」 |
| 触发条件 | 单选 | 人工触发 / 自动执行 / 按时执行 |
| 开始时间 | 任务原生 `start` 字段 | 「按时执行」的触发时刻；未设开始时间则不按时触发 |
| 结束时间 | 任务原生 `due`（截止） | 过了结束时间就不再自动开工 |

「触发条件」是三态：`manual` 只有人点开工；`auto` 同步发现就开工；`scheduled` 到开始时间开工
（插件每 30 秒巡检一次到点任务，到点后自动跑一轮同步，所以误差 ≤30s）。旧字段「自动开工」的
是/否仍会被读成 `auto` / `manual`。

读字段值需要 `task:custom_field:read`；读选项文字（是/否）同样依赖它；自动建字段需要
`task:custom_field:write`。两者不在 feishu-sync 的默认 scope 里，升级授权时要单独追加
（本插件通过 `feishu_api.py` 复用 CLI 的 token 调这几个接口）。

字段存在时**字段优先**，没有对应字段才回退到下面的描述约定（旧任务兼容）。

### 任务描述里的配置约定（旧，仅作为回退）

| 键（大小写/中英文都认） | 值 | 作用 |
| --- | --- | --- |
| `workspace` / `ws` / `project` / `项目` / `工作区` | 已登记的工作区标题（或路径） | 开工时把会话建在这个工作区；按 id 绑定，改名不断链 |
| `auto` / `auto-start` / `自动开工` / `自动` | `true/yes/on/开/是`、`false/no/off/关/否` | 该任务是否参与自动开工；`false` 永远优先 |

写法：任意行 `键: 值` / `键：值` / `键 = 值`，允许行首 `-` `*` `·`。
标题里的 `[ws:名字]` 是轻量写法（描述里的同名键优先）。都没写时用默认工作目录。
「任务清单名当工作区名」的兜底只对 `meta.source === 'tasklist'` 生效，且解析不到时**静默放弃**、不报错
（当前 `task list --json` 只返回清单 guid 不回名字，所以这条兜底实际不会触发）。

会话绑定字段：`sessionId` 是绑定的 DSH 会话；`startedAt` 是绑定时间；`linkSource` 记录来源
（`open` 面板开工 / `auto` 定时自动开工 / `current` 由模型把当前会话绑上 / `manual` 手填）；
`sessionAlive` 由 `snapshot()` 现算——它只表示「这条会话的 agent 还在本进程里跑」，
**不表示**会话不存在（归档/重启后仍可从侧栏恢复）。面板措辞要按这个语义写。

## 接口

### `GET /dsh-feishu/api/state`

```json
{ "ok": true, "settings": {...}, "state": {...}, "now": 1790000000000 }
```

### `POST /dsh-feishu/api/settings`

请求体：`settings` 的部分字段（深合并）。响应：`{ "ok": true, "settings": {...} }`。

### `POST /dsh-feishu/api/cli/install`

由宿主代装 CLI（GUI 里没有可交互终端）。请求体可选 `{ "backend": "feishu-sync" | "lark-cli" }`，
缺省为当前 `cliBackend`（默认 `feishu-sync`）。指定另一套时先只安装；装成功（或本来就已装）才把它设为当前后端
（响应里 `switched=true`），安装失败不会动现有后端。
- `backend=lark-cli`（显式选择的官方安装入口）：先 `npm install -g @larksuite/cli`，失败再试
  `npx -y @larksuite/cli@latest install`；每步之后都会重新探活。
- `backend=feishu-sync`（公司内部隐藏后端，只在准备卡「高级」里露出）：
  `uv tool install --upgrade --index <cliIndexUrl> feishu-sync`，失败再试
  `python3 -m pip install --user --upgrade --extra-index-url <cliIndexUrl> feishu-sync`；
  pip 命中 PEP 668（`externally-managed-environment`）时自动补 `--break-system-packages` 重试。
  `cliIndexUrl` 为空则不带索引参数。
响应：

```json
{
  "ok": true,
  "backend": "lark-cli",
  "switched": false,
  "installed": true,
  "already": false,
  "steps": [{ "label": "uv tool install feishu-sync", "ok": true, "detail": null }],
  "cli": { "found": true, "version": "1.0.98", "path": "/Users/me/.npm-global/bin/lark-cli" },
  "settings": { "cliBackend": "lark-cli" },
  "error": null
}
```

失败也返回 200：`installed=false`，`error` 是一句人话；`steps` 里每步失败原因原样保留（同一条 stderr 不会重复拼接）。

### `POST /dsh-feishu/api/backend/switch`

切换 CLI 后端。请求体：`{ "cliBackend": "feishu-sync" | "lark-cli" }`。
宿主保存设置 → 重新探活 → 体检授权，一次返回新状态；非法值返回 400。


```json
{ "ok": true, "backend": "lark-cli", "settings": {...}, "state": { "cli": {...}, "auth": {...} } }
```


切换后 `state.cli.backend` 与设置一致；缺省保持 `feishu-sync`，升级不自动切换已有用户的后端。
`feishu-sync-cli` 是公司内部隐藏后端，默认不在准备卡里露出，只在准备卡的「高级」里可选。

### 官方 lark-cli 后端的动作矩阵（v0.21）

引擎里所有「写飞书」的动作都走 `backend().actions(settings, actions)`：
官方后端直接调 Open API，内部后端走 Python 桥，调用方不再自己判断后端。
lark-cli 后端已实现的动作：

| op | 官方接口 |
| --- | --- |
| `task_get` | `GET /task/v2/tasks/{guid}`（评论协作里的权威回执） |
| `set_task_time` | `PATCH /task/v2/tasks/{guid}`（start/due，毫秒字符串） |
| `task_reopen` | `PATCH /task/v2/tasks/{guid}`（completed_at=0） |
| `ensure_custom_field` / `set_custom_field` | `GET/POST /task/v2/custom_fields` + `PATCH /task/v2/tasks/{guid}`；支持文本/单选/多选/日期，拒绝字段/选项歧义 |
| `task_dependencies` / `add_dependencies` / `remove_dependencies` | `GET /task/v2/tasks/{guid}` + `POST .../add_dependencies|remove_dependencies` |
| `task_comments` | `GET /task/v2/comments`（分页，拿不全返回 `incomplete`） |
| `task_comment` | `POST /task/v2/comments`；真实 @ 用 `POST /task/v1/tasks/{guid}/comments` + v2 回执核验 |
| `task_subtasks` / `task_attachments` | `GET /task/v2/tasks/{guid}/subtasks`、`GET /task/v2/attachments` |
| `create_docx` / `update_docx` / `rename_docx` / `delete_file` / `ensure_folder` / `add_tasklist` / `append_description` | 对应 docs/drive/task 官方接口 |

两种后端共享受管任务清单状态机与完整字段契约。`ensure_tasklist` 使用稳定 `client_token`、明确 GUID 与全分页唯一名称查找；字段创建回执未知不会盲目重建。
评论的 `task-v1` 模式通过 raw API 提及原作者（包括本人），保留统一 AI 卡片；权限失败不切换接口重发。只有显式 `native` 才发送无 @ 的原生回复。POST 超时/5xx/回执不符标为 `unknownDelivery=true`；评论和任务分页缺游标/循环/超过上限标为不完整。通知实际到达未验证。

### `POST /dsh-feishu/api/sync`

立即同步（异步，不等待）。响应：`{ "ok": true, "started": true }`；
已在同步中：`{ "ok": true, "started": false, "reason": "syncing" }`。

### `POST /dsh-feishu/api/auth/check`

实测当前后端的授权是否可用。`feishu-sync` 跑一次 task list；`lark-cli` 跑
`auth status --json`（**不带 `--verify`**：企业可能禁用 bot 身份，带 verify 会把能用的
user 授权误判成失败）。

```json
{ "ok": true, "auth": { "ok": false, "checkedAt": 1790000000000, "detail": "refresh token 已被吊销…" } }
```

lark-cli 未就绪时 `auth` 还会带阶段与最近一条浏览器链接，面板据此显示下一步：

```json
{
  "ok": false,
  "stage": "config",
  "detail": "还没配置飞书应用：点「开始授权」会引导你创建应用…",
  "pendingUrl": "https://open.feishu.cn/page/cli?user_code=…",
  "pendingExpiresAt": 1790000600000,
  "checkedAt": 1790000000000
}
```

`stage`：`config`（还没绑定飞书应用）→ `login`（应用已建好、等用户 OAuth）→ `ok`；
若整个应用被租户的数据安全策略拦截，则为 `blocked`（带 `policyBlocked: true`）：

```json
{
  "ok": false,
  "stage": "blocked",
  "policyBlocked": true,
  "detail": "这个应用被租户的数据安全策略整体拦截了（21001）…需要管理员放行…",
  "appId": "cli_xxxxxxxxxxxxxxxx",
  "consoleUrl": "https://open.feishu.cn/app/cli_xxxxxxxxxxxxxxxx/auth",
  "checkedAt": 1790000000000
}
```

判断方式：用 bot 身份调一次 `GET /open-apis/tenant/v2/tenant/query`（不需要用户授权）。
回 `21001`（data security policy）就说明这个应用在租户级被整体挡住，此时发 OAuth 链接
只会得到授权页「当前无需开通或授权任何权限」，插件因此不再生成链接。
`pendingUrl`/`pendingExpiresAt` 来自最近一次授权调用，刷新页面或宿主短暂重启后仍可接着显示；
过期（config 链接 10 分钟、OAuth 设备链接默认 600 秒）后字段消失，重新调一次 login 生成新链接。

### `POST /dsh-feishu/api/auth/login`

按当前后端启动授权：
- `feishu-sync`：`feishu-sync-cli init_token --enable_autofill`
- `lark-cli`：先 `auth status --json`，已授权直接 `already=true`；否则
  `auth login --domain <larkDomains> --no-wait --json` 拿验证链接和 device code，
  后台继续跑 `auth login --device-code <code>`；应用还没配置时返回 `stage="config"` 和
  `config init --new` 的创建链接（单实例：重复点击复用同一条，不会叠进程）。

响应：

```json
{
  "ok": true,
  "url": "https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=…",
  "stage": "login",
  "expiresAt": 1790000600000,
  "already": false
}
```

`url` 为浏览器地址（拿不到时为 `null`）；`stage="config"` 时为创建应用链接。
`settings.larkAccountMode`：`enterprise`（默认）按 `--domain` 申请并做应用级 21001 体检；
`individual`（个人账号）改用 `--scope <larkScopes>` 只做 user OAuth，不做 tenant 探测，
体检里 `permission=false` 时读数据 21001 通常表示资源没共享给该用户。
应用被策略拦截时返回 `{"ok":false,"url":null,"stage":"blocked","error":"…21001…"}`，
不会再生成一条注定失败的链接。
授权完成后宿主置 `auth.ok=true`：面板在拿到链接后每 4 秒自动查一次 `auth/check`，
阶段前进（config→login）或授权成功都会自动更新，并自动触发一次同步；
也可以手动调 `auth/check` 观察，不要自己猜。

> **桌面端（DSH Desktop）硬约束**：面板必须走「先 `auth/login` 拿链接 → 面板内联链接/二维码」。
> 面板页面跑在 `dsh-app://app` 下，`window.open` 插件自己的相对路由会被 Electron 的窗口打开
> 处理静默拒绝（它只把 http(s) 交给系统浏览器，`dsh-app:` 一律 deny），表现就是点「飞书登录」
> 毫无反应。`/api/auth/open` 的 302 直达路由保留给外部浏览器/脚本，面板不再依赖它。

### `GET /dsh-feishu/api/auth/qrcode?stage=login|config`

把最近一条待用授权链接渲染成二维码 PNG（`image/png`，`cache-control: no-store`），
面板直接 `<img src>` 内联显示，不用人手动打开链接。仅官方 `lark-cli` 后端可用
（内部调用 `lark-cli auth qrcode <url> --output /tmp/... --size 512`）。

没有待用链接 / 后端是 `feishu-sync` 时返回 `404 {"ok":false,"error":"..."}`。
链接过期后该接口同样返回 404，重新调一次 `auth/login` 生成新链接即可。

### `POST /dsh-feishu/api/tasks/start`

请求体：`{ "id": "task-guid" }`。为该任务建一条 DSH 会话并把任务描述投进去。

```json
{ "ok": true, "sessionId": "feishu-task-....", "note": "已开工" }
```

失败：`{ "ok": false, "error": "人类可读原因" }`。

### `POST /dsh-feishu/api/tasks/dismiss`

请求体：`{ "id": "task-guid" }`。清掉 `isNew` 标记。响应 `{ "ok": true }`。

### `POST /dsh-feishu/api/tasks/bind-doc`

在任务卡片里手动绑定 / 解绑一篇文档。请求体：

```json
{ "taskId": "task-guid", "url": "https://.../docx/xxx", "remove": false }
```

- `remove:false`（默认）：标题尽力从 `info_page` 拿，拿不到用链接占位；本地记 `source:"手动"`。
- `remove:true`：只从这条任务上摘掉，不删飞书里的文档。
- **两种都立刻把这条任务的全部文档链接重写进飞书「文档」字段**，不等下一次同步。

响应：`{ "ok": true, "docs": [...], "field": { "ok": true }, "docField": "文档" }`；
写回失败时 `ok` 仍为 `true`（绑定本身成立），但 `field.ok=false` 且带 `field.error`，面板据此提示。

### `POST /dsh-feishu/api/tasks/edit-doc`

把任务上已绑定的一篇文档**换成另一个链接**并同步飞书。请求体：

```json
{ "taskId": "task-guid", "url": "https://.../docx/旧", "nextUrl": "https://.../docx/新" }
```

- 标题按 `nextUrl` 重新问一次 `info_page`；换完这条记录按 `手动` 记（原本「生成」的那篇不再是它）。
- 换完**立刻重写飞书「文档」字段**（字段里存的就是链接）。
- `url === nextUrl` 时直接返回 `unchanged:true`，不写飞书。
- 响应：`{ "ok": true, "url": "https://.../docx/新", "previousUrl": "...", "title": "...", "field": { "ok": true }, "docField": "文档" }`。
  非法链接返回 400 `{ ok:false, error }`。

### 设置里的两个新开关

`POST /dsh-feishu/api/settings` 接受：

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `contextInjection` | `false` | 绑定任务时把「任务档案」投进会话，并挂一段几行的 system prompt 提示 |
| `pushChanges` | `false` | 同步发现标题/状态/新增文档变化时，往绑定会话投一条通知（同会话 5 分钟最多一条） |
| `autoComment` | `true` | 每个 turn 结束把本轮结论写进绑定任务的飞书评论 |
| `autoCommentMinSeconds` | `45` | 同一会话两条进度评论的最小间隔（10–3600 秒） |

### 模型工具 `feishu_task_detail`

`{ taskId?, refresh? }`：不传 `taskId` 就用**当前会话绑定的任务**（`exec.agent.id` 反查）。
返回任务全量档案 + 评论/子任务/附件（补充通道，120s 缓存）。缺 scope 时对应段落是「（读取失败：…）」。

> 注意：工具实现必须用 `execute(args, exec)` 把 exec 透传下去——`exec.agent.id` 就是当前会话 id，
> 早期版本只传了 args，导致 `feishu_task_session bind` / `feishu_task_report` 全都「拿不到当前会话」。

### `POST /dsh-feishu/api/tasks/create-doc`

给这条任务生成 / 更新一篇飞书文档（统一目录 `DSH 任务文档 / <T<n>-任务名> /`），
生成后同样把链接写回「文档」字段。响应 `{ "ok": true, "url": "...", "updated": false, "tables": 3 }`。

#### 任务改名时文档跟着改

`POST /api/tasks/rename` 成功后，会把**这条任务自己生成的**那篇文档的标题也改成新任务名
（响应里多一个 `docTitles: [{ url, ok, error? }]`）；手动绑定的外部文档不动。

### `POST /dsh-feishu/api/docs/read`

请求体：`{ "url": "https://..." }`。响应 `{ "ok": true, "markdown": "..." }`（超长截断到 20000 字符）。
按当前后端读取：`feishu-sync` 用 `read_page_as_markdown`，`lark-cli` 用 `docs +fetch --doc-format markdown`。

### `POST /dsh-feishu/api/docs/watch`

请求体：`{ "url": "https://...", "remove": false }`。加入/移出监听列表。
响应 `{ "ok": true, "watch": ["..."] }`。

## 面板要求

- 单文件、无外部依赖（不引 CDN、不引字体、不引图片），离线可用。
- 中文界面；跟随主题：`?theme=dark` → `<body class="dark">`，也接受
  `postMessage({type:'dsh-feishu:theme', dark:true})`。
- 颜色只走 CSS 变量，且必须有宿主令牌和回退两套，例如
  `color: var(--dsw-alias-label-primary, #14141a)`；
  需要自己的变量时在 `:root` / `body.dark` 各定义一份。
- 布局：单列、最大宽度 760px、内边距 16px；窄到 420px 以下不横向滚动。
- 任务条目若已有会话：显示「运行中 / 已结束」、可复制或截断的会话 id，以及「打开会话 / 复制 ID / 解绑」；
  「打开会话」用 `window.parent.postMessage({type:'dsh-feishu:open-session', sessionId})` 交给 client 半体，
  由它调用宿主 `uiWorkspace.openSession`。不在 iframe 里时退化为复制 ID。
- 未绑定会话、且宿主通过 `{type:'dsh-feishu:context', sessionId}` 告知了当前会话时，显示「绑定到当前会话」。
- 结构（自上而下）：
  1. 飞书准备卡，两步：
     1) 安装 CLI：两套二选一（feishu-sync-cli / 官方 lark-cli），各一个安装按钮，
        点哪套就调 `/api/cli/install` 的 `{backend}` 并切到那套；已装的可「重新检查」；
     2) 完成飞书授权：按当前后端走个人令牌或 lark-cli OAuth；提示用中性色，不再用橙色告警。
     切换后端也可以直接调 `/api/backend/switch`。
  2. 状态条：授权（可用/需授权）、CLI 版本、上次同步时间、同步中指示。
  3. 授权卡：未授权时显示「开始授权」，拿到 url 后显示可点链接 + 「我已完成授权」；
     提供「检查授权」按钮。
  4. 同步设置：自动同步开关、间隔（分钟）、只读未完成、关键词、自动开工开关 + 每轮上限。
     保存按钮调 `/api/settings`。
  5. 任务列表：标题、截止、新标记、按钮「开工」「略过」；空态文案。
  6. 文档监听列表：标题 + 最后修改 + 「打开」「移除」；输入框添加 wiki/文档链接。
- 交互细节：打开时拉一次 `/api/state`，`syncing` 为真或每 20 秒轮询；所有写操作后重新拉取。
- 无障碍：按钮是 `<button type="button">`，输入有 `<label>`，状态文案在 `aria-live="polite"` 区。
- 错误呈现：接口 `ok:false` 时在页面顶部 toast，不要 alert()。

## 时间自动化 · 排期层（v0.10 新增）

这一层把「什么时候开工」从飞书字段里解耦出来，改成**一句话 → 可求值规则 → 准点触发**。
设计文档：[docs/DESIGN-ai-scheduling.md](docs/DESIGN-ai-scheduling.md)。

### 唯一真相源：DSH 自动化任务（`@deepseek-ai/dsh-schedule`）

从 v0.13 起，「定时」不再自己记时间——**有绑定会话的任务，一律以 DSH 的自动化任务为准**：

- 显示：`ctx.schedule.catalog()` → 按 `sessionId` 分组，卡片上的 `⏰` 就是这条记录；
  会话里有多条时显示最先到点的一条，其余在悬停里报数量。**本地 `state.schedules` 不再参与**。
- 写入：面板改时间 = `ctx.schedule.create()` / `update()`（已有则原地改，保留 id 与投递历史），
  同时清掉该任务的本地排期条目，避免 DSH 投一次、本地再开一次。
- 清除：`ctx.schedule.delete()` 只删卡片上那一条；还有剩余会在返回里报 `remaining`。
- 暂停：DSH 没有暂停语义 → 明确报错「改时间或清除即可」。
- 本地 scheduler：**已停用**。`scheduleViewOf()` 只读 DSH 记录，`dueScheduleTasks()` 恒为空。
- **没绑定会话 = 不能排期**：`set / preview / clear` 一律 400，面板上的 ⏰ 变成禁用态并提示「先绑定会话」。
- **一个会话只允许一条自动化**：保存时若发现多条，收敛成一条（删掉多余的）；
  清除等于删掉这条会话的全部自动化记录。

`spec` → DSH selector 的映射（见 `dshSchedule.js`）：

| 插件 spec | DSH 请求 |
| --- | --- |
| `kind:'at'` | `at`（ISO 时刻） |
| `kind:'interval', everyMinutes` | `every_seconds`（≥60） |
| `kind:'daily', time` | `daily: { time, time_zone }` |
| `kind:'workdays', time` | `weekly: { time, time_zone, weekdays: [1..5] }` |
| `kind:'weekly', time, weekdays` | `weekly: { time, time_zone, weekdays }` |
| `kind:'monthly', time, monthDays` | `cron: { expression: 'M H D,D * *', time_zone }` |

DSH 没有免打扰 / 只在某时段 / 到某天为止 / 最多 N 次：这些条件**不静默吞掉**，
`toDshRequest()` 会把它们放进 `warnings`，面板原样显示「不会生效」。

提示词就是到点发给会话的那句话（`settings.schedule.automationPrompt`，默认
「继续这条任务：先制定计划，然后按计划开始执行。」，支持 `{{title}} {{list}} {{workspace}}`）。
服务缺席（老 profile / headless）时自动退回下面的本地排期，插件照常工作。

### 数据结构（历史遗留，不再使用）

```jsonc
// state.schedules[taskId]：v0.14 起停用。老状态里的条目会被忽略（不显示、不触发），
// 只在新保存时顺手清掉，方便回滚

{
  "spec": {
    "kind": "at | interval | daily | workdays | weekly | monthly",
    "at": "2026-11-02T15:00:00+08:00",   // kind=at
    "everyMinutes": 60,                   // kind=interval（步长，最短 5 分钟）
    "time": "09:30",                      // 固定钟点类（daily/workdays/weekly/monthly）
    "weekdays": [1, 3],                   // weekly（1=周一）
    "monthDays": [1, 15],                 // monthly
    "quiet": [["12:00", "13:30"]],        // 免打扰（规范形状是二元数组）
    "window": ["09:00", "19:00"],
    "missPolicy": "delay | skip | next",
    "graceMinutes": 30,
    "until": "2026-12-31T23:59:59+08:00",
    "maxRuns": 10,
    "tz": "Asia/Shanghai"
  },
  "createdAt": 0, "lastFiredAt": 0, "runs": 0,
  "paused": false,
  "source": "nl | plan | feishu",
  "delivery": "session | spawn | auto",   // 到点怎么交付（见下）
  "lastReason": ""
}
```

不变式：

- `lastFiredAt` **必须非 0**（创建时等于 `createdAt`）：0 会被当成 1970 年，触发判定会判成「睡过头一万多天」。
- 存盘前 spec 一律经过 `compileSpec()` 归一化；宽松写法（`quiet:[{start,end}]`）在入口处就统一。
- `anchor`（截止前 2 小时）在落地时立刻算成绝对 `at`，之后不随任务改期自动漂移。
- 快照里的 `task.schedule` 是**派生字段**（`summary/nextText/nextAt/state/runs/lastReason`），不进状态文件。

### 接口

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/dsh-feishu/api/schedules` | — | `{ok, items:[{taskId,title,summary,nextAt,nextText,state,runs,lastReason}]}` |
| POST | `/dsh-feishu/api/tasks/schedule` | `{taskId, action: preview\|set\|clear\|pause\|resume, when?, spec?, writeBack?}` | `{ok, preview:{summary,nextAt,nextText,warnings,spec,tz}, task:{id,schedule}}` |
| GET | `/dsh-feishu/api/plan` | — | `{ok, candidates:[{taskId,title,priority,due,idleDays,suggestedMinutes}], capacity, workHours, quietHours}` |
| POST | `/dsh-feishu/api/plan/commit` | `{plan:[{taskId,minutes,why}], startFrom?, writeBack?}` | `{ok, committed, failed, errors, totalMinutes}` |

`preview` 必须无副作用（不写 state、不写飞书）；`set` 失败时返回 `ok:false` + 中文原因，不改已有排期。

### 模型工具

- `feishu_task_schedule`：`{taskId?, action, when?, spec?(JSON 字符串), writeBack?}`。
  自然语言走 `when`；只有模型自己算好 ISO 时间时才用 `spec`。
- `feishu_plan_today`：`{action: preview|commit, plan?(JSON 字符串数组), startFrom?, writeBack?}`。

工具返回**人话**（含下次触发时刻与跳过原因），不返回裸 JSON。

### 设置

`settings.schedule = {timeZone, workHours:{start,end}, quietHours:[{start,end}], missPolicy, graceMinutes, dailyCapacityMinutes, writeBackDefault}`。
非法时区/时间/策略一律回落到默认值，不允许因为一条坏设置让整个插件加载失败。

### 与「触发条件」字段的关系

- 飞书「触发条件 = 按时执行 + 开始时间」仍然有效：同步时合成 `source:'feishu'` 的排期兜底。
- 有本地排期时**以本地为准**；排期是显式授权，不受 `autoStartMode` 三档开关限制，
  但仍受 `maxAutoStartPerRun` 限制。
- 任务截止时间已过 → 排期不触发（reason：已过截止时间）。
- `delivery` 决定到点后的会话来源：`session`（默认，只投已有会话；没会话时 fire=false，
  reason「未生效：还没有会话」）、`spawn`（没会话就新建，飞书「按时执行」字段映射成它）、
  `auto`（有就用、没有就建）。旧数据没有这个字段：`source='feishu'` 按 spawn，其余按 session。
- 一次性排期（`kind:'at'`）开工后失效；重复排期（interval/daily/workdays/weekly/monthly）在任务已开工时
  **不新建会话**，改为向 `task.sessionId` 投递一轮（`nudge`），并照常推进 `runs/lastFiredAt`。
- 开工/推送失败记 `lastAttemptAt`，5 分钟内不再重试，避免到点判定反复拉同步烧 token。

## 履约：生命周期时间与预期完成（v0.11 新增）

设计稿：[docs/DESIGN-task-lifecycle.md](docs/DESIGN-task-lifecycle.md)。

### 数据（本地权威，按任务）

```jsonc
{
  "startAt": 1793000000000,     // 首次绑定会话的时刻（绑定即开始）
  "endAt": 1793100000000,       // 标记完成的时刻
  "expectedAt": 1793583000000,  // 当前承诺
  "promiseLog": [{ "at": 0, "expectedAt": 0, "kind": "set|recommit", "reason": "" }],
  "delayLog":   [{ "at": 0, "from": 0, "to": 0, "days": 2, "reason": "" }],
  "etaSyncedAt": 0,             // 上次成功写进飞书的值（用于区分回声/人工修改）
  "etaSyncPending": false,
  "etaSyncError": null
}
```

快照里另有派生字段 `task.commitment`（不落盘）：

```jsonc
{
  "state": "none|pending|overdue|early|on_time|late|done_unknown",
  "slackMs": 0, "label": "剩 2 天",
  "expectedAt": 0, "expectedText": "2026-10-30 18:00",
  "firstPromiseText": "2026-10-28 18:00", "delayCount": 1,
  "syncState": "ok|pending|failed|off", "syncError": ""
}
```

不变式：

- 开始/结束只用于计算，不进卡片；`endAt` 只在本地完成或同步到飞书已完成时写入。
- `expectedAt` 的真相是本地事件流；飞书「预期完成」**文本**列是投影 + 人工输入口。
- 远端变化判定：命中 `etaSyncedAt` → 自己写的回声；否则视为人工改期，记一条 `promise_changed`。
  `etaSyncPending=true` 期间不采纳远端（我们自己的写还没送达）。
- 延期以**首次承诺**为基准；重承诺单独计数，不覆盖首次。

### 飞书字段

| 用途 | 字段 | 类型 | 写方向 |
| --- | --- | --- | --- |
| 预期完成 | 清单自定义「预期完成」 | text，`YYYY-MM-DD HH:mm` | 双向（人工可改） |
| 开始时间 | 任务原生 `start` + 既有「开始时间」日期列 | native / datetime | 单向写 |
| 结束时间 | 原生 `completed_at` + 既有「结束时间」日期列 | native / datetime | 单向写 |

日期列只精确到天（实测），所以预期用文本列；日期列**已存在才写，不创建**。

### 接口

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| POST | `/dsh-feishu/api/tasks/eta` | `{taskId, action: preview\|set\|clear, when?, reason?}` | `{ok, preview:{at,text,cleared,warnings}, task:{id,commitment}, sync?}` |
| GET | `/dsh-feishu/api/fulfillment` | `?days=28` | `{ok, days, summary}` |

### 工具

- `feishu_task_eta`：`{taskId?, action: set\|preview\|clear\|list, when?, reason?}`，返回人话。
- `feishu_tasks` 每条任务多一段 `📅 预期 …（剩/逾期/延期）`。

### 设置

`settings.schedule` 追加：`writeEtaToFeishu`（默认 true）、`writeStartToFeishu`（true）、
`writeEndToFeishu`（true）、`etaDefaultClock`（默认 `18:00`，只给日期时用）。

抓烟测试会先把这三个写回开关关掉，避免测试改真实飞书。
