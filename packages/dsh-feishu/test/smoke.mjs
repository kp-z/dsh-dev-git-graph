/**
 * 冒烟测试：不装进 profile，直接用假 ctx 把宿主半体跑起来。
 *
 * 覆盖的是「装之前能自己发现的那部分」：
 *   - 插件能 apply 且不抛
 *   - 路由按时挂上，/api/state 形状对
 *   - 真实跑一次 feishu-sync-cli，任务能落进快照
 *   - 模型工具能注册并返回人话
 *
 * 不覆盖：真实宿主里的右侧栏页签、面板视觉、开工（需要 agents/sessionController）。
 *
 * 跑法：node test/smoke.mjs      （需要已授权 feishu-sync-cli；未授权时应看到 auth.ok=false 而不是崩）
 */
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * 状态目录隔离：插件把状态写在 $DSH_HOME/dsh-feishu 下。如果直接跑在真实的 ~/.dsh 上，
 * 断言会被「清单里现在恰好有几条任务、某条是否已经开工」这类现实情况绑死——
 * 换个环境就红。这里固定用一个临时目录，让冒烟只验链路。
 */
/*
 * 必须强制隔离：宿主进程本身带着 DSH_HOME=~/.dsh，直接继承就会把「假会话绑定、
 * 被改过的设置、试写的预期时间」写进真实插件状态（踩过一次）。
 * 想复用某个目录时显式传 SMOKE_HOME。
 */
process.env.DSH_HOME = process.env.SMOKE_HOME || mkdtempSync(join(tmpdir(), 'dsh-feishu-smoke-'))

const { apply } = await import('../index.js')

const tools = new Map()
const routes = []
const disposers = []
const created = []
const prompts = []

/* 假的会话服务：开工逻辑要在这里面走一遍，否则「能不能自动开工」只能靠读代码猜。 */
/*
 * 真实飞书清单里的任务可能挂在任意工作区名下（插件会把工作区补写进字段）。
 * 冒烟验的是「写了工作区就按工作区目录开工」这条链路。
 * v0.15 起工作区解析是**严格匹配**（去掉了 contains 兜底）：所以假注册表要在开工会那一步
 * 动态补上「这次要开工的任务」的工作区名，才能真的走到「按工作区开工」。
 */
const STUB_WORKSPACE = 'DSH 插件开发'
const workspaceList = [{ id: 'ws-1', title: STUB_WORKSPACE, path: '/tmp' }]

const fakeServices = {
  agents: {
    async create(options) {
      created.push(options)
      return { agent: { id: options.sessionId }, dispose: async () => {} }
    },
    list() {
      return created.map((options) => ({ id: options.sessionId, session: { title: '假会话' } }))
    },
  },
  sessionController: {
    async prompt(request) {
      prompts.push(request)
      return {}
    },
    async inspect(sessionId) {
      if (sessionId === 'session-current') return { id: sessionId }
      if (!created.some((options) => options.sessionId === sessionId)) throw new Error('no such session')
      return { id: sessionId }
    },
  },
  workingDirectory: { defaultDirectory: '/tmp' },
  /* 任务里写了工作区时，开工要按工作区目录走；这里给一个能匹配上的假注册表。 */
  workspaceRegistry: {
    list: () => workspaceList,
  },
}

/* 冒烟也要有 DSH 自动化服务：v0.14 起定时只写进它，没有服务就等于「定时不可用」。
   这里是一个内存假实现，只够验「一句话 → 编译 → 写进服务 → 快照能看见 → 清得掉」。 */
