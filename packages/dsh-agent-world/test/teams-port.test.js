/**
 * 套壳端口的单元测试（R38）。
 *
 * ⚠️ **它证明的是协议形状，不是真机行为**。真机那几条（角色用自己的语气回话、
 * 宿主重启后还记得、工具白名单生效）只能靠真宿主验，命令见 PROGRESS R37/R38。
 * 这里守住的是"读错了字段名 / 少传一个参数"这类只在真机上才炸的低级错——
 * R37 就踩过：工具的结构化返回值在 `value`，我猜成 `structured`，
 * 于是团队建好了却把成功原文当失败报出来。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createTeamsPort } from '../lib/bridge/index.js'

/** 一个记账用的假 `ctx.tools`：按工具名返回预设结果。 */
function fakeTools(results = {}) {
  const calls = []
  return {
    calls,
    async execute(input) {
      calls.push(input)
      const preset = results[input.name]
      if (preset === undefined) return { isError: true, content: [{ type: 'text', text: `没有预设 ${input.name}` }] }
      return typeof preset === 'function' ? preset(input) : preset
    },
  }
}

/** 假 subagents：按 label 反查成员会话。 */
function fakeSubagents(children = []) {
  return {
    async listChildren() {
      return children
    },
  }
}

function makePort({ tools, subagents, transport, options = {} } = {}) {
  return createTeamsPort(tools, subagents, transport, {
    captainSessionId: 'agent-world:captain',
    cwd: '/tmp/world',
    teamName: 'Agent World',
    teamDescription: '测试用小镇',
    memberNameFor: (id) => `成员-${id}`,
    memberRoleFor: () => 'engineer',
    personaFor: (id) => `你是 ${id} 的人设。`,
    createCaptain: async (sessionId) => ({ agent: { id: sessionId }, async dispose() {} }),
    ...options,
  })
}

const CREATED = { isError: false, value: { team_id: 'agent-world', team_name: 'Agent World' }, content: [] }

test('teams：结构化返回值读 `value`（R37 真机踩过：猜成 structured 会把成功当失败）', async () => {
  const SENT = { isError: false, value: {}, content: [] }
  const tools = fakeTools({
    agent_teams_create: CREATED,
    agent_teams_add_member: SENT,
    agent_teams_send_message: SENT,
  })
  const port = makePort({ tools, transport: { subscribe: () => () => {} } })
  const r = await port.say('agent-5', '你好')
  assert.equal(r.ok, true, r.reason)
  assert.equal(port.teamId(), 'agent-world', 'team_id 必须从 value 里取到')
})

test('teams：已带队时用 status 接回，而不是重建（agent-teams 禁止一个队长带两个队）', async () => {
  const tools = fakeTools({
    agent_teams_create: { isError: true, error: { message: 'you already lead team "Agent World" (id agent-world).' }, content: [] },
    agent_teams_status: { isError: false, value: { team_id: 'agent-world' }, content: [] },
    agent_teams_add_member: { isError: false, value: {}, content: [] },
    agent_teams_send_message: { isError: false, value: {}, content: [] },
  })
  const port = makePort({ tools, transport: { subscribe: () => () => {} } })
  const r = await port.say('agent-5', '你好')
  assert.equal(r.ok, true, r.reason)
  assert.equal(port.teamId(), 'agent-world')
  assert.ok(tools.calls.some((c) => c.name === 'agent_teams_status'), '应当用 status 找回 team_id')
})

test('teams：人设走 executionPrompt，工具策略按配置带上', async () => {
  const tools = fakeTools({ agent_teams_create: CREATED, agent_teams_add_member: { isError: false, value: {}, content: [] } })
  const port = makePort({ tools, transport: { subscribe: () => () => {} }, options: { toolPolicy: 'agent-world-resident' } })
  await port.say('agent-5', '你好')
  const add = tools.calls.find((c) => c.name === 'agent_teams_add_member')
  assert.equal(add.arguments.executionPrompt, '你是 agent-5 的人设。')
  assert.equal(add.arguments.tool_policy, 'agent-world-resident')
  assert.equal(add.arguments.name, '成员-agent-5')
})

