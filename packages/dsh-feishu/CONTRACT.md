# dsh-feishu 插件接口契约（v1）

宿主半体（index.js）与面板（panel.html）、侧栏壳（client.js）之间的固定接口。
**改这里之前先改代码注释里的同一段**：面板不读宿主源码，只认这份契约。

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
  "tasks": { "includeCompleted": false, "keyword": "", "dueWithinDays": 0 },
  "docs": { "watch": ["https://momenta.feishu.cn/wiki/xxx"], "excerptChars": 600 },
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
  "cli": { "found": true, "version": "1.1.3" },
  "lastSyncAt": 1790000000000,
  "lastError": null,
  "syncing": false,
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
      "url": "https://momenta.feishu.cn/wiki/xxx",
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
工作区解析结果单独放 `workspaceName / workspaceTitle / workspacePath / workspaceError`。

### 清单自定义字段（首选配置来源）

任务所在清单上建两个字段，插件按 `settings.taskFields` 里的名字去认：

| 字段名（默认） | 类型 | 取值 |
| --- | --- | --- |
| 工作区 | 文本 | 已登记的工作区标题，或绝对路径 |
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
| `workspace` / `ws` / `project` / `项目` / `工作区` | 已登记的工作区标题，或绝对路径 | 开工时把会话建在这个工作区 |
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

### `POST /dsh-feishu/api/sync`

立即同步（异步，不等待）。响应：`{ "ok": true, "started": true }`；
已在同步中：`{ "ok": true, "started": false, "reason": "syncing" }`。

### `POST /dsh-feishu/api/auth/check`

实测个人令牌是否可用（跑一次 task list）。响应：

```json
{ "ok": true, "auth": { "ok": false, "checkedAt": 1790000000000, "detail": "refresh token 已被吊销…" } }
```

### `POST /dsh-feishu/api/auth/login`

启动 `feishu-sync-cli init_token --enable_autofill`。响应：

```json
{ "ok": true, "url": "https://accounts.feishu.cn/open-apis/authen/v1/authorize?..." }
```

`url` 为浏览器授权地址（拿不到时为 `null`）。授权完成后宿主置 `auth.ok=true`；
面板轮询 `GET /api/state` 观察，不要自己猜。

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
  1. 状态条：授权（可用/需授权）、CLI 版本、上次同步时间、同步中指示。
  2. 授权卡：未授权时显示「开始授权」，拿到 url 后显示可点链接 + 「我已完成授权」；
     提供「检查授权」按钮。
  3. 同步设置：自动同步开关、间隔（分钟）、只读未完成、关键词、自动开工开关 + 每轮上限。
     保存按钮调 `/api/settings`。
  4. 任务列表：标题、截止、新标记、按钮「开工」「略过」；空态文案。
  5. 文档监听列表：标题 + 最后修改 + 「打开」「移除」；输入框添加 wiki/文档链接。
- 交互细节：打开时拉一次 `/api/state`，`syncing` 为真或每 20 秒轮询；所有写操作后重新拉取。
- 无障碍：按钮是 `<button type="button">`，输入有 `<label>`，状态文案在 `aria-live="polite"` 区。
- 错误呈现：接口 `ok:false` 时在页面顶部 toast，不要 alert()。
