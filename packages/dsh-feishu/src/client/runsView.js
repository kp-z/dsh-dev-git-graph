/**
 * 运行页的纯函数层：`buildRuns(snapshot)`。
 *
 * 零依赖、零副作用，可离线单测。输入是宿主快照的 tasks（字段见 index.js 的 overview 组装）：
 *   { id, no, title, done, workspaceKey, workspaceTitle, sessionId, running, sessionTurn,
 *     blocked, ready, started, suspended, createdAt, startedAt, completedAt, suspendedAt, runningSince,
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

/** 气泡墙的分组顺序（运行中的排最前，未开始垫底）。
 *  **已完成的任务不上运pages**：done 在 buildRuns 入口就被过滤掉，所以这里没有 done 组。 */
export const GROUP_ORDER = ['running', 'started', 'blocked', 'idle']

/** KPI 行的五张卡（adventure 首页那种：圆球 + eyebrow + 大数值 + 迷你水位条）。 */
export const KPI_KEYS = ['running', 'started', 'blocked', 'sessions']

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 2 天前（没有时间戳就回空串，不猜）。 */
export function formatAgo(ms) {
  const value = num(ms, 0)
  if (value < 0) return ''
  const sec = Math.floor(value / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return `${Math.floor(day / 30)} 个月前`
}

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
  /* 硬口径（用户明确要求）：已完成的任务在运行页**完全不出现** —— 入口就丢掉，
     所以气泡墙 / KPI 分母 / 执行历史 / 时长 Top / 告警里都不可能有 done。
     下面所有 counts/分母都基于这份 unfinished。 */
  const allTasks = arr(snap.tasks).filter((task) => isObj(task) && str(task.id))
  /* 运行页只呈现「还在推进」的任务：
       - done      = 做完了；
       - suspended = 暂时不做（挂起）。
     两者都不上面（用户口径：先是「完成的不要显示」，再是「挂起的也不显示」），只保留计数用于自证。 */
  const tasks = allTasks.filter((task) => task.done !== true && task.suspended !== true)
  const now = num(snap.now, Date.now())
  const nowMs = now
  const titleOf = new Map(tasks.map((task) => [str(task.id), str(task.title) || str(task.id)]))

  /* 「刚做完」的任务：**只给气泡墙用**，不参与 KPI 分母 / 分组 / 历史 / 时长。
     为什么需要它：用户口径是「运行中和运行完都可以显示（状态）」，但已完成的任务按另一个口径
     不上运行页 —— 两者只有靠「短暂停留」才能同时成立：完成后的 RECENT_DONE_MS 内留一个绿泡
     （带「已完成」状态对话气泡），然后自己消失。默认 0 = 完全不上墙（保持旧行为）。 */
  const recentDoneMs = Math.max(0, num(snap.recentDoneMs, 0))
  const recentDone = recentDoneMs > 0
    ? allTasks.filter((task) => task.done === true && num(task.completedAt, 0) > 0
      && nowMs - num(task.completedAt, 0) <= recentDoneMs)
    : []

  /**
   * 任务 → 气泡行（未完成任务与「刚做完」的任务共用同一套字段）。
   *
   * `stateOverride` 是给「刚做完」用的：`stateOfTask` 的口径是
   * suspended → blocked → running → started → done，也就是**运行中优先于已完成** ——
   * 这在「完成的任务本来就不上页」时无所谓，但刚做完的任务常常还带着 running 标记
   * （会话还没收到停止事件），于是会出现「蓝泡（运行中）+ 状态泡写『已完成』」的自相矛盾。
   * 刚做完的行显式钉成 done。
   */
  const toBubble = (task, stateOverride) => {
    const state = stateOverride || stateOfTask(task)
    const meta = STATE_META[state] || STATE_META.idle
    const sessionId = str(task.sessionId)
    const startedAt = num(task.startedAt, 0)
    /* 运行起点只有一个，但来源分两种（都在数据面里，不猜）：
       - runningSince：宿主**观察到会话在跑**的最早时刻（本次连续运行的起点，重启后重算）
       - startedAt：任务自己的「开工」时间（历史任务大多没有）
       画面上要让人看出用的是哪一个，所以带上 source 与文案。 */
    const runningSince = num(task.runningSince, 0)
    const hasStart = state !== 'done' && (runningSince > 0 || startedAt > 0)
    const startFrom = runningSince > 0 ? runningSince : startedAt
    const startSource = runningSince > 0 ? 'observed' : (startedAt > 0 ? 'task' : 'none')
    const elapsed = hasStart ? Math.max(0, now - startFrom) : 0
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
      runningSince,
      startFrom,
      startSource,
      startedText: startSource === 'observed' ? '观察到运行' : (startSource === 'task' ? '开工时间' : '未记录开始时间'),
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
  }
  /* 注意：必须包一层箭头函数 —— 直接把 toBubble 传给 map，**index 会被当成 stateOverride**
     （map 的第二个参数是下标），于是除第一条外所有气泡的 state 都变成 1 → 退化成 idle。
     这个坑当场被 runsView 的分组/KPI 断言抓住。 */
  const bubbles = tasks.map((task) => toBubble(task))
  /* 只给气泡墙用：完成不久的绿泡（KPI/分组/历史/时长都用不到它们） */
  const justDone = recentDone.map((task) => toBubble(task, 'done'))

  /**
   * 项目维度（旭日图的数据）：**按自定义目录合并项目** —— 与总览页/关系图同一套规则
   * （`overview/model.js` 的 `groupByCustom`）：用户拖出来的一个目录（比如「QV」）算**一个项目**，
   * 它下面可以有多个 workspace；没进任何目录的各自按 workspace 算，并落在「未分组」桶里。
   * 每个项目再按状态拆一层（在跑 / 等待 / 阻塞），供旭日图的外圈用。
   */
  const projectOf = (() => {
    const custom = arr(snap.groups)
      .filter((group) => isObj(group) && str(group.id) && str(group.name))
      .map((group) => ({ id: str(group.id), name: str(group.name), members: arr(group.members).map((key) => str(key)) }))
    const byMember = new Map()
    custom.forEach((group) => group.members.forEach((key) => { if (key && !byMember.has(key)) byMember.set(key, group) }))
    const titleByKey = new Map()
    arr(snap.workspaces).forEach((ws) => {
      if (!isObj(ws)) return
      const key = str(ws.key)
      if (key) titleByKey.set(key, str(ws.label) || str(ws.title) || key)
    })
    return (row) => {
      const workspaceKey = str(row.workspaceKey)
      const group = workspaceKey ? byMember.get(workspaceKey) : null
      if (group) return { key: `group:${group.id}`, label: group.name, merged: group.members.length }
      const label = str(row.workspaceTitle) || titleByKey.get(workspaceKey) || '未归属项目'
      return { key: workspaceKey || `name:${label}`, label, merged: 1 }
    }
  })()

  const projectMap = new Map()
  bubbles.forEach((row) => {
    const project = projectOf(row)
    const cur = projectMap.get(project.key) || { key: project.key, label: project.label, merged: project.merged, count: 0, states: { running: 0, started: 0, blocked: 0, suspended: 0, idle: 0 } }
    cur.count += 1
    cur.states[row.state] = (cur.states[row.state] || 0) + 1
    cur.merged = Math.max(cur.merged, project.merged)
    projectMap.set(project.key, cur)
  })
  /* 计时覆盖（「计时覆盖」卡要用）：有没有开工时间的条数。
     用户口径里的这张卡是**数据质量监控** —— 没记开始时间的任务，时长类指标对它们不成立。
     口径与气泡行一致：startSource === 'none' 就是没记录。 */
  const timedCount = bubbles.filter((bubble) => bubble.startFrom > 0).length
  const untimedCount = bubbles.length - timedCount

  /** 旭日图的项目环：条数降序，最多的排在上面 */
  const projects = [...projectMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  const counts = { running: 0, started: 0, blocked: 0, suspended: 0, idle: 0 }
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

  /* KPI 行：五张卡，分母一律是「未完成任务数」（done 已在入口被过滤） */
  const unfinished = tasks.length
  const kpiDefs = [
    { key: 'running', label: '运行中', eyebrow: 'RUNNING', value: counts.running, tone: 'success', hint: '会话正在跑', breathing: true },
    { key: 'started', label: '等待中', eyebrow: 'WAITING', value: counts.started, tone: 'idle', hint: '已开始、没在跑' },
    { key: 'blocked', label: '阻塞', eyebrow: 'BLOCKED', value: counts.blocked, tone: 'error', hint: '在等前置任务' },
    { key: 'sessions', label: '已绑会话', eyebrow: 'SESSIONS', value: 0, tone: 'brand', hint: '能一句话跳过去' },
  ]
  const overview = kpiDefs.map((def) => {
    const value = def.key === 'sessions' ? bubbles.filter((bubble) => bubble.sessionId).length : def.value
    const ratio = unfinished > 0 ? Math.max(0, Math.min(1, value / unfinished)) : 0
    return { ...def, value, total: unfinished, ratio, pct: Math.round(ratio * 100) }
  })

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

  /* 运行时长 Top5：now - 起点，越早开始越靠前。
     起点优先取**观察到运行**的时刻（runningSince），没有才退回任务开工时间（startedAt）；
     两者都没有的排最后并标「未记录开始时间」——不猜、不拿轮次冒充时长。 */
  const live = bubbles.filter((bubble) => bubble.state !== 'done')
  const timed = live
    .filter((bubble) => bubble.startFrom > 0)
    .map((bubble) => ({ ...bubble, elapsed: Math.max(0, now - bubble.startFrom), elapsedText: formatDuration(Math.max(0, now - bubble.startFrom)), untimed: false }))
    .sort((a, b) => (b.elapsed - a.elapsed) || (a.no - b.no))
  const untimedRows = live
    .filter((bubble) => bubble.startFrom <= 0)
    .sort((a, b) => (a.no - b.no))
    .map((bubble) => ({ ...bubble, elapsed: 0, elapsedText: '未记录开始时间', untimed: true }))
  const longest = timed.concat(untimedRows).slice(0, 5)
  const untimed = untimedRows.length

  /* 需要人看一眼：被阻塞但前置其实都完成了（说明关系数据可能过期）。
     挂起任务已经不在这页，所以告警里不再列「挂起中」那一类。 */
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
  const alerts = staleBlocked.slice(0, 8)

  /* 执行历史风格列表：未完成任务，按「最近活跃 → 编号」倒序，最近的在上面 */
  const lastActiveOf = (bubble) => Math.max(bubble.startedAt, bubble.runningSince || 0, bubble.suspendedAt, bubble.completedAt)
  const history = bubbles
    .map((bubble) => {
      const lastActiveAt = lastActiveOf(bubble)
      return {
        id: bubble.id,
        no: bubble.no,
        noText: bubble.no > 0 ? `#${bubble.no}` : '未编号',
        title: bubble.title,
        state: bubble.state,
        label: bubble.label,
        tone: bubble.tone,
        breathing: bubble.breathing,
        dashed: bubble.dashed,
        workspaceTitle: bubble.workspaceTitle,
        sessionId: bubble.sessionId,
        canOpenSession: bubble.canOpenSession,
        lastActiveAt,
        agoText: lastActiveAt > 0 ? formatAgo(now - lastActiveAt) : '时间未记录',
      }
    })
    .sort((a, b) => (b.lastActiveAt - a.lastActiveAt) || (b.no - a.no) || a.id.localeCompare(b.id))

  return {
    empty: tasks.length === 0,
    now,
    total: tasks.length,
    /** 入口被过滤掉的已完成任务数（自证「done 不上页面」，也方便测试断言） */
    skippedDone: allTasks.filter((task) => task.done === true).length,
    /** 入口被过滤掉的挂起任务数（挂起 = 暂时不做，同样不上运行页） */
    skippedSuspended: allTasks.filter((task) => task.done !== true && task.suspended === true).length,
    /** 完成不久、仍留在气泡墙上的任务（只影响气泡墙；KPI/分组/历史/时长都不含它们） */
    justDone,
    /** 旭日图用：按自定义目录合并后的项目（含状态拆分） */
    projects,
    /** 计时覆盖：有开始时间 / 未记录的条数（「计时覆盖」卡用） */
    timedCount,
    untimedCount,
    history,
    counts,
    boundSessions,
    groups,
    bubbles,
    overview,
    activity,
    longest,
    longestUntimed: untimed,
    alerts,
  }
}

export default buildRuns
