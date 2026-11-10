/**
 * 洞察页的纯函数层：`buildInsight(snapshot)`。
 *
 * 零依赖、零副作用（不读 store、不碰 DOM、不联网），所以能离线单测。
 * 输入就是宿主快照里的那份数据（见 index.js 的 overview 组装）：
 *   tasks:     { id, no, title, done, workspaceKey, workspaceTitle, blocked, ready,
 *                started, suspended, sessionId, running, sessionTurn,
 *                predecessors[], successors[], sourceTasks[], derivedTasks[], blockedBy[] }
 *   relations: { from, to, kind: 'depends_on' | 'derived_from' }
 *   workspaces:{ key, title }[]
 *
 * 口径（和宿主 index.js 保持一致，别自己发明）：
 * - `blocked` = 有未完成前置；`ready` 是宿主字段，但**已完成的任务**也会是 ready=true，
 *   所以状态分布要自己算互斥桶：完成 → 阻塞 → 挂起 → 就绪。
 * - `running` 是「这条会话此刻真的在跑」（宿主内存态），`sessionTurn` 是跑到第几轮。
 * - 任务级时间戳由宿主投影（毫秒）：`createdAt` / `startedAt` / `completedAt` / `suspendedAt`，
 *   取不到就是 0。0 一律视为「没有时间」，排序时排最后，不拿编号冒充时间。
 */

const DECO = [0, 1, 2, 3, 4, 5]

const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const arr = (value) => (Array.isArray(value) ? value : [])
const str = (value) => (typeof value === 'string' ? value : (value == null ? '' : String(value)))
const num = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback)
}
export const TONES = ['done', 'blocked', 'suspended', 'ready']

/** 状态桶（互斥）：一个任务恰好落一个桶。 */
export function bucketOf(task) {
  const t = isObj(task) ? task : {}
  if (t.done === true) return 'done'
  const blockers = arr(t.blockedBy)
  if (blockers.length > 0 || t.blocked === true) return 'blocked'
  if (t.suspended === true) return 'suspended'
  return 'ready'
}

/**
 * 整数百分比，和**恰好** 100（总量为 0 时全 0）。
 * 用最大余数法分配，避免 33+33+33=99 这种。
 */
export function sharePct(values) {
  const list = arr(values).map((value) => Math.max(0, num(value, 0)))
  const total = list.reduce((sum, value) => sum + value, 0)
  if (!total) return list.map(() => 0)
  const raw = list.map((value) => (value / total) * 100)
  const out = raw.map((value) => Math.floor(value))
  let rest = 100 - out.reduce((sum, value) => sum + value, 0)
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value), positive: list[index] > 0 }))
    .filter((row) => row.positive)
    .sort((a, b) => (b.frac - a.frac) || (a.index - b.index))
  for (let i = 0; i < order.length && rest > 0; i += 1) {
    out[order[i].index] += 1
    rest -= 1
  }
  return out
}