test('teams：同一个角色说第二句话不重复加成员（名册会重复，agent-teams 会直接报错）', async () => {
  const tools = fakeTools({ agent_teams_create: CREATED, agent_teams_add_member: { isError: false, value: {}, content: [] }, agent_teams_send_message: { isError: false, value: {}, content: [] } })
  const port = makePort({ tools, transport: { subscribe: () => () => {} } })
  await port.say('agent-5', '第一句')
  await port.say('agent-5', '第二句')
  assert.equal(tools.calls.filter((c) => c.name === 'agent_teams_add_member').length, 1)
  assert.equal(tools.calls.filter((c) => c.name === 'agent_teams_send_message').length, 2)
})

test('teams：成员会话 id 按 label 反查（`agent-teams:<teamId>:<成员名>`），不读它的状态文件', async () => {
  const tools = fakeTools({ agent_teams_create: CREATED, agent_teams_add_member: { isError: false, value: {}, content: [] }, agent_teams_send_message: { isError: false, value: {}, content: [] } })
  const subagents = fakeSubagents([
    { id: 'other-session', label: 'agent-teams:agent-world:别人' },
    { id: 'member-session-1', label: 'agent-teams:agent-world:成员-agent-5' },
  ])
  const seen = []
  const transport = {
    subscribe(listener) {
      seen.push(listener)
      return () => {}
    },
  }
  const port = makePort({ tools, subagents, transport })
  await port.say('agent-5', '你好')
  const pending = port.waitForReply('agent-5', 5000)
  // `waitForReply` 要先反查成员会话 id 才订阅，所以订阅发生在后面的微任务里。
  // 这里等到它订阅上（不是固定 sleep 一个魔数）。
  for (let i = 0; i < 50 && seen.length === 0; i += 1) await new Promise((r) => setTimeout(r, 2))
  assert.equal(seen.length, 1, '必须订阅事件流')
  // 推一条回复：会话 id 必须是反查到的那个。
  seen[0]('member-session-1', {
    type: 'assistant/message',
    data: { message: { role: 'assistant', content: [{ type: 'text', text: '我是成员-agent-5。' }] } },
  })
  seen[0]('member-session-1', { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  const reply = await pending
  assert.equal(reply.ok, true, reply.reason)
  assert.equal(reply.text, '我是成员-agent-5。')
})

test('teams：反查不到成员会话时给出可下手的原因（成员还没被唤醒）', async () => {
  const tools = fakeTools({ agent_teams_create: CREATED, agent_teams_add_member: { isError: false, value: {}, content: [] }, agent_teams_send_message: { isError: false, value: {}, content: [] } })
  const port = makePort({ tools, subagents: fakeSubagents([]), transport: { subscribe: () => () => {} } })
  await port.say('agent-5', '你好')
  const reply = await port.waitForReply('agent-5', 200)
  assert.equal(reply.ok, false)
  assert.match(reply.reason, /会话 id/)
})

test('R43：readTasks 从 status 的 value.tasks 取（attempt_id → attemptId）；团队没建时为空', async () => {
  const SENT = { isError: false, value: {}, content: [] }
  const tools = fakeTools({
    agent_teams_create: CREATED,
    agent_teams_add_member: SENT,
    agent_teams_send_message: SENT,
    agent_teams_status: {
      isError: false,
      content: [],
      value: { team_id: 'agent-world', tasks: [{ id: 't1', subject: '改代码', status: 'in_progress', assignee: '小蓝', dependencies: [], attempt_id: 'a1' }] },
    },
  })
  const port = makePort({ tools, transport: { subscribe: () => () => {} } })
  assert.deepEqual(await port.readTasks(), [], '团队还没建出来时不该去问')
  await port.say('agent-5', '你好')
  const rows = await port.readTasks()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].attemptId, 'a1')
  assert.equal(rows[0].assignee, '小蓝')
})

test('R43：createTask 带依赖，返回 value.task_id；拿不到 id 时报出原因', async () => {
  const tools = fakeTools({
    agent_teams_create: CREATED,
    agent_teams_create_task: (input) => ({ isError: false, content: [], value: { task_id: `t-${input.arguments.subject}` } }),
  })
  const port = makePort({ tools, transport: { subscribe: () => () => {} } })
  const id = await port.createTask({ subject: 'B', dependencies: ['t-A'] })
  assert.equal(id, 't-B')
  const call = tools.calls.find((c) => c.name === 'agent_teams_create_task')
  assert.deepEqual(call.arguments.dependencies, ['t-A'])

  const bad = makePort({ tools: fakeTools({ agent_teams_create: CREATED, agent_teams_create_task: { isError: false, content: [], value: {} } }), transport: { subscribe: () => () => {} } })
  await assert.rejects(bad.createTask({ subject: 'X' }), /task_id/)
})
