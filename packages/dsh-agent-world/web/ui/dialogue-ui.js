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
 * R76：面板从右侧抽屉移到**舞台底部中间**（DOM 浮层），仍与渲染器解耦——逻辑不变，
 * 只换了容器位置。这也是"对话不该被渲染器绑住"的直接体现。
 */

import { actionCountText, actionIcon, actionText, actingText } from './labels.js'
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
} from '../core/dialogue-state.js'

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
 *   发话。**由调用方（`main.js`）拥有端点**，这里只管 UI 与状态。
 * @param {() => void} [options.onChanged] - 面板状态变了（花名册上的"…"要跟着变）。
 * @param {() => void} [options.onUnlock] - 点「取消锁定」时回调（P2：解锁镜头，由 main.js 接到 `scene2d.clearSelection`）。
 * @param {(mode: 'chat'|'move') => void} [options.onModeChange] - 超控模式切了（main.js 拿它开关引擎键盘移动）。
 * @param {object} [options.state] - 状态机选项（`createDialogueState`）。
 */
export function createDialogueUi(options = {}) {
  const doc = options.document ?? globalThis.document
  const state = createDialogueState(options.state)

  const byId = (id) => doc.getElementById(id)
  const $panel = byId('dialogue')
  const $who = byId('dialogue-who')
  const $log = byId('dialogue-log')
  const $history = byId('dialogue-history')
  const $expand = byId('dialogue-expand')
  const $bottom = byId('dialogue-bottom')
  const $form = byId('dialogue-form')
  const $input = byId('dialogue-input')
  const $send = byId('dialogue-send')
  const $hint = byId('dialogue-hint')
  const $close = byId('dialogue-close')
  /** P2：取消锁定按钮（点它解锁镜头，不关对话）。 */
  const $unlock = byId('dialogue-unlock')
  /** 对话记录的展开/收起按钮（记录默认收起，因为回复气泡已经实时展示了）。 */
  /** 超控双模式：两片 tab + 两个面板（同时只亮一个）。 */
  const $modeChat = byId('dialogue-mode-chat')
  const $modeMove = byId('dialogue-mode-move')
  const $chatPanel = byId('dialogue-mode-chat-panel')
  const $movePanel = byId('dialogue-mode-move-panel')
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
        // 占位阶段（在想 / 在干活）才显示秒数；`acting` 也一样要跳秒。
        const waiting = t.phase === 'thinking' || t.phase === 'acting'
        const secs = waiting ? Math.floor((nowMs - (t.uiChangedAt ?? nowMs)) / 1000) : -1
        // 动作进了签名：**新动作到达必须重画**，否则"正在派单…"这种实时感就是假的。
        const actions = (t.actions ?? []).map((a) => `${a.name}:${a.detail ?? ''}:${a.ok ? 1 : 0}`).join(',')
        return `${t.turnId}\u0001${t.phase}\u0001${t.said}\u0001${t.text}\u0001${t.reason ?? ''}\u0001${secs}\u0001${actions}`
      })
      .join('\u0002')
  }

  /**
   * 动作列表：回复正文**下面**的小字行（每条一行，如"🔧 派单 task.quick-fix"）。
   *
   * 视觉权重刻意低（`--fg-1`/`--fg-2` + 更小字号）：正文才是结论，
   * 动作是"我怎么走到这个结论的"——它必须**看得见**，但不能和正文抢。
   */
  function renderActions(turn) {
    const actions = Array.isArray(turn.actions) ? turn.actions : []
    if (actions.length === 0) return null
    const box = el(doc, 'div', 'd-actions')
    if (actions.length > 1) {
      // "调了几次"要一眼看得出（R34 真机是 3 次：status、content ×2、dispatch）。
      box.append(el(doc, 'span', 'd-actions-count', actionCountText(actions.length)))
    }
    for (const action of actions) {
      const row = el(doc, 'div', action.ok === false ? 'd-action is-failed' : 'd-action')
      row.append(el(doc, 'i', 'd-action-icon', actionIcon(action)), el(doc, 'span', undefined, actionText(action)))
      box.append(row)
    }
    return box
  }

  function renderLog(nowMs, force = false) {
    if (!ready) return
    const turns = turnsFor(state, currentAgentId)
    const external = externalHistory.get(currentAgentId) ?? []
    const externalUser = new Set(external.filter((message) => message.role === 'user').map((message) => message.text))
    const externalAssistant = new Set(external.filter((message) => message.role === 'assistant').map((message) => message.text))
    const sig = `${signature(turns, nowMs)}|ext:${external.map((m) => `${m.role}:${m.text}`).join('\u0001')}`
    if (!force && sig === lastSignature) return
    lastSignature = sig

    $log.textContent = ''
    if (turns.length === 0 && external.length === 0) {
      $log.append(
        el(
          doc,
          'li',
          'd-empty',
          '还没有对话。在下面输入开始——回复会经事件流推回来，不会卡在这个页面上等。',
        ),
      )
      return
    }

    /**
     * 一条消息 = **气泡 + 元信息（发送者 · 时间）**（R116）。
     *
     * 自己的话靠右、对方的回复靠左：这是"对话"最省认知成本的排法——
     * 不用读名字就知道哪句是谁说的（名字仍然给出来，供读屏与回看）。
     *
     * 时间用 **tick**（世界时钟）而不是墙钟：这个界面里所有时间读数都是 tick
     * （页脚、任务、纸条），混用两套时间会让"这条是什么时候的"没法互相比较。
     */
    const pushBubble = (side, who, tick, body) => {
      const item = el(doc, 'li', `d-msg d-msg-${side}`)
      const meta = el(doc, 'div', 'd-meta')
      meta.append(el(doc, 'b', 'd-who', who))
      if (Number.isFinite(tick)) meta.append(el(doc, 'i', 'd-tick', `tick ${tick}`))
      const bubble = el(doc, 'div', 'd-bubble')
      if (typeof body === 'string') bubble.textContent = body
      else bubble.append(body)
      item.append(meta, bubble)
      $log.append(item)
      return item
    }

    for (const message of external) {
      pushBubble(message.role === 'user' ? 'me' : 'them', message.role === 'user' ? '我' : nameOf(currentAgentId), undefined, message.text)
    }
    for (const turn of turns) {
      if (turn.said !== '' && !externalUser.has(turn.said)) pushBubble('me', '我', turn.atTick, turn.said)

      // 回复气泡的内容随阶段变：想/干活是**占位**，回复是正文，失败是原因。
      const body = el(doc, 'span')
      if (turn.phase === 'thinking' || turn.phase === 'acting') {
        const secs = Math.max(0, Math.floor((nowMs - (turn.uiChangedAt ?? nowMs)) / 1000))
        // `acting` = "他在干活"（工具在跑）；`thinking` = "他在想"。
        // 两者都是**占位**，所以都带秒数——用户要能看出"这件事还在动"。
        const text = turn.phase === 'acting' ? `${actionIcon(null)} ${actingText(turn.actions)}` : '他正在想…'
        body.className = turn.phase === 'acting' ? 'd-acting' : 'd-thinking'
        body.textContent = `${text}（${secs}s）`
      } else if (turn.phase === 'replied') {
        body.textContent = turn.text
      } else {
        // 失败**必须带原因**：状态机保证了 `reason` 永远是一句能下手的话。
        body.className = 'd-reason'
        body.textContent = `他说不出话：${turn.reason}`
      }

      if (turn.phase === 'replied' && externalAssistant.has(turn.text)) continue
      const item = pushBubble('them', nameOf(turn.agentId), turn.atTick, body)
      item.classList.add(`d-${turn.phase}`)
      // 动作挂在**这条**回复下面：干过的事是这条回复的一部分，分开看就都不完整。
      const actionBox = renderActions(turn)
      if (actionBox !== null) item.append(actionBox)
    }

    // 滚到最新一条：对话是"越新越重要"的东西，不用手动滑。
    $log.scrollTop = $log.scrollHeight
    syncBottomButton()
  }

  /** 重画（上层每 250ms 调一次；签名没变时几乎不做事）。 */
  function render(nowMs = 0) {
    renderLog(nowMs)
    renderHistory()
  }

  /**
   * R211：全部 agent 的聊天记录，默认折叠。
   * 数据来自状态机的 byAgent（每个 agent 最多保留 DEFAULT_MAX_TURNS_PER_AGENT 轮），
   * 不另建 store；`<details>` 默认 closed。
   */
  let lastHistorySig = null
  let historyOpen = false
  let expanded = false
  const externalHistory = new Map()

  function syncBottomButton() {
    if ($bottom === null || $bottom === undefined) return
    const atBottom = $log.scrollTop + $log.clientHeight >= $log.scrollHeight - 8
    $bottom.hidden = false
    $bottom.classList.toggle('is-at-bottom', atBottom)
  }

  function setExpanded(next) {
    expanded = next === true
    historyOpen = expanded
    $panel?.classList.toggle('is-expanded', expanded)
    if ($expand !== null && $expand !== undefined) {
      $expand.textContent = expanded ? '收起' : '展开'
      $expand.setAttribute('aria-expanded', String(expanded))
      $expand.title = expanded ? '收起对话记录' : '展开对话记录'
    }
    lastHistorySig = null
    renderHistory()
    if (expanded) globalThis.setTimeout(() => { $log.scrollTop = $log.scrollHeight; syncBottomButton() }, 0)
  }

  /** 从 DSH 会话读到的历史（lead 的主对话/成员的会话）。 */
  function setHistory(agentId, messages) {
    if (typeof agentId !== 'string' || agentId === '') return
    externalHistory.set(agentId, Array.isArray(messages) ? messages : [])
    lastHistorySig = null
    renderHistory()
  }

  /**
   * 全部 agent 的聊天记录，默认折叠。
   * 优先用 DSH 会话历史（lead 的主对话只存在于这里）；world 侧对话作为兜底。
   */
  function renderHistory() {
    if ($history === null || $history === undefined) return
    const groups = []
    for (const [agentId, messages] of externalHistory) {
      const lines = messages
        .map((message) => `${message.role === 'user' ? '我' : nameOf(agentId)}：${message.text}`)
        .filter((line) => line.trim() !== '')
      if (lines.length > 0) groups.push({ agentId, name: nameOf(agentId), lines })
    }
    for (const [agentId, turns] of state.byAgent) {
      if (externalHistory.has(agentId)) continue
      const lines = []
      for (const turn of turns) {
        if (typeof turn.said === 'string' && turn.said !== '') lines.push(`我：${turn.said}`)
        if (turn.phase === 'replied' && typeof turn.text === 'string') lines.push(`${nameOf(agentId)}：${turn.text}`)
        else if (turn.phase === 'failed') lines.push(`${nameOf(agentId)}：说不出话（${turn.reason ?? '未知原因'}）`)
      }
      if (lines.length > 0) groups.push({ agentId, name: nameOf(agentId), lines })
    }
    const sig = groups.map((g) => `${g.agentId}:${g.lines.length}:${g.lines.join('\u0001')}`).join('||')
    if (sig === lastHistorySig) {
      $history.hidden = !historyOpen
      return
    }
    lastHistorySig = sig
    $history.hidden = !historyOpen
    $history.textContent = ''
    if (groups.length === 0) {
      if (historyOpen) $history.append(el(doc, 'div', 'dialogue-history-line dim', '还没有对话记录。'))
      return
    }
    const all = el(doc, 'details', 'dialogue-history-all')
    all.open = true
    all.append(el(doc, 'summary', 'dialogue-history-summary', `全部对话记录 · ${groups.length} 人`))
    for (const group of groups) {
      const detail = el(doc, 'details', 'dialogue-history-agent')
      detail.append(el(doc, 'summary', 'dialogue-history-name', `${group.name} · ${group.lines.length}`))
      for (const line of group.lines) detail.append(el(doc, 'div', 'dialogue-history-line', line))
      all.append(detail)
    }
    $history.append(all)
  }

  function refreshWho() {
    if ($who === null || currentAgentId === null) return
    const info = names.get(currentAgentId)
    $who.textContent =
      info === undefined ? `${UNKNOWN_NAME}（${currentAgentId}）` : `${info.name} · ${info.role ?? ''}`
  }

  /**
   * 打开超控面板。
   *
   * `mode` 默认 `'move'`：**选中一个人，第一件事是能操控他走**，不是让他说话
   * （想说话再点「对话」或按回车）。只有显式传 `'chat'`（回车快捷键）才从对话起步。
   */
  function open(agentId, mode = 'move') {
    if (!ready || agentId === null || agentId === undefined) return false
    currentAgentId = agentId
    $panel.hidden = false
    setHint('')
    lastSignature = null
    // R116：记录**不再有"收起"这回事**——它是面板的主体，永远可见。
    const nextMode = mode === 'chat' ? 'chat' : 'move'
    setMode(nextMode)
    refreshWho()
    renderLog(performance.now(), true)
    // 移动档**不能抢焦点**：焦点一旦落在 textarea 上，WASD/方向键就被输入框吞掉，
    // 表现是"选中了却走不动"。只有对话档才把焦点给输入框。
    if (nextMode === 'chat') $input?.focus()
    options.onChanged?.()
    return true
  }

  function close() {
    if (!ready) return
    currentAgentId = null
    $panel.hidden = true
    // 面板藏了，焦点不能留在隐藏的输入框上（否则引擎以为用户在打字、键盘一直不归它）。
    $input?.blur()
    setHint('')
    options.onChanged?.()
  }

  // ── 超控双模式（对话 / 移动）─────────────────────────────────────────────────
  //
  // 两者**互斥**，根因在"键盘焦点归谁"：
  //   · 对话模式：焦点在 textarea 上，键盘是**文字**；
  //   · 移动模式：焦点必须离开 textarea（否则 WASD/方向键被输入框吞掉），键盘才是**动作**。
  // 所以切换模式不是"换个面板"那么简单，**搬焦点**才是这条互斥的关键。

  /** @type {'chat'|'move'} */
  let currentMode = 'chat'

  /**
   * 切换模式。`chat` → 输入框亮相并聚焦、引擎移动关；`move` → 输入框藏起来并失焦、引擎移动开。
   */
  function setMode(mode) {
    const next = mode === 'move' ? 'move' : 'chat'
    currentMode = next
    const isChat = next === 'chat'
    $modeChat?.classList.toggle('is-active', isChat)
    $modeMove?.classList.toggle('is-active', !isChat)
    $modeChat?.setAttribute('aria-selected', String(isChat))
    $modeMove?.setAttribute('aria-selected', String(!isChat))
    if ($chatPanel !== null && $chatPanel !== undefined) $chatPanel.hidden = !isChat
    if ($movePanel !== null && $movePanel !== undefined) $movePanel.hidden = isChat
    if (isChat === true) {
      // 回对话：焦点给输入框（下一句直接能打字）。
      $input?.focus()
    } else if (doc.activeElement === $input) {
      // 去移动：焦点必须离开输入框，否则 WASD/方向键全被 textarea 吞掉。
      $input.blur()
    }
    options.onModeChange?.(next)
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
      // `thinking` / `acting` 的轮无限期挂着：它们就是"他还在想 / 他还在干活"的证据，
      // 淡出会让人以为没发出去。有结果的那两种才按时淡出。
      const waiting = turn.phase === 'thinking' || turn.phase === 'acting'
      if (!waiting && nowMs - atMs > withinMs) continue
      const raw = waiting
        ? turn.phase === 'acting'
          ? `${actionIcon(null)} ${actingText(turn.actions)}`
          : '他在想…'
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
        // Esc = 退出锁定：关面板 + 解锁镜头（与 main.js 的全局 Esc 同一个语义）。
        close()
        options.onUnlock?.()
        return
      }
      if (event.key !== 'Enter' || event.shiftKey) return
      // **输入法里回车是"确认候选词"**：不看 isComposing 的话，每句中文都会在半途发出去。
      if (event.isComposing === true || event.keyCode === 229) return
      event.preventDefault()
      void submit()
    })
    $close?.addEventListener('click', () => close())
    $expand?.addEventListener('click', () => setExpanded(!expanded))
    $bottom?.addEventListener('click', () => { $log.scrollTop = $log.scrollHeight; syncBottomButton() })
    $log.addEventListener('scroll', syncBottomButton)
    $unlock?.addEventListener('click', () => options.onUnlock?.())
    $modeChat?.addEventListener('click', () => setMode('chat'))
    $modeMove?.addEventListener('click', () => setMode('move'))
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
    /** 面板取当前 tick 的方式（由 main.js 注入，面板自己不碰时钟）。 */
    setTickSource(fn) {
      tickOf = typeof fn === 'function' ? fn : () => 0
    },
    open,
    close,
    submit,
    ingest,
    expire,
    render,
    bubblesFor,
    isOpen: () => currentAgentId !== null,
    agentId: () => currentAgentId,
    /** 超控模式：`'chat'`（打字）| `'move'`（键盘操控）。 */
    mode: () => currentMode,
    setHistory,
    setMode,
    turnsFor: (agentId) => turnsFor(state, agentId),
    latestTurn: (agentId) => latestTurn(state, agentId),
    thinkingTurns: () => thinkingTurns(state),
  }
}
