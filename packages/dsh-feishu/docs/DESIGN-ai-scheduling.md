# 任务时间自动化：AI 排期层设计

> 目标：把「什么时候做哪件事」从**在飞书里手填字段**，变成**一句话 + 模型取舍 + 插件确定性执行**。

## 1. 现状与问题

现在（v0.9.x）的时间自动化只有一条链路：

1. 用户在飞书任务上手工设置「触发条件 = 按时执行」+ 原生「开始时间」；
2. 插件每 30 秒巡检一次，到点就跑一轮同步，同步里按 `evaluateAutoStart` 开工。

四个硬伤：

| # | 问题 | 后果 |
| --- | --- | --- |
| 1 | 时间只能手填，不能自然语言 | 要开飞书 → 找字段 → 自己算「下周一 9:30」是什么日期 |
| 2 | 只支持单点时间 | 「每周一」「工作日早上」「截止前 2 小时」都表达不了 |
| 3 | 触发判定是 30 秒盲轮询 | 没有工作时段、免打扰、错过补偿；睡眠/重启后错过就永远错过 |
| 4 | AI 只能「建议」 | 洞察卡片说「今天先做 T3」，但没有一条路径把它变成真实的开工时间 |

## 2. 设计原则

**AI 做语义，插件做算术。**

- 模型负责：理解「下周一早上」「截止前一天」这种话、决定今天该排哪几件、给每块多久、为什么；
- 插件负责：把时间意图编译成**确定的 spec**、算出**下一次触发时刻**、校验容量/时段/冲突。
- 所有时间计算都是纯函数、可单测；模型不参与「2026-11-02 是不是周一」这类算术，避免编造时间。
- 与洞察卡片同一原则：**数字来自本地，模型只决定形状**。

## 3. 数据模型：Schedule Spec

一条任务的排期是一份可序列化的 spec（存在本地 state 里，不依赖飞书字段）：

```jsonc
{
  "kind": "at | daily | workdays | weekly | monthly",   // 必填
  "at": "2026-11-02T15:00:00+08:00",                    // kind=at：绝对时刻（ISO）
  "anchor": "due | start | created",                    // kind=at 可改用锚点 + 偏移
  "offsetMinutes": -120,                                // 截止前 2 小时 = -120
  "time": "09:30",                                      // 重复类：当天时刻 HH:mm
  "weekdays": [1, 3],                                   // weekly：1=周一 … 7=周日
  "monthDays": [1, 15],                                 // monthly
  "window": ["09:00", "19:00"],                         // 只在此时段内触发
  "quiet": [["12:00", "13:30"]],                        // 免打扰（触发会被推迟到之后）
  "missPolicy": "delay | skip | next",                  // 错过怎么办，默认 delay
  "graceMinutes": 30,                                    // delay 的宽限窗口
  "until": "2026-12-31T23:59:59+08:00",                 // 截止后不再触发
  "maxRuns": 10,                                         // 最多触发几次
  "tz": "Asia/Shanghai",
  "note": "人话备注，面板上展示"
}
```

存储：`state.schedules = { [taskId]: { spec, createdAt, lastFiredAt, runs, paused, source, lastAttemptAt } }`。
`source` 取值 `nl`（面板/工具自然语言）/ `plan`（AI 排期落地）/ `feishu`（从飞书字段读到的时间）。

两条容易踩的实现约定：

- **`lastFiredAt` 创建时等于 `createdAt`，不能是 0**。0 会被当成 1970 年，`evaluateSchedule` 会判成
  「睡过头一万多天」。
- **全局约束不写进 spec**：免打扰 / 错过策略 / 宽限 / 时区是「设置」，改一次要对所有排期生效，
  所以求值时才套上去（`withScheduleDefaults`）；spec 里只保留用户显式说的那部分。

**兼容**：飞书「触发条件=按时执行 + 开始时间」仍然是有效输入。同步时若任务没有本地 schedule，
就用开始/结束时间合成一条 `kind:'at'` 的 spec（`source:'feishu'`）；本地 schedule 优先。
两者都不存在时，行为与今天完全一致。

## 4. 模块：`schedule.js`（纯函数，无 IO）

