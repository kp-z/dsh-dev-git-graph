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
  // ⚠️ R119：**必须先 `turn/start` 再 `turn/end`**——真机的流里两者永远成对出现，
  // 而 `waitForReply` 现在只结算"订阅之后才开始"的轮次（见下面那条反证用例）。
  // 这条用例原先只推 `turn/end`，等于在替"对任何 turn/end 都收尾"的旧行为背书。
  seen[0]('member-session-1', { type: 'turn/start', data: { turn: 1 } })
  // 真机流里我们那句话会作为 user/message 落进这一轮（R119 靠它认出"我们这一轮"）。
  seen[0]('member-session-1', { type: 'user/message', data: { source: { kind: 'agent-teams' }, content: [{ type: 'text', text: 'AgentTeams message: 你好' }] } })
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

test('R119：**订阅前就在跑的轮次**，它的 turn/end 必须被忽略（"工头阿金说不出话"的根因）', async () => {
  const seen = []
  const SENT = { isError: false, value: {}, content: [] }
  const port = makePort({
    tools: fakeTools({ agent_teams_create: CREATED, agent_teams_add_member: SENT, agent_teams_send_message: SENT }),
    subagents: fakeSubagents([{ id: 'member-session-1', label: 'agent-teams:agent-world:成员-agent-5' }]),
    transport: {
      subscribe(listener) {
        seen.push(listener)
        return () => {}
      },
    },
  })

  await port.say('agent-5', '你在忙什么？')
  const pending = port.waitForReply('agent-5', 5000)
  for (let i = 0; i < 50 && seen.length === 0; i += 1) await new Promise((r) => setTimeout(r, 2))
  assert.equal(seen.length, 1)

  // ① 先来一条**陈旧的** turn/end：它属于订阅前就在跑的那一轮（我们从没见过它的 start）。
  //    正文在订阅前就发完了 —— 这正是真机上把 agent-1 判成"没发言"的那条事件。
  seen[0]('member-session-1', { type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } })

  // ② 我们这条消息触发的轮次：turn/start 在订阅之后到达 → 它的 turn/end 才算数。
  seen[0]('member-session-1', { type: 'turn/start', data: { turn: 8 } })
  seen[0]('member-session-1', { type: 'user/message', data: { source: { kind: 'agent-teams' }, content: [{ type: 'text', text: 'AgentTeams message: 你在忙什么？' }] } })
  seen[0]('member-session-1', {
    type: 'assistant/message',
    data: { message: { role: 'assistant', content: [{ type: 'text', text: '我在盯 task-27。' }] } },
  })
  seen[0]('member-session-1', { type: 'turn/end', data: { turn: 8, reason: { kind: 'completed' } } })

  const reply = await pending
  assert.equal(reply.ok, true, `陈旧 turn/end 把这一轮提前结算了：${reply.reason ?? ''}`)
  assert.equal(reply.text, '我在盯 task-27。')
})

test('R119：**模型确实没发言**的那一轮仍要报失败（不许退化成"永远不报错"）', async () => {
  const seen = []
  const SENT = { isError: false, value: {}, content: [] }
  const port = makePort({
    tools: fakeTools({ agent_teams_create: CREATED, agent_teams_add_member: SENT, agent_teams_send_message: SENT }),
    subagents: fakeSubagents([{ id: 'member-session-1', label: 'agent-teams:agent-world:成员-agent-5' }]),
    transport: {
      subscribe(listener) {
        seen.push(listener)
        return () => {}
      },
    },
  })

  await port.say('agent-5', '说句话')
  const pending = port.waitForReply('agent-5', 5000)
  for (let i = 0; i < 50 && seen.length === 0; i += 1) await new Promise((r) => setTimeout(r, 2))

  // 我们这一轮：start 在订阅之后、**没有 assistant/message**、直接 end。
  seen[0]('member-session-1', { type: 'turn/start', data: { turn: 3 } })
  seen[0]('member-session-1', { type: 'user/message', data: { source: { kind: 'agent-teams' }, content: [{ type: 'text', text: 'AgentTeams message: 说句话' }] } })
  seen[0]('member-session-1', { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } })

  const reply = await pending
  assert.equal(reply.ok, false, '没发言必须报失败——否则就是把"坏掉"伪装成"正常"')
  assert.match(reply.reason, /没有发言/)
})

