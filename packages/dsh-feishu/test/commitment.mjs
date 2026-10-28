/**
 * 履约口径的单元测试。
 *
 * 这里锁的是「准时还是延期」这种会被人拿来看的结论：口径错一次，
 * 履约率就会系统性偏高或偏低，而且很难从界面上看出来。
 *
 * 跑法：node test/commitment.mjs
 */
import {
  ETA_FIELD_DEFAULT,
  classifyDelayReason,
  classifyFulfillment,
  completionQuality,
  delayPatterns,
  firstPromiseOf,
  formatEta,
  formatSpan,
  fulfillmentSummary,
  parseEta,
  promiseRisk,
  promiseUpdate,
} from '../commitment.js'

let failures = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`✗ ${name}\n  期望 ${e}\n  实际 ${a}`)
  } else {
    console.log(`✓ ${name}`)
  }
}

const TZ = 'Asia/Shanghai'
const NOW = Date.parse('2026-10-28T12:00:00+08:00')
const DAY = 86_400_000
const HOUR = 3_600_000

/* ── 常量与格式化 ── */
check('字段名默认值', ETA_FIELD_DEFAULT, '预期完成')
check('formatEta：上海时区', formatEta(Date.parse('2026-10-30T18:00:00+08:00'), TZ), '2026-10-30 18:00')
check('formatEta：跨时区（UTC 输入按上海展示）', formatEta(Date.parse('2026-10-30T10:00:00Z'), TZ), '2026-10-30 18:00')
check('formatEta：纽约', formatEta(Date.parse('2026-10-30T22:00:00Z'), 'America/New_York'), '2026-10-30 18:00')
check('formatEta：空值', formatEta(0, TZ), '')

/* ── parseEta ── */
check('parseEta：空 = 清空', parseEta('', { tz: TZ, now: NOW }), { ok: true, at: null, cleared: true })
check('parseEta：只给日期 → 当天 18:00', parseEta('2026-10-30', { tz: TZ, now: NOW }).at, Date.parse('2026-10-30T18:00:00+08:00'))
check('parseEta：日期 + 时分', parseEta('2026-10-30 09:15', { tz: TZ, now: NOW }).at, Date.parse('2026-10-30T09:15:00+08:00'))
check('parseEta：斜杠 + 一位小时', parseEta('2026/10/30 9:15', { tz: TZ, now: NOW }).at, Date.parse('2026-10-30T09:15:00+08:00'))
check('parseEta：带秒', parseEta('2026-10-30 09:15:30', { tz: TZ, now: NOW }).at, Date.parse('2026-10-30T09:15:30+08:00'))
check('parseEta：ISO 带时区', parseEta('2026-10-30T09:15:00+08:00', { tz: TZ, now: NOW }).at, Date.parse('2026-10-30T09:15:00+08:00'))
check('parseEta：自然语言（明天下午三点）', parseEta('明天下午三点', { tz: TZ, now: NOW }).at, Date.parse('2026-10-29T15:00:00+08:00'))
check('parseEta：自然语言（下周一）', parseEta('下周一', { tz: TZ, now: NOW }).ok, true)
check('parseEta：没听懂', parseEta('随便什么时候', { tz: TZ, now: NOW }).ok, false)
check('parseEta：自定义默认时刻', parseEta('2026-10-30', { tz: TZ, now: NOW, defaultClock: '12:00' }).at, Date.parse('2026-10-30T12:00:00+08:00'))
check('parseEta：dateOnly 标记', parseEta('2026-10-30', { tz: TZ, now: NOW }).dateOnly, true)
/* 口语默认值：只说「哪一天」→ 当天 18:00（下班前）；这是预期和排期的关键差异 */
check('parseEta：这周五 → 当天 18:00', parseEta('这周五', { tz: TZ, now: NOW }).at, Date.parse('2026-10-30T18:00:00+08:00'))
check('parseEta：月底', parseEta('月底', { tz: TZ, now: NOW }).at, Date.parse('2026-10-31T18:00:00+08:00'))
check('parseEta：下个月 5 号', parseEta('下个月5号', { tz: TZ, now: NOW }).at, Date.parse('2026-11-05T18:00:00+08:00'))
check('parseEta：下下个月 1 号', parseEta('下下个月1号', { tz: TZ, now: NOW }).at, Date.parse('2026-12-01T18:00:00+08:00'))
check('parseEta：下班前（今天 18:00）', parseEta('下班前', { tz: TZ, now: NOW }).at, Date.parse('2026-10-28T18:00:00+08:00'))
check('parseEta：中午前', parseEta('中午前', { tz: TZ, now: NOW }).at, Date.parse('2026-10-29T12:00:00+08:00'))
check('parseEta：只写月日 10-30', parseEta('10-30', { tz: TZ, now: NOW }).at, Date.parse('2026-10-30T18:00:00+08:00'))
check('parseEta：月日带时间', parseEta('10/30 09:15', { tz: TZ, now: NOW }).at, Date.parse('2026-10-30T09:15:00+08:00'))
check(
  'parseEta：截止前 2 小时（锚点换算）',
  parseEta('截止前 2 小时', { tz: TZ, now: NOW, anchorTs: NOW + 5 * 86400000 }).at,
  NOW + 5 * 86400000 - 2 * 3600000,
)
check('parseEta：没有截止时间时锚点报错', parseEta('截止前 2 小时', { tz: TZ, now: NOW }).ok, false)
check('parseEta：重复规则不能当预期', parseEta('每周一 9:30', { tz: TZ, now: NOW }).ok, false)
check('parseEta：解析失败给候选', Array.isArray(parseEta('随便', { tz: TZ, now: NOW }).candidates), true)
/* 带口语前后缀：说时间时常带「请/麻烦/完成/交」这类词，不能因此看不懂 */
check('parseEta：下班前交', parseEta('下班前交', { tz: TZ, now: NOW }).at, Date.parse('2026-10-28T18:00:00+08:00'))
check('parseEta：请在下班前完成', parseEta('请在下班前完成', { tz: TZ, now: NOW }).at, Date.parse('2026-10-28T18:00:00+08:00'))
check('parseEta：麻烦帮我在明天下午三点交', parseEta('麻烦帮我在明天下午三点交', { tz: TZ, now: NOW }).at, Date.parse('2026-10-29T15:00:00+08:00'))
check('parseEta：这周五之前搞定', parseEta('这周五之前搞定', { tz: TZ, now: NOW }).at, Date.parse('2026-10-30T18:00:00+08:00'))
check('parseEta：今天晚上6点完成', parseEta('今天晚上6点完成', { tz: TZ, now: NOW }).at, Date.parse('2026-10-28T18:00:00+08:00'))
check('parseEta：自然语言标记', parseEta('明天下午三点', { tz: TZ, now: NOW }).natural, true)

