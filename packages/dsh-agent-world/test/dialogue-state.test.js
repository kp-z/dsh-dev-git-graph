/**
 * 对话面板状态机测试（M6-5）。
 *
 * ## 为什么这份测试值钱
 *
 * 一次搭话在线上是**两条事件**（`thinking` → `replied`），而面板要么合并成一条、
 * 要么就变成"他怎么回了两次"。这个差别在浏览器里**看不出来**——两条记录都长得像回复，
 * 只是让人疑惑；等发现时已经不知道是哪条事件多了。
 *
 * 所以这里打的全是"**同一 `turnId` 只许有一条记录**"这个不变量，以及它的所有破坏方式：
 * 重复事件、乱序到达（replied 先到）、本地乐观占位与 SSE 的竞态、失败的覆盖、条数上限。
 * 还有两条是给用户的：失败提示必须**能下手**（不是"失败"两个字）、
 * 以及宿主用哪种帧形状推来都要认得出。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MISSING_REASON,
  PHASES,
  activeAgentIds,
  applyDialogueEvent,
  applyDialogueEvents,
  beginLocalTurn,
  clearDialogue,
  createDialogueState,
  dialogueEventsFromFrame,
  explainSayFailure,
  expireThinking,
  failLocalTurn,
  latestTurn,
  resolveLocalTurn,
  speakerAgentId,
  thinkingTurns,
  turnsFor,
} from '../web/core/dialogue-state.js'

const GOD = { kind: 'god' }
const agent = (id) => ({ kind: 'agent', id })

const thinking = (turnId, { agentId = 'agent-1', tick = 0, text = '', from = GOD } = {}) => ({
  turnId,
  tick,
  phase: 'thinking',
  from,
  to: from === GOD ? agent(agentId) : GOD,
  text,
})

const replied = (turnId, text, { agentId = 'agent-1', tick = 1 } = {}) => ({
  turnId,
  tick,
  phase: 'replied',
  from: agent(agentId),
  to: GOD,
  text,
})

const failed = (turnId, reason, { agentId = 'agent-1', tick = 2 } = {}) => ({
  turnId,
  tick,
  phase: 'failed',
  from: agent(agentId),
  to: GOD,
  text: '',
  ...(reason === undefined ? {} : { reason }),
})

/**
 * 结构不变量：`byTurn` 索引与各角色的桶必须**完全一致**。
 *
 * 归组类 bug 的最终症状就是这两者不一致（桶里有两条、索引里只有一条），
 * 而它们各自看都"没问题"。所以每条测试后面都跑一遍。
 */
function assertConsistent(state) {
  const inBuckets = []
  for (const [agentId, turns] of state.byAgent.entries()) {
    assert.ok(turns.length > 0, `角色 ${agentId} 留着一个空桶`)
    assert.ok(turns.length <= state.maxTurnsPerAgent, `角色 ${agentId} 的条数超上限`)
    for (const turn of turns) {
      assert.equal(turn.agentId, agentId, '轮挂错了角色')
      assert.equal(state.byTurn.get(turn.turnId), turn, `turnId ${turn.turnId} 的索引对不上`)
      assert.ok(PHASES.includes(turn.phase), `阶段不认识：${turn.phase}`)
      if (turn.phase === 'failed') {
        assert.ok(
          typeof turn.reason === 'string' && turn.reason.length > 0,
          'failed 的轮必须带 reason（面板不许显示光秃秃的失败）',
        )
      }
      inBuckets.push(turn)
    }
  }
  assert.equal(state.byTurn.size, inBuckets.length, '索引里的轮数与各角色桶里的总数不一致')
  return state
}

test('同一 turnId 的 thinking 与 replied 合并成一条（不许出现两条记录）', () => {
  const state = createDialogueState()
  applyDialogueEvents(state, [thinking('t1'), replied('t1', '好，我去看看登录那块')])

  const turns = turnsFor(state, 'agent-1')
  assert.equal(turns.length, 1, 'thinking 与 replied 必须是同一条记录')
  assert.equal(state.byTurn.size, 1)
  assert.equal(turns[0].phase, 'replied')
  assert.equal(turns[0].text, '好，我去看看登录那块')
  assert.equal(turns[0].reason, null)
  assertConsistent(state)
})

test('failed 覆盖 thinking 的占位，并带上能下手的原因', () => {
  const state = createDialogueState()
  applyDialogueEvents(state, [
    thinking('t1'),
    failed('t1', '模型没有配置：provider 与 model 都是空的'),
  ])

  const turns = turnsFor(state, 'agent-1')
  assert.equal(turns.length, 1, 'failed 必须**覆盖**占位，不是并存')
  assert.equal(turns[0].phase, 'failed')
  assert.equal(turns[0].reason, '模型没有配置：provider 与 model 都是空的')
  // 占位的语义是"还在想"：failed 之后就没有任何轮还在 thinking。
  assert.deepEqual(thinkingTurns(state), [])
  assertConsistent(state)
})