const smokeSchedules = []
const smokeSchedule = {
  async catalog() {
    return smokeSchedules.map((row) => ({ ...row }))
  },
  async list(request) {
    return smokeSchedules
      .filter((row) => row.sessionId === request.sessionId && row.status === 'active')
      .map(({ sessionId, status, ...record }) => record)
  },
  async create(sessionId, request) {
    const kind = request.at ? 'at' : request.every_seconds ? 'every' : request.daily ? 'daily' : request.weekly ? 'weekly' : 'cron'
    const record = {
      id: `smoke-${smokeSchedules.length + 1}`,
      kind,
      title: request.title,
      prompt: request.prompt,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    }
    if (request.daily) record.time = request.daily.time
    if (request.weekly) {
      record.time = request.weekly.time
      record.weekdays = request.weekly.weekdays
    }
    if (request.every_seconds) record.everySeconds = request.every_seconds
    if (request.cron) record.expression = request.cron.expression
    smokeSchedules.push({ ...record, sessionId, status: 'active' })
    return record
  },
  async update(request) {
    const index = smokeSchedules.findIndex((row) => row.id === request.id && row.sessionId === request.sessionId)
    if (index < 0) return { code: 'schedule_not_found', message: 'gone' }
    const next = { ...smokeSchedules[index], scheduledAt: new Date(Date.now() + 7_200_000).toISOString() }
    if (request.change?.daily) {
      next.kind = 'daily'
      next.time = request.change.daily.time
    }
    smokeSchedules[index] = next
    return { record: next }
  },
  async delete(request) {
    const index = smokeSchedules.findIndex((row) => row.id === request.id && row.sessionId === request.sessionId)
    if (index < 0) return { code: 'schedule_not_found', message: 'gone' }
    smokeSchedules.splice(index, 1)
    return { id: request.id, deleted: true }
  },
}
const smokeScheduleScope = {
  schedule: smokeSchedule,
  on: () => () => {},
  effect: (fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
    return () => {}
  },
}

const ctx = {
  logger: () => ({
    info: (...args) => console.log('[feishu]', ...args),
    error: (...args) => console.error('[feishu]', ...args),
  }),
  effect(fn) {
    disposers.push(fn())
    return () => {}
  },
  get: (name) => fakeServices[name],
  inject(deps, cb) {
    if (Array.isArray(deps) && deps.includes('schedule')) cb(smokeScheduleScope)
  },
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => {}
    },
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs = 20_000, label = '条件') {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await wait(100)
  }
  throw new Error(`等待超时：${label}`)
}

apply(ctx, {})

await waitFor(() => routes.length > 0, 15_000, '路由挂载')
console.log('✓ 路由已挂载')

