/**
 * 人设→system prompt 的**装配**测试（M6-2 最后一段）。
 *
 * ## 为什么光有纯函数测试不够
 *
 * `test/bridge-persona.test.js` 证明了模板是纯函数、内容一变 prompt 就变。
 * 但它**没**证明这些东西真的被**接上**了：`src/index.ts` 里的解析器
 * （世界角色 → 场景 → 花名册 → 座位 → prompt）一行都没被测到。
 *
 * 装配错了的症状是"面板能说话，但角色说话像路人"——纯函数全绿，功能全错。
 * 这正是"单测很齐但接线断了一根"那一类缺陷，所以这里从**最外面**进：
 *
 *     POST /api/say  →  bridge 唤醒角色  →  agentLoop.createAgent(seed)
 *
 * 然后断言 `createAgent` 收到的 `seed` 里**真的是那份内容的人设**。
 * 这条路径上没有一个假的人设文本：期望值是从**真实内置内容**里独立读出来的。
 *
 * ## 不碰时间
 *
 * 没有固定 sleep：等 `createAgent` 被调用用「轮询 + 截止时间」，
 * 所以负载高的时候只会慢一点，不会假红。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, test } from 'node:test'

import { apply } from '../lib/index.js'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'

const PREFIX = '/agent-world'

/** 注册过的清理函数（`apply` 的 effect 是"先挂、卸载时跑"，假 ctx 必须照抄这个语义）。 */
const disposers = []
after(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

/** 轮询到条件成立为止；超时就报"等什么超时了"。**不用固定 sleep**。 */
async function until(predicate, what, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = predicate()
    if (value !== undefined && value !== false && value !== null) return value
    assert.ok(Date.now() < deadline, `等「${what}」超时（${timeoutMs}ms）`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * 一个"像样的"假 ctx：**镜像真实 cordis 的 API 面**，并额外提供
 * `get`（服务查询）与 `on`（事件订阅）——这两条是对话桥需要的。
 *
 * 与 `test/smoke.test.js` 的 `fakeCtx` 同源；差别只在多了 `get`/`on` 与 webServer。
 */
function fakeCtx({ agentLoop, sessionController }) {
  const routes = []
  const registered = []
  const logs = { info: [], warn: [], error: [] }

  const ctx = {
    tools: { register: (tool) => registered.push(tool) },
    logger: () => ({
      info: (message) => logs.info.push(message),
      warn: (message) => logs.warn.push(message),
      error: (message) => logs.error.push(message),
    }),
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    inject: (names, cb) => {
      const webServer = { register: (route) => {
        if (route.kind === 'prefix') routes.push(route)
        return () => {}
      } }
      const host = { webServer, effect: ctx.effect }
      if (names.every((name) => host[name] !== undefined)) cb(host)
    },
    get: (name) => (name === 'agentLoop' ? agentLoop : name === 'sessionController' ? sessionController : undefined),
    on: () => () => {},
  }

  return { ctx, routes, registered, logs }
}

/** 独立地（不走插件的代码路径）从真实内容里读出每个角色的 persona。 */
function realPersonas() {
  const content = new ContentRegistry()
  const issues = content.loadAll(builtinPacks())
  assert.equal(issues.filter((i) => i.level === 'error').length, 0, '内置内容必须是干净的')

  const world = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
  const scene = content.require('scenes', world.origin.scene)
  const roster = content.require('rosters', scene.roster)

  const byAgentId = new Map()
  world.agents.forEach((agent, index) => {
    const seat = roster.seats[index]
    assert.ok(seat, `${agent.id} 应当有对应的座位`)
    byAgentId.set(agent.id, { seat, name: agent.name })
  })
  return byAgentId
}

test('装配：/api/say 搭话后，createAgent 收到的 seed 里是**那份内容的人设**', async () => {
  const created = []
  const agentLoop = {
    async createAgent(ownerCtx, options) {
      created.push(options)
      return { agent: { id: options.sessionId }, async dispose() {} }
    },
  }
  const sessionController = {
    async modelCatalog() {
      return { routableProviders: ['p'], groups: [{ id: 'p' }], failures: [] }
    },
    async prompt() {
      return { accepted: true }
    },
  }

  const { ctx, routes, logs } = fakeCtx({ agentLoop, sessionController })
  apply(ctx, { persistTicks: 0, persistEveryTicks: 0, autoStart: false, maxLiveSessions: 8 })

  assert.equal(routes.length, 1, '应当注册了一个（且只有一个）前缀路由')
  const route = routes[0]
  assert.equal(route.path, PREFIX)
  assert.equal(logs.warn.length, 0, `不该有警告日志：${logs.warn.join(' | ')}`)

  const server = createServer(route.handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`

  const personas = realPersonas()
  const firstId = 'agent-1'
  const secondId = 'agent-2'
  const firstSeat = personas.get(firstId)
  const secondSeat = personas.get(secondId)
  assert.ok(firstSeat && secondSeat, '默认世界至少有 2 个角色')

  try {
    // 先拉快照确认世界真的建起来了（否则下面的失败会被误读成"人设坏了"）。
    const snapshot = await fetch(`${base}${PREFIX}/api/world`)
    assert.equal(snapshot.status, 200)

    for (const id of [firstId, secondId]) {
      const response = await fetch(`${base}${PREFIX}/api/say`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: id, text: '你好，你是谁？' }),
      })
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.accepted, true, `${id} 的搭话应当被接收：${JSON.stringify(body)}`)
    }

    // 唤醒是异步的（发送同步、回复走 SSE），所以这里轮询到两次 createAgent 都发生。
    await until(() => created.length >= 2, '两次 agentLoop.createAgent 调用')

    const seedTextOf = (options) => {
      const seed = options.seed
      // R30：seed 是一个闭合的 turn/step 框，人设消息在框里（不是数组第一项）。
      assert.ok(Array.isArray(seed) && seed.length === 5, `seed 应当是闭合的框，实际 ${seed?.length} 条`)
      assert.deepEqual(seed.map((e) => e.type), ['turn/start', 'step/start', 'system/message', 'step/end', 'turn/end'])
      const event = seed.find((e) => e.type === 'system/message')
      assert.equal(event.surfaceOp, 'append')
      const blocks = event.data.message.content
      assert.ok(Array.isArray(blocks) && blocks.length === 1)
      return blocks[0].text
    }

    const firstText = seedTextOf(created[0])
    const secondText = seedTextOf(created[1])

    // ★ 核心断言：内容里的 persona 真的走到了 createAgent 的 seed 里。
    assert.ok(
      firstText.includes(firstSeat.seat.persona.trim()),
      `agent-1 的 system prompt 里应当有他自己的人设（来自内容库）。\n实际 prompt：\n${firstText}`,
    )
    assert.ok(
      firstText.includes(firstSeat.seat.speechStyle.trim()),
      'agent-1 的 system prompt 里应当有他自己的说话方式',
    )
    assert.ok(firstText.includes(firstSeat.name), 'agent-1 的 prompt 里应当有他的名字')

    assert.ok(secondText.includes(secondSeat.seat.persona.trim()), 'agent-2 同理')
    assert.notEqual(firstText, secondText, '★ 两个角色的 prompt 必须不同（否则"每个人有自己的语气"不成立）')

    // 会话 id 由插件生成，两个角色必须是两个会话（懒创建的复用别串了）。
    assert.notEqual(created[0].sessionId, created[1].sessionId)
    assert.equal(created[0].sessionId, 'agent-world:agent-1')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('装配：人设读不到时**退化而不是静默**——/api/say 仍被接收，失败原因走 SSE', async () => {
  // 这个 profile 有 agentLoop 但没有会话服务：桥建不起来，但登记照旧。
  const agentLoop = { async createAgent() { throw new Error('不该走到这里') } }

  const { ctx, routes, logs } = fakeCtx({ agentLoop, sessionController: undefined })
  apply(ctx, { persistEveryTicks: 0, autoStart: false })

  assert.equal(routes.length, 1)
  // R30 起建桥是**惰性**的（真宿主上会话服务往往在插件之后才挂上）：
  // 加载时**不该**下结论，所以加载时没有警告。警告在第一次真正要说话时发出。
  assert.equal(logs.warn.length, 0, `加载时不该对一个可能稍后才出现的服务下结论，实际：${logs.warn.join(' | ')}`)

  const server = createServer(routes[0].handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  try {
    const response = await fetch(`http://127.0.0.1:${port}${PREFIX}/api/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1', text: '你好' }),
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.accepted, true, '话收到了就是收到了；失败通过 SSE 的 failed 事件说清楚')
    assert.equal(typeof body.turnId, 'string')

    // 第一次搭话时才尝试建桥 → 此时才该有那条警告（有 agentLoop 却拿不到会话服务 = 真装错了）。
    // 用轮询 + 截止时间等它出现，不用固定 sleep（R27 的规矩）。
    const deadline = Date.now() + 2000
    while (logs.warn.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5))
    assert.equal(logs.warn.length, 1, `第一次搭话后应当正好一条警告，实际：${logs.warn.join(' | ')}`)
    assert.match(logs.warn[0], /会话服务/)

    // 再说一句：同一种失败**不再重复写日志**（否则日志会被同一句话淹没），但原因照样可下手。
    await fetch(`http://127.0.0.1:${port}${PREFIX}/api/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1', text: '再问一次' }),
    })
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(logs.warn.length, 1, '同一种失败只记一次日志')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
