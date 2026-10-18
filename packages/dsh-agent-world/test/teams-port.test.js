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

test('R126：**我们那一轮在 waitForReply 订阅前就跑完了**——仍要认出它（真机 turn 28/29 原样回放）', async () => {
  // 真机（成员会话 agent-teams:agent-world:工头阿金）：
  //   turn 28  +0.0s start → +0.2s 我们的原话 → +2.5s 回复「没在忙什么…」 → +2.5s end
  //   turn 29 +20.8s start → 队长消息**引用**了我们的原话 → 只有 reasoning + 空 text → +28.9s end
  // R125 的实现：订阅晚于 turn 28 → 认出的是 29（引用）→ 29 的空 text 覆盖答案 → 判「没有发言」。
  const listeners = []
  const SENT = { isError: false, value: {}, content: [] }
  const said = '你好，用一句话告诉我你现在在忙什么。'
  const um = (text) => ({ type: 'user/message', data: { source: { kind: 'agent-teams' }, content: [{ type: 'text', text } ] } })
  const am = (turn, blocks) => ({ type: 'assistant/message', data: { turn, message: { role: 'assistant', content: blocks } } })
  const emit = (ev) => { for (const l of listeners) l('m1', ev) }
  const port = makePort({
    tools: fakeTools({
      agent_teams_create: CREATED,
      agent_teams_add_member: SENT,
      // 发送工具还没返回，成员那一轮就已经整轮跑完（这正是真机的时序）。
      agent_teams_send_message: () => {
        emit({ type: 'turn/start', data: { turn: 28 } })
        emit(um(`AgentTeams message from captain:\n\n${said}`))
        emit(am(28, [{ type: 'text', text: '没在忙什么——手上一张单没有，等玩家开口。' }]))
        emit({ type: 'turn/end', data: { turn: 28, reason: { kind: 'completed' } } })
        return SENT
      },
    }),
    subagents: fakeSubagents([{ id: 'm1', label: 'agent-teams:agent-world:成员-agent-1' }]),
    transport: { subscribe(l) { listeners.push(l); return () => { listeners.splice(listeners.indexOf(l), 1) } } },
  })

  assert.equal((await port.say('agent-1', said)).ok, true)
  const pending = port.waitForReply('agent-1', 3000)
  // 下一轮：引用原话 + 空 text —— 不许被当成我们的
  await new Promise((r) => setTimeout(r, 5))
  emit({ type: 'turn/start', data: { turn: 29 } })
  emit(um(`AgentTeams message from captain:\n\n阿金，你那句答得准。连贯请求：「${said}」——成句。`))
  emit(am(29, [{ type: 'reasoning', text: '……' }, { type: 'text', text: '' }]))
  emit({ type: 'turn/end', data: { turn: 29, reason: { kind: 'completed' } } })

  const reply = await pending
  assert.equal(reply.ok, true, `又被判成没发言：${reply.reason ?? ''}`)
  assert.equal(reply.text, '没在忙什么——手上一张单没有，等玩家开口。')
  assert.equal(listeners.length, 0, '结算后必须退订（录制用的那个订阅也要关）')
})

test('R126：**上一轮残留的发言**不许冒充我们这一轮（我们这轮只动手不说话 ⇒ 仍报失败）', async () => {
  const listeners = []
  const SENT = { isError: false, value: {}, content: [] }
  const said = '把那张单拆一下'
  const emit = (ev) => { for (const l of listeners) l('m1', ev) }
  const port = makePort({
    tools: fakeTools({
      agent_teams_create: CREATED,
      agent_teams_add_member: SENT,
      agent_teams_send_message: () => {
        // 订阅时上一轮(27)还在收尾：它的发言先到。
        emit({ type: 'assistant/message', data: { turn: 27, message: { role: 'assistant', content: [{ type: 'text', text: '（上一轮的话）' }] } } })
        emit({ type: 'turn/end', data: { turn: 27, reason: { kind: 'completed' } } })
        // 我们这一轮(28)：只调了工具，一句话没说。
        emit({ type: 'turn/start', data: { turn: 28 } })
        emit({ type: 'user/message', data: { source: { kind: 'agent-teams' }, content: [{ type: 'text', text: `AgentTeams message from captain:\n\n${said}` }] } })
        emit({ type: 'assistant/message', data: { turn: 28, message: { role: 'assistant', content: [{ type: 'tool-call', name: 'world_task_split' }] } } })
        emit({ type: 'turn/end', data: { turn: 28, reason: { kind: 'completed' } } })
        return SENT
      },
    }),
    subagents: fakeSubagents([{ id: 'm1', label: 'agent-teams:agent-world:成员-agent-1' }]),
    transport: { subscribe(l) { listeners.push(l); return () => { listeners.splice(listeners.indexOf(l), 1) } } },
  })
  await port.say('agent-1', said)
  const reply = await port.waitForReply('agent-1', 2000)
  assert.equal(reply.ok, false, `把上一轮的话当成了这一轮的回复：${reply.text ?? ''}`)
  assert.match(reply.reason, /只动了手/)
})

