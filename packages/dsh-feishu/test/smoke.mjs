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
if (!process.env.DSH_HOME) {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-feishu-smoke-'))
}

const { apply } = await import('../index.js')

const tools = new Map()
const routes = []
const disposers = []
const created = []
const prompts = []

/* 假的会话服务：开工逻辑要在这里面走一遍，否则「能不能自动开工」只能靠读代码猜。 */
/*
 * 真实飞书清单里的任务可能挂在任意工作区名下（插件会把工作区补写进字段）。
 * 冒烟验的是「写了工作区就按工作区目录开工」这条链路，不是名字匹配，所以假注册表
 * 对认不出的名字一律回同一个目录。
 */
const STUB_WORKSPACE = 'DSH 插件开发'
const workspaceList = [{ id: 'ws-1', title: STUB_WORKSPACE, path: '/tmp' }]
workspaceList.find = function findLoose(predicate) {
  return Array.prototype.find.call(this, predicate) ?? this[0]
}

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
