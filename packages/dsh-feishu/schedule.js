/**
 * 时间排期：纯函数，无 IO、无第三方依赖。
 *
 * 设计见 docs/DESIGN-ai-scheduling.md §3 / §4。分工是「AI 做语义，插件做算术」：
 * 这个文件只做算术——把时间意图编译成确定的 spec、算下一次触发时刻、判定此刻该不该跑。
 *
 * 时区的处理原则（重点）：
 *   1. 一律用 Intl.DateTimeFormat 取某个时刻在目标时区的「墙钟年月日时分」，
 *      再用两次逼近把「墙钟时间」反解成 epoch ms；**不硬编码 +08:00**，
 *      也不碰 `Date` 的本地时区（测试机可能就在东八区，硬编码在 CI 上炸不出来）。
 *   2. 遇到 DST：
 *      - 重叠时刻（冬令时回拨，同一个墙钟时间出现两次）取较早的那次；
 *      - 空洞时刻（夏令时前拨，墙钟时间根本不存在）顺延到空洞结束后，
 *        例如纽约 2026-03-08 02:30 → 03:30 EDT。
 *   3. 所有对外时间都是 epoch ms（`until` / `at` 在 spec 里存 ISO 字符串，
 *      统一规范化成 UTC 形式，避免「带不带偏移」两套写法）。
 *
 * 导出的 7 个入口：
 *   TZ_DEFAULT / compileSpec / nextFireAt / evaluateSchedule / parseWhen / describeSpec / advance
 */

/** 默认时区。 */
export const TZ_DEFAULT = 'Asia/Shanghai'

const MINUTE = 60_000
const DAY = 86_400_000
/* 间隔型排期的下限：每次触发都是一条会话，比 5 分钟还密只会烧 token、没有信息量。 */
const MIN_EVERY_MINUTES = 5
const MAX_EVERY_MINUTES = 365 * 24 * 60
/** 重复类排期最多向后找这么多天（月排期 [31] 从 2 月起最长要跨一年）。 */
const MAX_SCAN_DAYS = 800
const WEEKDAY_NAMES = ['', '一', '二', '三', '四', '五', '六', '日']

/* ═══════════════════════════ 时区算术 ═══════════════════════════ */

const formatterCache = new Map()

function formatterFor(tz) {
  let f = formatterCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(tz, f)
  }
  return f
}

function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() })
    return tz.trim()
  } catch {
    return null
  }
}

function weekdayOf(civil) {
  const wd = new Date(Date.UTC(civil.y, civil.mo - 1, civil.d)).getUTCDay()
  return wd === 0 ? 7 : wd
}

/** 某个 epoch ms 在 tz 里的墙钟年月日时分秒。 */
function zoneParts(ts, tz) {
  const parts = formatterFor(tz).formatToParts(new Date(ts))
  const out = { y: 1970, mo: 1, d: 1, h: 0, mi: 0, s: 0 }
  for (const part of parts) {
    const n = Number(part.value)
    switch (part.type) {
      case 'year':
        out.y = n
        break
      case 'month':
        out.mo = n
        break
      case 'day':
        out.d = n
        break
      case 'hour':
        out.h = n === 24 ? 0 : n
        break
      case 'minute':
        out.mi = n
        break
      case 'second':
        out.s = n
        break
      default:
        break
    }
  }
  return out
}

/** tz 在 ts 这一刻的 UTC 偏移（毫秒，东八区 = +8h）。 */
function offsetAt(ts, tz) {
  const p = zoneParts(ts, tz)
  const base = Math.floor(ts / 1000) * 1000
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - base
}

/**
 * 墙钟 → epoch ms。两次逼近后校验：
 *   - 校验通过：说明这个墙钟时间存在（重叠时取较早那次）；
 *   - 校验不通过：墙钟时间落在 DST 空洞里，顺延到空洞之后。
 */
function wallToTs(civil, tz) {
  const target = Date.UTC(civil.y, civil.mo - 1, civil.d, civil.h || 0, civil.mi || 0, civil.s || 0)
  const off0 = offsetAt(target, tz)
  const ts1 = target - off0
  const off1 = offsetAt(ts1, tz)
  if (off1 === off0) return ts1
  const ts2 = target - off1
  if (offsetAt(ts2, tz) === off1) return ts2
  // DST 空洞：用前拨之前的偏移落到空洞之后（02:30 → 03:30）。
  return ts1
}

