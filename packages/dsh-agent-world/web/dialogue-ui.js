/*
 * 对话面板（M6-5）—— 这一半是**DOM**，逻辑全在 `dialogue-state.js` 里。
 *
 * ── 它负责什么 ────────────────────────────────────────────────────────────────
 *
 * `点角色 → 面板出现 → 打字 → 回车 → 立刻"他在想…" → 事件流到了就替换成回复`。
 * 面板**不轮询、不等待**：`POST ./api/say` 只表示"话收到了"（契约里的时序约定），
 * 回复等 SSE 推 `DialogueEvent`。所以这里没有任何定时器等回复——
 * 唯一的定时来源是上层每 250ms 调一次的 `render(nowMs)`，它只重画"他在想…（12s）"
 * 里的那个秒数，顺便让超过 12 秒的气泡淡出。
 *
 * ── 三条刻意的做法 ────────────────────────────────────────────────────────────
 *
 * 1. **文本一律 `textContent` 上屏**。这里显示的东西来自模型与用户输入，
 *    用 `innerHTML` 拼就是把页面的控制权交给对话内容。
 * 2. **回车发送要绕开输入法**。中文输入法里回车是"确认候选词"，
 *    只看 `key === 'Enter'` 会让每一句中文都在半途发出去（`isComposing` 那一行）。
 * 3. **名字来自世界数据**（`setAgents`），代码里没有任何角色名——
 *    人设是内容（D37）。名字没到（快照还没回来）时显示"该角色"，而不是编一个。
 *
 * 面板放在侧栏里，所以**俯视与 3D 两个视图下它都在**（不随 `state.mode` 变），
 * 这是"对话不该被渲染器绑住"的直接体现。
 */

import {
  applyDialogueEvents,
  beginLocalTurn,
  createDialogueState,
  explainSayFailure,
  expireThinking,
  failLocalTurn,
  latestTurn,
  resolveLocalTurn,
  thinkingTurns,
  turnsFor,
} from './dialogue-state.js'

/** 打字时提示面板不轮询的那句话（也是给"为什么回复没立刻出现"的解释）。 */
const SENDING_HINT = '已发出。这条不走请求等待——回复会经事件流推回来，面板不轮询。'

/** 回复气泡在头顶留多久（`thinking` 的轮不受这个限制：它要一直挂到有结果）。 */
export const BUBBLE_TTL_MS = 12000

/** 没有名字时的占位（**不是角色名**：名字是内容，代码里不许有）。 */
const UNKNOWN_NAME = '该角色'

