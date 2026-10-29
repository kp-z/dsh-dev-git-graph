/**
 * DSH 自动化任务（`@deepseek-ai/dsh-schedule`）桥接层。
 *
 * 为什么要有这一层：
 *   插件的「定时」不再自己记时间——**唯一真相源是 DSH 的自动化任务**。
 *   面板上看到的那一条、点开改的那一条，都是这个服务里的记录；
 *   本地 `state.schedules` 只在「任务还没有会话」时作为降级用（DSH 的自动化
 *   必须绑定会话，没会话就投不出去）。
 *
 * 本文件只做纯映射，不碰 IO：
 *   spec（插件自己的时间意图） ↔ DSH 的 selector（at / every / daily / weekly / cron）
 *   DSH 的 record（别人在 DSH 里建的也算）→ 卡片上的短文案
 *
 * DSH 记录形状（见 dsh-schedule 的 domain）：
 *   { id, kind: 'at'|'after'|'every'|'daily'|'weekly'|'cron', title, prompt,
 *     scheduledAt: ISO, everySeconds?, time?: 'HH:mm:ss', timeZone?, weekdays?, expression? }
 */

/** DSH 侧固定间隔的下限（服务端要求 ≥ 60 秒）。 */
export const DSH_MIN_EVERY_SECONDS = 60

const WEEKDAY_CN = ['', '一', '二', '三', '四', '五', '六', '日']

/** 'HH:mm' / 'HH:mm:ss' → 'HH:mm:ss'。DSH 的钟点规则要秒级文本。 */
export function dshTime(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw)
  if (!m) return ''
  const h = Math.min(23, Math.max(0, Number(m[1])))
  const mi = Math.min(59, Math.max(0, Number(m[2])))
  const s = Math.min(59, Math.max(0, Number(m[3] || 0)))
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 周一到周日 1..7 → '每周一、三 09:00'；1-5 收成「工作日」。 */
export function weeklyLabel(weekdays, time) {
  const days = (Array.isArray(weekdays) ? weekdays : []).map(Number).filter((n) => n >= 1 && n <= 7)
  if (days.length === 0) return ''
  if (days.length === 5 && [1, 2, 3, 4, 5].every((n) => days.includes(n))) return `工作日 ${time}`
  const text = days.map((n) => `周${WEEKDAY_CN[n] || n}`).join('、')
  return `每${text} ${time}`
}

/** 步长秒 → '每 30 分钟' / '每 1 小时' / '每 2 天'。 */
export function everyLabel(everySeconds) {
  const seconds = Math.max(0, Math.round(Number(everySeconds) || 0))
  if (!seconds) return ''
  const minutes = Math.round(seconds / 60)
  if (minutes % 1440 === 0) return `每 ${minutes / 1440} 天`
  if (minutes % 60 === 0) return `每 ${minutes / 60} 小时`
  return `每 ${minutes} 分钟`
}

/**
 * cron 表达式 → 人话（只认插件自己会写出的三种形状，其余原样显示）。
 * 认不出来的就显示 `cron <expr>`：宁可难看，也不能猜错。
 */