```js
export const TZ_DEFAULT = 'Asia/Shanghai'

// 宽松输入 → 规范 spec。错误一次全给，不要只报第一条。
export function compileSpec(input, opts = {})            // {ok, spec?, errors?}
// opts: { tz = TZ_DEFAULT, now = Date.now() }

// 下一次触发时刻（epoch ms），不会再触发返回 null。
export function nextFireAt(spec, after = Date.now())     // number | null

// 触发判定（调度器唯一入口）。
export function evaluateSchedule(entry, opts = {})
// entry: {spec, lastFiredAt, runs, paused}
// opts:  {now, done, started, endTs, graceMs?, defaultMissPolicy?}
// → {fire, reason, nextAt, waitMs?, late?, deferredBy?}
// reason 是给人看的一句话：'到点' / '未到点' / '免打扰推迟到 13:30' / '已过截止时间' / '机器睡了 2 小时，按 skip 跳过'

// 自然语言 → spec（确定性优先；说不准就返回候选，不要瞎猜）
export function parseWhen(text, opts = {})
// → {ok, spec?, candidates?: [{spec, label, at}], error?}
// opts: {tz, now, anchorTs, anchorKind}

// 人话描述：'每周一 09:30'、'2026-11-02 15:00（还有 2 小时）'
export function describeSpec(spec, opts = {})            // string

// 触发器自增后的下一状态（lastFiredAt/runs 由调用方落地）
export function advance(entry, firedAt, opts = {})       // {entry, done}
```

### 必须支持的输入形态（`parseWhen`）

| 输入 | 结果 |
| --- | --- |
| `2026-11-02T15:00:00+08:00` / `2026-11-02 15:00` | kind=at |
| `明天 15:00` / `明天下午三点` / `今晚八点` / `后天上午 10 点` | kind=at |
| `30 分钟后` / `两小时后` / `半小时后` | kind=at（相对 now） |
| `下周一 9:30` / `本周五 18:00` / `周一` | kind=at（最近的未来那一天） |
| `每天 9:00` / `每日 8:30` | kind=daily |
| `工作日 9:00` / `每个工作日早上九点` | kind=workdays |
| `每周一 9:30` / `每周五 18:00` / `每周一、三 10:00` | kind=weekly |
| `每月 1 号 10:00` / `每月 15 日` | kind=monthly |
| `截止前 2 小时` / `提前一天` / `到期前 30 分钟` | anchor=due, offsetMinutes=-120/-1440/-30 |
| `开工后 1 小时` | anchor=start, offsetMinutes=+60 |
| 带窗口：`工作日 9:00，只在 9:00-19:00 之间` | + window |
| 带免打扰：`每天 9:00，午休别打扰` | + quiet=[["12:00","13:30"]] |
| 带截止：`每周一 9:30 到 12 月底` | + until |

中文数字（一二三…十、半）与「上午/下午/中午/晚上/凌晨/早/晚」都要支持，`15:00`/`15点`/`3 点半` 都要支持。
解析不出来时返回 `ok:false` + 候选，不允许抛异常。

## 5. 调度器（index.js）

把现在的「30 秒盲轮询」换成**按最近触发时刻动态 arm 的单定时器**：

```
armSchedule():
  next = min over schedules(nextFireAt) ∪ 现有 30 分钟同步
  setTimeout(→ onFire, next - now)，封顶 30 分钟（顺带兜住跨天/改设置）
onFire():
  遍历 schedules：evaluateSchedule → fire?
    是 → 立刻 engine.sync({source:'timer'})，落地 lastFiredAt/runs
  重新 armSchedule()
```

- 启动时先做一次**错过补偿**：`lastFiredAt` 到 now 之间漏掉的用 `missPolicy` 判定（`delay` 在宽限内补跑一次）。
- 免打扰/工作时段在 `evaluateSchedule` 里判定，不 fire 时给出 `deferredBy`，面板直接显示「为什么还没跑」。
- 开工失败（工作区没登记、宿主没就绪）记 `lastAttemptAt`，5 分钟内不再重试——否则到点判定每 30 秒
  触发一次同步，会一直烧 token。
- 一个 tick 最多开工 `maxAutoStartPerRun` 条，按 P0→P3、再按 `nextAt` 升序。
- 打开「每天 9:00」这种重复排期时，开工后要能继续排下一次，不能变成一次性。
  具体语义：**一次性排期开工后即失效；重复排期开工后每到点往已绑定的会话推一轮**
  （复用同一条会话，不新建——否则一周就是七条孤儿会话）。任务没有会话 id 时降级为跳过并记 `lastAttemptAt`。

## 6. AI 排期落地（`feishu_plan_today`）

工具签名：