function el(doc, tag, className, text) {
  const node = doc.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * 建对话面板。
 *
 * @param {object} options
 * @param {Document} [options.document] - 文档（测试/嵌入时可换）。
 * @param {(request: {agentId: string, text: string, tick: number, localTurnId: string}) => Promise<{ok: boolean, turnId?: string, status?: number, reason?: string, error?: unknown, text?: string}>} options.send
 *   发话。**由调用方（`app.js`）拥有端点**，这里只管 UI 与状态。
 * @param {() => void} [options.onChanged] - 面板状态变了（花名册上的"…"要跟着变）。
 * @param {object} [options.state] - 状态机选项（`createDialogueState`）。
 */
export function createDialogueUi(options = {}) {
  const doc = options.document ?? globalThis.document
  const state = createDialogueState(options.state)

  const byId = (id) => doc.getElementById(id)
  const $panel = byId('dialogue')
  const $who = byId('dialogue-who')
  const $log = byId('dialogue-log')
  const $form = byId('dialogue-form')
  const $input = byId('dialogue-input')
  const $send = byId('dialogue-send')
  const $hint = byId('dialogue-hint')
  const $close = byId('dialogue-close')
  /** 面板缺元素时**不要抛**：对话没了不该把整个面板带崩（俯视图还要看模拟）。 */
  const ready = [$panel, $log, $form, $input, $hint].every((node) => node !== null && node !== undefined)

  /** agentId → 世界数据里的名字/职业（D37：名字是内容）。 */
  const names = new Map()
  /** 从世界数据里取当前 tick（面板自己不吃时钟，见文件头）。 */
  let tickOf = () => 0
  /** 当前在跟谁说话（null = 面板关着）。 */
  let currentAgentId = null
  /** 上一次重画用的签名：没变就不动 DOM（每 250ms 调一次，不能每次都重建）。 */
  let lastSignature = null

  function nameOf(agentId) {
    return names.get(agentId)?.name ?? agentId ?? UNKNOWN_NAME
  }

  function setHint(text, tone = 'info') {
    if ($hint === null) return
    $hint.textContent = text ?? ''
    $hint.className = `dialogue-hint ${tone}`
    $hint.hidden = text === null || text === undefined || text === ''
  }

  /** 把这一轮"刚变过"这件事记下来（气泡靠它决定什么时候淡出）。 */
  function stamp(turns, nowMs) {
    for (const turn of turns) if (turn !== undefined && turn !== null) turn.uiChangedAt = nowMs
  }

  /** 一轮的签名：变了才重画。 */
  function signature(turns, nowMs) {
    return turns
      .map((t) => {
        const secs = t.phase === 'thinking' ? Math.floor((nowMs - (t.uiChangedAt ?? nowMs)) / 1000) : -1
        return `${t.turnId}\u0001${t.phase}\u0001${t.said}\u0001${t.text}\u0001${t.reason ?? ''}\u0001${secs}`
      })
      .join('\u0002')
  }

  function renderLog(nowMs, force = false) {
    if (!ready) return
    const turns = turnsFor(state, currentAgentId)
    const sig = signature(turns, nowMs)
    if (!force && sig === lastSignature) return
    lastSignature = sig

    $log.textContent = ''
    if (turns.length === 0) {
      $log.append(
        el(
          doc,
          'li',
          'd-empty',
          '还没有对话。打字发第一句——回复会经事件流推回来，不会卡在这个页面上等。',
        ),
      )
      return
    }

    for (const turn of turns) {
      if (turn.said !== '') {
        const said = el(doc, 'li', 'd-said')
        said.append(el(doc, 'b', undefined, '我'), el(doc, 'span', undefined, turn.said))
        $log.append(said)
      }

      const line = el(doc, 'li', `d-reply d-${turn.phase}`)
      line.append(el(doc, 'b', undefined, nameOf(turn.agentId)))
      if (turn.phase === 'thinking') {
        const secs = Math.floor((nowMs - (turn.uiChangedAt ?? nowMs)) / 1000)
        line.append(el(doc, 'span', 'd-thinking', `他正在想…（${Math.max(0, secs)}s）`))
      } else if (turn.phase === 'replied') {
        line.append(el(doc, 'span', undefined, turn.text))
      } else {
        // 失败**必须带原因**：状态机保证了 `reason` 永远是一句能下手的话。
        line.append(el(doc, 'span', 'd-reason', `他说不出话：${turn.reason}`))
      }
      if (turn.phase !== 'thinking') line.append(el(doc, 'i', 'dim d-tick', `tick ${turn.atTick}`))
      $log.append(line)
    }

    // 滚到最新一条：对话是"越新越重要"的东西，不用手动滑。
    $log.scrollTop = $log.scrollHeight
  }

  /** 重画（上层每 250ms 调一次；签名没变时几乎不做事）。 */
  function render(nowMs = 0) {
    renderLog(nowMs)
  }

  function refreshWho() {
    if ($who === null || currentAgentId === null) return
    const info = names.get(currentAgentId)
    $who.textContent =
      info === undefined ? `${UNKNOWN_NAME}（${currentAgentId}）` : `${info.name} · ${info.role ?? ''}`
  }

  function open(agentId) {
    if (!ready || agentId === null || agentId === undefined) return false
    currentAgentId = agentId
    $panel.hidden = false
    setHint('')
    lastSignature = null
    refreshWho()
    renderLog(performance.now(), true)
    $input?.focus()
    options.onChanged?.()
    return true
  }

  function close() {
    if (!ready) return
    currentAgentId = null
    $panel.hidden = true
    setHint('')
    options.onChanged?.()
  }

  function toggle(agentId) {
    if (currentAgentId === agentId) close()
    else open(agentId)
  }

  /** 发话。**先本地乐观建轮**，再等宿主的 `accepted`。 */
  async function submit() {
    if (!ready || currentAgentId === null) return null
    const text = ($input.value ?? '').trim()
    if (text === '') {
      setHint('说点内容再发（空消息宿主也会拒，白跑一趟）。', 'warn')
      $input.focus()
      return null
    }

    const agentId = currentAgentId
    const tick = tickOf()
    const local = beginLocalTurn(state, { agentId, text, tick })
    stamp([local], performance.now())
    $input.value = ''
    setHint(SENDING_HINT, 'info')
    lastSignature = null
    renderLog(performance.now(), true)
    options.onChanged?.()

    let result
    try {
      result = await options.send({ agentId, text, tick, localTurnId: local.turnId })
    } catch (error) {
      result = { ok: false, status: 0, error }
    }

    const now = performance.now()
    let turn
    if (result !== null && result.ok === true && typeof result.turnId === 'string' && result.turnId !== '') {
      turn = resolveLocalTurn(state, local.turnId, result.turnId)
      setHint('')
    } else {
      // **失败要说清楚**：`explainSayFailure` 把状态码/网络错误翻成一句能下手的话。
      const reason = explainSayFailure(result ?? {})
      turn = failLocalTurn(state, local.turnId, reason)
      setHint(reason, 'warn')
    }
    stamp([turn], now)
    lastSignature = null
    renderLog(now, true)
    options.onChanged?.()
    return turn ?? null
  }

  /** 收事件流推来的对话事件（上层已经用 `dialogueEventsFromFrame` 取出来了）。 */
  function ingest(events, nowMs = 0) {
    const affected = applyDialogueEvents(state, events)
    if (affected.length > 0) {
      stamp(affected, nowMs)
      lastSignature = null
      renderLog(nowMs, true)
      options.onChanged?.()
    }
    return affected
  }

  /**
   * 同步心跳时查一遍"有没有等太久的轮"。
   *
   * 契约说宿主超时会发 `failed`，但**宿主自己挂了**那条就永远不来——
   * 面板会一直显示"他在想…"，那是在装作没事。所以这里也有一条兜底（红线 6）。
   */
  function expire(nowTick, nowMs = 0) {
    const expired = expireThinking(state, { nowTick, maxAgeTicks: options.maxAgeTicks ?? 300 })
    if (expired.length > 0) {
      stamp(expired, nowMs)
      lastSignature = null
      renderLog(nowMs, true)
      options.onChanged?.()
    }
    return expired
  }

  /**
   * 头顶气泡要显示什么（**位置由上层算**：3D 要投影、2D 要按俯视的比例换算）。
   *
   * @returns {ReadonlyArray<{agentId: string, phase: string, text: string, atMs: number}>}
   */
  function bubblesFor(nowMs, { withinMs = BUBBLE_TTL_MS, maxText = 90 } = {}) {
    const out = []
    for (const [agentId, turns] of state.byAgent.entries()) {
      const turn = turns[turns.length - 1]
      if (turn === undefined) continue
      const atMs = turn.uiChangedAt ?? 0
      // `thinking` 的轮无限期挂着：它就是"他还在想"的证据，淡出会让人以为没发出去。
      if (turn.phase !== 'thinking' && nowMs - atMs > withinMs) continue
      const raw =
        turn.phase === 'thinking'
          ? '他在想…'
          : turn.phase === 'failed'
            ? `他说不出话：${turn.reason ?? ''}`
            : turn.text
      const text = raw.length > maxText ? `${raw.slice(0, maxText)}…` : raw
      out.push({ agentId, phase: turn.phase, text, atMs })
    }
    return out
  }

  if (ready) {
    $form.addEventListener('submit', (event) => {
      event.preventDefault()
      void submit()
    })
    $input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        close()
        return
      }
      if (event.key !== 'Enter' || event.shiftKey) return
      // **输入法里回车是"确认候选词"**：不看 isComposing 的话，每句中文都会在半途发出去。
      if (event.isComposing === true || event.keyCode === 229) return
      event.preventDefault()
      void submit()
    })
    $close?.addEventListener('click', () => close())
  }

  return {
    state,
    ready,
    /** 世界数据里的角色（名字/职业只从这里来，代码里没有一个角色名——D37）。 */
    setAgents(agents) {
      names.clear()
      for (const a of agents ?? []) if (a?.id !== undefined) names.set(a.id, { name: a.name ?? a.id, role: a.role ?? null })
      if (currentAgentId !== null && !names.has(currentAgentId)) {
        close()
      } else {
        // 只是换了个名字/职业：刷新标题，**不清提示**（提示可能正说着一条错误原因）。
        refreshWho()
      }
    },
    /** 面板取当前 tick 的方式（由 app.js 注入，面板自己不碰时钟）。 */
    setTickSource(fn) {
      tickOf = typeof fn === 'function' ? fn : () => 0
    },
    open,
    close,
    toggle,
    submit,
    ingest,
    expire,
    render,
    bubblesFor,
    isOpen: () => currentAgentId !== null,
    agentId: () => currentAgentId,
    turnsFor: (agentId) => turnsFor(state, agentId),
    latestTurn: (agentId) => latestTurn(state, agentId),
    thinkingTurns: () => thinkingTurns(state),
  }
}