test('failed 没给 reason 也不能显示"失败"两个字', () => {
  const state = createDialogueState()
  applyDialogueEvents(state, [thinking('t1'), failed('t1', undefined)])

  const turn = latestTurn(state, 'agent-1')
  assert.equal(turn.phase, 'failed')
  assert.equal(turn.reason, MISSING_REASON)
  assert.ok(turn.reason.length > 10, '兜底文案必须是一句能下手的话')
  assert.ok(!/^失败[。！]?$/.test(turn.reason))
  assertConsistent(state)
})

test('乱序：replied 先到、thinking 后到，不许把结果降级回"在想"', () => {
  const state = createDialogueState()
  applyDialogueEvents(state, [replied('t1', '来了'), thinking('t1')])

  const turns = turnsFor(state, 'agent-1')
  assert.equal(turns.length, 1)
  assert.equal(turns[0].phase, 'replied', '晚到的 thinking 不能把回复打回占位')
  assert.equal(turns[0].text, '来了')
  assertConsistent(state)
})

test('重复事件是幂等的：同一批发三次，还是一条', () => {
  const state = createDialogueState()
  const batch = [thinking('t1'), replied('t1', '收到')]
  applyDialogueEvents(state, batch)
  applyDialogueEvents(state, batch)
  applyDialogueEvents(state, batch)

  assert.equal(turnsFor(state, 'agent-1').length, 1)
  assert.equal(state.byTurn.size, 1)
  assert.equal(latestTurn(state, 'agent-1').text, '收到')
  assertConsistent(state)
})

test('乱序 + 重复混在一起也不产生重复条目', () => {
  const state = createDialogueState()
  applyDialogueEvents(state, [
    replied('t1', '第二条'),
    thinking('t1'),
    replied('t1', '第二条'),
    thinking('t1'),
    replied('t1', '第二条'),
  ])

  const turns = turnsFor(state, 'agent-1')
  assert.equal(turns.length, 1)
  assert.equal(turns[0].text, '第二条', '后来的 replied 覆盖正文，但仍然只有一条')
  assertConsistent(state)
})

test('回复已经到手时，晚到的 failed 不抹掉真回复（只记下原因）', () => {
  const state = createDialogueState()
  applyDialogueEvents(state, [thinking('t1'), replied('t1', '已经做完了'), failed('t1', '超时（30s）')])

  const turn = latestTurn(state, 'agent-1')
  assert.equal(turn.phase, 'replied', '失败不该毁掉一句真回复')
  assert.equal(turn.text, '已经做完了')
  assert.equal(turn.reason, '超时（30s）', '但原因要留下来，别装作没事')
  assertConsistent(state)
})

test('每个角色的历史有条数上限，且留的是最近几轮', () => {
  const state = createDialogueState({ maxTurnsPerAgent: 5 })
  for (let i = 1; i <= 20; i++) {
    applyDialogueEvents(state, [thinking(`t${i}`), replied(`t${i}`, `第 ${i} 句`)])
  }

  const turns = turnsFor(state, 'agent-1')
  assert.equal(turns.length, 5, '内存不能无限涨')
  assert.deepEqual(
    turns.map((t) => t.turnId),
    ['t16', 't17', 't18', 't19', 't20'],
  )
  assert.equal(state.byTurn.size, 5, '被挤掉的轮必须从索引里也删掉')
  assert.equal(state.dropped, 15)
  assertConsistent(state)
})

test('角色数也有上限：挤掉最久没说话的那个（索引一起清）', () => {
  const state = createDialogueState({ maxAgents: 2 })
  applyDialogueEvents(state, [thinking('a1', { agentId: 'agent-1' }), replied('a1', '一', { agentId: 'agent-1' })])
  applyDialogueEvents(state, [thinking('b1', { agentId: 'agent-2' }), replied('b1', '二', { agentId: 'agent-2' })])
  // 再跟 1 号说一次：2 号成了"最久没动"的那个，3 号进来时把它挤掉。
  applyDialogueEvents(state, [thinking('a2', { agentId: 'agent-1' }), replied('a2', '三', { agentId: 'agent-1' })])
  applyDialogueEvents(state, [thinking('c1', { agentId: 'agent-3' }), replied('c1', '四', { agentId: 'agent-3' })])

  assert.equal(state.byAgent.size, 2)
  assert.deepEqual(activeAgentIds(state), ['agent-3', 'agent-1'], '最近活跃的在前')
  assert.equal(state.byTurn.has('b1'), false, '被挤掉角色的轮不能留在索引里')
  assertConsistent(state)
})

