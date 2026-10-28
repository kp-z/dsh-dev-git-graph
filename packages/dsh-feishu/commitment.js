/**
 * 履约（commitment）：预期完成时间、偏差、延期记录、汇总指标。
 *
 * 为什么单独一个文件：和 schedule.js 一样，这里的每一件事都是纯计算——
 * 「准时还是延期」「延期几天」「首次承诺和最后一次承诺差多少」如果掺进 IO，
 * 就只能靠人工核对了。抽出来才能锁口径（test/commitment.mjs）。
 *
 * 口径（与 DESIGN-task-lifecycle.md §4.2 一致）：
 *   - 延期以**首次承诺**为基准，重承诺单独计次，不覆盖首次；
 *   - 提前完成也记账（正样本）；
 *   - 进行中且已过预期 = 逾期（风险），不算延期（没结算）。
 */
import { TZ_DEFAULT, parseWhen, zonedParts, zonedTimestamp } from './schedule.js'

export const ETA_FORMAT_HINT = 'YYYY-MM-DD HH:mm'
export const ETA_FIELD_DEFAULT = '预期完成'
const DAY = 86_400_000

/* 口语前后缀：说时间时常带的动词/客套话，摘掉之后才能判断「是不是只有时间」。
   注意只摘端点，不动中间（「截止前 2 小时」这种交给 parseWhen 的锚点解析）。 */
const ETA_FILLER_HEAD = /^(?:(?:请|麻烦|帮我|帮忙|要|在|就)\s*)+/u
const ETA_FILLER_TAIL = /(?:(?:之前|以前|前|完成|做完|搞定|交付|交|截止)\s*)+$/u

/* 口语里的「几点」→ 具体时刻。只影响「没说几点」时的默认值。 */
const ETA_CLOCK_PHRASES = [
  [/下班前|下班之前|收工前/, '18:00'],
  [/上班前|上班之前/, '09:00'],
  [/中午前|午饭前|午休前/, '12:00'],
]

const pad2 = (n) => String(n).padStart(2, '0')
const asText = (value) => (value == null ? '' : String(value)).trim()