test('R119：按**真机实况**回放——队长会话连续转轮时，只有我们那一轮会被结算', async () => {
  // 事件序列取自真机会话记录 `agent-world:captain`（工头阿金）：
  // 它在 58→66 轮之间**连续转轮**，中间还夹着 `subagent-settled` / `runtime-context` 触发的轮次，
  // 而且 turn 64 是 `turn/end(blocked)`、**没有任何 assistant/message**。
  // 旧代码在这里必然踩到别人的 `turn/end` → 稳定误判「工头阿金没有发言」。
  const seen = []
  const SENT = { isError: false, value: {}, content: [] }
  const port = makePort({
    tools: fakeTools({ agent_teams_create: CREATED, agent_teams_add_member: SENT, agent_teams_send_message: SENT }),
    subagents: fakeSubagents([{ id: 'cap-session', label: 'agent-teams:agent-world:成员-agent-1' }]),
    transport: {
      subscribe(listener) {
        seen.push(listener)
        return () => {}
      },
    },
  })

  await port.say('agent-1', '那张单卡在哪？')
  const pending = port.waitForReply('agent-1', 5000)
  for (let i = 0; i < 50 && seen.length === 0; i += 1) await new Promise((r) => setTimeout(r, 2))
  const emit = seen[0]
  const to = (turn, reason) => emit('cap-session', { type: 'turn/end', data: { turn, reason: { kind: reason } } })
  const start = (turn) => emit('cap-session', { type: 'turn/start', data: { turn } })

  // ① 订阅前就在跑的轮次 58/59：它们的 end 先到（正文早在我们订阅前就发完了）。
  to(58, 'completed')
  to(59, 'error')
  // ② 别人的轮次 60/61/62：有 assistant/message，但**不是我们这条消息触发的**。
  start(60)
  // 别人的消息（subagent-settled）——不含我们那句话，所以 60 轮**不是**我们的。
  emit('cap-session', { type: 'user/message', data: { source: { kind: 'subagent-settled' }, content: [{ type: 'text', text: 'Background subagent finished.' }] } })
  emit('cap-session', { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '我先看看团队状态。' }] } } })
  to(60, 'completed')
  start(63)
  to(63, 'completed')
  // ③ 真机里那个"没有发言"的轮次（blocked）——也不是我们的。
  start(64)
  to(64, 'blocked')

  // ④ 我们这条消息触发的轮次：65 → 有回复 → end。
  start(65)
  emit('cap-session', { type: 'user/message', data: { source: { kind: 'agent-teams' }, content: [{ type: 'text', text: 'AgentTeams message: 那张单卡在哪？' }] } })
  emit('cap-session', { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '卡在没有工位：research 能力没空位。' }] } } })
  to(65, 'completed')

  const reply = await pending
  assert.equal(reply.ok, true, `被前面任何一条 turn/end 提前结算了：${reply.reason ?? ''}`)
  assert.equal(reply.text, '卡在没有工位：research 能力没空位。')
})

test('R119：**认不出我们那一轮**时，宁可超时也不把别人的回复报成答案', async () => {
  const seen = []
  const SENT = { isError: false, value: {}, content: [] }
  const port = makePort({
    tools: fakeTools({ agent_teams_create: CREATED, agent_teams_add_member: SENT, agent_teams_send_message: SENT }),
    subagents: fakeSubagents([{ id: 's', label: 'agent-teams:agent-world:成员-agent-5' }]),
    transport: { subscribe(l) { seen.push(l); return () => {} } },
  })
  await port.say('agent-5', '只有我知道的这句话')
  const pending = port.waitForReply('agent-5', 150)
  for (let i = 0; i < 50 && seen.length === 0; i += 1) await new Promise((r) => setTimeout(r, 2))
  // 一整轮**别人的**：有回复、有 end，但从没出现过我们那句话。
  seen[0]('s', { type: 'turn/start', data: { turn: 9 } })
  seen[0]('s', { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '别人的回复' }] } } })
  seen[0]('s', { type: 'turn/end', data: { turn: 9, reason: { kind: 'completed' } } })
  const reply = await pending
  assert.equal(reply.ok, false, '把别人的回复报成了答案')
  assert.match(reply.reason, /还没等到/)
})