test('本地乐观占位：拿到宿主 turnId 后改挂过去，不是另存一条', () => {
  const state = createDialogueState()
  const local = beginLocalTurn(state, { agentId: 'agent-1', text: '你去修那个登录 bug', tick: 7 })
  assert.equal(local.phase, 'thinking', '按回车的那一刻就得显示"他在想…"')
  assert.equal(local.said, '你去修那个登录 bug')
  assert.equal(local.local, true)

  const merged = resolveLocalTurn(state, local.turnId, 'srv-1')
  assert.equal(merged.turnId, 'srv-1')
  assert.equal(merged.said, '你去修那个登录 bug', '自己说的话不能丢')
  assert.equal(merged.local, false)
  assert.equal(turnsFor(state, 'agent-1').length, 1, '占位与宿主那条必须是同一条')

  // 幂等：重复 resolve 不会变两条。
  resolveLocalTurn(state, 'local:1', 'srv-1')
  assert.equal(turnsFor(state, 'agent-1').length, 1)
  assertConsistent(state)
})

test('竞态：SSE 的 thinking 比 POST 的响应先到，也不能变成两条', () => {
  const state = createDialogueState()
  const local = beginLocalTurn(state, { agentId: 'agent-1', text: '在吗', tick: 3 })
  // 宿主的 thinking 先到（发送是同步的，回复是事件驱动的——但两条路是并行的）
  applyDialogueEvents(state, [thinking('srv-9', { tick: 3 })])

  const merged = resolveLocalTurn(state, local.turnId, 'srv-9')
  assert.equal(turnsFor(state, 'agent-1').length, 1, '竞态下最典型的 bug 就是这里出现两条')
  assert.equal(merged.turnId, 'srv-9')
  assert.equal(merged.said, '在吗', '本地那句原话要补进宿主那条里')
  assertConsistent(state)
})

test('竞态的另一半：回复已经先到了，resolve 不许把它降级回"在想"', () => {
  const state = createDialogueState()
  const local = beginLocalTurn(state, { agentId: 'agent-1', text: '进度呢', tick: 4 })
  applyDialogueEvents(state, [thinking('srv-2', { tick: 4 }), replied('srv-2', '正在做，七成', { tick: 9 })])

  const merged = resolveLocalTurn(state, local.turnId, 'srv-2')
  assert.equal(merged.phase, 'replied')
  assert.equal(merged.text, '正在做，七成')
  assert.equal(merged.said, '进度呢')
  assert.equal(turnsFor(state, 'agent-1').length, 1)
  assertConsistent(state)
})

test('发不出去时：占位就地变成 failed，用户那句话还留着', () => {
  const state = createDialogueState()
  const local = beginLocalTurn(state, { agentId: 'agent-1', text: '你好', tick: 0 })
  failLocalTurn(state, local.turnId, explainSayFailure({ status: 404 }))

  const turn = latestTurn(state, 'agent-1')
  assert.equal(turn.phase, 'failed')
  assert.equal(turn.said, '你好')
  assert.ok(turn.reason.includes('404'))
  assertConsistent(state)
})

test('等太久没动静就自己说"这次回复不会来了"（宿主挂了也得说话）', () => {
  const state = createDialogueState()
  applyDialogueEvents(state, [thinking('t1', { tick: 100 }), thinking('t2', { tick: 950 })])

  const expired = expireThinking(state, { nowTick: 1000, maxAgeTicks: 300 })
  assert.deepEqual(
    expired.map((t) => t.turnId),
    ['t1'],
    '只该收掉真过期的那个',
  )
  assert.equal(state.byTurn.get('t1').phase, 'failed')
  assert.ok(state.byTurn.get('t1').reason.includes('事件流'))
  assert.equal(state.byTurn.get('t2').phase, 'thinking', '还没到点的不许动')
  assertConsistent(state)
})

test('认不出 / 归不到角色的事件不炸，只记账', () => {
  const state = createDialogueState()
  const nothing = [
    null,
    undefined,
    'not an object',
    { type: 'hello', seq: 3 },
    { type: 'dialogue' }, // 没有 turnId
    { turnId: 't1', phase: '编不出来' },
    // 两个界说者都不是角色：面板是"跟谁说话"的面板，没有地方放它
    { turnId: 't2', tick: 0, phase: 'thinking', from: { kind: 'system' }, to: GOD, text: '' },
  ]
  for (const raw of nothing) assert.equal(applyDialogueEvent(state, raw), null)

  assert.equal(state.ignored, nothing.length)
  assert.equal(state.byTurn.size, 0)
  assert.equal(state.byAgent.size, 0)
  assert.equal(activeAgentIds(state).length, 0)
})

