/**
 * M6 对话通道 —— **独立验收测试**（里程碑 M6-3；独立验证者写）。
 *
 * ## 这份测试与 `test/dialogue-state.test.js` 的分工
 *
 * 那一份是**实现者自己的单测**（盯内部函数与状态机）。这一份只认两样东西：
 *
 *   1. `src/protocol/dialogue.ts` 里**冻结的传输契约**（`SayRequest` / `SayResponse` /
 *      `DialogueEvent`）—— 写这份测试时**没有读** `src/routes/`、`src/bridge/` 里任何实现；
 *   2. 一个假想的"面板"：只会 `POST /api/say` + 读 `GET /api/events` 的 HTTP 客户端。
 *
 * 所以它不知道 bridge 怎么建会话、turnId 怎么生成、事件套在哪种帧里——
 * 只要契约成立就该绿，实现随便换。**验证者的价值就在这个"随便换"上。**
 *
 * ## 状态：M6-3 传输段已落地，本文件 7 条全绿（R24）
 *
 * 这份测试是**先写、后实现**的：R23 写它时 `POST /api/say` 还不存在，当时 7 条全标 `todo`
 * （基线保持 `fail 0`）。R24 端点落地后，**先真的跑绿、才摘掉 `todo`**——
 * 这是"完成"的判定方式，不是"我觉得应该能过"。
 *
 * 规矩留档（写进 `docs/VERIFICATION.md`）：
 * 1. 为未实现功能先写的验收测试必须标 `{ todo: '...' }` 并写明欠的是哪一条；
 *    基线永远是 `fail 0`。
 * 2. **摘 `todo` 的标准是"真的跑过了"**。不许改断言迁就实现；
 *    够不到的断言（例如需要真模型）单独留着 `todo` 并写明由谁覆盖，
 *    **推演不等于跑过**。
 *
 * 本文件当前覆盖的两条真实路径：
 * - **不接 port**（headless profile 的真实路径）：`thinking` → `failed`，reason 指向"会话服务不可用"；
 * - **接桩 port**：`thinking` → `replied`，正文与方向都按契约。
 * 桩只替代"模型怎么回"，**不替代传输**：POST 与 SSE 走的都是真 handler、真 TCP 连接。
 *
 * ## 两条不明显的断言，先把理由说清楚
 *
 * - **发送必须同步**（`elapsedMs < 2000`）：契约第 17–28 行写明"`POST /api/say` 只表示
 *   话收到了"，回复走 SSE。如果实现在 HTTP 里等模型，面板会跟着一起卡——这正是 R21
 *   "前端卡顿常常来自在错误的层等了不该等的东西"那条教训。阈值给到 2s 是**刻意宽松**：
 *   这条测的是"有没有等模型"（几秒级），不是 CI 抖动（几十毫秒级）。
 * - **事件按"信封无关"的方式找**：契约冻结了 `DialogueEvent` 的**字段**，但**没有冻结**
 *   它套在哪层帧里（`type:'events'` 的 WorldEvent、还是独立的 `type:'dialogue'` 帧）。
 *   所以这里**递归扫描**每一帧的 data 找"长得像 DialogueEvent 的对象"，而不是断言某种信封
 *   —— 断言信封就是在测我猜的实现，不是在测契约。
 * - **不钉 `from`/`to` 的方向**：契约只说"谁在说"，`thinking` 可能是 god→agent、
 *   `replied` 可能是 agent→god。钉死方向是猜；这里只要求"这场对话确实跟这个角色有关"。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { createPluginState } from '../lib/state.js'
import { createEventHub, createRuntime } from '../lib/runtime/index.js'
import { createHandler } from '../lib/routes/index.js'

const PREFIX = '/agent-world'

/**
 * 当前**没有**未实现功能的欠账：本文件 7 条全绿。
 *
 * 规矩仍然生效（每轮照用，写进 `docs/VERIFICATION.md`）：
 * **为"还没实现的功能"先写的验收测试，必须标 `{ todo: '...' }` 并写明欠的是哪一条。**
 * node 的 `todo` 语义是"失败也不计入 `fail`"，于是基线永远 `fail 0`
 * ——红一旦成为每轮的常态，真正的失败就会被忽略掉。
 * 而完工的判定是：**去掉 `todo` 后真的转绿**，不许改断言迁就实现。
 */