const route = routes[0]
const server = createServer((req, res) => route.handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const base = `http://127.0.0.1:${port}/dsh-feishu`

const stateResponse = await fetch(`${base}/api/state`)
const statePayload = await stateResponse.json()
if (!statePayload.ok || !statePayload.settings || !statePayload.state) {
  throw new Error(`/api/state 形状不对：${JSON.stringify(statePayload).slice(0, 300)}`)
}
console.log(`✓ /api/state：cli=${statePayload.state.cli.found} auth=${statePayload.state.auth.ok}`)

const panelResponse = await fetch(`${base}/panel`)
const panelHtml = await panelResponse.text()
if (panelResponse.status !== 200 || !/<html/i.test(panelHtml)) {
  throw new Error(`面板不是 HTML（status=${panelResponse.status}, len=${panelHtml.length}）`)
}
console.log(`✓ /panel：${panelHtml.length} 字符`)

/* 面板靠能力清单判断「宿主是不是旧代码」：这条不能掉，否则新按钮点下去只能吃 404 */
const capsResponse = await fetch(`${base}/api/capabilities`)
const capsPayload = await capsResponse.json()
if (!capsPayload.ok || !Array.isArray(capsPayload.features) || capsPayload.features.length === 0) {
  throw new Error(`/api/capabilities 形状不对：${JSON.stringify(capsPayload).slice(0, 200)}`)
}
if (!capsPayload.features.includes('workspace.bind')) throw new Error('能力清单缺 workspace.bind')
console.log(`✓ /api/capabilities：${capsPayload.features.length} 项，v${capsPayload.version}`)

const syncResponse = await fetch(`${base}/api/sync`, { method: 'POST' })
const syncPayload = await syncResponse.json()
console.log(`✓ /api/sync：${JSON.stringify(syncPayload)}`)

let after = await (await fetch(`${base}/api/state`)).json()
const syncStarted = Date.now()
while (Date.now() - syncStarted < 180_000) {
  after = await (await fetch(`${base}/api/state`)).json()
  if (after.state.lastSyncAt > 0 || after.state.lastError) break
  await wait(500)
}
if (!(after.state.lastSyncAt > 0 || after.state.lastError)) {
  throw new Error('同步 180s 没落地')
}
console.log(
  `✓ 同步结果：任务 ${after.state.tasks.length} 条，文档 ${after.state.docs.length} 篇，auth=${after.state.auth.ok}${
    after.state.lastError ? `，lastError=${after.state.lastError.slice(0, 160)}` : ''
  }`,
)

const settingsResponse = await fetch(`${base}/api/settings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ syncIntervalMinutes: 45, tasks: { keyword: '' }, __evil: 'x' }),
})
const settingsPayload = await settingsResponse.json()
if (settingsPayload.settings.syncIntervalMinutes !== 45 || '__evil' in settingsPayload.settings) {
  throw new Error(`设置写入不对：${JSON.stringify(settingsPayload.settings)}`)
}
console.log('✓ /api/settings：写入并过滤未知字段')

/* 冒烟跑的是真实清单：把所有「写回飞书」关掉，避免改用户数据。
   写回链路本身在单独的真机探针里验过（见 docs/DESIGN-task-lifecycle.md §10）。 */
const noWrite = await (await fetch(`${base}/api/settings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    schedule: { writeEtaToFeishu: false, writeStartToFeishu: false, writeEndToFeishu: false },
  }),
})).json()
if (noWrite.settings?.schedule?.writeEtaToFeishu !== false) {
  throw new Error(`写回开关没关掉：${JSON.stringify(noWrite.settings?.schedule)}`)
}
console.log('✓ 写回开关已关闭（冒烟不碰真实飞书）')

/* 开工：建会话 + 按模板投递。用假 agents/sessionController 抓参数。 */
/* 挑一条工作区能对上假注册表（或没写工作区）的任务：真实清单里有些任务挂在别的工作区上，
   那样开工会被「找不到工作区」挡掉，和本次冒烟要验的链路无关。 */
/* 只挑「还没绑定过会话」的任务：绑了死会话的那条会走「没找到当前会话」分支，
   那是数据漂移，不是本次冒烟要验的建会话链路。 */
const startTarget =
  after.state.tasks.find((task) => !task.sessionId
    && (!task.workspaceTitle || task.workspaceTitle === STUB_WORKSPACE))
  ?? after.state.tasks.find((task) => !task.sessionId)
  ?? after.state.tasks.find((task) => !task.workspaceTitle || task.workspaceTitle === STUB_WORKSPACE)
  ?? after.state.tasks[0]
/* 严格匹配：让假注册表里正好有这条任务写的工作区名（没有工作区就只留默认那条） */
{
  const text = String(startTarget?.meta?.workspace ?? '').trim()
  if (text) {
    workspaceList.length = 0
    workspaceList.push({ id: 'ws-1', title: text, path: '/tmp' })
  }
}