/** R128 回放用：一个"发送工具一返回、成员那一轮就已整轮跑完"的端口（真机时序，见 R126）。 */
function replayPort(turnsBySend) {
  const listeners = []
  const SENT = { isError: false, value: {}, content: [] }
  let n = 0
  const emit = (ev) => { for (const l of listeners) l('m1', ev) }
  const port = makePort({
    tools: fakeTools({
      agent_teams_create: CREATED,
      agent_teams_add_member: SENT,
      agent_teams_send_message: (input) => {
        const turn = turnsBySend[n++]
        emit({ type: 'turn/start', data: { turn: turn.turn } })
        emit({ type: 'user/message', data: { source: { kind: 'agent-teams' }, content: [{ type: 'text', text: `AgentTeams message from captain:\n\n${input.arguments.content}` }] } })
        emit({ type: 'assistant/message', data: { turn: turn.turn, message: { role: 'assistant', content: turn.blocks } } })
        emit({ type: 'turn/end', data: { turn: turn.turn, reason: { kind: 'completed' } } })
        return SENT
      },
    }),
    subagents: fakeSubagents([{ id: 'm1', label: 'agent-teams:agent-world:成员-agent-1' }]),
    transport: { subscribe(l) { listeners.push(l); return () => { listeners.splice(listeners.indexOf(l), 1) } } },
  })
  return port
}

test('R128 ②：**想了但没说出口**（真机 turn 31：答案整句在 reasoning 里）——文案要说清，且**不泄露思考内容**', async () => {
  const reasoning = '"现在团队里谁最闲？" — coherent request… 一句话：**全闲，不分先后 —— 五个成员手上一张单都没有。**'
  const port = replayPort([{ turn: 31, blocks: [{ type: 'reasoning', text: reasoning, thinkingSignature: '' }] }])
  await port.say('agent-1', '阿金，用一句话说说：现在团队里谁最闲？')
  const reply = await port.waitForReply('agent-1', 2000)
  assert.equal(reply.ok, false, '方案 B 已否决：reasoning 不许当回复')
  assert.match(reply.reason, /想了，但没说出口/)
  assert.doesNotMatch(reply.reason, /全闲|coherent/, '失败原因里不许出现思维链内容')
})

test('R128 ③：**重复的问题不答**（真机 turn 30：同一句话刚问过）——文案要和"想了没说"分开', async () => {
  const said = '你好，用一句话告诉我你现在在忙什么。'
  const port = replayPort([
    { turn: 28, blocks: [{ type: 'text', text: '没在忙什么——手上一张单没有，等玩家开口。' }] },
    { turn: 30, blocks: [{ type: 'reasoning', text: 'This is a repeat of the previous message verbatim… 重复消息，不答。' }] },
  ])
  await port.say('agent-1', said)
  assert.equal((await port.waitForReply('agent-1', 2000)).ok, true, '第一次要能正常答上')
  await port.say('agent-1', said)
  const second = await port.waitForReply('agent-1', 2000)
  assert.equal(second.ok, false)
  assert.match(second.reason, /重复的问题/)
  assert.doesNotMatch(second.reason, /想了，但没说出口/, '"他不理你"和"他想了没说"必须分得开')
})