export function cronLabel(expression) {
  const text = String(expression || '').trim()
  if (!text) return ''
  const parts = text.split(/\s+/)
  if (parts.length !== 5) return `cron ${text}`
  const [minute, hour, dom, month, dow] = parts
  const isNum = (v) => /^\d{1,2}$/.test(v)
  const clock = isNum(hour) && isNum(minute) ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` : ''
  if (clock && month === '*' && dow === '*' && /^\d{1,2}(,\d{1,2})*$/.test(dom)) {
    const days = dom.split(',').join('、')
    return `每月 ${days} 日 ${clock}`
  }
  if (clock && month === '*' && dow === '*' && dom === '*') return `每天 ${clock}`
  if (clock && month === '*' && dom === '*' && /^\d(,\d)*$/.test(dow)) {
    const days = dow.split(',').map((n) => Number(n) === 0 ? 7 : Number(n)).sort((a, b) => a - b)
    return weeklyLabel(days, clock)
  }
  return `cron ${text}`
}

/**
 * 插件 spec → DSH create 请求（一个 selector + 标题 + 提示词）。
 *
 * 返回 `{ ok, request, warnings }`。`warnings` 是这个映射里**丢掉**的能力：
 * DSH 的自动化只有「什么时候」，没有免打扰/时段/到某天为止/最多几次，
 * 这些不静默吞掉，交给调用方显示。
 */
export function toDshRequest(spec, opts = {}) {
  const tz = opts.tz || 'Asia/Shanghai'
  const title = String(opts.title || '').trim()
  const prompt = String(opts.prompt || '').trim()
  const warnings = []
  const kind = spec?.kind
  const clock = dshTime(spec?.time)

  let selector = null
  if (kind === 'at') {
    const at = Date.parse(spec.at || '')
    if (!Number.isFinite(at)) return { ok: false, error: '这条排期没有确定的绝对时间' }
    selector = { at: new Date(at).toISOString() }
  } else if (kind === 'interval') {
    const seconds = Math.round((Number(spec.everyMinutes) || 0) * 60)
    if (seconds < DSH_MIN_EVERY_SECONDS) return { ok: false, error: `DSH 的间隔至少 ${DSH_MIN_EVERY_SECONDS / 60} 分钟` }
    selector = { every_seconds: seconds }
  } else if (kind === 'daily') {
    if (!clock) return { ok: false, error: '每天规则缺少钟点' }
    selector = { daily: { time: clock, time_zone: tz } }
  } else if (kind === 'workdays') {
    if (!clock) return { ok: false, error: '工作日规则缺少钟点' }
    selector = { weekly: { time: clock, time_zone: tz, weekdays: [1, 2, 3, 4, 5] } }
  } else if (kind === 'weekly') {
    const weekdays = (Array.isArray(spec.weekdays) ? spec.weekdays : []).map(Number).filter((n) => n >= 1 && n <= 7)
    if (!clock || weekdays.length === 0) return { ok: false, error: '每周规则缺少星期或钟点' }
    selector = { weekly: { time: clock, time_zone: tz, weekdays } }
  } else if (kind === 'monthly') {
    const days = (Array.isArray(spec.monthDays) ? spec.monthDays : []).map(Number).filter((n) => n >= 1 && n <= 31)
    if (!clock || days.length === 0) return { ok: false, error: '每月规则缺少日期或钟点' }
    const [h, mi] = clock.split(':').map(Number)
    selector = { cron: { expression: `${mi} ${h} ${days.join(',')} * *`, time_zone: tz } }
  } else {
    return { ok: false, error: `DSH 自动化不认识的规则：${kind || '空'}` }
  }

  if (spec.window) warnings.push('DSH 自动化不支持「只在某时段」，这条限制不会生效')
  if (Array.isArray(spec.quiet) && spec.quiet.length) warnings.push('DSH 自动化不支持免打扰，这条限制不会生效')
  if (spec.until) warnings.push('DSH 自动化不支持「到某天为止」，需要时请手动删除')
  if (spec.maxRuns) warnings.push('DSH 自动化不支持「最多 N 次」，需要时请手动删除')

  const request = { title: dshTitle(title), prompt }
  Object.assign(request, selector)
  return { ok: true, request, warnings }
}

/** DSH 的 update 用带判别字段的 change：{kind:'daily', daily:{...}}。 */
export function toDshChange(spec, opts = {}) {
  const built = toDshRequest(spec, opts)
  if (!built.ok) return built
  const r = built.request
  let change
  if (r.at !== undefined) change = { kind: 'at', at: r.at }
  else if (r.every_seconds !== undefined) change = { kind: 'every', every_seconds: r.every_seconds }
  else if (r.daily !== undefined) change = { kind: 'daily', daily: r.daily }
  else if (r.weekly !== undefined) change = { kind: 'weekly', weekly: r.weekly }
  else if (r.cron !== undefined) change = { kind: 'cron', cron: r.cron }
  else return { ok: false, error: '无法把规则翻成 DSH 的时间变更' }
  return { ok: true, change, warnings: built.warnings }
}

/** DSH 要求标题非空且 ≤ 120 字；任务标题可能带 emoji/编号，原样保留、只做截断。 */
export function dshTitle(text) {
  const raw = String(text || '').trim() || '飞书任务自动化'
  return raw.length > 120 ? raw.slice(0, 119) + '…' : raw
}

/**
 * 自动化任务的提示词。默认写得「模糊但可执行」——到点被唤醒的 Agent 不需要
 * 重述任务全文（它在自己的会话里，上下文都在），只要知道「接着干」。
 *
 * 支持 settings.schedule.automationPrompt 自定义，占位符：{{title}} {{list}} {{workspace}}。
 */
export const DEFAULT_AUTOMATION_PROMPT = '继续这条任务：先制定计划，然后按计划开始执行。'

export function automationPrompt(settings, task) {
  const template = String(settings?.schedule?.automationPrompt || '').trim() || DEFAULT_AUTOMATION_PROMPT
  return template
    .replace(/\{\{title\}\}/g, String(task?.title || '').trim())
    .replace(/\{\{list\}\}/g, String(task?.listName || '').trim())
    .replace(/\{\{workspace\}\}/g, String(task?.workspaceName || '').trim())
    .trim()
}

/** 显示用的规则文本（DSH 记录 → '每天 09:00' / '每 1 小时' / '每月 1 日 10:00'）。 */
export function ruleOfRecord(record) {
  const kind = record?.kind
  if (kind === 'at' || kind === 'after') return ''
  if (kind === 'every') return everyLabel(record.everySeconds)
  const time = String(record.time || '').slice(0, 5)
  if (kind === 'daily') return time ? `每天 ${time}` : ''
  if (kind === 'weekly') return weeklyLabel(record.weekdays, time)
  if (kind === 'cron') return cronLabel(record.expression)
  return ''
}

/** 多条记录时取「最先到点」的那条：卡片上只看一条，剩下的在悬停里说数量。 */
export function primaryRecord(records) {
  const list = (Array.isArray(records) ? records : []).filter((r) => r && r.id)
  if (list.length === 0) return null
  return [...list].sort((a, b) => (Date.parse(a.scheduledAt) || Infinity) - (Date.parse(b.scheduledAt) || Infinity))[0]
}