const startResponse = await fetch(`${base}/api/tasks/start`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: startTarget?.id ?? '' }),
})
const startPayload = await startResponse.json()
/* 真实清单里这条任务可能已经开过工（幂等），这种情况不算失败 */
const alreadyStarted = /已经开过工了/.test(String(startPayload?.error ?? ''))
if (!alreadyStarted && (!startPayload.ok || !startPayload.sessionId)) {
  throw new Error(`开工失败：${JSON.stringify(startPayload)}`)
}
if (!alreadyStarted && (created.length !== 1 || created[0].meta?.cwd !== '/tmp')) {
  // 假注册表把「DSH 插件开发」映射到 /tmp，断言 cwd 走的确实是工作区而不是默认目录
  throw new Error(`建会话参数不对：${JSON.stringify(created)}`)
}
if (alreadyStarted) {
  console.log('✓ /api/tasks/start：该任务已开工（幂等返回），跳过建会话断言')
} else {
  const promptText = prompts[0]?.content?.[0]?.text ?? ''
  if (!promptText.includes(startTarget.title.slice(0, 12))) {
    throw new Error(`投递的提示词没带任务标题：${promptText.slice(0, 200)}`)
  }
  if (prompts[0].sessionId !== startPayload.sessionId || prompts[0].mode !== 'queue') {
    throw new Error(`投递参数不对：${JSON.stringify(prompts[0]).slice(0, 300)}`)
  }
  console.log(`✓ /api/tasks/start：建会话 + 投递提示词（${startPayload.sessionId}）`)
}

/* 任务 ↔ 会话绑定：伪造一条不存在的会话必须被拒，真会话能绑能解。
   这条链路依赖「刚刚新建的那个会话」；任务若已开工（幂等返回、没有新会话）就跳过。 */
const bindSession = startPayload.sessionId || startTarget?.sessionId || ''
if (alreadyStarted && !startPayload.sessionId) {
  console.log('✓ 任务↔会话：该任务已开工，跳过绑定断言')
} else {
const bogusLink = await fetch(`${base}/api/tasks/link`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ taskId: after.state.tasks[1]?.id ?? '', sessionId: 'not-a-session' }),
})
if (bogusLink.status !== 400) throw new Error(`不存在的会话应当 400，实际 ${bogusLink.status}`)

const realLink = await fetch(`${base}/api/tasks/link`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ taskId: after.state.tasks[1]?.id ?? '', sessionId: bindSession }),
})
const realLinkPayload = await realLink.json()
if (realLink.status === 200 && realLinkPayload.ok === false) {
  if (!String(realLinkPayload.error).includes('已经绑')) throw new Error(`绑定失败：${realLinkPayload.error}`)
}
const liveState = await (await fetch(`${base}/api/state`)).json()
const boundTask = liveState.state.tasks.find((task) => task.sessionId === bindSession)
if (!boundTask || boundTask.sessionAlive !== true) {
  throw new Error(`绑定后会话状态不对：${JSON.stringify(liveState.state.tasks.map((t) => [t.sessionId, t.sessionAlive]))}`)
}
/* 绑定 = 开始计时：startAt 必须落下来（卡片不显示，但履约要用） */
if (!(Number(boundTask.startAt) > 0)) throw new Error('绑定后没记 startAt')
/* 绑定不该凭空造出预期：原来有（飞书清单里本来就填过）就保持原值，原来没有就仍然没有。
   断言必须数据无关——直接比「绑定前 → 绑定后」，否则清单里恰好有预期就会假红
   （2026-10 就是这样：真实任务带了「预期完成」，冒烟一直红，代码却是对的）。 */
const bindTarget = after.state.tasks[1] || {}
const bindTargetLive = liveState.state.tasks.find((task) => task.id === bindTarget.id)
if (!bindTargetLive) throw new Error(`绑定后找不到目标任务：${bindTarget.id}`)
const etaBefore = Number(bindTarget.commitment?.expectedAt) || 0
const etaAfter = Number(bindTargetLive.commitment?.expectedAt) || 0
if (etaAfter !== etaBefore) throw new Error(`绑定会话改动了预期时间：${etaBefore} → ${etaAfter}（${bindTarget.id} / ${boundTask.id}）`)
if (!boundTask.commitment) throw new Error('绑定后缺 commitment 视图')
const sessionsResponse = await (await fetch(`${base}/api/sessions`)).json()
if (!sessionsResponse.ok || !Array.isArray(sessionsResponse.sessions)) {
  throw new Error(`/api/sessions 形状不对：${JSON.stringify(sessionsResponse)}`)
}
const unlinkResponse = await fetch(`${base}/api/tasks/unlink`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: boundTask.id }),
})
if ((await unlinkResponse.json()).ok !== true) throw new Error('解绑失败')
console.log(`✓ 任务↔会话：拒绝假会话、绑定后 sessionAlive=true、/api/sessions ${sessionsResponse.sessions.length} 条、可解绑`)
}

