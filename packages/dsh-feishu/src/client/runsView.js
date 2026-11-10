/**
 * 运行页的纯函数层：`buildRuns(snapshot)`。
 *
 * 零依赖、零副作用，可离线单测。输入是宿主快照的 tasks（字段见 index.js 的 overview 组装）：
 *   { id, no, title, done, workspaceKey, workspaceTitle, sessionId, running, sessionTurn,
 *     blocked, ready, started, suspended, createdAt, startedAt, completedAt, suspendedAt,
 *     predecessors[], blockedBy[] }
 *
 * **状态判定优先级（写死在这张表里，顺序即优先级）**：
 *   suspended → 挂起        (warn)
 *   blocked   → 阻塞        (error)
 *   running   → 运行中      (success + 呼吸)
 *   started   → 等待中      (idle)
 *   done      → 已完成      (success 静态)
 *   否则      → 未开始      (idle 虚线)
 * 想改口径只动这张表，组件与测试都从这里派生。
 */

/** 顺序即优先级：前面的赢。 */
export const STATE_ORDER = ['suspended', 'blocked', 'running', 'started', 'done']

export const STATE_META = {
  suspended: { key: 'suspended', label: '挂起', tone: 'warn', breathing: false, dashed: false },
  blocked: { key: 'blocked', label: '阻塞', tone: 'error', breathing: false, dashed: false },
  running: { key: 'running', label: '运行中', tone: 'success', breathing: true, dashed: false },
  started: { key: 'started', label: '等待中', tone: 'idle', breathing: false, dashed: false },
  done: { key: 'done', label: '已完成', tone: 'success', breathing: false, dashed: false },
  idle: { key: 'idle', label: '未开始', tone: 'idle', breathing: false, dashed: true },
}

/** 气泡墙的分组顺序（运行中的排最前，未开始垫底）。 */
export const GROUP_ORDER = ['running', 'started', 'blocked', 'suspended', 'done', 'idle']

const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const arr = (value) => (Array.isArray(value) ? value : [])
const str = (value) => (typeof value === 'string' ? value : (value == null ? '' : String(value)))
const num = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback)
}

/** 一个任务的运行态（优先级见 STATE_ORDER）。 */
export function stateOfTask(task) {
  const t = isObj(task) ? task : {}
  const flags = {
    suspended: t.suspended === true,
    blocked: t.blocked === true || arr(t.blockedBy).length > 0,
    running: t.running === true,
    started: t.started === true,
    done: t.done === true,
  }
  for (const key of STATE_ORDER) {
    if (flags[key]) return key
  }
  return 'idle'
}