/** 相对时间：刚刚 / 3 分钟前 / 2 小时前 / 3 天前。 */
export function formatAgo(ms) {
  const value = num(ms, 0)
  if (value <= 0) return '刚刚'
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

/** 本地日历日 0 点（今日完成的口径边界，跟运行页同一套）。 */
export function startOfDay(nowMs) {
  const d = new Date(num(nowMs, Date.now()))
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 依赖链最长深度（沿 depends_on 的 from → to 走，带环保护）。 */
export function longestDepChain(relations) {
  const next = new Map()
  const nodes = new Set()
  arr(relations).forEach((edge) => {
    if (!isObj(edge) || edge.kind !== 'depends_on') return
    const from = str(edge.from)
    const to = str(edge.to)
    if (!from || !to || from === to) return
    nodes.add(from)
    nodes.add(to)
    if (!next.has(from)) next.set(from, [])
    next.get(from).push(to)
  })
  const memo = new Map()
  const walk = (id, seen) => {
    if (memo.has(id)) return memo.get(id)
    if (seen.has(id)) return 1
    seen.add(id)
    let best = 1
    for (const to of next.get(id) || []) best = Math.max(best, 1 + walk(to, seen))
    seen.delete(id)
    memo.set(id, best)
    return best
  }
  let max = 0
  nodes.forEach((id) => { max = Math.max(max, walk(id, new Set())) })
  return max
}

function kpiOf(id, label, value, total, tone, suffix) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0
  return {
    id,
    label,
    value: Math.round(value),
    total: Math.round(total),
    ratio,
    pct: Math.round(ratio * 100),
    tone,
    text: suffix ? `${Math.round(value)}${suffix}` : String(Math.round(value)),
  }
}

/**
 * 主入口。坏数据一律降级成「空」，不抛（面板崩了比少两块图更糟）。
 * 返回：
 *   empty      是否没有任何任务
 *   totals     { tasks, done, open, blocked, suspended, ready, running }
 *   kpis       4-5 个气泡指标卡
 *   statusMix  互斥四桶 + 百分比（和恰好 100）
 *   workspaces 按任务数倒序，Top 8 + 「其他」
 *   relations  { dependencyEdges, provenanceEdges, ghosts, maxChain }
 *   blockers   阻塞榜 Top 5（标题 + 等谁）
 *   recent     { done, started, suspended } 各 Top 5（按编号倒序，无时间戳）
 */
export function buildInsight(snapshot) {
  const snap = isObj(snapshot) ? snapshot : {}
  const tasks = arr(snap.tasks).filter((task) => isObj(task) && str(task.id))
  const relations = arr(snap.relations).filter((edge) => isObj(edge) && str(edge.from) && str(edge.to))
  const workspaces = arr(snap.workspaces).filter(isObj)

  const ids = new Set(tasks.map((task) => str(task.id)))
  const buckets = { done: 0, blocked: 0, suspended: 0, ready: 0 }
  let running = 0
  tasks.forEach((task) => {
    buckets[bucketOf(task)] += 1
    if (task.running === true) running += 1
  })
  const total = tasks.length
  const done = buckets.done
  const open = total - done

  const statusLabels = { done: '已完成', blocked: '阻塞', suspended: '挂起', ready: '就绪' }
  const statusTones = { done: 'ok', blocked: 'danger', suspended: 'warn', ready: 'idle' }
  const mixValues = TONES.map((key) => buckets[key])
  const pcts = sharePct(mixValues)
  const statusMix = TONES.map((key, index) => ({
    key,
    label: statusLabels[key],
    tone: statusTones[key],
    count: buckets[key],
    pct: pcts[index],
    ratio: total > 0 ? buckets[key] / total : 0,
  }))

  const projectTotal = new Set(tasks.map((task) => str(task.workspaceKey) || '__none__')).size
  /* 今日完成：completedAt 落在今天 0 点之后；一个时间都没有时退化为「累计已完成」 */
  const nowMs = num(snap.now, 0)
  const todayStart = nowMs > 0 ? startOfDay(nowMs) : 0
  const doneTasks = tasks.filter((task) => task.done === true)
  const completedTimes = doneTasks.map((task) => num(task.completedAt, 0)).filter((at) => at > 0)
  const hasCompletionTime = completedTimes.length > 0
  const doneToday = hasCompletionTime && todayStart > 0
    ? completedTimes.filter((at) => at >= todayStart).length
    : (hasCompletionTime ? 0 : done)

  const kpis = [
    kpiOf('total', '任务总数', total, Math.max(total, 1), 'brand'),
    kpiOf('done', '完成率', done, Math.max(total, 1), 'ok', ''),
    kpiOf('blocked', '阻塞中', buckets.blocked, Math.max(total, 1), 'danger'),
    kpiOf('ready', '就绪', buckets.ready, Math.max(total, 1), 'idle'),
    kpiOf('suspended', '挂起', buckets.suspended, Math.max(total, 1), 'warn'),
    kpiOf('todayDone', hasCompletionTime ? '今日完成' : '已完成', doneToday, Math.max(total, 1), 'ok'),
  ]
  /* 每张卡的一句话口径（组件直接显示，不再各自算） */
  kpis[0].note = `${projectTotal} 个项目 · ${running} 个会话在跑`
  kpis[1].note = `${done}/${total} 已完成`
  kpis[2].note = buckets.blocked ? '在等前置任务' : '没有被阻塞的任务'
  kpis[3].note = `${buckets.ready} 个可以开工`
  kpis[4].note = buckets.suspended ? '需要人看一眼' : '没有挂起的任务'
  kpis[5].note = hasCompletionTime ? '按完成时间统计' : '快照无完成时间，暂为累计'
  /* 「完成率」卡显示百分比，其余显示条数（text 是卡片上的主数字） */
  kpis[1].text = `${kpis[1].pct}%`
  kpis[1].value = kpis[1].pct
  kpis[1].total = 100

  /* ---- 项目分布：按任务数倒序，Top 8 + 其他 ---- */
  const byWorkspace = new Map()
  tasks.forEach((task) => {
    const key = str(task.workspaceKey) || '__none__'
    let row = byWorkspace.get(key)
    if (!row) {
      row = { key, label: str(task.workspaceTitle) || str(task.workspaceKey) || '未归属项目', total: 0, done: 0, blocked: 0, running: 0 }
      byWorkspace.set(key, row)
    }
    row.total += 1
    if (task.done === true) row.done += 1
    if (bucketOf(task) === 'blocked') row.blocked += 1
    if (task.running === true) row.running += 1
  })
  const allWorkspaces = Array.from(byWorkspace.values())
    .sort((a, b) => (b.total - a.total) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
  const topN = 8
  const head = allWorkspaces.slice(0, topN).map((row, index) => ({
    key: row.key,
    label: row.label,
    total: row.total,
    done: row.done,
    blocked: row.blocked,
    running: row.running,
    ratio: row.total > 0 ? row.done / row.total : 0,
    pct: row.total > 0 ? Math.round((row.done / row.total) * 100) : 0,
    deco: DECO[index % DECO.length],
  }))
  const tail = allWorkspaces.slice(topN)
  const wsRows = tail.length
    ? head.concat([{
      key: '__other__',
      label: `其他 ${tail.length} 个项目`,
      total: tail.reduce((sum, row) => sum + row.total, 0),
      done: tail.reduce((sum, row) => sum + row.done, 0),
      blocked: tail.reduce((sum, row) => sum + row.blocked, 0),
      running: tail.reduce((sum, row) => sum + row.running, 0),
      ratio: 0,
      pct: 0,
      deco: DECO[topN % DECO.length],
      other: true,
    }])
    : head
  wsRows.forEach((row) => {
    if (row.other) {
      row.ratio = row.total > 0 ? row.done / row.total : 0
      row.pct = Math.round(row.ratio * 100)
    }
    row.share = total > 0 ? row.total / total : 0
    row.sharePct = Math.round(row.share * 100)
  })

  /* ---- 关系概览 ---- */
  const dependencyEdges = relations.filter((edge) => edge.kind === 'depends_on').length
  const provenanceEdges = relations.filter((edge) => edge.kind === 'derived_from').length
  const ghosts = relations.filter((edge) => !ids.has(str(edge.from)) || !ids.has(str(edge.to))).length
  const maxChain = longestDepChain(relations)
  const relationsView = {
    dependencyEdges,
    provenanceEdges,
    ghosts,
    maxChain,
    total: dependencyEdges + provenanceEdges,
    ghostPct: relations.length ? Math.round((ghosts / relations.length) * 100) : 0,
    rows: [
      { key: 'dep', label: '依赖边', value: dependencyEdges, tone: 'brand', hint: '前置 → 后置' },
      { key: 'prov', label: '来源边', value: provenanceEdges, tone: 'idle', hint: '任务 → 派生任务' },
      { key: 'ghost', label: '未同步端点', value: ghosts, tone: ghosts ? 'warn' : 'ok', hint: '关系里有、任务表里没有' },
      { key: 'chain', label: '最长依赖链', value: maxChain, tone: 'ok', hint: '一条链上最多经过几个任务' },
    ],
  }

  /* ---- 阻塞榜 Top 5 ---- */
  const blockerTitle = new Map(tasks.map((task) => [str(task.id), str(task.title) || str(task.id)]))
  const blockers = tasks
    .filter((task) => bucketOf(task) === 'blocked')
    .map((task) => {
      const waiting = arr(task.blockedBy).map((item) => {
        const ref = isObj(item) ? item : {}
        const id = str(ref.id)
        return {
          id,
          title: str(ref.title) || blockerTitle.get(id) || id || '未知任务',
          no: num(ref.no, 0),
        }
      })
      return {
        id: str(task.id),
        no: num(task.no, 0),
        title: str(task.title) || str(task.id),
        workspaceTitle: str(task.workspaceTitle),
        waiting,
        waitingText: waiting.length ? waiting.map((row) => row.title).join('、') : '未知原因',
        count: waiting.length,
      }
    })
    .sort((a, b) => (b.count - a.count) || (a.no - b.no) || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((row, index) => ({ ...row, rank: index + 1 }))

  /* ---- 最近动态：真时间戳倒序（0 视为没时间，排最后），没有时间戳的退化为编号倒序 ---- */
  const byNoDesc = (a, b) => (num(b.no, 0) - num(a.no, 0)) || str(a.id).localeCompare(str(b.id))
  const byTimeDesc = (field) => (a, b) => {
    const ta = num(a[field], 0)
    const tb = num(b[field], 0)
    if (ta !== tb) return tb - ta
    return byNoDesc(a, b)
  }
  const clock = num(snap.now, 0)
  const brief = (task, field) => {
    const at = num(task[field], 0)
    return {
      id: str(task.id),
      no: num(task.no, 0),
      title: str(task.title) || str(task.id),
      workspaceTitle: str(task.workspaceTitle),
      running: task.running === true,
      turn: num(task.sessionTurn, 0),
      at,
      atText: at > 0 && clock > 0 ? formatAgo(clock - at) : '',
    }
  }
  const recent = {
    orderBy: '完成 / 开始 / 挂起时间倒序',
    /* 没有时间戳的照样列出来（排最后），面板会显示「时间未记录」 */
    done: tasks.filter((task) => task.done === true).sort(byTimeDesc('completedAt')).slice(0, 5).map((task) => brief(task, 'completedAt')),
    started: tasks.filter((task) => task.started === true && task.done !== true).sort(byTimeDesc('startedAt')).slice(0, 5).map((task) => brief(task, 'startedAt')),
    suspended: tasks.filter((task) => task.suspended === true && task.done !== true).sort(byTimeDesc('suspendedAt')).slice(0, 5).map((task) => brief(task, 'suspendedAt')),
  }

  return {
    empty: total === 0,
    totals: { tasks: total, done, open, blocked: buckets.blocked, suspended: buckets.suspended, ready: buckets.ready, running, projects: allWorkspaces.length },
    kpis,
    statusMix,
    workspaces: wsRows,
    projectCount: allWorkspaces.length,
    relations: relationsView,
    blockers,
    recent,
    todayDone: doneToday,
    hasCompletionTime,
    /* 统计面板之外的口径：运行中的任务（洞察页只做计数，运行页才是主战场） */
    runningTasks: tasks.filter((task) => task.running === true).slice(0, 5).map(brief),
    workspaceRows: workspaces.length,
  }
}

export default buildInsight