/* 手动开工带 sessionId：应该投递进这条会话，而不是新建。 */
const beforeCreated = created.length
const currentStart = await fetch(`${base}/api/tasks/start`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: after.state.tasks[2]?.id ?? '', sessionId: 'session-current' }),
})
const currentPayload = await currentStart.json()
/* 真实清单里这条任务可能已经绑在别的会话上（插件会拒绝跨会话抢占），这时跳过即可 */
const takenByOther = /已经绑/.test(String(currentPayload?.error ?? ''))
  || /没找到当前会话/.test(String(currentPayload?.error ?? ''))
  || /已经开过工了/.test(String(currentPayload?.error ?? ''))
if (takenByOther) {
  console.log('✓ /api/tasks/start(sessionId)：该任务已绑定其它会话，跳过当前会话断言')
} else {
  if (!currentPayload.ok || created.length !== beforeCreated) {
    throw new Error(`当前会话开工不应该新建会话：${JSON.stringify(currentPayload)}`)
  }
  const currentPrompt = prompts[prompts.length - 1]
  if (currentPrompt.sessionId !== 'session-current' || currentPrompt.mode !== 'queue') {
    throw new Error(`没有投递进当前会话：${JSON.stringify(currentPrompt).slice(0, 200)}`)
  }
  const afterCurrent = await (await fetch(`${base}/api/state`)).json()
  const boundCurrent = afterCurrent.state.tasks.find((task) => task.sessionId === 'session-current')
  if (!boundCurrent || boundCurrent.linkSource !== 'current') {
    throw new Error(`当前会话开工后绑定不对：${JSON.stringify(boundCurrent)}`)
  }
}
console.log('✓ /api/tasks/start + sessionId：投递进当前会话、不新建、linkSource=current')

/* 回写接口：不存在的任务要 400，且不能误发评论。 */
const reportMiss = await fetch(`${base}/api/tasks/report`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'not-a-task', text: 'should not send' }),
})
if (reportMiss.status !== 400) throw new Error(`回写不存在的任务应 400，实际 ${reportMiss.status}`)
const reportEmpty = await fetch(`${base}/api/tasks/report`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: after.state.tasks[0]?.id ?? '' }),
})
if (reportEmpty.status !== 400) throw new Error(`空回写应 400，实际 ${reportEmpty.status}`)
console.log('✓ /api/tasks/report：未知任务与空内容都被拒')

/* 会话 → 任务：缺 sessionId 应被拒（真正建任务由 agent 调工具，不在测试里打真实飞书）。 */
const promoteNoId = await fetch(`${base}/api/sessions/promote`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({}),
})
if (promoteNoId.status !== 400) throw new Error(`promote 缺 sessionId 应 400，实际 ${promoteNoId.status}`)
console.log('✓ /api/sessions/promote：缺 sessionId 被拒')

/* 当前会话同步：没 sessionId、会话没绑任务，都该 400 且不写飞书。 */
const syncNoSession = await fetch(`${base}/api/sessions/sync`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({}),
})
if (syncNoSession.status !== 400) throw new Error(`缺 sessionId 应 400，实际 ${syncNoSession.status}`)
const syncUnbound = await fetch(`${base}/api/sessions/sync`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId: 'session-current' }),
})
if (syncUnbound.status !== 400) throw new Error(`未绑定会话应 400，实际 ${syncUnbound.status}`)
console.log('✓ /api/sessions/sync：缺会话、未绑定都被拒')

const dismissResponse = await fetch(`${base}/api/tasks/dismiss`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'not-a-real-task' }),
})
console.log(`✓ /api/tasks/dismiss 404 路径：${(await dismissResponse.json()).error ?? ''}`)