function addDaysCivil(civil, n) {
  const t = new Date(Date.UTC(civil.y, civil.mo - 1, civil.d) + n * DAY)
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

function lastDayOfMonth(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function clockText(clock) {
  const head = `${pad2(clock.h)}:${pad2(clock.mi)}`
  return clock.s ? `${head}:${pad2(clock.s)}` : head
}

function noonClock(ts, tz) {
  const p = zoneParts(ts, tz)
  return `${pad2(p.h)}:${pad2(p.mi)}`
}

function dayText(ts, tz) {
  const p = zoneParts(ts, tz)
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`
}

function trimFix(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
}

/** 一分钟精度的「人话时长」：'30 分钟' / '2 小时' / '1 天'。 */
function humanDelay(ms) {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / MINUTE))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = minutes / 60
  if (hours < 24) return `${trimFix(hours)} 小时`
  return `${trimFix(hours / 24)} 天`
}

/* ═══════════════════════════ 基础解析 ═══════════════════════════ */

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 中文数字 / 阿拉伯数字 → number；认不出返回 NaN。'半' 交给调用方。 */
function cnNumber(value) {
  const text = String(value ?? '').trim()
  if (!text) return NaN
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  if (text === '十') return 10
  if (/^十[一二三四五六七八九]$/.test(text)) return 10 + CN_DIGITS[text[1]]
  if (/^[一二三四五六七八九]十$/.test(text)) return CN_DIGITS[text[0]] * 10
  if (/^[一二三四五六七八九]十[一二三四五六七八九]$/.test(text)) {
    return CN_DIGITS[text[0]] * 10 + CN_DIGITS[text[2]]
  }
  if (/^[零一二两三四五六七八九]$/.test(text)) return CN_DIGITS[text]
  return NaN
}

function normalizeClock(h, mi, s = 0, maxHour = 23) {
  const hh = Number(h)
  const mm = Number(mi)
  const ss = Number(s) || 0
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > maxHour) return null
  if (mm < 0 || mm > 59) return null
  if (ss < 0 || ss > 59) return null
  return { h: hh, mi: mm, s: ss }
}

/** 'HH:mm' / 'H:mm:ss' / '9点' / '9点30' / '三点半' → {h,mi,s}。整串必须就是一个时刻。 */
function parseClockStrict(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const hm = text.match(/^(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?$/)
  if (hm) return normalizeClock(+hm[1], +hm[2], hm[3] ? +hm[3] : 0)
  const dj = text.match(
    /^([0-9]{1,2}|[零一二两三四五六七八九十]{1,3})\s*(?:点|时)\s*(半|[0-9]{1,2}|[零一二两三四五六七八九十]{1,3})?\s*分?$/,
  )
  if (dj) {
    const h = cnNumber(dj[1])
    if (!Number.isFinite(h)) return null
    let mi = 0
    if (dj[2] === '半') mi = 30
    else if (dj[2]) {
      mi = cnNumber(dj[2])
      if (!Number.isFinite(mi)) return null
    }
    return normalizeClock(h, mi, 0, 24)
  }
  return null
}

/** 在一段文字里找第一个时刻（HH:mm 优先，其次 点/时 形式）。 */
function findClock(text) {
  const raw = String(text ?? '')
  const hm = raw.match(/(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?/)
  if (hm) {
    const clock = normalizeClock(+hm[1], +hm[2], hm[3] ? +hm[3] : 0)
    if (clock) return clock
  }
  const dj = raw.match(
    /(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*(?:点|时)\s*(半|[0-9]{1,2}|[零一二两三四五六七八九十]{1,3})?\s*分?/,
  )
  if (dj) {
    const h = cnNumber(dj[1])
    if (!Number.isFinite(h)) return null
    let mi = 0
    if (dj[2] === '半') mi = 30
    else if (dj[2]) {
      mi = cnNumber(dj[2])
      if (!Number.isFinite(mi)) return null
    }
    return normalizeClock(h, mi, 0, 24)
  }
  return null
}

const PART_WORDS = ['凌晨', '清晨', '早上', '早晨', '上午', '中午', '下午', '傍晚', '晚上', '夜里', '夜间', '早', '晚']

function clockPartOf(text) {
  for (const word of PART_WORDS) {
    if (String(text ?? '').includes(word)) return word
  }
  return null
}

/** 时段词 → 24 小时制小时。 */
function applyClockPart(h, part) {
  if (!part) return h
  if (part === '中午') return h < 11 ? h + 12 : h
  if (part === '下午' || part === '傍晚' || part === '晚上' || part === '晚' || part === '夜里' || part === '夜间') {
    return h < 12 ? h + 12 : h
  }
  // 凌晨 / 清晨 / 早上 / 早晨 / 上午 / 早
  return h === 12 ? 0 : h
}

/** 从一段文字里解析「时刻」，含时段词（下午三点半 → 15:30）。 */
function parseTimePhrase(text) {
  const raw = String(text ?? '')
  const part = clockPartOf(raw)
  let rest = raw
  if (part) rest = rest.replace(part, ' ')
  const clock = findClock(rest)
  if (!clock) return null
  const h = applyClockPart(clock.h, part)
  if (h > 24) return null
  return { h, mi: clock.mi, s: clock.s, part }
}

const WEEKDAY_EN = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
}

const CN_WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 七: 7 }

/** 单个星期值 → 1..7；认不出返回 null。 */
function readWeekdayOne(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 1 && value <= 7 ? Math.trunc(value) : null
  }
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return null
  if (/^[1-7]$/.test(text)) return Number(text)
  if (WEEKDAY_EN[text]) return WEEKDAY_EN[text]
  if (/^7$/.test(text)) return 7
  const m = text.match(/^(?:\d|周|星期|礼拜)?([一二三四五六七日天])$/)
  if (m) return CN_WEEKDAY[m[1]]
  return null
}

/** weekdays 宽松输入 → {days:[1,3], bad:[...]}；null 表示没给。 */
function readWeekdays(value) {
  if (value == null || value === '') return null
  const flat = []
  const push = (item) => {
    if (Array.isArray(item)) {
      for (const one of item) push(one)
      return
    }
    if (typeof item === 'string') {
      /* 「周一三五」「一和三」都要拆开：只认第一个的话会被静默降级成一次性
         （历史 bug：每周一三五 9:00 变成了「下周一 09:00 一次性」）。 */
      for (const piece of item.split(/[,、，;；\/|和及与]+/)) {
        const compact = piece.replace(/^(?:周|星期|礼拜)/, '')
        if (compact.length > 1 && /^[一二三四五六七日天]+$/.test(compact)) {
          for (const ch of compact) flat.push(ch)
        } else {
          flat.push(piece)
        }
      }
      return
    }
    flat.push(item)
  }
  push(value)
  const days = []
  const bad = []
  for (const item of flat) {
    if (item == null) continue
    const text = String(item).trim()
    if (!text) continue
    const one = readWeekdayOne(text)
    if (one == null) bad.push(text)
    else if (!days.includes(one)) days.push(one)
  }
  days.sort((a, b) => a - b)
  return { days, bad }
}

/** monthDays 宽松输入 → {days:[1,15], bad:[...]}；null 表示没给。 */
function readMonthDays(value) {
  if (value == null || value === '') return null
  const flat = []
  const push = (item) => {
    if (Array.isArray(item)) {
      for (const one of item) push(one)
      return
    }
    if (typeof item === 'string') {
      for (const piece of item.split(/[,、，;；\/|]+/)) flat.push(piece)
      return
    }
    flat.push(item)
  }
  push(value)
  const days = []
  const bad = []
  for (const item of flat) {
    if (item == null) continue
    const text = String(item).replace(/[日号]/g, '').trim()
    if (!text) continue
    const n = cnNumber(text)
    if (Number.isFinite(n) && n >= 1 && n <= 31) {
      const day = Math.trunc(n)
      if (!days.includes(day)) days.push(day)
    } else {
      bad.push(String(item).trim())
    }
  }
  days.sort((a, b) => a - b)
  return { days, bad }
}

/* ═══════════════════════════ 时刻 / 区间 ═══════════════════════════ */

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
const CIVIL_DATETIME = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/

/**
 * 绝对时刻的宽松输入 → epoch ms。
 * opts.endOfDay：只有日期时取当天 23:59:59（`until` 的语义「到这一天为止」）。
 */
function readInstant(value, tz, opts = {}) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isFinite(t) ? t : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'object') {
    if ('ts' in value) return readInstant(value.ts, tz, opts)
    if ('at' in value) return readInstant(value.at, tz, opts)
    return null
  }
  const text = String(value).trim()
  if (!text) return null
  if (/^\d{10,}$/.test(text)) return Number(text)
  if (ISO_WITH_ZONE.test(text)) {
    const t = Date.parse(text)
    return Number.isFinite(t) ? t : null
  }
  const m = text.match(CIVIL_DATETIME)
  if (m) {
    const y = +m[1]
    const mo = +m[2]
    const d = +m[3]
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    const hasTime = m[4] != null
    const h = hasTime ? +m[4] : opts.endOfDay ? 23 : 0
    const mi = hasTime ? +m[5] : opts.endOfDay ? 59 : 0
    const s = hasTime ? (m[6] ? +m[6] : 0) : opts.endOfDay ? 59 : 0
    return wallToTs({ y, mo, d, h, mi, s }, tz)
  }
  return null
}

function clockToMinutes(text) {
  const clock = parseClockStrict(String(text ?? '').replace(/\s+/g, ''))
  return clock ? clock.h * 60 + clock.mi : null
}

function windowEdges(value) {
  if (value == null) return null
  let start
  let end
  if (Array.isArray(value)) {
    if (value.length < 2) return null
    ;[start, end] = value
  } else if (typeof value === 'object') {
    start = value.start ?? value.from
    end = value.end ?? value.to
  } else if (typeof value === 'string') {
    const pieces = value.split(/\s*[-~～—至到]\s*/)
    if (pieces.length < 2) return null
    ;[start, end] = pieces
  } else {
    return null
  }
  const a = clockToMinutes(start)
  const b = clockToMinutes(end)
  if (a == null || b == null) return null
  return { start: a, end: b, text: [minutesToClock(a), minutesToClock(b)] }
}

function minutesToClock(minutes) {
  const m = ((Math.trunc(minutes) % 1440) + 1440) % 1440
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

/** quiet 宽松输入（单对 / 多对 / 字符串 / 对象）→ [[ '12:00','13:30' ], ...]；null 表示没给。 */
function readQuiet(value) {
  if (value == null || value === '') return null
  const pairs = []
  const addOne = (item) => {
    const edges = windowEdges(item)
    if (edges) pairs.push(edges.text)
  }
  if (typeof value === 'string') {
    for (const piece of value.split(/[,，;；]+/)) {
      if (piece.trim()) addOne(piece.trim())
    }
  } else if (Array.isArray(value)) {
    const looksLikePair =
      value.length === 2 &&
      value.every((one) => typeof one === 'string' || (one && typeof one === 'object' && !Array.isArray(one)))
    if (looksLikePair && value.every((one) => typeof one === 'string') && value.some((one) => /\d/.test(one))) {
      const edges = windowEdges(value)
      if (edges) pairs.push(edges.text)
    } else {
      for (const item of value) addOne(item)
    }
  } else if (typeof value === 'object') {
    addOne(value)
  }
  return pairs.length ? pairs : null
}

const MISS_DELAY = /^(delay|grace|catch-?up|补跑|宽限|顺延|补)$/
const MISS_SKIP = /^(skip|drop|跳过|放弃|丢弃)$/
const MISS_NEXT = /^(next|advance|jump|下一次|下一个|跳到下一次|跳)$/

function readMissPolicy(value) {
  if (value == null || value === '') return null
  const text = String(value).trim().toLowerCase()
  if (!text) return null
  if (MISS_DELAY.test(text)) return 'delay'
  if (MISS_SKIP.test(text)) return 'skip'
  if (MISS_NEXT.test(text)) return 'next'
  return undefined // 明确给了但不认识
}

function readKind(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return null
  if (/^(at|once|one|one-?off|one-?time|absolute|time|时刻|一次|定点|准时)$/.test(text)) return 'at'
  if (/^(daily|day|every-?day|每天|每日|天天)$/.test(text)) return 'daily'
  if (/^(workdays?|weekdays?|工作日|每个工作日|上班日)$/.test(text)) return 'workdays'
  if (/^(weekly|week|every-?week|每周|每星期|每个星期)$/.test(text)) return 'weekly'
  if (/^(monthly|month|every-?month|每月|每个月)$/.test(text)) return 'monthly'
  /* 间隔型：没有固定钟点，只有步长（everyMinutes）。「每隔一小时」就落在这里。 */
  if (/^(interval|every-?x?|step|repeat|fixed-?rate|间隔|每隔|每)$/.test(text)) return 'interval'
  return null
}

/* 「每 1 小时 / 30m / 2h」这类步长字段：数字 + 单位，或纯数字（分钟）。 */
function readEveryMinutes(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null
  const text = String(value).trim().toLowerCase()
  const m = /^([0-9]+(?:\.[0-9]+)?|[零一二两三四五六七八九十半]+)\s*(分钟|分|小时|钟头|钟|min|mins|minute|minutes|h|hr|hrs|hour|hours|m)?$/.exec(text)
  if (!m) return null
  const amount = amountOf(m[1])
  const unit = m[2] ? unitMinutes(m[2].replace(/^min.*/, '分').replace(/^h.*/, '小时')) : 1
  if (!Number.isFinite(amount) || !unit) return null
  const minutes = Math.round(amount * unit)
  return minutes > 0 ? minutes : null
}

function readAnchor(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'due' || text === '截止' || text === '到期') return 'due'
  if (text === 'start' || text === '开始' || text === '开工') return 'start'
  if (text === 'created' || text === '创建' || text === '建单') return 'created'
  return null
}

/* ═══════════════════════════ compileSpec ═══════════════════════════ */

function defaultOpts(opts = {}) {
  const now = Number(opts.now)
  return {
    now: Number.isFinite(now) ? now : Date.now(),
    tz: validTimeZone(opts.tz) || TZ_DEFAULT,
  }
}

/**
 * 宽松输入 → 规范 spec，错误全部收进 errors（不抛异常）。
 * 返回 {spec, errors}；spec.kind 为 null 表示连 kind 都没认出来。
 */
function buildSpec(input, opts = {}) {
  const base = defaultOpts(opts)
  const errors = []
  const src = (() => {
    if (input && typeof input === 'object' && !Array.isArray(input)) return input
    if (typeof input === 'string' && input.trim()) {
      const parsed = parseWhen(input, { tz: base.tz, now: base.now })
      if (parsed.ok) return parsed.spec
      errors.push(parsed.error || '无法从文字里解析出时间')
      return {}
    }
    return {}
  })()

  const tz = (() => {
    if (src.tz == null || src.tz === '') return base.tz
    const picked = validTimeZone(src.tz)
    if (!picked) errors.push(`时区不认识：${src.tz}`)
    return picked || base.tz
  })()

  const kind = readKind(src.kind)
  if (!kind) {
    errors.push(src.kind == null || src.kind === '' ? '缺少 kind（at / interval / daily / workdays / weekly / monthly）' : `kind 不认识：${src.kind}`)
  }

  const spec = { kind }

  if (kind === 'at') {
    const atTs = readInstant(src.at, tz)
    if (src.at != null && src.at !== '' && atTs == null) errors.push(`at 无法解析：${src.at}`)
    if (atTs != null) {
      spec.at = new Date(atTs).toISOString()
    } else if (src.anchor != null && src.anchor !== '') {
      const anchor = readAnchor(src.anchor)
      if (!anchor) {
        errors.push(`anchor 不认识：${src.anchor}（due / start / created）`)
      } else {
        let offset = 0
        if (src.offsetMinutes != null && src.offsetMinutes !== '') {
          const n = Number(src.offsetMinutes)
          if (!Number.isFinite(n)) errors.push(`offsetMinutes 不是数字：${src.offsetMinutes}`)
          else offset = Math.round(n)
        }
        spec.anchor = anchor
        spec.offsetMinutes = offset
      }
    } else if (src.at == null || src.at === '') {
      errors.push('kind=at 需要 at（绝对时刻）或 anchor + offsetMinutes')
    }
  } else if (kind === 'interval') {
    /* 间隔型只认步长：从「上一次触发（没有就创建时刻）」往后推 everyMinutes。 */
    const minutes = readEveryMinutes(src.everyMinutes ?? src.every ?? src.interval ?? src.step)
    if (minutes == null) errors.push('kind=interval 需要 everyMinutes（分钟数，比如 60 = 每小时）')
    else if (minutes < MIN_EVERY_MINUTES) errors.push(`间隔太短：${minutes} 分钟（至少 ${MIN_EVERY_MINUTES} 分钟）`)
    else if (minutes > MAX_EVERY_MINUTES) errors.push(`间隔太长：${minutes} 分钟（最多 ${MAX_EVERY_MINUTES} 分钟）`)
    else spec.everyMinutes = minutes
  } else if (kind) {
    const time = readTimeOfDayField(src.time)
    if (time) spec.time = time.text
    else if (src.time == null || src.time === '') errors.push(`kind=${kind} 需要 time（HH:mm）`)
    else errors.push(`time 无法解析：${src.time}（要 HH:mm 或 HH:mm:ss）`)

    if (kind === 'weekly') {
      const wd = readWeekdays(src.weekdays)
      if (!wd || wd.days.length === 0) errors.push('kind=weekly 需要 weekdays（1=周一 … 7=周日）')
      if (wd?.bad.length) errors.push(`weekdays 有认不出的值：${wd.bad.join('、')}`)
      if (wd?.days.length) spec.weekdays = wd.days
    }
    if (kind === 'monthly') {
      const md = readMonthDays(src.monthDays ?? src.monthDay)
      if (!md || md.days.length === 0) errors.push('kind=monthly 需要 monthDays（1..31）')
      if (md?.bad.length) errors.push(`monthDays 有认不出的值：${md.bad.join('、')}`)
      if (md?.days.length) spec.monthDays = md.days
    }
  }

  // window
  if (src.window != null && src.window !== '') {
    const edges = windowEdges(src.window)
    if (!edges) errors.push(`window 无法解析：${JSON.stringify(src.window)}（要 ["09:00","19:00"]）`)
    else if (edges.start === edges.end) errors.push('window 的起止时间不能相同')
    else spec.window = edges.text
  }

  // quiet
  if (src.quiet != null && src.quiet !== '') {
    const quiet = readQuiet(src.quiet)
    if (!quiet) errors.push(`quiet 无法解析：${JSON.stringify(src.quiet)}（要 [["12:00","13:30"]]）`)
    else spec.quiet = quiet
  }

  // missPolicy
  const policy = readMissPolicy(src.missPolicy)
  if (policy === undefined) errors.push(`missPolicy 不认识：${src.missPolicy}（delay / skip / next）`)
  spec.missPolicy = policy || 'delay'

  // graceMinutes
  let grace = 30
  if (src.graceMinutes != null && src.graceMinutes !== '') {
    const n = Number(src.graceMinutes)
    if (!Number.isFinite(n) || n < 0) errors.push(`graceMinutes 不合法：${src.graceMinutes}`)
    else grace = Math.round(n)
  }
  spec.graceMinutes = grace

  // until
  if (src.until != null && src.until !== '') {
    const untilTs = readInstant(src.until, tz, { endOfDay: true })
    if (untilTs == null) errors.push(`until 无法解析：${src.until}`)
    else spec.until = new Date(untilTs).toISOString()
  }

  // maxRuns
  if (src.maxRuns != null && src.maxRuns !== '') {
    const n = Number(src.maxRuns)
    if (!Number.isFinite(n) || n < 1) errors.push(`maxRuns 不合法：${src.maxRuns}`)
    else spec.maxRuns = Math.min(Math.trunc(n), 1_000_000)
  }

  if (src.note != null && String(src.note).trim()) spec.note = String(src.note).trim()
  spec.tz = tz

  // 键顺序稳定，便于面板/测试比对
  const ordered = { kind: spec.kind, tz: spec.tz }
  for (const key of [
    'at',
    'anchor',
    'offsetMinutes',
    'everyMinutes',
    'time',
    'weekdays',
    'monthDays',
    'window',
    'quiet',
    'missPolicy',
    'graceMinutes',
    'until',
    'maxRuns',
    'note',
  ]) {
    if (spec[key] !== undefined) ordered[key] = spec[key]
  }
  return { spec: ordered, errors }
}

function readTimeOfDayField(value) {
  if (value == null || value === '') return null
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const clock = normalizeClock(value.h ?? value.hour, value.mi ?? value.minute ?? 0, value.s ?? value.second ?? 0)
    if (!clock) return null
    return { ...clock, text: clockText(clock) }
  }
  const clock = parseClockStrict(value)
  if (!clock || clock.h > 23) return null
  return { ...clock, text: clockText(clock) }
}

/** 运行时用的宽松规范化：认不出来就返回 null（不报错）。 */
function runtimeSpec(input, opts = {}) {
  if (input == null) return null
  const { spec } = buildSpec(input, opts)
  return spec.kind ? spec : null
}

/**
 * 宽松输入 → 规范 spec。错误一次全给，不抛异常。
 *
 * @param {object|string} input 原始 spec（字段可以是字符串/中文）
 * @param {{tz?: string, now?: number}} [opts]
 * @returns {{ok: boolean, spec?: object, errors: string[]}}
 */
/** 给履约模块复用：epoch ms → 目标时区的墙钟部件（y/mo/d/h/mi/s）。 */
export function zonedParts(ts, tz = TZ_DEFAULT) {
  return zoneParts(Number(ts) || 0, tz || TZ_DEFAULT)
}

/** 给履约模块复用：目标时区的墙钟时间 → epoch ms（处理 DST 空洞/重叠）。 */
export function zonedTimestamp(civil, tz = TZ_DEFAULT) {
  return wallToTs(civil, tz || TZ_DEFAULT)
}

export function compileSpec(input, opts = {}) {
  const { spec, errors } = buildSpec(input, opts)
  if (errors.length) return { ok: false, errors }
  return { ok: true, spec, errors: [] }
}

/* ═══════════════════════════ 下一次触发 ═══════════════════════════ */

function resolveAt(spec, opts = {}) {
  if (spec.at) {
    const ts = Date.parse(spec.at)
    return Number.isFinite(ts) ? ts : null
  }
  if (spec.anchor) {
    const anchorTs = Number(opts.anchorTs)
    if (!Number.isFinite(anchorTs)) return null
    return anchorTs + (Number(spec.offsetMinutes) || 0) * MINUTE
  }
  return null
}

function dayAt(civil, minutes, tz) {
  return wallToTs(
    { y: civil.y, mo: civil.mo, d: civil.d, h: Math.floor(minutes / 60), mi: minutes % 60, s: 0 },
    tz,
  )
}

function inWindow(minutes, start, end) {
  if (start <= end) return minutes >= start && minutes <= end
  return minutes >= start || minutes <= end
}

function inQuiet(minutes, start, end) {
  if (start <= end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end
}

/** 把落在窗口外/免打扰里的时刻往后推，直到合法（或推不动）。 */
function resolveAllowed(raw, spec, tz) {
  let cur = raw
  let deferredBy = 0
  let defer = null
  const edges = spec.window ? windowEdges(spec.window) : null
  const quiet = Array.isArray(spec.quiet)
    ? spec.quiet.map((pair) => windowEdges(pair)).filter(Boolean)
    : []
  for (let guard = 0; guard < 8; guard += 1) {
    const p = zoneParts(cur, tz)
    const minutes = p.h * 60 + p.mi
    let next = null
    if (edges && !inWindow(minutes, edges.start, edges.end)) {
      let civil = p
      if (edges.start <= edges.end) {
        // 普通窗口：比起点早 → 当天起点；比终点晚 → 次日起点
        if (minutes > edges.end) civil = addDaysCivil(p, 1)
      }
      next = { ts: dayAt(civil, edges.start, tz), kind: 'window' }
    } else {
      for (const span of quiet) {
        if (!inQuiet(minutes, span.start, span.end)) continue
        let civil = p
        if (span.start > span.end && minutes >= span.start) civil = addDaysCivil(p, 1)
        next = { ts: dayAt(civil, span.end, tz), kind: 'quiet' }
        break
      }
    }
    if (!next) break
    cur = next.ts
    deferredBy = cur - raw
    defer = next
  }
  return { ts: cur, deferredBy, defer }
}

function dayMatches(spec, civil) {
  const wd = weekdayOf(civil)
  switch (spec.kind) {
    case 'daily':
      return true
    case 'workdays':
      return wd >= 1 && wd <= 5
    case 'weekly':
      return Array.isArray(spec.weekdays) && spec.weekdays.includes(wd)
    case 'monthly':
      return Array.isArray(spec.monthDays) && spec.monthDays.includes(civil.d)
    default:
      return false
  }
}

/**
 * 找 after 之后（严格大于）的第一个触发点。
 * 返回 {ts, deferredBy, defer} / null。
 */
function firstFire(spec, afterTs, opts = {}) {
  const tz = spec.tz || TZ_DEFAULT
  const untilTs = spec.until ? Date.parse(spec.until) : null
  if (Number.isFinite(untilTs) && afterTs >= untilTs) return null
  const runs = Math.max(0, Number(opts.runs) || 0)
  if (spec.maxRuns && runs >= spec.maxRuns) return null

  if (spec.kind === 'at') {
    const raw = resolveAt(spec, opts)
    if (raw == null) return null
    const hit = resolveAllowed(raw, spec, tz)
    if (hit.ts <= afterTs) return null
    if (Number.isFinite(untilTs) && hit.ts > untilTs) return null
    return hit
  }

  /* 间隔型：从 after 起往后推一个步长。after 由调用方给（上次触发 / 创建时刻 / 现在），
     所以「每隔一小时」的相位锚在创建那一刻，不会因为 DSH 重启漂移。 */
  if (spec.kind === 'interval') {
    const step = Math.round(Number(spec.everyMinutes) || 0) * MINUTE
    if (!step) return null
    const hit = resolveAllowed(afterTs + step, spec, tz)
    if (Number.isFinite(untilTs) && hit.ts > untilTs) return null
    return hit
  }

  const clock = spec.time ? parseClockStrict(spec.time) : null
  if (!clock || clock.h > 23) return null

  let cursor = addDaysCivil(zoneParts(afterTs, tz), -1)
  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    const civil = addDaysCivil(cursor, i)
    if (!dayMatches(spec, civil)) continue
    if (Number.isFinite(untilTs)) {
      const dayStart = wallToTs({ y: civil.y, mo: civil.mo, d: civil.d, h: 0, mi: 0, s: 0 }, tz)
      if (dayStart > untilTs) return null
    }
    const raw = wallToTs({ y: civil.y, mo: civil.mo, d: civil.d, h: clock.h, mi: clock.mi, s: clock.s }, tz)
    const hit = resolveAllowed(raw, spec, tz)
    if (hit.ts <= afterTs) continue
    if (Number.isFinite(untilTs) && hit.ts > untilTs) continue
    return hit
  }
  return null
}

/**
 * 下一次触发时刻（epoch ms）；不会再触发返回 null。
 *
 * 宽松接受 `nextFireAt(spec, after)` / `nextFireAt(spec, after, {runs, anchorTs, tz})` /
 * `nextFireAt(spec, {after, runs, anchorTs})`。
 */
export function nextFireAt(spec, after = Date.now(), opts = {}) {
  let options = opts
  let afterTs = Number(after)
  if (after && typeof after === 'object') {
    options = { ...after }
    afterTs = Number(after.after ?? after.now ?? Date.now())
  }
  const normalized = runtimeSpec(spec, options)
  if (!normalized) return null
  if (!Number.isFinite(afterTs)) afterTs = Date.now()
  const hit = firstFire(normalized, afterTs, options)
  return hit ? hit.ts : null
}

/* ═══════════════════════════ 触发判定 ═══════════════════════════ */

const EMPTY_VERDICT = { fire: false, reason: '', nextAt: null, waitMs: 0, late: 0, deferredBy: 0 }

function graceOf(spec, opts) {
  const ms = Number(opts.graceMs)
  if (Number.isFinite(ms) && ms >= 0) return ms
  const minutes = Number(spec.graceMinutes)
  if (Number.isFinite(minutes) && minutes >= 0) return minutes * MINUTE
  return 30 * MINUTE
}

/**
 * 触发判定（调度器唯一入口）。
 *
 * @param {{spec?: object, lastFiredAt?: number, runs?: number, paused?: boolean, createdAt?: number}} entry
 * @param {{now?: number, done?: boolean, started?: boolean, endTs?: number,
 *          graceMs?: number, defaultMissPolicy?: string, anchorTs?: number}} [opts]
 * @returns {{fire: boolean, reason: string, nextAt: number|null, waitMs: number, late: number, deferredBy: number}}
 */
export function evaluateSchedule(entry, opts = {}) {
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now()
  const raw = entry && typeof entry === 'object' ? entry : {}
  const rawSpec = raw.spec && typeof raw.spec === 'object' ? raw.spec : raw
  const spec = runtimeSpec(rawSpec, opts)
  const runs = Math.max(0, Number(raw.runs) || 0)
  if (!spec) return { ...EMPTY_VERDICT, reason: '排期不完整' }

  const tz = spec.tz || TZ_DEFAULT
  const parked = (reason) => {
    const hit = firstFire(spec, now, { ...opts, runs })
    return { ...EMPTY_VERDICT, reason, nextAt: hit ? hit.ts : null, waitMs: hit ? hit.ts - now : 0 }
  }

  // 「过了任务结束时间就不再开工」优先于其它判定：调用方（index.js）依赖这一条。
  const endTs = Number(opts.endTs)
  if (Number.isFinite(endTs) && endTs > 0 && now > endTs) return { ...EMPTY_VERDICT, reason: '已过截止时间' }

  if (raw.paused) return parked('已暂停')
  if (opts.done) return { ...EMPTY_VERDICT, reason: '已完成' }
  if (opts.started) return { ...EMPTY_VERDICT, reason: '已开工' }

  const untilTs = spec.until ? Date.parse(spec.until) : null
  if (Number.isFinite(untilTs) && now >= untilTs) return { ...EMPTY_VERDICT, reason: '已过截止时间' }
  if (spec.maxRuns && runs >= spec.maxRuns) {
    return { ...EMPTY_VERDICT, reason: `已触发 ${spec.maxRuns} 次，不再排期` }
  }

  const lastFired = Number.isFinite(Number(raw.lastFiredAt)) && raw.lastFiredAt != null ? Number(raw.lastFiredAt) : null
  const created = Number.isFinite(Number(raw.createdAt)) && raw.createdAt != null ? Number(raw.createdAt) : null

  let target = null
  if (spec.kind === 'at') {
    const rawAt = resolveAt(spec, opts)
    if (rawAt == null) return { ...EMPTY_VERDICT, reason: '排期待定（缺少锚点时间）' }
    const hit = resolveAllowed(rawAt, spec, tz)
    if (lastFired != null && lastFired >= hit.ts - 500) return { ...EMPTY_VERDICT, reason: '已触发过' }
    if (runs > 0) return { ...EMPTY_VERDICT, reason: '已触发过' }
    target = hit
  } else {
    const since = lastFired ?? created ?? now
    const hit = firstFire(spec, since, { ...opts, runs })
    if (!hit) return { ...EMPTY_VERDICT, reason: '排期已结束' }
    target = hit
  }

  const dueAt = target.ts
  const deferredBy = target.deferredBy || 0
  const deferKind = target.defer ? target.defer.kind : null
  const late = now - dueAt

  if (late < 0) {
    const reason =
      deferKind === 'quiet'
        ? `免打扰推迟到 ${noonClock(dueAt, tz)}`
        : deferKind === 'window'
          ? `不在工作时段，推迟到 ${noonClock(dueAt, tz)}`
          : '未到点'
    return { fire: false, reason, nextAt: dueAt, waitMs: dueAt - now, late: 0, deferredBy }
  }

  const explicitPolicy =
    rawSpec && typeof rawSpec === 'object' && rawSpec.missPolicy != null ? rawSpec.missPolicy : null
  const policy = readMissPolicy(explicitPolicy) || readMissPolicy(opts.defaultMissPolicy) || 'delay'
  const graceMs = graceOf(spec, opts)

  if (late <= graceMs) {
    const after = spec.kind === 'at' ? null : firstFire(spec, dueAt, { ...opts, runs: runs + 1 })
    return { fire: true, reason: '到点', nextAt: after ? after.ts : null, waitMs: 0, late, deferredBy }
  }

  const slept = humanDelay(late)
  const reason =
    policy === 'skip'
      ? `机器睡了 ${slept}，按 skip 跳过`
      : policy === 'next'
        ? `机器睡了 ${slept}，按 next 跳到下一次`
        : `机器睡了 ${slept}，超过 ${humanDelay(graceMs)}宽限，跳过`
  const after = spec.kind === 'at' ? null : firstFire(spec, now, { ...opts, runs })
  return {
    fire: false,
    reason,
    nextAt: after ? after.ts : null,
    waitMs: after ? after.ts - now : 0,
    late,
    deferredBy,
  }
}

/* ═══════════════════════════ parseWhen ═══════════════════════════ */

const CLOCK_TOKEN = '(?:[0-9]{1,2}:[0-9]{2}|[0-9]{1,2}\\s*点(?:半|[0-9]{1,2}\\s*分?)?)'
const RANGE_SEP = '[-~～—至到]'

function endOfDayTs(civil, tz) {
  return wallToTs({ y: civil.y, mo: civil.mo, d: civil.d, h: 23, mi: 59, s: 59 }, tz)
}

function extractUntil(body, tz, now) {
  const re = new RegExp(
    `(?:直到|截至|截止到|到|至)\\s*(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}\\s*月\\s*(?:底|\\d{1,2}\\s*[日号])|本月底|月底|年底|年末)`,
  )
  const m = body.match(re)
  if (!m) return null
  const token = m[1].replace(/\s+/g, '')
  const today = zoneParts(now, tz)
  const build = (y) => {
    if (/^\d{4}/.test(token)) {
      return endOfDayTs({ y: +token.slice(0, 4), mo: +token.slice(5, 7) || 1, d: +token.slice(8, 10) || 1 }, tz)
    }
    // '12月底' 必须先按「几月」解析，否则会被下面的「月底=本月」吃掉
    const md = token.match(/^(\d{1,2})月(底|(\d{1,2})[日号])$/)
    if (md) {
      const mo = +md[1]
      if (mo < 1 || mo > 12) return null
      const d = md[2] === '底' ? lastDayOfMonth(y, mo) : +md[3]
      return endOfDayTs({ y, mo, d }, tz)
    }
    if (/年底|年末/.test(token)) return endOfDayTs({ y, mo: 12, d: 31 }, tz)
    if (/月底/.test(token)) return endOfDayTs({ y, mo: today.mo, d: lastDayOfMonth(y, today.mo) }, tz)
    return null
  }
  let ts = build(today.y)
  if (ts == null) return null
  if (ts <= now) {
    const next = build(today.y + 1)
    if (next != null) ts = next
  }
  return { ts, rest: body.replace(m[0], ' ') }
}

function extractWindow(body) {
  const re = new RegExp(`(?:只在|仅在|限)\\s*(${CLOCK_TOKEN})\\s*${RANGE_SEP}\\s*(${CLOCK_TOKEN})\\s*(?:之间|之内|以内|内)?`)
  const m = body.match(re)
  if (m) {
    const a = parseClockStrict(m[1].replace(/\s+/g, ''))
    const b = parseClockStrict(m[2].replace(/\s+/g, ''))
    if (a && b) return { window: [minutesToClock(a.h * 60 + a.mi), minutesToClock(b.h * 60 + b.mi)], rest: body.replace(m[0], ' ') }
  }
  const relaxed = body.match(/只在?\s*(?:工作时段|上班时间|工作时间)/)
  if (relaxed) return { window: ['09:00', '19:00'], rest: body.replace(relaxed[0], ' ') }
  return null
}

function extractQuiet(body) {
  const looksQuiet = /午休|午间|中午休息/.test(body)
  const hasWords = /别打扰|勿扰|不打扰|免打扰|别叫|别吵/.test(body)
  const re = new RegExp(`(?:免打扰|勿扰|别打扰|不要打扰|别叫)\\s*(${CLOCK_TOKEN})\\s*${RANGE_SEP}\\s*(${CLOCK_TOKEN})`)
  let m = body.match(re)
  if (m) {
    const a = parseClockStrict(m[1].replace(/\s+/g, ''))
    const b = parseClockStrict(m[2].replace(/\s+/g, ''))
    if (a && b) {
      return { quiet: [[minutesToClock(a.h * 60 + a.mi), minutesToClock(b.h * 60 + b.mi)]], rest: body.replace(m[0], ' ') }
    }
  }
  const reBefore = new RegExp(`(${CLOCK_TOKEN})\\s*${RANGE_SEP}\\s*(${CLOCK_TOKEN})\\s*(?:免打扰|勿扰|别打扰|不要打扰)`)
  m = body.match(reBefore)
  if (m) {
    const a = parseClockStrict(m[1].replace(/\s+/g, ''))
    const b = parseClockStrict(m[2].replace(/\s+/g, ''))
    if (a && b) {
      return { quiet: [[minutesToClock(a.h * 60 + a.mi), minutesToClock(b.h * 60 + b.mi)]], rest: body.replace(m[0], ' ') }
    }
  }
  if (looksQuiet && hasWords) {
    return { quiet: [['12:00', '13:30']], rest: body.replace(/午休|午间|中午休息/, ' ').replace(/别打扰|勿扰|不打扰|免打扰|别叫|别吵/, ' ') }
  }
  return null
}

function unitMinutes(unit) {
  if (/^分/.test(unit)) return 1
  if (/^(小时|钟头|钟)/.test(unit)) return 60
  if (/^(天|日)/.test(unit)) return 1440
  if (/^(周|星期|礼拜)/.test(unit)) return 1440 * 7
  return null
}

const AMOUNT = '([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十半]+)'
const UNIT = '(分钟|分|小时|钟头|钟|天|日|周|星期|礼拜)'

function amountOf(text) {
  if (text === '半') return 0.5
  const n = cnNumber(text)
  return Number.isFinite(n) ? n : null
}

/** 截止前 2 小时 / 提前一天 / 到期前 30 分钟 / 开工后 1 小时。 */
function parseAnchorExpression(body) {
  const dueBefore = new RegExp(`(?:截止|到期|交期|deadline|due)\\s*(?:时间)?\\s*(?:前|之前|以前)\\s*${AMOUNT}\\s*${UNIT}`).exec(body)
  if (dueBefore) {
    const n = amountOf(dueBefore[1])
    const unit = unitMinutes(dueBefore[2])
    if (n != null && unit) return { anchor: 'due', offsetMinutes: -Math.round(n * unit) }
  }
  const ahead = new RegExp(`(?:提前|提早)\\s*${AMOUNT}\\s*${UNIT}`).exec(body)
  if (ahead) {
    const n = amountOf(ahead[1])
    const unit = unitMinutes(ahead[2])
    if (n != null && unit) return { anchor: 'due', offsetMinutes: -Math.round(n * unit) }
  }
  const startAfter = new RegExp(`(?:开工|开始|启动|start)\\s*(?:后|之后|以后)\\s*${AMOUNT}\\s*${UNIT}`).exec(body)
  if (startAfter) {
    const n = amountOf(startAfter[1])
    const unit = unitMinutes(startAfter[2])
    if (n != null && unit) return { anchor: 'start', offsetMinutes: Math.round(n * unit) }
  }
  if (/(?:截止|到期)\s*时|deadline/i.test(body)) return { anchor: 'due', offsetMinutes: 0 }
  return null
}

/** 30 分钟后 / 两小时后 / 半小时后 / 一天后。 */
function parseRelativeExpression(body) {
  const trimmed = body.trim()
  if (/^(马上|立刻|立即|现在)$/.test(trimmed)) return 0
  const m = new RegExp(`^(?:再过|过|还有)?\\s*${AMOUNT}\\s*${UNIT}\\s*(?:后|之后|以后|过后|内)$`).exec(trimmed)
  if (!m) return null
  const n = amountOf(m[1])
  const unit = unitMinutes(m[2])
  if (n == null || unit == null) return null
  return Math.round(n * unit) * MINUTE
}

/** 每隔一小时 / 每小时 / 每 30 分钟 / 每半小时 / 每两小时一次。 */
/* 天/周 也收：『每两周』『每隔两天』是明确的间隔，而『每天』『每周一』必须留给重复规则。 */
const INTERVAL_UNIT = '(分钟|分|小时|钟头|钟|天|日|周|星期|礼拜)'
const INTERVAL_AMOUNT = '([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十半]+)'
function parseIntervalExpression(body) {
  /* 「每」后面必须跟得出一个步长才算间隔；『每天』『每周一』没有步长，交给重复规则。 */
  const m = new RegExp(`每\\s*(?:隔\\s*)?(?:${INTERVAL_AMOUNT}\\s*)?${INTERVAL_UNIT}\\s*(?:一次|一遍|一趟|执行一次|跑一次|提醒一次)?`).exec(body)
  if (!m) return null
  const rawAmount = m[1] == null || m[1] === '' ? null : m[1]
  const amount = rawAmount == null ? 1 : amountOf(rawAmount)
  const unit = unitMinutes(m[2])
  if (!Number.isFinite(amount) || !unit) return null
  /* 天/周：只有明确写了「两/2」以上才算间隔（『每 2 天』），否则让给 daily/weekly */
  if ((unit === 1440 || unit === 1440 * 7) && (rawAmount == null || !(amount > 1))) return null
  const minutes = Math.round(amount * unit)
  if (!(minutes >= 1)) return null
  return { everyMinutes: minutes, rest: body.replace(m[0], ' ') }
}

/** 每天 / 工作日 / 每周一、三 / 每月 1 号。 */
function parseRecurringExpression(body) {
  const weeklyRe = /每\s*(?:个)?\s*(?:周|星期|礼拜)\s*([一二三四五六七日天0-9][一二三四五六七日天0-9、,，和及]*)/
  const monthlyRe =
    /每\s*(?:个)?\s*月\s*((?:[0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*[日号]?(?:\s*[、,，和]\s*(?:[0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*[日号]?)*)/
  const workdaysRe = /每\s*个?\s*工作日|每个工作日|工作日|上班日/
  const dailyRe = /每\s*(?:天|日)|天天|每日/

  let m = body.match(monthlyRe)
  if (m) {
    const md = readMonthDays(m[1])
    if (md?.days.length) return { kind: 'monthly', monthDays: md.days, rest: body.replace(m[0], ' ') }
  }
  m = body.match(weeklyRe)
  if (m) {
    const wd = readWeekdays(m[1])
    if (wd?.days.length) return { kind: 'weekly', weekdays: wd.days, rest: body.replace(m[0], ' ') }
  }
  m = body.match(workdaysRe)
  if (m) return { kind: 'workdays', rest: body.replace(m[0], ' ') }
  m = body.match(dailyRe)
  if (m) return { kind: 'daily', rest: body.replace(m[0], ' ') }
  return null
}

const DAY_WORDS = [
  { re: /大后天/, offset: 3, hint: null },
  { re: /后天/, offset: 2, hint: null },
  { re: /明天早上|明天上午|明早|明儿早上/, offset: 1, hint: 'morning' },
  { re: /明天晚上|明晚|明儿晚上/, offset: 1, hint: 'evening' },
  { re: /明天|明日|明儿/, offset: 1, hint: null },
  { re: /今天早上|今天上午|今早/, offset: 0, hint: 'morning' },
  { re: /今天晚上|今晚|今夜/, offset: 0, hint: 'evening' },
  { re: /今天|今日|今儿/, offset: 0, hint: null },
]

/** 明天 15:00 / 今晚八点 / 下周一 9:30 / 15:00（最近的未来）。 */
function parsePointExpression(body, tz, now, opts = {}) {
  let rest = body
  let dayOffset = null
  let hint = null
  for (const word of DAY_WORDS) {
    const m = rest.match(word.re)
    if (!m) continue
    dayOffset = word.offset
    hint = word.hint
    rest = rest.replace(m[0], ' ')
    break
  }

  let weekday = null
  const wdMatch = rest.match(/(下下|下|本|这|上)?\s*(?:周|星期|礼拜)\s*([一二三四五六七日天]|[1-7])/)
  if (wdMatch) {
    weekday = readWeekdayOne(wdMatch[2])
    rest = rest.replace(wdMatch[0], ' ')
  }

  /* 「月底/月末」= 当月最后一天；「下个月5号/下月5号」= 相对月份的第几天。
     这两种都只有一种读法，不属于「猜」；「周末」有周六/周日两种，仍然不进解析。 */
  let monthEnd = false
  if (/月底|月末/.test(rest)) {
    monthEnd = true
    rest = rest.replace(/月底|月末/g, ' ')
  }
  let monthShift = 0
  let monthDayNum = null
  const relMonth = rest.match(/(下下个|下个|下)\s*个?\s*月\s*(\d{1,2}|[一二三四五六七八九十]{1,2})\s*[日号]/)
  if (relMonth) {
    monthShift = relMonth[1] === '下下个' ? 2 : 1
    const day = cnNumber(relMonth[2])
    if (Number.isFinite(day)) monthDayNum = Math.trunc(day)
    rest = rest.replace(relMonth[0], ' ')
  }

  let monthDay = null
  const dateMatch = rest.match(/(\d{1,2}|[一二三四五六七八九十]{1,2})\s*月\s*(\d{1,2}|[一二三四五六七八九十]{1,2})\s*[日号]/)
  if (dateMatch) {
    const mo = cnNumber(dateMatch[1])
    const d = cnNumber(dateMatch[2])
    if (Number.isFinite(mo) && Number.isFinite(d)) monthDay = { mo: Math.trunc(mo), d: Math.trunc(d) }
    rest = rest.replace(dateMatch[0], ' ')
  }

  const parsed = parseTimePhrase(rest)
  /* 只说了「哪一天」没说几点时的默认时刻：排期默认 09:00（开工），
     履约的预期完成传 defaultClock='18:00'（下班前）。 */
  const fallbackClock = (() => {
    const custom = opts.defaultClock ? parseTimePhrase(String(opts.defaultClock)) : null
    if (custom && !custom.part) return { h: custom.h, mi: custom.mi, s: custom.s || 0 }
    return { h: 9, mi: 0, s: 0 }
  })()
  const fallback = hint === 'evening' ? { h: 20, mi: 0, s: 0 } : hint === 'morning' ? { h: 8, mi: 0, s: 0 } : fallbackClock
  // '今晚八点'：日词被摘掉后 '八点' 自己不带时段，要沿用日词给的暗示（晚上 → +12）
  const hinted =
    parsed && !parsed.part && hint
      ? {
          ...parsed,
          h: hint === 'evening' ? (parsed.h < 12 ? parsed.h + 12 : parsed.h) : parsed.h === 12 ? 0 : parsed.h,
        }
      : parsed
  const clock = hinted || (dayOffset != null || weekday != null || monthDay || monthEnd || monthShift ? fallback : null)
  if (!clock) return null

  const today = zoneParts(now, tz)
  if (monthEnd) {
    return wallToTs({ y: today.y, mo: today.mo, d: lastDayOfMonth(today.y, today.mo), h: clock.h, mi: clock.mi, s: clock.s }, tz)
  }
  if (monthShift && monthDayNum) {
    const total = (today.y * 12) + (today.mo - 1) + monthShift
    const y = Math.floor(total / 12)
    const mo = (total % 12) + 1
    const d = Math.min(monthDayNum, lastDayOfMonth(y, mo))
    return wallToTs({ y, mo, d, h: clock.h, mi: clock.mi, s: clock.s }, tz)
  }
  if (weekday != null) {
    const todayWd = weekdayOf(today)
    const delta = (weekday - todayWd + 7) % 7
    let ts = wallToTs({ ...addDaysCivil(today, delta), h: clock.h, mi: clock.mi, s: clock.s }, tz)
    if (delta === 0 && ts <= now) ts = wallToTs({ ...addDaysCivil(today, 7), h: clock.h, mi: clock.mi, s: clock.s }, tz)
    return ts
  }
  if (monthDay) {
    let ts = wallToTs({ y: today.y, mo: monthDay.mo, d: monthDay.d, h: clock.h, mi: clock.mi, s: clock.s }, tz)
    if (ts <= now) ts = wallToTs({ y: today.y + 1, mo: monthDay.mo, d: monthDay.d, h: clock.h, mi: clock.mi, s: clock.s }, tz)
    return ts
  }
  if (dayOffset != null) {
    return wallToTs({ ...addDaysCivil(today, dayOffset), h: clock.h, mi: clock.mi, s: clock.s }, tz)
  }
  const ts = wallToTs({ ...today, h: clock.h, mi: clock.mi, s: clock.s }, tz)
  return ts > now ? ts : wallToTs({ ...addDaysCivil(today, 1), h: clock.h, mi: clock.mi, s: clock.s }, tz)
}

function whenCandidates(tz, now) {
  const list = []
  const push = (label, ts, spec) => {
    if (!Number.isFinite(ts)) return
    list.push({ label, at: ts, spec: { kind: 'at', at: new Date(ts).toISOString(), tz } })
  }
  const today = zoneParts(now, tz)
  push('明天 09:00', wallToTs({ ...addDaysCivil(today, 1), h: 9, mi: 0, s: 0 }, tz), null)
  const nextMonday = (() => {
    const todayWd = weekdayOf(today)
    const delta = (1 - todayWd + 7) % 7 || (todayWd === 1 ? 0 : 7)
    let ts = wallToTs({ ...addDaysCivil(today, delta), h: 9, mi: 30, s: 0 }, tz)
    if (ts <= now) ts = wallToTs({ ...addDaysCivil(today, delta + 7), h: 9, mi: 30, s: 0 }, tz)
    return ts
  })()
  push('下周一 09:30', nextMonday, null)
  list.push({
    label: '每天 09:00',
    at: wallToTs({ ...addDaysCivil(today, 1), h: 9, mi: 0, s: 0 }, tz),
    spec: { kind: 'daily', time: '09:00', missPolicy: 'delay', graceMinutes: 30, tz },
  })
  list.push({ label: '截止前 2 小时', at: null, spec: { kind: 'at', anchor: 'due', offsetMinutes: -120, tz } })
  return list
}

function whenFail(error, tz, now) {
  return { ok: false, error, candidates: whenCandidates(tz, now) }
}

/**
 * 自然语言 → spec（确定性优先；说不准就给候选，不瞎猜、不抛异常）。
 *
 * @param {string} text '下周一早上九点半' / '截止前两小时' / '每天 9:00'
 * @param {{tz?: string, now?: number, anchorTs?: number, anchorKind?: string}} [opts]
 * @returns {{ok: boolean, spec?: object, error?: string, candidates?: Array}}
 */
export function parseWhen(text, opts = {}) {
  try {
    return parseWhenInner(text, opts)
  } catch (error) {
    const tz = validTimeZone(opts.tz) || TZ_DEFAULT
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now()
    return whenFail(`解析失败：${error?.message || error}`, tz, now)
  }
}

function parseWhenInner(text, opts = {}) {
  const tz = validTimeZone(opts.tz) || TZ_DEFAULT
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now()
  let body = String(text ?? '')
    .trim()
    .replace(/：/g, ':')
    .replace(/\s+/g, ' ')
  if (!body) return whenFail('没有时间表达', tz, now)

  const extras = {}

  const untilHit = extractUntil(body, tz, now)
  if (untilHit) {
    extras.until = new Date(untilHit.ts).toISOString()
    body = untilHit.rest
  }
  const windowHit = extractWindow(body)
  if (windowHit) {
    extras.window = windowHit.window
    body = windowHit.rest
  }
  const quietHit = extractQuiet(body)
  if (quietHit) {
    extras.quiet = quietHit.quiet
    body = quietHit.rest
  }
  body = body.replace(/\s+/g, ' ').trim()
  if (!body) return whenFail('只有窗口/免打扰，没有具体的触发时间', tz, now)

  const done = (spec) => ({ ok: true, spec: { ...spec, ...extras, tz } })

  const anchorHit = parseAnchorExpression(body)
  if (anchorHit) return done({ kind: 'at', anchor: anchorHit.anchor, offsetMinutes: anchorHit.offsetMinutes })

  const relative = parseRelativeExpression(body)
  if (relative != null) return done({ kind: 'at', at: new Date(now + relative).toISOString() })

  const iso = body.trim()
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]+\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(iso)) {
    const ts = readInstant(iso, tz)
    if (ts != null) return done({ kind: 'at', at: new Date(ts).toISOString() })
  }

  /* 间隔型要排在重复规则之前：『每隔一小时』里没有日/周/月的词，但『每小时』里的
     「每」会被重复规则的正则盯上，先问一次更稳。 */
  const interval = parseIntervalExpression(body)
  if (interval) return done({ kind: 'interval', everyMinutes: interval.everyMinutes })

  const recurring = parseRecurringExpression(body)
  if (recurring) {
    const clock = parseTimePhrase(recurring.rest) || { h: 9, mi: 0, s: 0 }
    const spec = { kind: recurring.kind, time: clockText({ h: clock.h, mi: clock.mi, s: clock.s }) }
    if (recurring.weekdays) spec.weekdays = recurring.weekdays
    if (recurring.monthDays) spec.monthDays = recurring.monthDays
    return done(spec)
  }

  const point = parsePointExpression(body, tz, now, opts)
  if (point != null) return done({ kind: 'at', at: new Date(point).toISOString() })

  return whenFail(`没看懂这个时间表达：${String(text).trim()}`, tz, now)
}

/* ═══════════════════════════ describeSpec ═══════════════════════════ */

export function anchorText(anchor, offsetMinutes) {
  const label = anchor === 'start' ? '开工' : anchor === 'created' ? '创建' : '截止'
  const offset = Number(offsetMinutes) || 0
  if (offset === 0) return `${label}时`
  const abs = Math.abs(offset)
  const unit = abs % 1440 === 0 ? `${abs / 1440} 天` : abs % 60 === 0 ? `${abs / 60} 小时` : `${abs} 分钟`
  return offset < 0 ? `${label}前 ${unit}` : `${label}后 ${unit}`
}

/**
 * 人话描述：'每周一 09:30' / '2026-11-02 15:00' / '每天 09:00（工作日）' / '截止前 2 小时'。
 *
 * - 传 opts.now 时，kind=at 会补一句「还有多久」；
 * - opts.compact=true 时只留「什么时候」本身（面板的排期 chip 用），
 *   不带免打扰/工作时段/截止/「还有多久」这些附加说明。
 */
export function describeSpec(spec, opts = {}) {
  const normalized = runtimeSpec(spec, opts)
  if (!normalized) return '未设置排期'
  const compact = opts.compact === true
  const tz = normalized.tz || TZ_DEFAULT
  const time = normalized.time || '09:00'
  let text

  if (normalized.kind === 'at') {
    if (normalized.anchor) {
      text = anchorText(normalized.anchor, normalized.offsetMinutes)
    } else {
      const ts = Date.parse(normalized.at || '')
      if (!Number.isFinite(ts)) {
        text = '时间未定'
      } else {
        text = `${dayText(ts, tz)} ${noonClock(ts, tz)}`
        const now = Number(opts.now)
        if (!compact && Number.isFinite(now) && ts > now) text += `（还有 ${humanDelay(ts - now)}）`
      }
    }
  } else if (normalized.kind === 'daily') {
    text = `每天 ${time}`
  } else if (normalized.kind === 'workdays') {
    text = `每天 ${time}（工作日）`
  } else if (normalized.kind === 'weekly') {
    const days = (normalized.weekdays || []).map((n) => WEEKDAY_NAMES[n] || n).join('、')
    text = `每周${days} ${time}`
  } else if (normalized.kind === 'interval') {
    text = everyText(normalized.everyMinutes)
  } else if (normalized.kind === 'monthly') {
    text = `每月 ${(normalized.monthDays || []).join('、')} 号 ${time}`
  } else {
    text = '未设置排期'
  }

  if (compact) return text
  if (normalized.window) text += `，只在 ${normalized.window[0]}-${normalized.window[1]}`
  if (normalized.quiet?.length) text += `，免打扰 ${normalized.quiet.map((pair) => `${pair[0]}-${pair[1]}`).join('、')}`
  if (normalized.until) {
    const ts = Date.parse(normalized.until)
    if (Number.isFinite(ts)) text += `，到 ${dayText(ts, tz)}`
  }
  if (normalized.maxRuns) text += `，最多 ${normalized.maxRuns} 次`
  return text
}

/* ═══════════════════════════ describeShort（面板 chip 用） ═══════════════════════════ */

/*
 * 卡片上「什么时候」只放两段：规则 + 下次。
 *   规则段回答「多久一次 / 每周几」；下次段只回答「哪一天」——几点已经在规则里，
 *   再写一遍就是把同一份时间说两遍（每天 09:00 · 2026-10-30 09:00）。
 *   一次性没有规则段，所以「哪天 + 几点」都放在同一段里。
 * 年份：同年不写，跨年才写全；免打扰 / 时段 / 截止 / 次数这些附加信息留在悬停。
 */

/* 步长的人话：60 → 「每 1 小时」，90 → 「每 90 分钟」，1440 → 「每 1 天」。 */
function everyText(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  if (!m) return '未设置排期'
  if (m % 10080 === 0) return `每 ${m / 10080} 周`
  if (m % 1440 === 0) return `每 ${m / 1440} 天`
  if (m % 60 === 0) return `每 ${m / 60} 小时`
  return `每 ${m} 分钟`
}

/** 规则段：'每天 09:00' / '工作日 09:00' / '每周一、三 10:00' / '每月 1、15 日 10:00' / '每 1 小时'。 */
function shortRule(spec) {
  const time = spec.time || '09:00'
  if (spec.kind === 'at') return String(spec.note || '').trim()
  if (spec.kind === 'daily') return `每天 ${time}`
  if (spec.kind === 'workdays') return `工作日 ${time}`
  if (spec.kind === 'weekly') {
    const days = (Array.isArray(spec.weekdays) ? spec.weekdays : []).map((n) => `周${WEEKDAY_NAMES[n] || n}`).join('、')
    return days ? `每${days} ${time}` : ''
  }
  if (spec.kind === 'monthly') {
    const days = (Array.isArray(spec.monthDays) ? spec.monthDays : []).join('、')
    return days ? `每月 ${days} 日 ${time}` : ''
  }
  if (spec.kind === 'interval') return everyText(spec.everyMinutes)
  return ''
}

/** 下次段：今天 / 明天 / 后天 / MM-DD / YYYY-MM-DD（一次性再带 HH:mm）。 */
export function shortNextText(nextAt, now, tz = TZ_DEFAULT, opts = {}) {
  const ts = Number(nextAt) || 0
  if (!ts) return ''
  const at = zoneParts(ts, tz)
  const base = zoneParts(Number(now) || Date.now(), tz)
  const dayDiff = Math.round((Date.UTC(at.y, at.mo - 1, at.d) - Date.UTC(base.y, base.mo - 1, base.d)) / DAY)
  let day
  if (dayDiff === 0) day = '今天'
  else if (dayDiff === 1) day = '明天'
  else if (dayDiff === 2) day = '后天'
  else if (at.y === base.y) day = `${pad2(at.mo)}-${pad2(at.d)}`
  else day = `${at.y}-${pad2(at.mo)}-${pad2(at.d)}`
  return opts.withClock === false ? day : `${day} ${pad2(at.h)}:${pad2(at.mi)}`
}

/**
 * 面板 chip 的短文案（不带 ⏰ 前缀、不含暂停标记）：'每天 09:00 · 明天'。
 * opts.nextAt 由调用方（scheduleViewOf）算好传进来，避免这里再扫一遍日历。
 */
/**
 * 附加说明（免打扰 / 只在哪段时段 / 到哪天为止 / 最多几次），给卡片悬停用。
 * 和 describeSpec 的区别：这里是**结构化的一段段**，面板自己拼，不用做字符串切分
 * （那套 indexOf 去重以前会把「还有 1.2 天），免打扰 …」切得七零八落）。
 */
export function describeExtras(spec, opts = {}) {
  const normalized = runtimeSpec(spec, opts)
  if (!normalized) return []
  const tz = normalized.tz || TZ_DEFAULT
  const extras = []
  if (normalized.window) extras.push(`只在 ${normalized.window[0]}-${normalized.window[1]}`)
  if (normalized.quiet?.length) extras.push(`免打扰 ${normalized.quiet.map((pair) => `${pair[0]}-${pair[1]}`).join('、')}`)
  if (normalized.until) {
    const ts = Date.parse(normalized.until)
    if (Number.isFinite(ts)) extras.push(`到 ${dayText(ts, tz)}`)
  }
  if (normalized.maxRuns) extras.push(`最多 ${normalized.maxRuns} 次`)
  return extras
}

export function describeShort(spec, opts = {}) {
  const normalized = runtimeSpec(spec, opts)
  if (!normalized) return ''
  const tz = normalized.tz || TZ_DEFAULT
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now()
  const rule = shortRule(normalized)
  const next = opts.nextAt ? shortNextText(opts.nextAt, now, tz, { withClock: normalized.kind === 'at' }) : ''
  return [rule, next].filter(Boolean).join(' · ')
}

/* ═══════════════════════════ advance ═══════════════════════════ */

/**
 * 触发器自增后的下一状态（lastFiredAt / runs 由调用方落地）。
 *
 * opts.countRun=false 时不加 runs（错过的排期按 skip 推进 lastFiredAt 但不计一次触发）。
 *
 * @param {{spec?: object, lastFiredAt?: number, runs?: number}} entry
 * @param {number} firedAt
 * @param {{countRun?: boolean, now?: number}} [opts]
 * @returns {{entry: object, done: boolean}}
 */
export function advance(entry, firedAt, opts = {}) {
  const raw = entry && typeof entry === 'object' ? entry : {}
  const spec = runtimeSpec(raw.spec && typeof raw.spec === 'object' ? raw.spec : raw, opts)
  const fallback = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now()
  const at = Number.isFinite(Number(firedAt)) ? Number(firedAt) : fallback
  const countRun = opts.countRun !== false
  const runs = Math.max(0, Number(raw.runs) || 0) + (countRun ? 1 : 0)
  const next = { ...raw, lastFiredAt: at, runs }

  if (!spec) return { entry: next, done: true }
  if (spec.kind === 'at') return { entry: next, done: true }
  if (spec.maxRuns && runs >= spec.maxRuns) return { entry: next, done: true }
  const untilTs = spec.until ? Date.parse(spec.until) : null
  if (Number.isFinite(untilTs) && at >= untilTs) return { entry: next, done: true }
  const following = nextFireAt(spec, at, { runs })
  return { entry: next, done: following == null }
}