/* ── 首次承诺 ── */
check('firstPromiseOf：没有 log 用当前值', firstPromiseOf({ expectedAt: 123 }), 123)
check(
  'firstPromiseOf：取 log 第一条',
  firstPromiseOf({ expectedAt: 999, promiseLog: [{ expectedAt: 111 }, { expectedAt: 999 }] }),
  111,
)
check('firstPromiseOf：空任务', firstPromiseOf({}), 0)

/* ── 时长文案 ── */
check('formatSpan：45 分钟', formatSpan(45 * 60_000), '45 分钟')
check('formatSpan：3 小时', formatSpan(3 * HOUR), '3 小时')
check('formatSpan：2.5 天', formatSpan(2.5 * DAY), '2.5 天')
check('formatSpan：12 天', formatSpan(12 * DAY), '12 天')

/* ── 单任务履约状态 ── */
check('classify：未设预期', classifyFulfillment({}, NOW).state, 'none')
check('classify：已完成但缺结束时间', classifyFulfillment({ done: true, expectedAt: NOW }, NOW).state, 'done_unknown')
check('classify：进行中未到期', classifyFulfillment({ expectedAt: NOW + 2 * DAY }, NOW), {
  state: 'pending',
  slackMs: 2 * DAY,
  label: '剩 2 天',
})
check('classify：进行中已逾期', classifyFulfillment({ expectedAt: NOW - 3 * HOUR }, NOW), {
  state: 'overdue',
  slackMs: -3 * HOUR,
  label: '逾期 3 小时',
})
check('classify：提前完成', classifyFulfillment({ done: true, expectedAt: NOW, endAt: NOW - 3 * HOUR }, NOW), {
  state: 'early',
  slackMs: -3 * HOUR,
  label: '提前 3 小时',
})
check('classify：准时（差值 0）', classifyFulfillment({ done: true, expectedAt: NOW, endAt: NOW }, NOW).label, '准时')
check('classify：延期', classifyFulfillment({ done: true, expectedAt: NOW, endAt: NOW + 2 * DAY }, NOW), {
  state: 'late',
  slackMs: 2 * DAY,
  label: '延期 2 天',
})