test('R128：silentReason 的优先级——动手 > 重复 > 想了没说 > 真没发言', async () => {
  const { silentReason } = await import('../lib/bridge/teams.js')
  const r = (o) => silentReason('阿金', { actions: [], repeated: false, thought: false, ...o })
  assert.match(r({ actions: ['world_move'], repeated: true, thought: true }), /只动了手/)
  assert.match(r({ repeated: true, thought: true }), /重复的问题/)
  assert.match(r({ thought: true }), /想了，但没说出口/)
  assert.match(r({}), /没有发言，也没有动手/)
})

test('R128：**我们的话被拼进正在跑的那一轮**（真机 小铁 turn 35）——没看到 turn/start 也要认出来', async () => {
  // 真机：turn/start 35 早在投递之前；投递时序是
  //   step/end 35 → agent/inbox/spliced → step/start 35 → user/message(我们的话)
  //   → assistant[reasoning, tool-call] → … → assistant[text] → turn/end 35
  // 只认 turn/start 的实现在这里认不出 ourTurn → 60s 超时（R128 真机复现）。
  const listeners = []
  const SENT = { isError: false, value: {}, content: [] }
  const emit = (ev) => { for (const l of listeners) l('m3', ev) }
  const port = makePort({
    tools: fakeTools({
      agent_teams_create: CREATED,
      agent_teams_add_member: SENT,
      agent_teams_send_message: (input) => {
        // 这一轮更早的一步（属于上一句话）——它的发言不许算进来
        emit({ type: 'assistant/message', data: { turn: 35, message: { role: 'assistant', content: [{ type: 'text', text: '（上一句话的回答）' }] } } })
        emit({ type: 'step/end', data: { turn: 35 } })
        emit({ type: 'agent/inbox/spliced', data: {} })
        emit({ type: 'step/start', data: { turn: 35 } })
        emit({ type: 'user/message', data: { source: { kind: 'agent-teams' }, content: [{ type: 'text', text: `AgentTeams message from captain:\n\n${input.arguments.content}` }] } })
        emit({ type: 'assistant/message', data: { turn: 35, message: { role: 'assistant', content: [{ type: 'reasoning', text: '…' }, { type: 'tool-call', name: 'agent_teams_send_message' }] } } })
        emit({ type: 'assistant/message', data: { turn: 35, message: { role: 'assistant', content: [{ type: 'text', text: '今天先把 t10 的失败原因查清。' }] } } })
        emit({ type: 'turn/end', data: { turn: 35, reason: { kind: 'completed' } } })
        return SENT
      },
    }),
    subagents: fakeSubagents([{ id: 'm3', label: 'agent-teams:agent-world:成员-agent-3' }]),
    transport: { subscribe(l) { listeners.push(l); return () => { listeners.splice(listeners.indexOf(l), 1) } } },
  })
  await port.say('agent-3', '小铁，用一句话说说你今天的计划。')
  const reply = await port.waitForReply('agent-3', 1500)
  assert.equal(reply.ok, true, `拼进来的那一轮没认出来：${reply.reason ?? ''}`)
  assert.equal(reply.text, '今天先把 t10 的失败原因查清。', '同一轮里我们这句话之前的发言不许混进来')
})

/** R140 用：发送工具一返回，成员那一轮的事件就已按给定顺序发生（真机时序，见 R126）。 */
function splicePort(events) {
  const listeners = []
  const SENT = { isError: false, value: {}, content: [] }
  const emit = (ev) => { for (const l of listeners) l('m1', ev) }
  return makePort({
    tools: fakeTools({
      agent_teams_create: CREATED,
      agent_teams_add_member: SENT,
      agent_teams_send_message: (input) => {
        for (const ev of events(input.arguments.content)) emit(ev)
        return SENT
      },
    }),
    subagents: fakeSubagents([{ id: 'm1', label: 'agent-teams:agent-world:成员-agent-1' }]),
    transport: { subscribe(l) { listeners.push(l); return () => { listeners.splice(listeners.indexOf(l), 1) } } },
  })
}
const cap = (text, kind = 'agent-teams') => ({ type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text: `AgentTeams message from captain:\n\n${text}` }] } })
const say63 = (turn, blocks) => ({ type: 'assistant/message', data: { turn, message: { role: 'assistant', content: blocks } } })

