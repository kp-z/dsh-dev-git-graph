/**
 * 队长会话 id 可配置（R136 / task-22 方案 A「新一代」）。
 *
 * 钉两条关系（Lead 点名）：
 *  ① **不配 = 旧值** `agent-world:captain`——现有部署的行为一字不变；
 *  ② **配了 = 用配置值**——而且是**真的被用上**：从 `apply()` 最外面进，
 *     看 `agentLoop.createAgent` 收到的 `sessionId`，而不是只看 `resolveConfig` 的返回值
 *     （"配置解析对了、但 index.ts 还在用硬编码"正是这条要防的错）。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, test } from 'node:test'

import { apply } from '../lib/index.js'
import { resolveConfig } from '../lib/config.js'

const PREFIX = '/agent-world'
const disposers = []
after(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

async function until(predicate, what, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = predicate()
    if (value !== undefined && value !== false && value !== null) return value
    assert.ok(Date.now() < deadline, `等「${what}」超时（${timeoutMs}ms）`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('resolveConfig：不配 = `agent-world:captain`；配了用配置值；空白退回默认', () => {
  assert.equal(resolveConfig({}).captainSessionId, 'agent-world:captain', '不配置时必须保持旧值')
  assert.equal(resolveConfig({ captainSessionId: 'agent-world:captain-g2' }).captainSessionId, 'agent-world:captain-g2')
  assert.equal(resolveConfig({ captainSessionId: '  agent-world:captain-g2  ' }).captainSessionId, 'agent-world:captain-g2')
  assert.equal(resolveConfig({ captainSessionId: '   ' }).captainSessionId, 'agent-world:captain', '空白不许变成空 id')
})

/**
 * 走默认后端（agent-teams 套壳）的最小假宿主：只够让一次 `/api/say` 走到"建队长会话"。
 * 发送工具故意报错——我们只关心**建的是哪个队长会话**，不关心之后的事。
 */
async function captainIdUsed(config) {
  const created = []
  const logs = []
  const routes = []
  const agentLoop = {
    async createAgent(ownerCtx, options) {
      created.push(options.sessionId)
      return { agent: { id: options.sessionId }, async dispose() {} }
    },
  }
  const services = {
    agentLoop,
    tools: { async execute() { return { isError: true, content: [{ type: 'text', text: 'test: 不需要真的建队' }] } } },
    subagents: { async listChildren() { return [] } },
  }
  const ctx = {
    tools: { register: () => {} },
    logger: () => ({ info: (m) => logs.push(m), warn: () => {}, error: () => {} }),
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    inject: (names, cb) => {
      const host = { webServer: { register: (r) => (routes.push(r), () => {}) }, effect: ctx.effect }
      if (names.every((n) => host[n] !== undefined)) cb(host)
    },
    get: (name) => services[name],
    on: () => () => {},
  }
  apply(ctx, { persistEveryTicks: 0, autoStart: false, ...config })
  const route = routes.find((r) => r.kind === 'prefix')
  const server = createServer(route.handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    await fetch(`${base}${PREFIX}/api/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1', text: '你好' }),
    })
    await until(() => created.length >= 1, 'agentLoop.createAgent（建队长会话）')
    return { sessionId: created[0], logs }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('装配：**不配**时 index.ts 建的队长会话仍是 `agent-world:captain`', async () => {
  const { sessionId, logs } = await captainIdUsed({})
  assert.equal(sessionId, 'agent-world:captain')
  assert.ok(logs.some((m) => m.includes('队长会话 agent-world:captain，')), `启动日志要写出实际队长：${logs.join(' | ')}`)
})

test('装配：**配了**时 index.ts 真的用配置值建队长会话（不是只解析对了）', async () => {
  const { sessionId, logs } = await captainIdUsed({ captainSessionId: 'agent-world:captain-g2', teamName: 'Agent World G2' })
  assert.equal(sessionId, 'agent-world:captain-g2')
  assert.ok(logs.some((m) => m.includes('队长会话 agent-world:captain-g2') && m.includes('Agent World G2')), logs.join(' | '))
})