/* ── 承诺变更 ── */
const first = promiseUpdate({}, NOW, NOW, '初次承诺')
check('promiseUpdate：首次 set', first.expectedAt, NOW)
check('promiseUpdate：首次记一条 promiseLog', first.promiseLog.length, 1)
check('promiseUpdate：首次 kind=set', first.promiseLog[0].kind, 'set')
check('promiseUpdate：首次不记延期', first.delayLog.length, 0)

const same = promiseUpdate(first, NOW, NOW + 1000, '重复写')
check('promiseUpdate：值没变不记', same.promiseLog.length, 1)

const later = promiseUpdate(first, NOW + 2 * DAY, NOW + 1000, '等上游接口')
check('promiseUpdate：往后改 = 重承诺', later.promiseLog[1].kind, 'recommit')
check('promiseUpdate：往后改记延期', later.delayLog.length, 1)
check('promiseUpdate：延期天数', later.delayLog[0].days, 2)
check('promiseUpdate：延期原因', later.delayLog[0].reason, '等上游接口')

const earlier = promiseUpdate(first, NOW - DAY, NOW + 1000, '提前收口')
check('promiseUpdate：往前改不记延期', earlier.delayLog.length, 0)
check('promiseUpdate：往前改仍记承诺', earlier.promiseLog.length, 2)

const cleared = promiseUpdate(first, 0, NOW + 1000, '不做了')
check('promiseUpdate：清空预期', cleared.expectedAt, 0)
check('promiseUpdate：清空也留痕', cleared.promiseLog.length, 2)
check('promiseUpdate：清空 kind=cleared', cleared.promiseLog[1].kind, 'cleared')
check('promiseUpdate：清空原因', cleared.promiseLog[1].reason, '不做了')

/* ── 汇总 ── */
const tasks = [
  /* 提前完成，首次=当前：严格准时 */
  { expectedAt: NOW, promiseLog: [{ expectedAt: NOW }], done: true, endAt: NOW - 10 * HOUR, workspaceTitle: 'A' },
  /* 延期完成，首次=当前 */
  { expectedAt: NOW, promiseLog: [{ expectedAt: NOW }], done: true, endAt: NOW + 30 * HOUR, workspaceTitle: 'A' },
  /* 改过承诺：首次晚 50h，最终只晚 0h（按首次算延期，按最终算准时） */
  {
    expectedAt: NOW + 50 * HOUR,
    promiseLog: [{ expectedAt: NOW }, { expectedAt: NOW + 50 * HOUR }],
    delayLog: [{ at: NOW, from: NOW, to: NOW + 50 * HOUR, days: 2.1 }],
    done: true,
    endAt: NOW + 50 * HOUR,
    workspaceTitle: 'B',
  },
  /* 进行中未到期 */
  { expectedAt: NOW + 2 * DAY },
  /* 进行中已逾期 */
  { expectedAt: NOW - DAY },
  /* 没设预期：不计入 */
  { done: true, endAt: NOW },
]

const summary = fulfillmentSummary(tasks, { now: NOW })
check('汇总：tracked', summary.tracked, 5)
check('汇总：completed', summary.completed, 3)
check('汇总：pending', summary.pending, 1)
check('汇总：overdue', summary.overdue, 1)
check('汇总：严格准时数', summary.onTime, 1)
check('汇总：最终准时数', summary.finalOnTime, 2)
check('汇总：严格准时率', summary.onTimeRate, 33.3)
check('汇总：最终准时率', summary.finalOnTimeRate, 66.7)
check('汇总：延期次数（重承诺条数）', summary.lateCount, 1)
check('汇总：平均偏差（严格口径）', summary.avgSlackMs, Math.round(((-10 * HOUR) + (30 * HOUR) + (50 * HOUR)) / 3))
check('汇总：按工作区分组数', summary.byWorkspace.length, 2)
check('汇总：A 组完成数', summary.byWorkspace.find((item) => item.workspace === 'A').completed, 2)
check('汇总：B 组准时率', summary.byWorkspace.find((item) => item.workspace === 'B').onTimeRate, 0)
check('汇总：窗口过滤（since 之后无完成）', fulfillmentSummary(tasks, { now: NOW, since: NOW + 999 * DAY }).completed, 0)
check('汇总：空列表不炸', fulfillmentSummary([], { now: NOW }).tracked, 0)

