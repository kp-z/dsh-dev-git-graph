/*
 * 对话面板的状态机（M6-5）—— **纯函数，不碰 DOM**。
 *
 * ── 为什么单独一个纯模块 ──────────────────────────────────────────────────────
 *
 * 与 `world-update.js` 同一个理由。对话面板要显示的东西只有三种：
 * 「我说了什么」「他还在想」「他说不出话，因为 X」。如果这层逻辑和 DOM 混在一起，
 * 就只能靠肉眼验，而它恰恰是**看起来对、却少一条或多一条**最难发现的那种东西：
 * 一次搭话在线上是**两条事件**（`thinking` → `replied`），归组错了的表现是
 * 「同一次对话出现两条记录」——肉眼只会觉得"他怎么回了两次"，不会想到是归组问题。
 *
 * 所以这里只做四件事，全部可以被 `node --test` 直接打：
 *   1. 把 `DialogueEvent` 折叠成面板要显示的形状（按 `turnId` 归组、每角色有上限）；
 *   2. 认得出宿主用哪种 SSE 帧形状推来的事件（`dialogueEventsFromFrame`）：
 *      **对形状宽容、对语义严格**——多一个不认识的形状不能把面板带崩；
 *   3. 把本地乐观占位的「他在想…」在收到 `replied`/`failed` 后**换掉而不是并存**；
 *   4. 把「发话失败」翻译成**能直接下手**的中文提示（`explainSayFailure`）。
 *      它单独一个纯函数就是为了能被测：本轮唯一能端到端验到的真链路就是这条提示，
 *      而"失败"两个字式的报错是契约里明确禁止的（`src/protocol/dialogue.ts` 写了理由）。
 *
 * ── 契约 ────────────────────────────────────────────────────────────────────
 *
 * 传输形状冻结在 `src/protocol/dialogue.ts`（R22）。本文件**不改契约**，
 * 只是在契约之上加两个面板侧算出来的字段（`agentId` / `said`）：
 * 契约里 `DialogueEvent` 只说"谁对谁说"，而面板是**按角色分栏**的，
 * 所以"这一轮属于哪个角色"要算一次（见 `speakerAgentId`）。
 *
 * ── 时间 ────────────────────────────────────────────────────────────────────
 *
 * 这里**不吃时钟**：所有函数只吃参数。D35 的确定性约束只约束 `src/sim/`，
 * 面板侧用不用 `Date.now()` 都无所谓——但不吃时钟的纯函数在测试里不用造假时间，
 * 于是这些测试才写得出来。
 */

/** 契约里的三个阶段（`DialoguePhase`），按顺序列出来当白名单用。 */
export const PHASES = ['thinking', 'replied', 'failed']

/** 每个角色最多留几轮。**内存不能无限涨**：一场长局能聊几百轮。 */
export const DEFAULT_MAX_TURNS_PER_AGENT = 30

/** 最多为几个角色保留历史（8 个角色的世界够用；有上限是为了内容换了也不炸）。 */
export const DEFAULT_MAX_AGENTS = 64

/**
 * 宿主报了 `failed` 却没给 `reason` 时的兜底文案。
 *
 * **绝不显示光秃秃的"失败"**：那种报错帮不了任何人（契约里 `reason` 的注释写明了）。
 * 兜底文案指向"这是协议缺陷"，因为那确实是——面板能做的只有把它说出来。
 */
export const MISSING_REASON =
  '宿主报告了 failed，但没有给 reason（DialogueEvent.reason 缺失）——这是协议缺陷，请让宿主带上原因'

/** 宿主没在预期时间内回话时的说明（`expireThinking` 用）。 */
export const SILENT_REASON_HINT = '检查宿主进程与 ./api/events 事件流是否还活着'

const EMPTY = Object.freeze([])

/**
 * 递归扫帧时**不往下钻**的键：它们指向整份世界/场景。
 *
 * 这个表是模块级常量而不是每次调用新建的 `Set`——`dialogueEventsFromFrame`
 * 每秒被调十几次（每条 SSE 帧一次），"顺手 new 一个小对象"乘以这个频率就是纯垃圾。
 */
const DIALOGUE_SCAN_SKIP = new Set(['scene', 'world', 'agents', 'tasks', 'messages', 'stations'])