```jsonc
feishu_plan_today({
  "action": "preview | commit",
  "plan": [ { "taskId": "…", "minutes": 90, "why": "P0 且今天截止" } ],  // 顺序即时间顺序
  "writeBack": true,          // commit 时把开始时间写回飞书原生字段
  "startFrom": "13:30"        // 可选：从此刻/指定时刻开始排
})
```

- 插件把 `plan` 按 `startFrom` + 工作时段 + 容量编译成**真正的时间块**（模型只给顺序与时长）；
- 校验：单块 ≤ 容量、总量 ≤ `dailyCapacityMinutes`、不跨免打扰、不排已完成任务；不通过就返回可解释的冲突清单，不落地；
- `commit`：每块写一条 `kind:'at'` 的本地 schedule；`writeBack=true` 时同时调桥接
  `set_task_time` 写飞书原生「开始时间/截止时间」，这样在飞书侧也看得见、`按时执行` 链路完全闭环；
- 返回：每块起止时间 + 下一次触发 + 被推迟/跳过的原因。

## 7. 工具与接口

### 模型工具

`feishu_task_schedule`（新增，AI 化配置的唯一入口）

```jsonc
{
  "taskId": "…",                 // 不传 = 当前会话绑定的任务
  "action": "preview | set | clear | pause | resume | list",
  "when": "下周一早上九点半",     // 自然语言，插件编译
  "spec": { … },                 // 或者直接给 spec（模型自己算好时间时）
  "writeBack": false,            // set 时是否同步写飞书开始时间
  "dryRun": false
}
```

返回人话：`已排期「周报」：每周一 09:30（Asia/Shanghai），下次 2026-11-02 09:30。写回飞书：是。`

`feishu_plan_today`：见 §6。

`feishu_tasks` 每条任务多一行 `⏱ 每周一 09:30 · 下次 11-02 09:30`（有其他字段时保持一行内）。

### HTTP 接口（面板用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/schedules` | `{items:[{taskId,title,spec,summary,nextAt,nextText,state,runs,lastReason}]}` |
| POST | `/api/tasks/schedule` | `{taskId, action, when?, spec?, writeBack?}` → `{ok, preview:{summary,nextAt,nextText,warnings}, task}` |
| GET | `/api/plan` | 返回本地候选池（不调模型）：今天可排的任务 + 容量 + 工作时段 |
| POST | `/api/plan/commit` | `{plan:[{taskId, minutes, why}], startFrom?, writeBack?}` |

### 设置（`settings.schedule`）

```jsonc
{
  "timeZone": "Asia/Shanghai",
  "workHours": { "start": "09:00", "end": "19:00" },
  "quietHours": [{ "start": "12:00", "end": "13:30" }],
  "missPolicy": "delay",          // delay | skip | next
  "graceMinutes": 30,
  "dailyCapacityMinutes": 360,
  "writeBackDefault": true
}
```

## 8. 面板

1. **任务卡片**：信息行加一枚排期 chip
   `⏱ 每周一 09:30 · 下次 11-02 09:30`（无排期时显示淡色的 `⏱ 排期`）。
   点击弹出小面板：输入框（占位符「下周一早上九点半 / 截止前两小时」）+ 「预览」+「保存」+「清除」；
   预览行显示 `下次 2026-11-02 09:30（周一）· 每周一 09:30`，解析失败时把原话标红并给出示例。
2. **设置 → 时间自动化**：时区、工作时段、免打扰、错过策略、每日容量、默认写回飞书。
3. 全部文案中文，失败必须给原因（不静默）。

## 9. 测试

- `test/schedule.mjs`（纯函数）：上表每种输入 → 期望 spec；`nextFireAt` 的跨天/跨周/跨月/截止/最大次数；
  时区（Asia/Shanghai 与 America/New_York 的 DST）；免打扰与窗口推迟；错过补偿三种策略。
- `test/meta.mjs` 扩：`evaluateAutoStart` 在「本地 schedule 覆盖飞书字段」时的行为。
- `test/smoke.mjs` 扩：`feishu_task_schedule` 预览/设置/清除 的返回话术；`/api/schedules` 形状。
- 真机：面板上排一条「1 分钟后」，确认到点开工（这条只人工验，不写进 CI）。

## 10. 不做的事（本轮）

- 不做多人共享排期 / 跨人资源平衡；
- 不做自动依赖推导（子任务顺序）——先留 `dependsOn` 字段，不落地调度；
- 不改飞书清单字段结构（本地 schedule 是权威，飞书时间只作为输入与展示）；
- 不改 `autoStartMode` 三档语义。