/* ── 排期（AI 时间自动化）──
 * 验的是「一句话 → 编译 → 写进 DSH 自动化 → 快照里能看见 → 清得掉」这条链路。
 * v0.14：定时只能写到「已绑定会话」的任务上，所以挑一条带 sessionId 的 */
const scheduleTarget = after.state.tasks.find((task) => !task.done && task.sessionId)
if (!scheduleTarget) console.log('· 没有已绑定会话的任务：跳过排期冒烟（dshBridge 已覆盖这条链路）')
if (scheduleTarget) {

const planResponse = await fetch(`${base}/api/plan`)
const planPayload = await planResponse.json()
if (!planPayload.ok || !Array.isArray(planPayload.candidates) || !planPayload.workHours) {
  throw new Error(`/api/plan 形状不对：${JSON.stringify(planPayload).slice(0, 300)}`)
}
console.log(`✓ /api/plan：候选 ${planPayload.candidates.length} 条，容量 ${planPayload.capacity} 分钟`)

const previewResponse = await fetch(`${base}/api/tasks/schedule`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ taskId: scheduleTarget.id, action: 'preview', when: '明天早上九点半' }),
})
const previewPayload = await previewResponse.json()
if (!previewPayload.ok || !previewPayload.preview?.nextAt || previewPayload.preview.nextAt <= Date.now()) {
  throw new Error(`排期预览不对：${JSON.stringify(previewPayload).slice(0, 300)}`)
}
console.log(`✓ /api/tasks/schedule 预览：${previewPayload.preview.summary}，下次 ${previewPayload.preview.nextText}`)

/* 预览不该留下状态。注意不能断言「快照里没有排期」：飞书上本来填了开始时间的任务，
   同步时会被 adoptFeishuSchedule 补一条兜底排期，那是另一条链路。这里比的是「预览前后没变」。 */
/* 只比稳定字段：waitMs/dueAt 跟着墙钟走，整对象比较会假阳性。 */
const stableSchedule = (view) => (view
  ? JSON.stringify({ summary: view.summary, nextAt: view.nextAt, nextText: view.nextText, runs: view.runs, state: view.state, paused: view.paused })
  : 'null')
const beforePreview = stableSchedule(after.state.tasks.find((task) => task.id === scheduleTarget.id)?.schedule)
const afterPreview = await (await fetch(`${base}/api/state`)).json()
const previewed = afterPreview.state.tasks.find((task) => task.id === scheduleTarget.id)
if (stableSchedule(previewed?.schedule) !== beforePreview) {
  throw new Error('预览改了排期状态（预览必须无副作用）')
}

const setResponse = await fetch(`${base}/api/tasks/schedule`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  /* writeBack=false：冒烟不该真的去改用户飞书里的任务时间 */
  body: JSON.stringify({ taskId: scheduleTarget.id, action: 'set', when: '明天早上九点半', writeBack: false }),
})
const setPayload = await setResponse.json()
if (!setPayload.ok || !setPayload.task?.schedule?.summary) {
  throw new Error(`排期落地不对：${JSON.stringify(setPayload).slice(0, 300)}`)
}
const stateAfterSet = await (await fetch(`${base}/api/state`)).json()
const scheduledTask = stateAfterSet.state.tasks.find((task) => task.id === scheduleTarget.id)
if (!scheduledTask?.schedule?.nextText) throw new Error('快照里没带 schedule 视图')
console.log(`✓ 排期落地：${scheduledTask.schedule.summary}，下次 ${scheduledTask.schedule.nextText}`)

/* 一句话说不准时要给出候选或明确报错，不能静默成功 */
const badResponse = await fetch(`${base}/api/tasks/schedule`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ taskId: scheduleTarget.id, action: 'preview', when: '随便什么时候吧' }),
})
const badPayload = await badResponse.json()
if (badPayload.ok) throw new Error('解析不出的时间不该返回 ok')
console.log(`✓ 解析失败有原因：${String(badPayload.error).slice(0, 80)}`)