function positiveInt(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 从一个界说者里取出角色 id（`{kind:'agent', id}`），不是角色时返回 null。 */
function agentIdOfSpeaker(speaker) {
  if (speaker === null || typeof speaker !== 'object') return null
  return speaker.kind === 'agent' ? nonEmptyString(speaker.id) : null
}

/**
 * 这一轮对话属于哪个角色。
 *
 * 契约里**没有这个字段**（它只有 `from` / `to`），所以面板要自己算：
 * · 玩家搭话：`from={kind:'god'}`、`to={kind:'agent'}` → 角色在 `to` 里；
 * · 角色回话：`from={kind:'agent'}` → 角色在 `from` 里；
 * · `system` 发言（D38 里"世界本身说的话"）也归到它面对的那个角色身上。
 *
 * 两边都不是角色（纯 system 事件）时返回 null——见 `applyDialogueEvent` 的处理。
 */
export function speakerAgentId(event) {
  return agentIdOfSpeaker(event?.from) ?? agentIdOfSpeaker(event?.to)
}

/**
 * 事件里"玩家说的那句话"。
 *
 * 契约写的是「`thinking` 时 `text` 为空串、`replied` 时是回复正文」，所以正常情况
 * 玩家原话只在面板本地（谁发的谁记得）。但**多开一个面板**（D38 要的效果）时，
 * 那边只看得见事件——如果宿主愿意在 `thinking` 里带上原话，这里就认它，
 * 这样第二个面板也能显示"我先说了什么"。**宽容但不猜**：`from` 不是 god 就不算。
 */
function godTextOf(event) {
  if (event?.from?.kind !== 'god') return null
  return nonEmptyString(event.text)
}

/** 这个对象长得像不像一条 `DialogueEvent`（形状门槛，语义在后面才判）。 */
function looksLikeDialogueEvent(raw) {
  if (raw === null || typeof raw !== 'object') return false
  if (nonEmptyString(raw.turnId) === null) return false
  return PHASES.includes(raw.phase)
}

/**
 * 把线上来的东西**归一成**面板能用的对话事件（认不出就 null）。
 *
 * 允许两种包装，因为两种都很可能出现：
 * · `{ type:'dialogue', payload:{…} }` —— 世界事件流就是这么包的（D38：对话是世界里的事件）；
 * · 事件本体。
 *
 * 返回的对象比契约多两个字段：`agentId`（这一轮属于谁，`speakerAgentId` 算的）与
 * `said`（玩家原话，可能为 null）。其余字段保持契约里的名字。
 */
export function normalizeDialogueEvent(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const candidate =
    raw.type === 'dialogue' && raw.payload !== null && typeof raw.payload === 'object' ? raw.payload : raw
  if (!looksLikeDialogueEvent(candidate)) return null
  return {
    turnId: candidate.turnId,
    tick: Number.isFinite(candidate.tick) ? candidate.tick : 0,
    phase: candidate.phase,
    from: candidate.from,
    to: candidate.to,
    text: typeof candidate.text === 'string' ? candidate.text : '',
    reason: nonEmptyString(candidate.reason) ?? undefined,
    agentId: speakerAgentId(candidate),
    said: godTextOf(candidate),
  }
}

/**
 * 从一个 SSE 帧里取出所有对话事件。
 *
 * 帧的确切形状**不在冻结的契约里**——契约冻结的是"过什么"，不是"怎么包"
 * （`test/acceptance-m6.test.js` 因此也是**递归找**长得像 `DialogueEvent` 的对象，
 * 而不是断言某种信封）。同一件事在面板侧就是这里：**递归扫描 + 形状判定**，
 * 于是宿主把对话放在 `{type:'dialogue', events:[…]}`、`{type:'dialogue', event:{…}}`、
 * 世界事件批 `{type:'events', events:[{type:'dialogue', payload}]}`、
 * 还是干脆塞在某个自定义信封的第 N 层，面板都认。
 *
 * 三条自我约束：
 * · **深度上限 4**、跳过 `scene`/`world` 这类大对象键——递归不能变成遍历一整份快照；
 * · 认不出的形状返回空数组，**一条未知的帧不能让整条事件流停止工作**；
 * · 命中即不再往下钻（一条事件只交出去一次）。
 *
 * @param {object} frame - `EventSource` 上收到、已 `JSON.parse` 的消息。
 * @returns {ReadonlyArray<object>} 候选事件（还没归一，交给 `applyDialogueEvents`）。
 */
export function dialogueEventsFromFrame(frame) {
  const out = []
  const walk = (node, depth) => {
    if (node === null || node === undefined || depth > 4 || out.length > 500) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    if (looksLikeDialogueEvent(node)) {
      out.push(node)
      return
    }
    for (const [key, value] of Object.entries(node)) {
      if (DIALOGUE_SCAN_SKIP.has(key)) continue
      if (value !== null && typeof value === 'object') walk(value, depth + 1)
    }
  }
  walk(frame, 0)
  return out
}

/** 建一份对话面板状态。 */
export function createDialogueState(options = {}) {
  return {
    maxTurnsPerAgent: positiveInt(options.maxTurnsPerAgent, DEFAULT_MAX_TURNS_PER_AGENT),
    maxAgents: positiveInt(options.maxAgents, DEFAULT_MAX_AGENTS),
    /** agentId → 轮数组（旧 → 新）。Map 的插入顺序当 LRU 用（见 `ensureBucket`）。 */
    byAgent: new Map(),
    /** turnId → 轮。**含还没拿到宿主 turnId 的本地占位轮**。 */
    byTurn: new Map(),
    /** 本地占位轮的编号。本地 id 形如 `local:1`，与宿主的 id 不会撞。 */
    localSeq: 0,
    /** 台账序号：给"同一 tick 的条目"一个稳定顺序，显示不依赖 Map 的遍历顺序。 */
    seq: 0,
    /** 被上限挤掉的轮数（诊断用：涨得快说明上限太小）。 */
    dropped: 0,
    /** 认不出/归不到角色的帧数（**要能看见**，否则"对话怎么没出现"无从查起）。 */
    ignored: 0,
  }
}

/** 把一个角色桶挪到 Map 末尾（最新活跃），这样第一个 key 永远是"最久没动"。 */
function touchAgent(state, agentId) {
  const bucket = state.byAgent.get(agentId)
  if (bucket === undefined) return null
  state.byAgent.delete(agentId)
  state.byAgent.set(agentId, bucket)
  return bucket
}

/** 丢掉一个角色的全部历史（连同 `byTurn` 里的引用，否则 turnId → 轮 会泄漏）。 */
function dropBucket(state, agentId) {
  const bucket = state.byAgent.get(agentId)
  if (bucket === undefined) return
  for (const turn of bucket) state.byTurn.delete(turn.turnId)
  state.byAgent.delete(agentId)
}

/** 拿这个角色的桶（没有就建），顺带维护"最多几个角色"的上限。 */
function ensureBucket(state, agentId) {
  let bucket = state.byAgent.get(agentId)
  if (bucket === undefined) {
    bucket = []
    state.byAgent.set(agentId, bucket)
  } else {
    touchAgent(state, agentId)
  }
  // 角色数上限：挤掉**最久没动**的那个（连同它的轮，避免 byTurn 泄漏）。
  while (state.byAgent.size > state.maxAgents) {
    const oldest = state.byAgent.keys().next().value
    if (oldest === undefined || oldest === agentId) break
    state.dropped += state.byAgent.get(oldest)?.length ?? 0
    dropBucket(state, oldest)
  }
  return bucket
}

/** 丢掉一个轮（从桶与索引两处都摘掉）。 */
function detachTurn(state, turn) {
  const bucket = state.byAgent.get(turn.agentId)
  if (bucket !== undefined) {
    const at = bucket.indexOf(turn)
    if (at >= 0) bucket.splice(at, 1)
    if (bucket.length === 0) state.byAgent.delete(turn.agentId)
  }
  if (state.byTurn.get(turn.turnId) === turn) state.byTurn.delete(turn.turnId)
}

/** 每角色条数上限：超了就丢最旧的（**丢的是最早那几轮**，不是最新的）。 */
function trimBucket(state, agentId) {
  const bucket = state.byAgent.get(agentId)
  if (bucket === undefined) return
  while (bucket.length > state.maxTurnsPerAgent) {
    const oldest = bucket.shift()
    if (state.byTurn.get(oldest.turnId) === oldest) state.byTurn.delete(oldest.turnId)
    state.dropped += 1
  }
  if (bucket.length === 0) state.byAgent.delete(agentId)
}

/**
 * 把一条事件并入它那一轮（**同 `turnId` 只留一条记录**，这是本文件存在的理由）。
 *
 * 归并规则（都是"乱序到达也不出错"的意思）：
 * · `thinking` **不降级**：已经 `replied`/`failed` 的轮不会被后来的 thinking 打回"在想"；
 * · `replied` 覆盖 thinking，并采用它带的正文（宿主可能补一条最终文本）；
 * · `failed` 覆盖 thinking 的占位并**必须带原因**（缺了就用 `MISSING_REASON`）；
 *   但如果这一轮已经有回复，就不把回复抹掉——晚到的 failed 不该毁掉一句真回复；
 * · 重复的同一条事件是完全幂等的（同 `turnId` 已经在表里，只是重写一遍同样的值）。
 */
function mergeInto(turn, event) {
  turn.atTick = Math.max(turn.atTick ?? 0, event.tick)
  turn.updatedTick = event.tick
  if (event.said !== null) turn.said = event.said

  if (event.phase === 'thinking') return // 占位阶段：什么都不改（不降级）

  if (event.phase === 'replied') {
    turn.phase = 'replied'
    turn.text = event.text
    turn.reason = null
    return
  }

  // failed
  turn.reason = event.reason ?? MISSING_REASON
  if (turn.phase !== 'replied') turn.phase = 'failed'
}

/**
 * 收到一条事件。认不出来的返回 null（并计数），认出来的返回**它并入的那一轮**。
 *
 * 归不到角色的（`from`/`to` 都不是角色）也算认不出：面板是"跟谁说话"的面板，
 * 没有角色的轮没有地方显示，而**装进一个假角色里比丢掉更糟**。
 *
 * @returns {object|null} 受影响的那一轮（同一个 `turnId` 永远只有这一个对象）。
 */
export function applyDialogueEvent(state, raw) {
  const event = normalizeDialogueEvent(raw)
  if (event === null || event.agentId === null) {
    state.ignored += 1
    return null
  }

  let turn = state.byTurn.get(event.turnId)
  if (turn === undefined) {
    turn = {
      turnId: event.turnId,
      agentId: event.agentId,
      phase: 'thinking',
      /** 玩家说的话（本地发的自己知道；宿主带上来的从事件里认）。 */
      said: event.said ?? '',
      /** 角色的回复正文（`thinking` 时为空串）。 */
      text: '',
      /** `failed` 时的原因（永远是一句能下手的话，见 `MISSING_REASON`）。 */
      reason: null,
      atTick: event.tick,
      updatedTick: event.tick,
      /** 本地乐观占位轮（还没拿到宿主的 turnId）。 */
      local: false,
      order: state.seq++,
    }
    state.byTurn.set(turn.turnId, turn)
    ensureBucket(state, turn.agentId).push(turn)
  } else {
    ensureBucket(state, turn.agentId)
  }

  mergeInto(turn, event)
  trimBucket(state, turn.agentId)
  return turn
}

/** 批量应用（一条认不出不影响后面的）。返回**真正并入了的**轮。 */
export function applyDialogueEvents(state, rawEvents) {
  const out = []
  if (!Array.isArray(rawEvents)) return out
  for (const raw of rawEvents) {
    const turn = applyDialogueEvent(state, raw)
    if (turn !== null) out.push(turn)
  }
  return out
}

/**
 * 本地乐观建一轮：「我说的这句话 + 他还在想」。
 *
 * 为什么要本地先建：`POST /api/say` 返回的是**收到了没有**（契约里的时序约定），
 * 回复要等 SSE。等 POST 回来再显示用户自己那句话，会有一瞬间的"我按了回车但什么都没发生"——
 * 而用户会因此再按一次（契约的注释里点名了这个后果）。
 *
 * @returns {object} 新的一轮，`turnId` 形如 `local:3`。
 */
export function beginLocalTurn(state, { agentId, text, tick = 0 }) {
  const turnId = `local:${state.localSeq + 1}`
  state.localSeq += 1
  const turn = {
    turnId,
    agentId,
    phase: 'thinking',
    said: typeof text === 'string' ? text : '',
    text: '',
    reason: null,
    atTick: tick,
    updatedTick: tick,
    local: true,
    order: state.seq++,
  }
  state.byTurn.set(turnId, turn)
  ensureBucket(state, agentId).push(turn)
  trimBucket(state, agentId)
  return turn
}

/**
 * `POST /api/say` 回来了：把本地占位轮**改挂到宿主的 `turnId` 上**。
 *
 * 这是最容易出错的一步，因为有个真实的竞态：**SSE 的 `thinking` 可能比 POST 的响应先到**
 * （发送是同步的、回复是事件驱动的，但两条路是并行的）。如果那时直接"把本地轮另存一份"，
 * 同一句话就会在面板上出现两条。所以三种情况都要处理：
 * · 宿主那条还不存在 → 本地轮换个 id 顶上去（保序、保原话）；
 * · 宿主那条已经存在（竞态）→ **合并成一条**：原话补进去，阶段用更新过的那个，
 *   位置沿用本地的那次（用户看到的是自己刚发的那条，不该因为竞态就跳走）；
 * · 找不到本地轮（重复调用）→ 返回宿主那条，幂等。
 *
 * @returns {object|null} 合并后的那一轮。
 */
export function resolveLocalTurn(state, localTurnId, serverTurnId) {
  const local = state.byTurn.get(localTurnId)
  if (local === undefined) {
    return state.byTurn.get(serverTurnId) ?? null
  }
  if (serverTurnId === undefined || serverTurnId === null || serverTurnId === localTurnId) {
    local.local = false
    return local
  }

  detachTurn(state, local)

  const server = state.byTurn.get(serverTurnId)
  if (server === undefined) {
    local.turnId = serverTurnId
    local.local = false
    state.byTurn.set(serverTurnId, local)
    ensureBucket(state, local.agentId).push(local)
    trimBucket(state, local.agentId)
    return local
  }

  // 竞态：宿主的轮已经在表里了。合成一条，别丢用户的原话。
  if (local.said !== '' && server.said === '') server.said = local.said
  server.order = Math.min(server.order, local.order)
  server.local = false
  if (server.phase === 'thinking' && local.phase !== 'thinking') {
    server.phase = local.phase
    server.text = local.text
    server.reason = local.reason
  }
  return server
}

/**
 * 这一轮发不出去（POST 失败/被拒/没端点）：把占位轮就地改成 `failed`，**并带上原因**。
 *
 * 用户那句话（`said`）留着——"我说了什么"是事实，不该因为宿主没接住就消失。
 */
export function failLocalTurn(state, localTurnId, reason) {
  const turn = state.byTurn.get(localTurnId)
  if (turn === undefined) return null
  turn.phase = 'failed'
  turn.reason = nonEmptyString(reason) ?? MISSING_REASON
  return turn
}

/**
 * 等太久了：把还在"他在想…"的轮标成失败。
 *
 * 为什么需要它：契约说宿主会在超时时发 `failed`，但如果**宿主自己挂了**，
 * 那条事件永远不会来，面板就会一直显示"他在想…"——那就是在装作没事（红线 6）。
 * 所以面板自己也有一条兜底：同步心跳每来一次就调一次，超过 `maxAgeTicks` 步没动静就说话。
 *
 * @returns {ReadonlyArray<object>} 被标成失败的轮（调用方据此重绘）。
 */
export function expireThinking(state, { nowTick, maxAgeTicks = 300 } = {}) {
  const expired = []
  if (!Number.isFinite(nowTick)) return expired
  for (const turn of state.byTurn.values()) {
    if (turn.phase !== 'thinking') continue
    const age = nowTick - (turn.updatedTick ?? 0)
    if (age < maxAgeTicks) continue
    turn.phase = 'failed'
    turn.reason = `已经 ${age} 步没有收到任何对话事件（超过 ${maxAgeTicks} 步），这次回复不会来了。${SILENT_REASON_HINT}。`
    expired.push(turn)
  }
  return expired
}

/** 某个角色的历史（旧 → 新）。返回的是**内部数组**，调用方只读。 */
export function turnsFor(state, agentId) {
  return state.byAgent.get(agentId) ?? EMPTY
}

/** 某个角色最近一轮（没有就 null）。气泡与花名册上的"…"用它。 */
export function latestTurn(state, agentId) {
  const bucket = state.byAgent.get(agentId)
  return bucket === undefined || bucket.length === 0 ? null : bucket[bucket.length - 1]
}

/** 所有还在"在想"的轮（状态栏上显示"几个角色在思考"）。 */
export function thinkingTurns(state) {
  const out = []
  for (const turn of state.byTurn.values()) if (turn.phase === 'thinking') out.push(turn)
  return out
}

/** 有历史的角色 id，**最近活跃的在前**（缓存上限淘汰时就是这个顺序的反面）。 */
export function activeAgentIds(state) {
  return [...state.byAgent.keys()].reverse()
}

/** 清空全部对话（"重开一局"时显式调用；平时**不要**在重拉快照时调——会丢历史）。 */
export function clearDialogue(state) {
  state.byAgent.clear()
  state.byTurn.clear()
  state.localSeq = 0
  state.seq = 0
  state.dropped = 0
  state.ignored = 0
  return state
}

/** 把 `fetch` 那边的错误变成一句人话。 */
function describeError(error) {
  if (error === null || error === undefined) return '没有错误对象'
  if (typeof error === 'string') return error
  if (error instanceof Error) {
    // `TypeError: fetch failed` 是最常见的一种（宿主没起 / 端口不通），它自己带不上原因，
    // 所以把 cause 也带出来——否则用户只能看到一个光秃秃的 "fetch failed"。
    const cause = error.cause === undefined ? '' : `（${describeError(error.cause)}）`
    return `${error.message}${cause}`
  }
  return String(error)
}

/**
 * 把"发话失败"翻译成**能直接下手**的提示。
 *
 * 这是本轮唯一能端到端验到的真链路（M6-3 的端点还没上线），所以它值得是个纯函数、
 * 值得有测试：用户看到的每一个字都要能指向一个具体动作——去看宿主日志、去等端点、
 * 去调大会话上限、去说点东西再说。
 *
 * @param {{ status?: number, reason?: string, error?: unknown, text?: string }} failure
 *   `status` 为 0/缺省表示"请求根本没到宿主"（网络层）。
 * @returns {string} 一句中文提示（永远不为空，也永远不是"失败"两个字）。
 */
export function explainSayFailure(failure) {
  const f = failure ?? {}
  const status = Number.isFinite(f.status) ? f.status : 0
  const reason = nonEmptyString(f.reason)
  const body = nonEmptyString(f.text)
  const bodyTail = body === null ? '' : ` 响应体：${body.slice(0, 200)}`
  const reasonTail = reason === null ? '' : `（宿主说：${reason}）`

  if (status === 0) {
    // 被我们自己中止（10 秒超时）是**最有信息量的一种失败**：端点可能存在，
    // 但它在 HTTP 请求里等了模型——那正是契约里点名的错误做法。要单独说清楚。
    if (f.error?.name === 'AbortError') {
      return '宿主 10 秒没有应答这次发话（请求已中止）。按契约 POST ./api/say 应当立刻回 { accepted, turnId }——端点可能存在，但在等不该等的东西（比如在 HTTP 里等模型回话）。'
    }
    return `请求没能送到宿主（${describeError(f.error)}）。看宿主进程还在不在，以及页面是不是从 ./agent-world/ 打开的（POST ./api/say）。`
  }
  if (status === 404 || status === 405 || status === 501) {
    return `宿主还没有对话端点：POST ./api/say 返回 HTTP ${status}${reasonTail}。这是 M6-3 那一半——宿主侧要加 /api/say 路由与 SSE 的 dialogue 事件；面板这边请求已经发出去了，端点一上线就能用。`
  }
  if (status === 400 || status === 422) {
    return `宿主拒了这次发话（HTTP ${status}）${reasonTail || '，而且它没给 reason'}。多半是说空了、或说话的对象不存在。`
  }
  if (status === 409 || status === 429) {
    return `宿主暂时不收新对话（HTTP ${status}）${reasonTail}。通常是同时搭话的角色数到了上限（D36 的成本可见可控）——等某一轮结束，或调大配置里的会话上限。`
  }
  if (status >= 500) {
    return `宿主处理发话时自己出错了（HTTP ${status}）${reasonTail}。${bodyTail || '去看宿主日志里那几行 HTTP 错误。'}`
  }
  return `宿主回了 HTTP ${status}，但没有 accepted:true${reasonTail}。${bodyTail || '按契约 POST ./api/say 必须回 { accepted, turnId }。'}`
}