/** 起一个真服务器（端口 0 = 系统分配），跑完关掉。真 HTTP 比假 req/res 更能说明问题。 */
async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

/**
 * 一份"宿主"依赖，造法与 `test/http.test.js` 保持一致。
 *
 * ⚠️ 如果 M6 给 `HttpDeps` 加了**必须注入**的依赖（例如 bridge 端口 / agentLoop 桥），
 * 就在这里补进 `overrides` —— **这是验证者的文件，加依赖注入是允许的**；
 * 但**不要**为了变绿而放宽下面任何一条契约断言（放宽 = 这份测试就没有意义了）。
 */
function makeDeps(config = {}, overrides = {}) {
  const service = createPluginState(
    resolveConfig({ autoStart: false, persistEveryTicks: 0, ...config }),
  )
  service.ensureWorld()
  service.dispatch('task.quick-fix')
  const hub = createEventHub()
  const runtime = createRuntime({ service, tickMs: 100, sink: hub })
  const handler = createHandler(PREFIX, { service, runtime, source: hub, tickMs: 100, ...overrides })
  return { service, runtime, hub, handler }
}

/** 面板会做的第一件事：拉快照，拿世界里**真实存在**的角色 id（而不是猜 `agent-1`）。 */
async function fetchWorld(base) {
  const res = await fetch(`${base}${PREFIX}/api/world`)
  assert.equal(res.status, 200, 'GET /api/world 应当可用（M3 就有的端点，与 M6 无关）')
  const snap = await res.json()
  const agents = snap.world?.agents ?? []
  const ids = agents.map((a) => a.id).filter((id) => typeof id === 'string')
  assert.ok(ids.length >= 2, `世界里至少要有 2 个角色才能验并发上限，当前 ${JSON.stringify(ids)}`)
  return { snap, ids, tick: snap.world?.tick ?? 0 }
}

/**
 * `POST /api/say`。**刻意不抛**：红要靠断言说话，而不是靠 `fetch` 抛异常——
 * 后者给出的信息是"TypeError: fetch failed"，对排查毫无帮助。
 */
async function postSay(base, body) {
  const startedAt = Date.now()
  const res = await fetch(`${base}${PREFIX}/api/say`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const elapsedMs = Date.now() - startedAt
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON 也是信息，留着 text 给诊断用 */
  }
  return { status: res.status, elapsedMs, body: json, text }
}

/** 端点不存在 / 报错时的诊断串。比"undefined 不是 true"有用得多。 */
function show(r) {
  return `status=${r.status} elapsed=${r.elapsedMs}ms body=${r.body === null ? JSON.stringify(r.text) : JSON.stringify(r.body)}`
}

/**
 * 断言这是**契约形状**的 `SayResponse`。
 *
 * 端点没实现时，`/api/*` 兜底路由会给出 404 `{error:"没有这个 API 端点…"}`——
 * 那时这条断言会红，并**明确指出端点是缺的**，而不是让后面某条断言报"undefined !== true"。
 */
function asSayResponse(r, what) {
  assert.ok(
    r.body !== null && typeof r.body === 'object',
    `${what}：/api/say 没有返回 JSON 对象（${show(r)}）。端点还没实现？`,
  )
  assert.equal(
    typeof r.body.accepted,
    'boolean',
    `${what}：SayResponse.accepted 必须是 boolean（${show(r)}）`,
  )
  return r.body
}

/** `DialogueSpeaker` 的三种合法形状（契约第 37 行）。 */
function assertSpeaker(speaker, where) {
  assert.ok(speaker !== null && typeof speaker === 'object', `${where} 必须是 DialogueSpeaker 对象，实际 ${JSON.stringify(speaker)}`)
  assert.ok(
    ['god', 'agent', 'system'].includes(speaker.kind),
    `${where}.kind 只能是 god|agent|system，实际 ${JSON.stringify(speaker)}`,
  )
  if (speaker.kind === 'agent') {
    assert.equal(typeof speaker.id, 'string', `${where} 是 agent 时必须带字符串 id：${JSON.stringify(speaker)}`)
  }
}

