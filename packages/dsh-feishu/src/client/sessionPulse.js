/**
 * 气泡上的「状态对话气泡」：纯逻辑 + 一条 SSE 订阅。
 *
 * 用户口径：
 *  - 只看**状态**，不显示计时；
 *  - 运行中与运行完都能显示；
 *  - 贴在泡沿外，用对话气泡样式；
 *  - **没有新消息就自动消失**（阻塞/挂起这类「要人看的」不消失）。
 *
 * 这一层只做三件事：把「快照 + 活动流」算成每个任务该显示什么、什么时候该淡出、以及订阅活动流。
 * 不碰 DOM、不碰 React —— 这样能离线单测（见 test/sessionPulse.mjs）。
 */

/** 自动消失的静默时长（毫秒）。有新事件就重置计时。 */
export const PULSE_TTL = 8000

/** 「要人看」的状态不自动消失：它们本来就该一直挂在那儿。 */
export const STICKY_TONES = new Set(['warn'])

/** 一轮结束时用来判断「新一轮」的阈值：轮次变大就算新消息。 */
function turnOf(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * 单条任务的状态词。
 * @param {object} task 快照里的任务行
 * @param {object} feed  活动流里该会话的最新一项 { alive, phase, turn }（可能没有）
 * @returns {{text:string, tone:string, sticky:boolean}|null} null = 不显示状态泡
 */
export function pulseForTask(task, feed) {
  const t = task && typeof task === 'object' ? task : {}
  const f = feed && typeof feed === 'object' ? feed : {}
  const phase = String(f.phase || '')
  const turn = turnOf(f.turn)

  /* 顺序即优先级：终态 > 要人看的 > 正在跑 > 等待 */
  if (t.done === true) return { text: '已完成', tone: 'ok', sticky: false }
  if (t.blocked === true) return { text: '被阻塞', tone: 'warn', sticky: true }
  if (t.suspended === true) return { text: '已挂起', tone: 'warn', sticky: true }
  if (phase === 'running' || t.running === true) {
    return { text: turn > 0 ? `运行中 · 第 ${turn} 轮` : '刚开工', tone: 'brand', sticky: false }
  }
  /* 「等待输出」故意**不显示**：等待中的任务本来就会一直停在那个状态，
     每个泡都挂一句会把气泡墙变成一句话列表（用户要的是状态提示，不是常驻标签）。 */
  return null
}

/**
 * 结算一轮：算出每个任务此刻该显示的状态泡。
 *
 * @param {Array} tasks 快照任务行（要有 id / done / blocked / suspended / running / started / sessionId）
 * @param {Array} sessions 活动流 sessions（{ id, alive, phase, turn }）
 * @param {Map} prev 上一轮的结果（taskId → entry），用来做「同一条状态不重置计时」
 * @param {number} now 当前时刻（毫秒）
 * @returns {{map: Map, echoed: number}} map = taskId → { text, tone, sticky, at }
 */
export function derivePulses(tasks, sessions, prev, now) {
  const at = Number(now) || 0
  const feedBySession = new Map()
  for (const row of Array.isArray(sessions) ? sessions : []) {
    if (row && row.id) feedBySession.set(String(row.id), row)
  }
  const before = prev instanceof Map ? prev : new Map()
  const map = new Map()
  let echoed = 0

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || !task.id) continue
    const id = String(task.id)
    const sessionId = String(task.sessionId || '')
    const feed = sessionId ? feedBySession.get(sessionId) : null
    const next = pulseForTask(task, feed)
    if (!next) continue
    const old = before.get(id)
    /* 文案与语气都没变 = 没有新消息 → 沿用旧的到达时刻（计时继续走，才会自动消失）。
       文案变了 = 新消息 → 重置计时。 */
    const same = old && old.text === next.text && old.tone === next.tone
    if (same) echoed += 1
    map.set(id, { ...next, at: same ? old.at : at })
  }
  return { map, echoed }
}

/**
 * 丢掉已经静默太久的非 sticky 状态泡。sticky（阻塞/挂起）永远留存。
 * @returns {Map} 过滤后的新 Map（不改入参）
 */
export function prunePulses(map, now, ttl) {
  const at = Number(now) || 0
  const life = Number(ttl) > 0 ? Number(ttl) : PULSE_TTL
  const out = new Map()
  if (!(map instanceof Map)) return out
  for (const [id, entry] of map) {
    if (!entry) continue
    if (entry.sticky === true) { out.set(id, entry); continue }
    if (at - Number(entry.at || 0) < life) out.set(id, entry)
  }
  return out
}

/** 状态词 → 状态色（与气泡同一套：蓝=在跑、绿=完成、黄=阻塞） */
export const TONE_COLOR = { brand: '#3b82f6', ok: '#22c55e', warn: '#f59e0b' }

/** 气泡里的状态描边：状态泡用同色系，但比泡本身亮一点 */
export function toneColor(tone) {
  return TONE_COLOR[String(tone || '')] || TONE_COLOR.brand
}

/**
 * 订阅活动流（SSE）。返回退订函数；宿主没给 EventSource（比如单测/老宿主）时返回 null。
 *
 * 为什么订阅而不是轮询：宿主已经在推 `{alive, phase, turn, unread}`（activity.js 的 SSE），
 * 每 1–2 秒轮询一次快照既慢又费；而且「没有新消息就消失」需要一个「什么都没发生」的心跳。
 */
export function subscribeActivity(url, handlers) {
  const api = handlers || {}
  const ES = typeof EventSource === 'function' ? EventSource : null
  if (!ES || !url) return null
  let source = null
  try {
    source = new ES(url)
  } catch {
    return null
  }
  source.addEventListener('activity', (event) => {
    let payload = null
    try { payload = JSON.parse(event.data) } catch { payload = null }
    if (!payload) return
    if (typeof api.onSessions === 'function') api.onSessions(Array.isArray(payload.sessions) ? payload.sessions : [])
  })
  source.addEventListener('error', () => {
    /* SSE 断了就让它自己重连（EventSource 内建）；只把状态告诉调用方，用于降级提示。 */
    if (typeof api.onError === 'function') api.onError()
  })
  return () => {
    try { source.close() } catch { /* 已关闭 */ }
  }
}