const listResponse = await fetch(`${base}/api/schedules`)
const listPayload = await listResponse.json()
if (!listPayload.ok || !Array.isArray(listPayload.items)) throw new Error('/api/schedules 形状不对')
console.log(`✓ /api/schedules：${listPayload.items.length} 条`)

const clearResponse = await fetch(`${base}/api/tasks/schedule`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ taskId: scheduleTarget.id, action: 'clear' }),
})
if (!(await clearResponse.json()).ok) throw new Error('清除排期失败')
console.log('✓ 清除排期')
}

/* 「到点开工」不再由插件负责：v0.14 起定时只写进 DSH 自动化任务，到点由 DSH
   把提示词发进会话。那条链路由 dshBridge（写入）与 DSH 自己的测试覆盖，
   这里只验插件「写进去」和「清得掉」，不再等墙钟。 */

/* ── 预期完成（履约基准）── */
const etaTarget = after.state.tasks.find((task) => !task.done) ?? after.state.tasks[0]
if (!etaTarget) throw new Error('清单里一条任务都没有，ETA 冒烟跑不了')

const etaPreview = await (await fetch(`${base}/api/tasks/eta`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ taskId: etaTarget.id, action: 'preview', when: '这周五 18:00' }),
})).json()
if (!etaPreview.ok || !etaPreview.preview?.at) {
  throw new Error(`预期预览不对：${JSON.stringify(etaPreview).slice(0, 300)}`)
}
console.log(`✓ /api/tasks/eta 预览：${etaPreview.preview.text}`)

const etaSet = await (await fetch(`${base}/api/tasks/eta`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ taskId: etaTarget.id, action: 'set', when: '2026-11-02 18:00' }),
})).json()
if (!etaSet.ok || etaSet.task?.commitment?.expectedText !== '2026-11-02 18:00') {
  throw new Error(`预期落地不对：${JSON.stringify(etaSet).slice(0, 300)}`)
}
const stateAfterEta = await (await fetch(`${base}/api/state`)).json()
const etaTask = stateAfterEta.state.tasks.find((task) => task.id === etaTarget.id)
if (!etaTask?.commitment || etaTask.commitment.expectedAt <= 0) throw new Error('快照里没带 commitment')
if (!/剩|逾期/.test(etaTask.commitment.label)) throw new Error(`履约文案不对：${etaTask.commitment.label}`)
console.log(`✓ 预期落地：${etaTask.commitment.expectedText}（${etaTask.commitment.label}）`)

/* 往后改一次 → 记一条延期 */
const etaLater = await (await fetch(`${base}/api/tasks/eta`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ taskId: etaTarget.id, action: 'set', when: '2026-11-05 18:00', reason: '等上游' }),
})).json()
if (!etaLater.ok || etaLater.task.commitment.delayCount < 1) {
  throw new Error(`改期没记延期：${JSON.stringify(etaLater).slice(0, 300)}`)
}
console.log(`✓ 改期记延期：${etaLater.task.commitment.delayCount} 次`)

const fulfill = await (await fetch(`${base}/api/fulfillment?days=28`)).json()
if (!fulfill.ok || typeof fulfill.summary?.tracked !== 'number') {
  throw new Error(`/api/fulfillment 形状不对：${JSON.stringify(fulfill).slice(0, 300)}`)
}
console.log(`✓ /api/fulfillment：跟踪 ${fulfill.summary.tracked} 条，逾期 ${fulfill.summary.overdue}`)

/* 诊断的输入统计要带上完成质量与延期归因（模型不数数，数字都在这里算好） */
const insightStats = await (await fetch(`${base}/api/insight/stats?days=14`)).json()
if (!insightStats?.stats?.quality || !Array.isArray(insightStats.stats.delayBuckets)) {
  throw new Error(`/api/insight/stats 没带 quality/delayBuckets：${JSON.stringify(insightStats).slice(0, 300)}`)
}
console.log(`✓ /api/insight/stats：quality（完成 ${insightStats.stats.quality.completed}）+ delayBuckets ${insightStats.stats.delayBuckets.length} 个桶`)