/** 打开一条 SSE 连接，按帧解析（与 `test/sse.test.js` 同构；测试完必须 `close()`）。 */
async function openSse(base) {
  const controller = new AbortController()
  const res = await fetch(`${base}${PREFIX}/api/events`, { signal: controller.signal })
  assert.equal(res.status, 200, `GET /api/events 应当可用（M3-4 就有的端点），实际 ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const frames = []
  let buffer = ''

  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut = buffer.indexOf('\n\n')
      while (cut !== -1) {
        const raw = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        frames.push(parseFrame(raw))
        cut = buffer.indexOf('\n\n')
      }
    }
  })().catch(() => {})

  return {
    frames,
    /** 等到某一帧满足条件；超时就带着**已有帧**报错（红的时候要能看懂为什么）。 */
    async waitFor(predicate, what, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const hit = frames.find(predicate)
        if (hit !== undefined) return hit
        assert.ok(Date.now() < deadline, `等「${what}」超时（${timeoutMs}ms），已有帧：${JSON.stringify(frames)}`)
        await new Promise((r) => setTimeout(r, 10))
      }
    },
    close() {
      controller.abort()
      return pump
    },
  }
}

/** 三种帧都要认得：注释（`: ping`）、`retry:` 控制行、带 `data:` 的消息帧。 */
function parseFrame(raw) {
  if (raw.startsWith(':')) return { comment: raw.slice(1).trim() }
  const out = { data: null, id: null, retry: null }
  for (const line of raw.split('\n')) {
    if (line.startsWith('id: ')) out.id = Number.parseInt(line.slice(4), 10)
    else if (line.startsWith('retry: ')) out.retry = Number.parseInt(line.slice(7), 10)
    else if (line.startsWith('data: ')) out.data = JSON.parse(line.slice(6))
  }
  return out
}

/**
 * **信封无关地**找出所有 `DialogueEvent`。
 *
 * 判据只有契约字段：`turnId` 是字符串、`phase` 是字符串。
 * 无论它出现在帧顶层、`payload` 里、还是 `events[]` 数组里，都会被找到。
 */
function findDialogueEvents(node, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) findDialogueEvents(item, out)
    return out
  }
  if (typeof node.turnId === 'string' && typeof node.phase === 'string') out.push(node)
  for (const value of Object.values(node)) findDialogueEvents(value, out)
  return out
}

/**
 * "并发唤醒上限"的配置旋钮。**名字没有冻结**，所以按语义探测，并且**显式排除 `maxAgents`**
 * （那是"同屏角色上限"，与"唤醒几个会话"是两件事，混用会让成本账算错）。
 *
 * 若 owner 最终定的名字不在这个模式里，验证者改这一行即可（本文件归验证者）。
 */
const CAP_KEY = Object.keys(resolveConfig({})).find(
  (k) =>
    k !== 'maxAgents' &&
    /max|limit|cap/i.test(k) &&
    /(session|dialog|conversation|wake|awake|talk|bridge)/i.test(k),
)

// ── 1. 合法请求 ──────────────────────────────────────────────────────────────

test('M6-3 · 合法请求：accepted:true + 非空 turnId，且返回是同步的（不等模型）', async () => {
  const deps = makeDeps()
  await withServer(deps.handler, async (base) => {
    const { ids } = await fetchWorld(base)
    const r = await postSay(base, { agentId: ids[0], text: '你去把登录页那个 bug 修一下' })
    const body = asSayResponse(r, '合法请求')

    assert.equal(
      body.accepted,
      true,
      `合法请求应当被接收（${show(r)}）。理由：契约只要求"登记一次对话"，不要求等模型出结果。`,
    )
    assert.equal(typeof body.turnId, 'string', `accepted:true 必须带 turnId（契约第 78–79 行）：${show(r)}`)
    assert.ok(body.turnId.length > 0, `turnId 不能是空串：${show(r)}`)
    assert.ok(
      r.elapsedMs < 2000,
      `发送必须同步（契约第 17–28 行）：实测 ${r.elapsedMs}ms。若实现是在 HTTP 里等模型，面板会跟着卡死。`,
    )
  })
})

test('M6-3 · 两次搭话拿到不同的 turnId（同一次搭话才复用）', async () => {
  const deps = makeDeps()
  await withServer(deps.handler, async (base) => {
    const { ids } = await fetchWorld(base)
    const a = await postSay(base, { agentId: ids[0], text: '第一句' })
    const b = await postSay(base, { agentId: ids[0], text: '第二句' })
    const aBody = asSayResponse(a, '第一次搭话')
    const bBody = asSayResponse(b, '第二次搭话')
    assert.equal(aBody.accepted, true, `前置条件：第一次搭话要被接收（${show(a)}）`)
    assert.equal(bBody.accepted, true, `前置条件：第二次搭话要被接收（${show(b)}）`)
    assert.notEqual(aBody.turnId, bBody.turnId, 'turnId 是"这一次搭话"的 id，两次不能相同')
  })
})

// ── 2. 三类拒绝，reason 都要能直接下手 ───────────────────────────────────────

test('M6-3 · 角色不存在：accepted:false，reason 指出是哪个 id、并给可用取值', async () => {
  const deps = makeDeps()
  await withServer(deps.handler, async (base) => {
    const { ids } = await fetchWorld(base)
    const ghost = 'agent-9999'
    const r = await postSay(base, { agentId: ghost, text: '在吗' })
    const body = asSayResponse(r, '角色不存在')

    assert.equal(body.accepted, false, `不存在的角色必须被拒（${show(r)}）`)
    assert.equal(typeof body.reason, 'string', `拒绝必须带 reason（契约第 80–81 行）：${show(r)}`)
    assert.ok(body.reason.trim().length > 0, 'reason 不能是空串或全空白——只写"失败"帮不了任何人')
    assert.match(
      body.reason,
      /不存在|未知|找不到|没有|not\s*found|unknown|invalid/i,
      `reason 要说清"角色不存在"：${JSON.stringify(body.reason)}`,
    )

    // "能直接下手"的判据：要么带上被拒的 id，要么列出世界里真实存在的 id（可用取值）。
    const actionable = body.reason.includes(ghost) || ids.some((id) => body.reason.includes(id))
    assert.ok(
      actionable,
      `reason 要能直接下手（含可用取值）：至少要说清被拒的是 "${ghost}" 或列出真实存在的 id ${JSON.stringify(ids)}。实际：${JSON.stringify(body.reason)}`,
    )
    assert.ok(r.status < 500, `这类拒绝不该是 5xx（${show(r)}）`)
  })
})

test('M6-3 · 文本为空 / 全空白：accepted:false，reason 说清"空"', async () => {
  const deps = makeDeps()
  await withServer(deps.handler, async (base) => {
    const { ids } = await fetchWorld(base)
    for (const text of ['', '   ', '\n\t ']) {
      const r = await postSay(base, { agentId: ids[0], text })
      const body = asSayResponse(r, `文本 ${JSON.stringify(text)}`)
      assert.equal(body.accepted, false, `空/全空白文本必须被拒：${JSON.stringify(text)} → ${show(r)}`)
      assert.equal(typeof body.reason, 'string', `拒绝必须带 reason：${show(r)}`)
      assert.match(
        body.reason,
        /空|空白|empty|blank|missing|required|不能/i,
        `reason 要说清"文本为空/全空白"，而不是别的理由：${JSON.stringify(body.reason)}`,
      )
      assert.ok(r.status < 500, `这类拒绝不该是 5xx（${show(r)}）`)
    }
  })
})

test('M6-3 · 超过并发唤醒上限：accepted:false，reason 给出阈值', async () => {
  if (CAP_KEY === undefined) {
    assert.fail(
      '配置里找不到"并发唤醒上限"的旋钮：M6-1 要求"懒创建 + 有上限 + 面板显示会话数"，' +
        '没有可配的上限，这条就无法确定性地验证。' +
        `resolveConfig 现有键：${Object.keys(resolveConfig({})).join(', ')}`,
    )
  }

  const deps = makeDeps({ [CAP_KEY]: 1 })
  await withServer(deps.handler, async (base) => {
    const { ids } = await fetchWorld(base)
    const first = await postSay(base, { agentId: ids[0], text: '你先去工位' })
    const firstBody = asSayResponse(first, `上限=${1} 的第一个角色`)
    assert.equal(
      firstBody.accepted,
      true,
      `前置条件失败：上限内第一个角色应当被接收（${show(first)}）。` +
        '若这里的原因是"模型/会话不可用"，说明本用例需要一个**不会回话的 bridge 桩**才能把上限占住' +
        '——请 owner 告知注入点，验证者来接线（不要为了让它绿而放宽断言）。',
    )

    const second = await postSay(base, { agentId: ids[1], text: '你也去' })
    const secondBody = asSayResponse(second, '超出上限的第二个角色')
    assert.equal(
      secondBody.accepted,
      false,
      `超过唤醒上限（${CAP_KEY}=1）必须被拒（${show(second)}）`,
    )
    assert.equal(typeof secondBody.reason, 'string', `拒绝必须带 reason：${show(second)}`)
    assert.match(
      secondBody.reason,
      /\d+/,
      `reason 要给出阈值/可用取值，让人能直接下手（例如"已唤醒 1 个，上限 1"）：${JSON.stringify(secondBody.reason)}`,
    )
    assert.match(
      secondBody.reason,
      /上限|limit|max|已满|唤醒|会话|session/i,
      `reason 要说清是"撞到唤醒上限"：${JSON.stringify(secondBody.reason)}`,
    )
    assert.ok(second.status < 500, `这类拒绝不该是 5xx（${show(second)}）`)
  })
})

// ── 3. 对话确实进了 SSE（D38：对话是世界里的事件，不是私有旁路） ─────────────

test('M6-3 · 对话进 SSE（不接 port 的真实退化路径）：thinking 带提问者原话 → failed 带可下手 reason', async () => {
  const deps = makeDeps()
  await withServer(deps.handler, async (base) => {
    const { ids, tick: worldTick } = await fetchWorld(base)
    const sse = await openSse(base)
    try {
      // 先等握手帧：否则"没等到事件"与"流根本没建立"分不开。
      await sse.waitFor((f) => f.data?.type === 'hello', 'hello 握手帧')

      const question = '你好，你是谁？'
      const r = await postSay(base, { agentId: ids[0], text: question })
      const body = asSayResponse(r, 'SSE 场景下的搭话')
      assert.equal(body.accepted, true, `前置条件：搭话要先被接收（${show(r)}）`)

      await sse.waitFor(
        (f) => findDialogueEvents(f.data).some((e) => e.turnId === body.turnId),
        `turnId=${body.turnId} 的 DialogueEvent（若实现把对话放在独立 SSE 端点，请注意决策 D38：对话必须进同一条事件流，多开的面板才看得到同一段对话）`,
      )

      const mine = sse.frames
        .flatMap((f) => findDialogueEvents(f.data))
        .filter((e) => e.turnId === body.turnId)

      const thinking = mine.find((e) => e.phase === 'thinking')
      assert.ok(
        thinking !== undefined,
        `契约第 41–44 行要求先来 phase='thinking'（模型几秒才回，面板必须能显示"他在想"，否则用户会以为卡住、再点一次）。实际阶段序列：${JSON.stringify(mine.map((e) => e.phase))}`,
      )

      for (const e of mine) {
        assert.ok(
          ['thinking', 'replied', 'failed'].includes(e.phase),
          `phase 只能是 thinking|replied|failed：${JSON.stringify(e)}`,
        )
        assert.equal(typeof e.tick, 'number', `DialogueEvent.tick 必须是数字（契约第 51–52 行）:${JSON.stringify(e)}`)
        assert.ok(
          Number.isFinite(e.tick) && e.tick >= 0 && e.tick <= worldTick + 1,
          `tick 必须是**世界 tick**、不是墙上时间：世界当前 tick=${worldTick}，事件给了 ${e.tick}。` +
            '（决策 D38：对话是世界里发生的事；用 Date.now() 当 tick 会让回放对不上。）',
        )
        assert.equal(typeof e.text, 'string', `DialogueEvent.text 必须是字符串：${JSON.stringify(e)}`)
        assertSpeaker(e.from, 'from')
        assertSpeaker(e.to, 'to')

        // 不钉方向（见文件头说明），只要求"这场对话确实跟这个角色有关"。
        const involvesAgent =
          (e.from.kind === 'agent' && e.from.id === ids[0]) ||
          (e.to.kind === 'agent' && e.to.id === ids[0])
        assert.ok(
          involvesAgent,
          `这场对话必须与 agentId=${ids[0]} 有关（from/to 至少一边是它）：${JSON.stringify({ from: e.from, to: e.to })}`,
        )

        if (e.phase === 'thinking') {
          // 契约 R24：thinking 的 text 是**提问者的原话**（原设计"空串"与 D38 冲突，
          // 已作废）。不变量：thinking 帧必须能自证"在回答谁说的什么"。
          assert.equal(
            e.text,
            question,
            `thinking 的 text 必须是**提问者的原话**（契约 R24，第 45–46、59–72 行）：${JSON.stringify(e)}`,
          )
        }
        if (e.phase === 'replied') {
          assert.ok(e.text.trim().length > 0, `replied 不该给空文本：${JSON.stringify(e)}`)
        }
        if (e.phase === 'failed') {
          assert.equal(e.text, '', `failed 时 text 必须是空串（契约第 60 行）：${JSON.stringify(e)}`)
          assert.ok(
            typeof e.reason === 'string' && e.reason.trim().length > 0,
            `failed 必须带能直接下手的 reason（契约第 73–78 行）：${JSON.stringify(e)}`,
          )
          assert.ok(
            e.reason.trim().length >= 8,
            `reason 要能直接下手（写清原因与下一步），不能只有一个"失败"：${JSON.stringify(e.reason)}`,
          )
        }
      }

      // 顺序与终态：面板先看到"他在想"，然后**必须**收到一个终态
      // （红线 6：失败要退化，不要卡住——永远停在 thinking 就是"装作没事"）。
      const phases = mine.map((e) => e.phase)
      const terminalIndex = phases.findIndex((p) => p === 'replied' || p === 'failed')
      assert.ok(
        terminalIndex !== -1,
        `必须有一个终态（replied/failed），否则面板会永远停在"他在想"：实际 ${JSON.stringify(phases)}`,
      )
      assert.ok(
        phases.indexOf('thinking') < terminalIndex,
        `thinking 必须先于终态（面板先显示"他在想"）：实际 ${JSON.stringify(phases)}`,
      )
    } finally {
      await sse.close()
    }
  })
})

test('M6-3 · 对话进 SSE（接上会回话的 port）：thinking → replied，回复正文与方向都对', async () => {
  // 用**桩 port** 把 replied 这一条真跑通：没有它，测试环境里序列只会是
  // [thinking, failed]，"replied 带正文"就只是**推演**而不是验过。
  // 桩只替代"模型怎么回"，不替代传输：POST 与 SSE 走的都是真 handler、真连接。
  const replyText = '（桩回复）收到，我这就去工位看看。'
  const stubPort = {
    async say() {
      return { ok: true }
    },
    async waitForReply() {
      return { ok: true, text: replyText }
    },
    liveCount: () => 1,
  }

  const deps = makeDeps({}, { dialogue: stubPort })
  await withServer(deps.handler, async (base) => {
    const { ids } = await fetchWorld(base)
    const sse = await openSse(base)
    try {
      await sse.waitFor((f) => f.data?.type === 'hello', 'hello 握手帧')
      const question = '你去看看登录那个 bug'
      const r = await postSay(base, { agentId: ids[0], text: question })
      const body = asSayResponse(r, '桩 port 下的搭话')
      assert.equal(body.accepted, true, `前置条件：搭话要先被接收（${show(r)}）`)

      await sse.waitFor(
        (f) => findDialogueEvents(f.data).some((e) => e.turnId === body.turnId && e.phase === 'replied'),
        `turnId=${body.turnId} 的 replied 帧`,
      )

      const mine = sse.frames
        .flatMap((f) => findDialogueEvents(f.data))
        .filter((e) => e.turnId === body.turnId)

      assert.deepEqual(
        mine.map((e) => e.phase),
        ['thinking', 'replied'],
        `桩 port 会立刻回话，序列应当是 [thinking, replied]：${JSON.stringify(mine)}`,
      )

      const [thinking, replied] = mine
      assert.equal(thinking.text, question, 'thinking 带的是提问者原话')
      assert.equal(replied.text, replyText, 'replied 带的是回复正文')
      assert.deepEqual(thinking.from, { kind: 'god' }, 'thinking 是玩家在说')
      assert.deepEqual(thinking.to, { kind: 'agent', id: ids[0] }, 'thinking 是说给这个角色')
      assert.deepEqual(replied.from, { kind: 'agent', id: ids[0] }, 'replied 是角色在说')
      assert.deepEqual(replied.to, { kind: 'god' }, 'replied 是说给玩家')
      assert.equal(replied.tick, thinking.tick, '同一次搭话的两个事件应当在同一 tick（世界没推进）')
    } finally {
      await sse.close()
    }
  })
})