test('system 发言归到它面对的那个角色身上（D38：世界自己也会说话）', () => {
  const state = createDialogueState()
  const event = {
    turnId: 't1',
    tick: 5,
    phase: 'replied',
    from: { kind: 'system' },
    to: agent('agent-2'),
    text: '任务已派给你',
  }
  const turn = applyDialogueEvent(state, event)

  assert.equal(speakerAgentId(event), 'agent-2')
  assert.equal(turn.agentId, 'agent-2')
  assert.equal(turnsFor(state, 'agent-2').length, 1)
  assert.equal(latestTurn(state, 'agent-2').text, '任务已派给你')
  assertConsistent(state)
})

test('SSE 帧的四种形状都认得出（形状宽容、语义严格）', () => {
  const e1 = thinking('t1')
  const e2 = replied('t1', '好的')
  const frames = [
    [{ type: 'dialogue', events: [e1, e2] }, 2],
    [{ type: 'dialogue', event: e1 }, 1],
    [{ type: 'dialogue', ...e1 }, 1],
    // 对话夹在世界事件批里（D38：对话是世界里的事件）
    [{ type: 'events', events: [{ seq: 1, tick: 0, type: 'world.tick', payload: {} }, { seq: 2, tick: 0, type: 'dialogue', payload: e1 }] }, 1],
    [e1, 1],
    [{ type: 'hello', seq: 1 }, 0],
    [{ type: 'reset' }, 0],
    // **信封不被契约冻结**：塞在自定义信封的第 N 层也要认得出
    //（验证者的验收测试也是递归找事件、不断言某种信封——面板侧同一口径）。
    [{ type: 'panel.update', data: { items: [{ kind: 'chat', dialogue: e1 }] } }, 1],
    // 两条不同的对话在同一帧里：都要认出来，不能只取第一条。
    [{ type: 'dialogue', events: [e1, thinking('t9', { agentId: 'agent-7' })] }, 2],
  ]

  for (const [frame, expected] of frames) {
    assert.equal(dialogueEventsFromFrame(frame).length, expected, `帧形状没认出来：${JSON.stringify(frame)}`)
  }

  // 认出来的候选喂进状态机，端到端还是一条记录。
  const state = createDialogueState()
  for (const [frame] of frames) applyDialogueEvents(state, dialogueEventsFromFrame(frame))
  assert.equal(turnsFor(state, 'agent-1').length, 1)
  assert.equal(latestTurn(state, 'agent-1').phase, 'replied')
  assert.equal(turnsFor(state, 'agent-7').length, 1, '同一帧里的第二条不能丢')
  assertConsistent(state)
})

test('clearDialogue 能清干净（重开一局时显式调）', () => {
  const state = createDialogueState()
  applyDialogueEvents(state, [thinking('t1'), replied('t1', '一')])
  beginLocalTurn(state, { agentId: 'agent-2', text: '二', tick: 0 })

  clearDialogue(state)
  assert.equal(state.byTurn.size, 0)
  assert.equal(state.byAgent.size, 0)
  assert.equal(turnsFor(state, 'agent-1').length, 0)
  assertConsistent(state)
})

test('失败提示必须能直接下手（不是"失败"两个字）', () => {
  const cases = [
    { failure: { status: 404 }, must: ['404', '/api/say', 'M6-3'] },
    { failure: { status: 405 }, must: ['405'] },
    { failure: { status: 0, error: new TypeError('fetch failed') }, must: ['fetch failed', '宿主'] },
    {
      // 我们自己 10 秒中止的那一种：端点可能存在，但在 HTTP 里等了模型。
      failure: { status: 0, error: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }) },
      must: ['10 秒', '中止', 'accepted'],
    },
    { failure: { status: 500, text: '<html>boom</html>' }, must: ['500', 'boom'] },
    { failure: { status: 429, reason: '该角色的会话数已达上限' }, must: ['上限', '会话数已达上限'] },
    { failure: { status: 400, reason: '文本为空' }, must: ['文本为空'] },
    { failure: { status: 400 }, must: ['400'] },
    { failure: { status: 200, reason: 'accepted 缺失' }, must: ['200', 'accepted'] },
    { failure: null, must: ['宿主'] },
  ]

  for (const { failure, must } of cases) {
    const text = explainSayFailure(failure)
    assert.ok(text.length > 20, `提示太短、帮不了人：${text}`)
    assert.ok(text !== '失败', '不许只写"失败"两个字')
    for (const needle of must) {
      assert.ok(text.includes(needle), `提示里该有「${needle}」：${text}`)
    }
  }

  // 网络错误要在提示里带上 cause，否则用户只看到光秃秃的 "fetch failed"。
  const nested = explainSayFailure({ status: 0, error: new Error('fetch failed', { cause: 'ECONNREFUSED 127.0.0.1:18437' }) })
  assert.ok(nested.includes('ECONNREFUSED'), nested)
})