/** 时长文本：1 分 20 秒 / 3 小时 12 分 / 2 天 4 小时 / — */
export function formatDuration(ms) {
  const value = num(ms, 0)
  if (value <= 0) return '—'
  const sec = Math.floor(value / 1000)
  if (sec < 60) return `${sec} 秒`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分`
  const hour = Math.floor(min / 60)
  if (hour < 24) return min % 60 ? `${hour} 小时 ${min % 60} 分` : `${hour} 小时`
  const day = Math.floor(hour / 24)
  return hour % 24 ? `${day} 天 ${hour % 24} 小时` : `${day} 天`
}

/** 本地日历日的 0 点（用 now 的时区，避免「今日」边界算错）。 */
export function startOfDay(nowMs) {
  const d = new Date(num(nowMs, Date.now()))
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 会话轮次分档：未开始 / 1-2 轮 / 3-9 轮 / 10+ 轮。 */
export function turnBucket(turn) {
  const t = Math.max(0, num(turn, 0))
  if (t <= 0) return 'none'
  if (t <= 2) return 'low'
  if (t <= 9) return 'mid'
  return 'high'
}

export const TURN_BUCKETS = [
  { key: 'none', label: '未开始', hint: '0 轮' },
  { key: 'low', label: '1-2 轮', hint: '刚起步' },
  { key: 'mid', label: '3-9 轮', hint: '在推进' },
  { key: 'high', label: '10+ 轮', hint: '长会话' },
]

/**
 * 主入口。返回：
 *   empty      没有任何任务
 *   totals     各状态计数 + 已绑会话数
 *   groups     气泡墙分组（GROUP_ORDER，空组不返回）
 *   bubbles    扁平气泡列表（带 state/group/时长/可用动作）
 *   overview   四张气泡式计数卡：运行中 / 等待 / 挂起 / 今日完成
 *   activity   会话活跃度四档（横向条）
 *   longest    运行时长 Top5（按 startedAt 倒序取最长）
 *   alerts     「需要人看一眼」：挂起中 / 被阻塞但前置其实都完成了
 */
export function buildRuns(snapshot) {
  const snap = isObj(snapshot) ? snapshot : {}
  const tasks = arr(snap.tasks).filter((task) => isObj(task) && str(task.id))
  const now = num(snap.now, Date.now())
  const todayStart = startOfDay(now)
  const titleOf = new Map(tasks.map((task) => [str(task.id), str(task.title) || str(task.id)]))

  const bubbles = tasks.map((task) => {
    const state = stateOfTask(task)
    const meta = STATE_META[state] || STATE_META.idle
    const sessionId = str(task.sessionId)
    const startedAt = num(task.startedAt, 0)
    const elapsed = startedAt > 0 && state !== 'done' ? Math.max(0, now - startedAt) : 0
    return {
      id: str(task.id),
      no: num(task.no, 0),
      title: str(task.title) || str(task.id),
      workspaceKey: str(task.workspaceKey),
      workspaceTitle: str(task.workspaceTitle) || '未归属项目',
      state,
      label: meta.label,
      tone: meta.tone,
      breathing: meta.breathing === true,
      dashed: meta.dashed === true,
      sessionId,
      canOpenSession: Boolean(sessionId),
      sessionTurn: num(task.sessionTurn, 0),
      startedAt,
      completedAt: num(task.completedAt, 0),
      suspendedAt: num(task.suspendedAt, 0),
      elapsed,
      elapsedText: formatDuration(elapsed),
      blockedBy: arr(task.blockedBy).map((item) => {
        const ref = isObj(item) ? item : {}
        const id = str(ref.id)
        return { id, title: str(ref.title) || titleOf.get(id) || id, done: ref.done === true }
      }),
    }
  })

  const counts = { running: 0, started: 0, blocked: 0, suspended: 0, done: 0, idle: 0 }
  bubbles.forEach((bubble) => { counts[bubble.state] = (counts[bubble.state] || 0) + 1 })
  const boundSessions = bubbles.filter((bubble) => bubble.sessionId).length

  /* 分组：空组不出现（避免一排空标题） */
  const groups = GROUP_ORDER
    .map((key) => {
      const meta = STATE_META[key]
      const items = bubbles.filter((bubble) => bubble.state === key)
      return {
        key,
        label: meta.label,
        tone: meta.tone,
        breathing: meta.breathing === true,
        count: items.length,
        bubbles: items,
      }
    })
    .filter((group) => group.count > 0)

  /* 今日完成：靠 completedAt（快照已投影）；没有时间戳时退化为「全部已完成」 */
  const doneAll = bubbles.filter((bubble) => bubble.state === 'done')
  const doneToday = doneAll.filter((bubble) => bubble.completedAt >= todayStart && bubble.completedAt > 0)
  const hasCompletionTime = doneAll.some((bubble) => bubble.completedAt > 0)

  const overview = [
    { key: 'running', label: '运行中', value: counts.running, tone: 'success', hint: '会话正在跑', breathing: true },
    { key: 'started', label: '等待', value: counts.started, tone: 'idle', hint: '已开始、没在跑' },
    { key: 'suspended', label: '挂起', value: counts.suspended, tone: 'warn', hint: '暂停中' },
    {
      key: 'todayDone',
      label: hasCompletionTime ? '今日完成' : '已完成',
      value: hasCompletionTime ? doneToday.length : counts.done,
      tone: 'success',
      hint: hasCompletionTime ? '今天完成的任务' : '快照无完成时间，暂为累计',
    },
  ]

  /* 会话活跃度：按 sessionTurn 分档，只统计已绑会话的任务 */
  const bound = bubbles.filter((bubble) => bubble.sessionId)
  const activity = TURN_BUCKETS.map((bucket) => {
    const items = bound.filter((bubble) => turnBucket(bubble.sessionTurn) === bucket.key)
    return {
      key: bucket.key,
      label: bucket.label,
      hint: bucket.hint,
      count: items.length,
      ratio: bound.length > 0 ? items.length / bound.length : 0,
      running: items.filter((item) => item.state === 'running').length,
    }
  })

  /* 运行时长 Top5：now - startedAt，越早开始越靠前；
     **没记开始时间的排在最后并标「未记录开始时间」**（不猜、不拿轮次冒充时长）。 */
  const live = bubbles.filter((bubble) => bubble.state !== 'done')
  const timed = live
    .filter((bubble) => bubble.startedAt > 0)
    .map((bubble) => ({ ...bubble, elapsed: Math.max(0, now - bubble.startedAt), elapsedText: formatDuration(Math.max(0, now - bubble.startedAt)), untimed: false }))
    .sort((a, b) => (b.elapsed - a.elapsed) || (a.no - b.no))
  const untimedRows = live
    .filter((bubble) => bubble.startedAt <= 0)
    .sort((a, b) => (a.no - b.no))
    .map((bubble) => ({ ...bubble, elapsed: 0, elapsedText: '未记录开始时间', untimed: true }))
  const longest = timed.concat(untimedRows).slice(0, 5)
  const untimed = untimedRows.length

  /* 需要人看一眼：挂起中 + 被阻塞但前置其实都完成了（说明关系数据可能过期） */
  const suspendedAlerts = bubbles
    .filter((bubble) => bubble.state === 'suspended')
    .sort((a, b) => (b.suspendedAt - a.suspendedAt) || (a.no - b.no))
    .map((bubble) => ({
      id: bubble.id,
      no: bubble.no,
      title: bubble.title,
      workspaceTitle: bubble.workspaceTitle,
      reason: 'suspended',
      reasonText: '挂起中',
      detail: bubble.suspendedAt > 0 ? `挂起于 ${formatDuration(now - bubble.suspendedAt)}前` : '等待恢复',
    }))
  const staleBlocked = bubbles
    .filter((bubble) => bubble.state === 'blocked' && bubble.blockedBy.length > 0 && bubble.blockedBy.every((ref) => ref.done === true))
    .map((bubble) => ({
      id: bubble.id,
      no: bubble.no,
      title: bubble.title,
      workspaceTitle: bubble.workspaceTitle,
      reason: 'stale-block',
      reasonText: '前置都已完成',
      detail: `等 ${bubble.blockedBy.map((ref) => ref.title).join('、')}`,
    }))
  const alerts = suspendedAlerts.concat(staleBlocked).slice(0, 8)

  return {
    empty: tasks.length === 0,
    now,
    total: tasks.length,
    counts,
    boundSessions,
    groups,
    bubbles,
    overview,
    activity,
    longest,
    longestUntimed: untimed,
    alerts,
    todayDone: doneToday.length,
    hasCompletionTime,
  }
}

export default buildRuns