/** epoch → `YYYY-MM-DD HH:mm`（按目标时区）。空值返回 ''。 */
export function formatEta(ts, tz = TZ_DEFAULT) {
  const n = Number(ts) || 0
  if (!n) return ''
  const p = zonedParts(n, tz || TZ_DEFAULT)
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}`
}

/**
 * 解析人给的预期时间。
 *   - '' → 清空（at: null, cleared: true）；
 *   - `2026-10-30` → 当天 defaultClock（默认 18:00，下班前）；
 *   - `2026-10-30 18:00` / `2026/10/30 18:00:00` → 原样；
 *   - ISO（带 Z 或 +08:00）→ Date.parse；
 *   - 其余交给 schedule.js 的自然语言解析（只接受一次性时刻）。
 */
export function parseEta(text, opts = {}) {
  const tz = opts.tz || TZ_DEFAULT
  const now = Number(opts.now) || Date.now()
  /* 只说「哪一天」时的默认时刻：预期完成默认下班前 18:00。 */
  let defaultClock = opts.defaultClock || '18:00'
  let raw = asText(text)
  if (!raw) return { ok: true, at: null, cleared: true }

  /* 口语里的「几点」：下班前 / 上班前 / 中午前。
     只写了这种词（没写哪天）时按今天算，已过就顺延到明天。 */
  let clockOnly = false
  let pickedClock = null
  raw = raw.replace(ETA_FILLER_HEAD, '').replace(/\s+/g, ' ').trim()
  for (const [re, clock] of ETA_CLOCK_PHRASES) {
    if (!re.test(raw)) continue
    raw = raw.replace(re, ' ').replace(/\s+/g, ' ').trim()
    pickedClock = clock
    break
  }
  /* 「下班前交」「周五前搞定」：把动词/介词尾巴摘掉再判断是不是只剩时间词。 */
  raw = raw.replace(ETA_FILLER_TAIL, '').replace(/\s+/g, ' ').trim()
  if (pickedClock) {
    defaultClock = pickedClock
    if (!raw) clockOnly = true
  }
  if (clockOnly) {
    const [h, mi] = defaultClock.split(':').map(Number)
    const p = zonedParts(now, tz)
    let at = zonedTimestamp({ y: p.y, mo: p.mo, d: p.d, h, mi }, tz)
    if (at <= now) {
      const t = new Date(Date.UTC(p.y, p.mo - 1, p.d) + DAY)
      at = zonedTimestamp({ y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h, mi }, tz)
    }
    return { ok: true, at, dayOnly: true }
  }

  /* 只写月日：10-30 / 10/30 [18:00]。年份取当前年，已经过去很久就顺延到明年。 */
  const monthDay = /^(\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(raw)
  if (monthDay) {
    const p = zonedParts(now, tz)
    const [h, mi] = (monthDay[3] && monthDay[4] ? `${monthDay[3]}:${monthDay[4]}` : defaultClock).split(':').map(Number)
    let at = zonedTimestamp({ y: p.y, mo: Number(monthDay[1]), d: Number(monthDay[2]), h, mi }, tz)
    if (at < now - 30 * DAY) {
      at = zonedTimestamp({ y: p.y + 1, mo: Number(monthDay[1]), d: Number(monthDay[2]), h, mi }, tz)
    }
    return { ok: true, at }
  }

  const dateOnly = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw)
  if (dateOnly) {
    const [h, mi] = defaultClock.split(':').map(Number)
    const at = zonedTimestamp(
      { y: Number(dateOnly[1]), mo: Number(dateOnly[2]), d: Number(dateOnly[3]), h, mi: mi || 0 },
      tz,
    )
    return { ok: true, at, dateOnly: true }
  }

  const withTime = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw)
  if (withTime) {
    const at = zonedTimestamp(
      {
        y: Number(withTime[1]),
        mo: Number(withTime[2]),
        d: Number(withTime[3]),
        h: Number(withTime[4]),
        mi: Number(withTime[5]),
        s: Number(withTime[6] || 0),
      },
      tz,
    )
    return { ok: true, at }
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const at = Date.parse(raw)
    if (Number.isFinite(at)) return { ok: true, at }
  }

  const parsed = parseWhen(raw, { tz, now, defaultClock })
  if (parsed.ok && parsed.spec?.kind === 'at') {
    /* 「截止前 2 小时」这种锚点：有截止时间就换算成绝对时刻。 */
    if (parsed.spec.anchor) {
      const base = Number(opts.anchorTs) || 0
      if (!base) {
        return { ok: false, error: '这条任务没有截止时间，没法按「截止前…」算预期', hint: ETA_FORMAT_HINT }
      }
      const at = base + (Number(parsed.spec.offsetMinutes) || 0) * 60_000
      return { ok: true, at, anchored: true }
    }
    const at = Date.parse(parsed.spec.at)
    if (Number.isFinite(at)) return { ok: true, at, natural: true }
  }
  /* 说不准就不猜：给出候选，让人补一句具体日期。 */
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : []
  const hintText = candidates.length
    ? `（比如：${candidates.slice(0, 3).map((item) => item.label).join(' / ')}）`
    : ''
  return {
    ok: false,
    error: `没听懂预期时间「${raw}」${hintText}`,
    hint: ETA_FORMAT_HINT,
    candidates,
  }
}

/** 首次承诺（履约严格口径的基准）。没有 promiseLog 时退回当前 expectedAt。 */
export function firstPromiseOf(task) {
  const log = Array.isArray(task?.promiseLog) ? task.promiseLog : []
  const first = log.find((item) => Number(item?.expectedAt) > 0)
  if (first) return Number(first.expectedAt)
  return Number(task?.expectedAt) || 0
}

/** 人能读的时长：45 分钟 / 3 小时 / 2.5 天 / 12 天。 */
export function formatSpan(ms) {
  const abs = Math.abs(Number(ms) || 0)
  const minutes = Math.round(abs / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  const days = (hours / 24)
  const rounded = days >= 10 ? Math.round(days) : Math.round(days * 10) / 10
  return `${rounded} 天`
}

/**
 * 单条任务此刻的履约状态。
 * state: none | pending | overdue | early | on_time | late | done_unknown
 */
export function classifyFulfillment(task, now = Date.now()) {
  const expectedAt = Number(task?.expectedAt) || 0
  if (!expectedAt) return { state: 'none', slackMs: null, label: '未设预期' }
  if (task.done) {
    const endAt = Number(task.endAt) || 0
    if (!endAt) return { state: 'done_unknown', slackMs: null, label: '已完成（缺结束时间）' }
    const slack = endAt - expectedAt
    if (slack < 0) return { state: 'early', slackMs: slack, label: `提前 ${formatSpan(-slack)}` }
    if (slack === 0) return { state: 'on_time', slackMs: 0, label: '准时' }
    return { state: 'late', slackMs: slack, label: `延期 ${formatSpan(slack)}` }
  }
  const rest = expectedAt - now
  if (rest < 0) return { state: 'overdue', slackMs: rest, label: `逾期 ${formatSpan(-rest)}` }
  return { state: 'pending', slackMs: rest, label: `剩 ${formatSpan(rest)}` }
}

/**
 * 记一次承诺变更（只增不改）。
 * 往后改 → 追加一条 delayLog；往前改（收紧）不记延期，但也留 promiseLog。
 * 没变就什么都不写，避免同步一次刷新一堆无意义记录。
 */
export function promiseUpdate(prev = {}, nextAt, at = Date.now(), reason = '') {
  const promiseLog = Array.isArray(prev.promiseLog) ? [...prev.promiseLog] : []
  const delayLog = Array.isArray(prev.delayLog) ? [...prev.delayLog] : []
  const before = Number(prev.expectedAt) || 0
  const next = Number(nextAt) || 0
  if (!next) {
    /* 清空也要留痕：否则「承诺被谁撤掉的」在数据里没有任何记录。 */
    if (before) promiseLog.push({ at, expectedAt: 0, kind: 'cleared', reason: asText(reason).slice(0, 120) })
    return { expectedAt: 0, promiseLog, delayLog }
  }
  if (before === next) return { expectedAt: next, promiseLog, delayLog }
  promiseLog.push({
    at,
    expectedAt: next,
    kind: before ? 'recommit' : 'set',
    reason: asText(reason).slice(0, 120),
  })
  if (before && next > before) {
    const days = Math.round(((next - before) / DAY) * 10) / 10
    delayLog.push({ at, from: before, to: next, days, reason: asText(reason).slice(0, 120) })
  }
  return { expectedAt: next, promiseLog, delayLog }
}

function rate(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

/**
 * 汇总。只统计「有预期时间」的任务：
 *   - onTimeRate 用**首次承诺**（严格口径），finalOnTimeRate 用最后一次承诺；
 *   - lateCount 是 delayLog 的条数（重承诺次数），不是任务数；
 *   - overdue 是当前进行中且已过预期的任务数。
 */
export function fulfillmentSummary(tasks, opts = {}) {
  const now = Number(opts.now) || Date.now()
  const since = Number(opts.since) || 0
  const rows = (Array.isArray(tasks) ? tasks : []).filter((task) => Number(task?.expectedAt) > 0)
  const finished = rows.filter(
    (task) => task.done && Number(task.endAt) > 0 && (!since || Number(task.endAt) >= since),
  )

  let onTime = 0
  let finalOnTime = 0
  let strictSlackSum = 0
  let finalSlackSum = 0
  let lateCount = 0
  const byWorkspace = new Map()

  for (const task of finished) {
    const endAt = Number(task.endAt)
    const first = firstPromiseOf(task) || Number(task.expectedAt)
    const current = Number(task.expectedAt)
    const strictSlack = endAt - first
    const finalSlack = endAt - current
    strictSlackSum += strictSlack
    finalSlackSum += finalSlack
    if (strictSlack <= 0) onTime += 1
    if (finalSlack <= 0) finalOnTime += 1

    const key = asText(task.workspaceTitle || task.workspaceName || task.meta?.workspace) || '（未标注工作区）'
    const bucket = byWorkspace.get(key) ?? { workspace: key, completed: 0, onTime: 0, slackSum: 0 }
    bucket.completed += 1
    if (strictSlack <= 0) bucket.onTime += 1
    bucket.slackSum += strictSlack
    byWorkspace.set(key, bucket)
  }

  for (const task of rows) {
    lateCount += Array.isArray(task.delayLog) ? task.delayLog.length : 0
  }

  const overdueRows = rows.filter((task) => !task.done && now > Number(task.expectedAt))
  const pendingRows = rows.filter((task) => !task.done && now <= Number(task.expectedAt))

  return {
    tracked: rows.length,
    completed: finished.length,
    pending: pendingRows.length,
    overdue: overdueRows.length,
    onTime,
    finalOnTime,
    onTimeRate: rate(onTime, finished.length),
    finalOnTimeRate: rate(finalOnTime, finished.length),
    avgSlackMs: finished.length ? Math.round(strictSlackSum / finished.length) : null,
    avgFinalSlackMs: finished.length ? Math.round(finalSlackSum / finished.length) : null,
    lateCount,
    byWorkspace: [...byWorkspace.values()]
      .map((bucket) => ({
        workspace: bucket.workspace,
        completed: bucket.completed,
        onTimeRate: rate(bucket.onTime, bucket.completed),
        avgSlackMs: bucket.completed ? Math.round(bucket.slackSum / bucket.completed) : null,
      }))
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 8),
  }
}

/* ═══════════════════════════ 延期归因与完成质量 ═══════════════════════════
 *
 * 诊断要把「为什么延期」说清楚，但模型不能数数。所以在本地把 delayLog 的原因
 * 归到固定几个桶（关键词命中，确定性），诊断只把「哪个桶、几条、举例」发给模型，
 * 让模型解释和给建议；条数永远由本地回填。
 */

export const DELAY_BUCKETS = [
  { id: 'dependency', label: '等依赖', re: /上游|依赖|联调|接口|等待|等(人|对方|外部|他)|对方|外部|被卡|blocked/i },
  { id: 'scope', label: '需求变了', re: /需求|变更|改需求|加需求|范围|口径|方案改|推翻/i },
  { id: 'interrupt', label: '被打断', re: /打断|临时|插队|会议|救火|分心|优先级变|插进来/i },
  { id: 'estimate', label: '估时不准', re: /估|低估|比想象|时间不够|来不及|工作量|拆不|粒度太粗/i },
  { id: 'environment', label: '环境/权限', re: /环境|权限|数据|构建|编译|工具|部署|网络|账号/i },
  { id: 'review', label: '返工/验收', re: /返工|测试|验收|bug|问题|review|修复|联调修/i },
  { id: 'other', label: '其他/未写', re: /.*/ },
]

const BUCKET_LABEL = Object.fromEntries(DELAY_BUCKETS.map((item) => [item.id, item.label]))

/** 一条延期原因 → 固定桶 id（空原因归 other）。 */
export function classifyDelayReason(text) {
  const raw = asText(text)
  if (!raw) return 'other'
  for (const bucket of DELAY_BUCKETS) {
    if (bucket.id === 'other') break
    if (bucket.re.test(raw)) return bucket.id
  }
  return 'other'
}

/** 延期原因聚合：每个桶的出现次数、涉及任务、举例。按次数降序，最多 limit 个桶。 */
export function delayPatterns(tasks, opts = {}) {
  const limit = Math.max(1, Math.min(6, Number(opts.limit) || 3))
  /* 注意：Number(undefined) 是 NaN，NaN ?? 2 还是 NaN，会让 samples 永远为空。 */
  const samplesPer = Math.max(0, Math.min(4, Number.isFinite(Number(opts.samples)) ? Number(opts.samples) : 2))
  const map = new Map()
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const log = Array.isArray(task?.delayLog) ? task.delayLog : []
    for (const entry of log) {
      const bucket = classifyDelayReason(entry?.reason)
      const hit = map.get(bucket) ?? {
        bucket,
        label: BUCKET_LABEL[bucket] ?? bucket,
        count: 0,
        days: 0,
        tasks: [],
        samples: [],
      }
      hit.count += 1
      hit.days += Number(entry?.days) || 0
      const id = task.id ?? `${task.no ?? ''}`
      if (!hit.tasks.some((item) => item.id === id)) {
        hit.tasks.push({ id, no: Number(task.no) || 0, title: asText(task.title) })
      }
      if (entry?.reason && hit.samples.length < samplesPer) {
        hit.samples.push(asText(entry.reason).slice(0, 40))
      }
      map.set(bucket, hit)
    }
  }
  return [...map.values()]
    .map((hit) => ({ ...hit, days: Math.round(hit.days * 10) / 10, tasks: hit.tasks.slice(0, 5) }))
    .sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket))
    .slice(0, limit)
}

/** 完成质量：提前/准时/延期分布 + 周期中位数/85 分位（只用有预期/有开始时间的样本）。 */
export function completionQuality(tasks, opts = {}) {
  const since = Number(opts.since) || 0
  const done = (Array.isArray(tasks) ? tasks : []).filter(
    (task) => task && task.done && Number(task.endAt) > 0 && (!since || Number(task.endAt) >= since),
  )
  let early = 0
  let onTime = 0
  let late = 0
  for (const task of done) {
    const expected = Number(task.expectedAt) || 0
    if (!expected) continue
    const slack = Number(task.endAt) - expected
    if (slack < 0) early += 1
    else if (slack === 0) onTime += 1
    else late += 1
  }
  const cycles = done
    .filter((task) => Number(task.startAt) > 0)
    .map((task) => (Number(task.endAt) - Number(task.startAt)) / DAY)
    .sort((a, b) => a - b)
  const pick = (p) => (cycles.length ? cycles[Math.min(cycles.length - 1, Math.floor(cycles.length * p))] : null)
  /* 中位数按真中位算（偶数个取中间两个的均值），和「周期」这种连续性指标更贴合。 */
  const median = cycles.length
    ? cycles.length % 2 === 1
      ? cycles[(cycles.length - 1) / 2]
      : (cycles[cycles.length / 2 - 1] + cycles[cycles.length / 2]) / 2
    : null
  return {
    completed: done.length,
    early,
    onTime,
    late,
    cycleSamples: cycles.length,
    cycleMedianDays: median,
    cycleP85Days: pick(0.85),
  }
}

/** 承诺风险：逾期未完成 / 承诺了但还没开工 / 未到期。返回精简行，供诊断 prompt 使用。 */
export function promiseRisk(tasks, now = Date.now()) {
  const open = (Array.isArray(tasks) ? tasks : []).filter(
    (task) => task && !task.done && Number(task.expectedAt) > 0,
  )
  const slim = (task) => ({
    id: task.id,
    no: Number(task.no) || 0,
    title: asText(task.title),
    expectedAt: Number(task.expectedAt),
    days: Math.round(((now - Number(task.expectedAt)) / DAY) * 10) / 10,
  })
  return {
    overdue: open.filter((task) => now > Number(task.expectedAt)).map(slim),
    notStarted: open.filter((task) => !task.sessionId).map(slim),
    upcoming: open.filter((task) => now <= Number(task.expectedAt)).map(slim),
  }
}