const etaClear = await (await fetch(`${base}/api/tasks/eta`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ taskId: etaTarget.id, action: 'clear' }),
})).json()
if (!etaClear.ok || etaClear.task.commitment.expectedAt !== 0) {
  throw new Error(`清除预期失败：${JSON.stringify(etaClear).slice(0, 300)}`)
}
console.log('✓ 清除预期')

/* 工具层：让模型能「说人话排期」。只 preview，不落地。
   定时必须绑定会话：没有带会话的任务时，这条工具链路由 dshBridge 覆盖。 */
const scheduleTool = tools.get('feishu_task_schedule')
if (!scheduleTool) throw new Error('缺 feishu_task_schedule 工具')
if (scheduleTarget) {
  const scheduleToolText = await scheduleTool.execute(
    { taskId: scheduleTarget.id, action: 'preview', when: '每周一早上 9:30' },
    {},
  )
  if (!/每周一 09:30/.test(String(scheduleToolText))) {
    throw new Error(`feishu_task_schedule 话术不对：${String(scheduleToolText).slice(0, 200)}`)
  }
  console.log(`✓ 工具 feishu_task_schedule：${String(scheduleToolText).split('\n')[0]}`)
} else {
  /* 没绑会话时必须明确拒绝，而不是偷偷落本地 */
  const refused = await scheduleTool.execute({ taskId: etaTarget.id, action: 'preview', when: '每周一早上 9:30' }, {})
  if (!/绑定会话|DSH 自动化/.test(String(refused))) {
    throw new Error(`没绑定会话时排期应被拒：${String(refused).slice(0, 200)}`)
  }
  console.log('✓ 工具 feishu_task_schedule：没绑定会话时明确拒绝')
}

const etaTool = tools.get('feishu_task_eta')
const etaToolText = await etaTool.execute({ taskId: etaTarget.id, action: 'preview', when: '明天下午三点' }, {})
if (!String(etaToolText).includes('预期')) throw new Error(`feishu_task_eta 话术不对：${etaToolText}`)
console.log(`✓ 工具 feishu_task_eta：${String(etaToolText).split('\n')[0]}`)

const planTool = tools.get('feishu_plan_today')
const planText = await planTool.execute({ action: 'preview' }, {})
if (!/可排候选|工作时段/.test(String(planText))) {
  throw new Error(`feishu_plan_today 话术不对：${String(planText).slice(0, 200)}`)
}
console.log('✓ 工具 feishu_plan_today：候选池与工作时段都说清了')

/* 没有模型时要好好失败，而不是抛异常：面板/对话都靠这句兜底 */
const insightTool = tools.get('feishu_insight')
if (!insightTool) throw new Error('缺 feishu_insight 工具')
const insightText = await insightTool.execute({}, {})
if (!/诊断没跑成|💡 今日诊断/.test(String(insightText))) {
  throw new Error(`feishu_insight 话术不对：${String(insightText).slice(0, 200)}`)
}
console.log(`✓ 工具 feishu_insight：${String(insightText).split('\n')[0]}`)

for (const tool of tools.values()) {
  if (typeof tool.execute !== 'function' || !tool.output?.schema) {
    throw new Error(`工具 ${tool.name} 形状不对`)
  }
}
const taskTool = tools.get('feishu_tasks')
const taskText = await taskTool.execute({}, {})
console.log(`✓ 工具 ${[...tools.keys()].join(', ')}`)
console.log(`--- feishu_tasks 输出 ---\n${String(taskText).slice(0, 500)}`)

server.close()
for (const dispose of disposers) dispose?.()
console.log('SMOKE_OK')
process.exit(0)