/* ── 延期归因 ── */
check('归因：等上游接口 → dependency', classifyDelayReason('等上游接口'), 'dependency')
check('归因：需求变更 → scope', classifyDelayReason('需求变更，口径改了'), 'scope')
check('归因：会议插队 → interrupt', classifyDelayReason('临时会议插队'), 'interrupt')
check('归因：估时不准 → estimate', classifyDelayReason('估时不准，低估了工作量'), 'estimate')
check('归因：测试环境 → environment（优先于 review）', classifyDelayReason('测试环境挂了'), 'environment')
check('归因：修 bug → review', classifyDelayReason('返工修 bug'), 'review')
check('归因：空原因 → other', classifyDelayReason(''), 'other')
check('归因：认不出 → other', classifyDelayReason('就是慢了'), 'other')

const delayTasks = [
  {
    id: 't1', no: 1, title: '接口联调',
    delayLog: [
      { from: NOW, to: NOW + DAY, days: 1, reason: '等上游接口' },
      { from: NOW + DAY, to: NOW + 2 * DAY, days: 1, reason: '上游还没好' },
    ],
  },
  {
    id: 't2', no: 2, title: '需求评审',
    delayLog: [{ from: NOW, to: NOW + 2 * DAY, days: 2, reason: '需求变更' }],
  },
  {
    id: 't3', no: 3, title: '估时',
    delayLog: [{ from: NOW, to: NOW + DAY, days: 1, reason: '' }],
  },
]
const patterns = delayPatterns(delayTasks)
check('归因汇总：桶数', patterns.length, 3)
check('归因汇总：最多的桶', patterns[0].bucket, 'dependency')
check('归因汇总：dependency 次数', patterns[0].count, 2)
check('归因汇总：days 累加', patterns[0].days, 2)
check('归因汇总：涉及任务去重', patterns[0].tasks.length, 1)
check('归因汇总：举例', patterns[0].samples.includes('等上游接口'), true)
check('归因汇总：limit 生效', delayPatterns(delayTasks, { limit: 1 }).length, 1)

/* ── 完成质量 ── */
const doneTasks = [
  { done: true, startAt: NOW, endAt: NOW + DAY, expectedAt: NOW + 2 * DAY },       // 提前
  { done: true, startAt: NOW, endAt: NOW + 2 * DAY, expectedAt: NOW + 2 * DAY },   // 准时
  { done: true, startAt: NOW, endAt: NOW + 4 * DAY, expectedAt: NOW + 2 * DAY },   // 延期
  { done: true, startAt: NOW, endAt: NOW + 3 * DAY },                              // 没预期：不计入分布
]
const quality = completionQuality(doneTasks)
check('完成质量：完成数', quality.completed, 4)
check('完成质量：提前', quality.early, 1)
check('完成质量：准时', quality.onTime, 1)
check('完成质量：延期', quality.late, 1)
check('完成质量：周期样本', quality.cycleSamples, 4)
check('完成质量：周期中位', quality.cycleMedianDays, 2.5)

/* ── 承诺风险 ── */
const riskTasks = [
  { id: 'a', no: 1, title: '逾期', expectedAt: NOW - DAY },
  { id: 'b', no: 2, title: '未开工', expectedAt: NOW + DAY, sessionId: '' },
  { id: 'c', no: 3, title: '正常', expectedAt: NOW + DAY, sessionId: 's1' },
  { id: 'd', no: 4, title: '已完成', expectedAt: NOW - DAY, done: true },
]
const risk = promiseRisk(riskTasks, NOW)
check('承诺风险：逾期', risk.overdue.map((x) => x.id), ['a'])
check('承诺风险：未开工', risk.notStarted.map((x) => x.id), ['a', 'b'])
check('承诺风险：未到期', risk.upcoming.map((x) => x.id), ['b', 'c'])
check('承诺风险：不带已完成', risk.overdue.every((x) => x.id !== 'd'), true)

if (failures > 0) {
  console.error(`\n${failures} 项失败`)
  process.exitCode = 1
} else {
  console.log('\nCOMMITMENT_OK')
}