test('R140：**真机 turn 63 原样回放**——别人拼进同一轮后，玩家拿到第 1 步的答案而不是给队长的话', async () => {
  // 旧阿金会话 c41d29d1 的真实序列（turn/start 63 早在投递之前，见 R128）：
  //  step 1: 我们的话 → [reasoning, text「派单前加一道前置检查…」]
  //  step 2: 队长**又拼进一条**「你这条日报里有两处已经过期…」→ [reasoning, text「认，两处都认。…」]
  //  turn/end 63
  const port = splicePort((said) => [
    { type: 'agent/inbox/spliced', data: {} },
    { type: 'step/start', data: { turn: 63 } },
    cap(said),
    { type: 'request/header', data: {} },
    say63(63, [
      { type: 'reasoning', text: '"给团队提一个改进建议吧。" — one sentence.' },
      { type: 'text', text: '一句话：**派单前加一道前置检查——"接单的人手上有没有干这活的工具"；队里四次零改动失败（t2/t4/t7/t10）全是漏了这一条。**' },
    ]),
    { type: 'step/end', data: { turn: 63 } },
    { type: 'agent/inbox/spliced', data: {} },
    { type: 'step/start', data: { turn: 63 } },
    cap('阿金，**你这条日报里有两处已经过期——两处都改结论，所以我去纠。**'),
    say63(63, [
      { type: 'reasoning', text: 'The captain corrects my daily report. I should accept, and note it. Short.' },
      { type: 'text', text: '认，两处都认。\n\n**一、"重放"这个标签是我越界了。**' },
    ]),
    { type: 'step/end', data: { turn: 63 } },
    { type: 'turn/end', data: { turn: 63, reason: { kind: 'completed' } } },
  ])
  await port.say('agent-1', '阿金，一句话：给团队提一个改进建议吧。')
  const reply = await port.waitForReply('agent-1', 2000)
  assert.equal(reply.ok, true, reply.reason)
  assert.match(reply.text, /派单前加一道前置检查/)
  assert.doesNotMatch(reply.text, /认，两处都认/, '给队长的话不许当成玩家的答案')
})

test('R140：**还没答到我们就被插话**——后面的正文是回给别人的，判失败并说清"被插了话"', async () => {
  const port = splicePort((said) => [
    { type: 'step/start', data: { turn: 3 } },
    cap(said),
    // 还没来得及回我们，队长就拼进来一条（G2 turn 3 的形态）
    cap('阿金，这条我不照办，理由说清楚：「没有在途工单」不等于「最大的风险」。'),
    say63(3, [{ type: 'text', text: '队长说得对，我认了。' }]),
    { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } },
  ])
  await port.say('agent-1', '阿金，一句话：如果来了一个紧急 bug，你会派给谁？')
  const reply = await port.waitForReply('agent-1', 2000)
  assert.equal(reply.ok, false, `把回给队长的话交给了玩家：${reply.text ?? ''}`)
  assert.match(reply.reason, /被别人插了话/)
})

test('R140：**运行时快照不算插话**（真机每次投递后都紧跟一条 runtime-context）', async () => {
  const port = splicePort((said) => [
    { type: 'step/start', data: { turn: 5 } },
    cap(said),
    { type: 'user/message', data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.' }] } },
    say63(5, [{ type: 'text', text: '小紫。' }]),
    { type: 'turn/end', data: { turn: 5, reason: { kind: 'completed' } } },
  ])
  await port.say('agent-1', '阿金，一句话：团队里谁最适合做评审？')
  const reply = await port.waitForReply('agent-1', 2000)
  assert.equal(reply.ok, true, `运行时快照被当成了插话：${reply.reason ?? ''}`)
  assert.equal(reply.text, '小紫。')
})

test('R140：silentReason——"被插了话"排在最前（此时动手/思考可能属于任何一方）', async () => {
  const { silentReason } = await import('../lib/bridge/teams.js')
  const r = silentReason('阿金', { actions: ['world_move'], repeated: true, thought: true, splicedBeforeAnswer: true })
  assert.match(r, /被别人插了话/)
  assert.match(silentReason('阿金', { actions: [], repeated: false, thought: true }), /想了，但没说出口/, '不传新字段时行为不变')
})
