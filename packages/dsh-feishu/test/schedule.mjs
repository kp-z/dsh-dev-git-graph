/**
 * 时间排期纯函数（schedule.js）的单元测试。
 *
 * 这一层是「插件做算术」的全部：时区换错一小时、窗口/免打扰推错一格、
 * 错过补偿判反一次，任务就会在错误的时间开工或者永远不开工。
 * 所以所有用例的 now 都是**显式时间戳**，不碰 Date.now()——否则测试在不同
 * 时区的机器上会给出不同结果，那就不叫测试了。
 *
 * 基准时刻：2026-10-28（周三）11:57:52 +08:00
 * 跑法：node test/schedule.mjs
 */
import {
  TZ_DEFAULT,
  advance,
  compileSpec,
  describeShort,
  describeSpec,
  evaluateSchedule,
  nextFireAt,
  parseWhen,
} from '../schedule.js'

let checks = 0
let failures = 0
function check(name, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`✗ ${name}\n  期望 ${e}\n  实际 ${a}`)
  } else {
    console.log(`✓ ${name}`)
  }
}

const SH = 'Asia/Shanghai'
const NY = 'America/New_York'
/** 固定基准：2026-10-28（周三）11:57:52 东八区。 */
const NOW = Date.parse('2026-10-28T11:57:52+08:00')

const iso = (ts) => (ts == null ? null : new Date(ts).toISOString())
const atOf = (spec) => (spec && spec.at ? new Date(spec.at).toISOString() : null)

/* ══════════════════ 导出与常量 ══════════════════ */

check('TZ_DEFAULT 是 Asia/Shanghai', TZ_DEFAULT, 'Asia/Shanghai')
check(
  '六个函数导出都在',
  [compileSpec, nextFireAt, evaluateSchedule, parseWhen, describeSpec, advance].map((fn) => typeof fn),
  ['function', 'function', 'function', 'function', 'function', 'function'],
)

/* ══════════════════ compileSpec：宽松输入 → 规范 spec ══════════════════ */

{
  const r = compileSpec({ kind: 'daily', time: '9:00', graceMinutes: '45', missPolicy: '补跑' }, { tz: SH })
  check('compile daily：H:mm 补零', r.spec.time, '09:00')
  check('compile daily：数字字符串 graceMinutes', r.spec.graceMinutes, 45)
  check('compile daily：中文 missPolicy 归一', r.spec.missPolicy, 'delay')
  check('compile 默认 missPolicy=delay / graceMinutes=30', [
    compileSpec({ kind: 'daily', time: '09:00' }, { tz: SH }).spec.missPolicy,
    compileSpec({ kind: 'daily', time: '09:00' }, { tz: SH }).spec.graceMinutes,
  ], ['delay', 30])
  check('compile 默认时区', compileSpec({ kind: 'daily', time: '09:00' }).spec.tz, SH)
  // 注意：opts.tz 只在 spec 没写 tz 时生效
  check('compile opts.tz 生效', compileSpec({ kind: 'daily', time: '09:00' }, { tz: NY }).spec.tz, NY)
}
{
  check('compile weekly：字符串 weekdays', compileSpec({ kind: 'weekly', time: '9:30', weekdays: '周一,周三' }).spec.weekdays, [1, 3])
  check('compile weekly：中文数组', compileSpec({ kind: 'weekly', time: '9:30', weekdays: ['一', '三', '五'] }).spec.weekdays, [1, 3, 5])
  check('compile weekly：数字字符串', compileSpec({ kind: 'weekly', time: '9:30', weekdays: '1,3' }).spec.weekdays, [1, 3])
  check('compile weekly：英文星期', compileSpec({ kind: 'weekly', time: '9:30', weekdays: 'mon,fri' }).spec.weekdays, [1, 5])
  check('compile weekly：去重并排序', compileSpec({ kind: 'weekly', time: '9:30', weekdays: [5, 1, 5] }).spec.weekdays, [1, 5])
  check('compile weekly：缺 weekdays 报错', compileSpec({ kind: 'weekly', time: '09:00' }).errors, ['kind=weekly 需要 weekdays（1=周一 … 7=周日）'])
}
{
  const withOffset = compileSpec({ kind: 'at', at: '2026-11-02T15:00:00+08:00' }, { tz: SH })
  check('compile at：带偏移的 ISO', withOffset.spec.at, '2026-11-02T07:00:00.000Z')
  const civil = compileSpec({ kind: 'at', at: '2026-11-02 15:00' }, { tz: SH })
  check('compile at：裸墙钟按 tz 解释', civil.spec.at, '2026-11-02T07:00:00.000Z')
  check('compile at 与带偏移的一致', civil.spec.at, withOffset.spec.at)
  const anchored = compileSpec({ kind: 'at', anchor: 'due', offsetMinutes: '-120' }, { tz: SH })
  check('compile at：anchor + 字符串 offsetMinutes', [anchored.spec.anchor, anchored.spec.offsetMinutes], ['due', -120])
  check('compile at：缺 at 也缺 anchor 报错', compileSpec({ kind: 'at' }).errors, ['kind=at 需要 at（绝对时刻）或 anchor + offsetMinutes'])
}
{
  check('compile window：字符串区间', compileSpec({ kind: 'daily', time: '09:00', window: '9:00-19:00' }).spec.window, ['09:00', '19:00'])
  check('compile window：数组', compileSpec({ kind: 'daily', time: '09:00', window: ['09:00', '19:00'] }).spec.window, ['09:00', '19:00'])
  check('compile window：对象', compileSpec({ kind: 'daily', time: '09:00', window: { start: '9:00', end: '19:00' } }).spec.window, ['09:00', '19:00'])
  check('compile quiet：单对数组', compileSpec({ kind: 'daily', time: '12:30', quiet: ['12:00', '13:30'] }).spec.quiet, [['12:00', '13:30']])
  check(
    'compile quiet：对象数组',
    compileSpec({ kind: 'daily', time: '12:30', quiet: [{ start: '12:00', end: '13:30' }, { start: '18:00', end: '18:30' }] }).spec.quiet,
    [['12:00', '13:30'], ['18:00', '18:30']],
  )
  check('compile quiet：字符串多段', compileSpec({ kind: 'daily', time: '12:30', quiet: '12:00-13:30, 18:00-18:30' }).spec.quiet, [
    ['12:00', '13:30'],
    ['18:00', '18:30'],
  ])
}
{
  check('compile until：只有日期取当天末', compileSpec({ kind: 'daily', time: '09:00', until: '2026-12-31' }).spec.until, '2026-12-31T15:59:59.000Z')
  check('compile maxRuns：字符串', compileSpec({ kind: 'daily', time: '09:00', maxRuns: '5' }).spec.maxRuns, 5)
  check('compile kind：中文别名', compileSpec({ kind: '每天', time: '09:00' }).spec.kind, 'daily')
  check('compile kind：英文别名', compileSpec({ kind: 'once', at: '2026-11-02 15:00' }).spec.kind, 'at')
  check('compile monthDays：带号字', compileSpec({ kind: 'monthly', time: '10:00', monthDays: '1号,15' }).spec.monthDays, [1, 15])
  check('compile 可以从一句中文来', compileSpec('每天 9:00', { now: NOW }).spec.time, '09:00')
}
{
  const r = compileSpec({ kind: 'daily', time: '乱写', window: 'x-y', missPolicy: 'whatever', maxRuns: '-1' })
  check('compile 错误一次全给：数量', r.errors.length, 4)
  check('compile 错误一次全给：ok=false 且没有 spec', [r.ok, r.spec], [false, undefined])
  check('compile 错误里带上了 time', r.errors[0].includes('time 无法解析'), true)
  check('compile 错误里带上了 missPolicy', r.errors.some((e) => e.includes('missPolicy 不认识')), true)
  check('compile null 不抛异常', compileSpec(null).errors, ['缺少 kind（at / interval / daily / workdays / weekly / monthly）'])
  check('compile 未知时区报错', compileSpec({ kind: 'daily', time: '09:00', tz: 'Mars/Base' }).errors, ['时区不认识：Mars/Base'])
  check('compile 怪输入也不抛', [compileSpec(42).ok, compileSpec([]).ok, compileSpec(undefined).ok], [false, false, false])
}

/* ══════════════════ nextFireAt：跨天 / 跨周 / 跨月 ══════════════════ */

const daily09 = { kind: 'daily', time: '09:00', tz: SH }

check('nextFireAt 一次性排期：未来', iso(nextFireAt({ kind: 'at', at: '2026-11-02T15:00:00+08:00', tz: SH }, NOW)), '2026-11-02T07:00:00.000Z')
check('nextFireAt 一次性排期：已过 → null', nextFireAt({ kind: 'at', at: '2026-10-27T15:00:00+08:00', tz: SH }, NOW), null)
check('nextFireAt 一次性排期：正好等于 after → null', nextFireAt({ kind: 'at', at: '2026-10-28T11:57:52+08:00', tz: SH }, NOW), null)
check('nextFireAt 每天：跨天', iso(nextFireAt(daily09, NOW)), '2026-10-29T01:00:00.000Z')
check('nextFireAt 每天：当天未到点', iso(nextFireAt(daily09, Date.parse('2026-10-28T08:00:00+08:00'))), '2026-10-28T01:00:00.000Z')
check('nextFireAt 工作日：周五晚 → 周一', iso(nextFireAt({ kind: 'workdays', time: '09:00', tz: SH }, Date.parse('2026-10-30T19:00:00+08:00'))), '2026-11-02T01:00:00.000Z')
check('nextFireAt 工作日：周六 → 周一', iso(nextFireAt({ kind: 'workdays', time: '09:00', tz: SH }, Date.parse('2026-10-31T12:00:00+08:00'))), '2026-11-02T01:00:00.000Z')
check('nextFireAt 每周：跨周', iso(nextFireAt({ kind: 'weekly', time: '09:30', weekdays: [1], tz: SH }, NOW)), '2026-11-02T01:30:00.000Z')
check('nextFireAt 每周：当天未到点', iso(nextFireAt({ kind: 'weekly', time: '09:30', weekdays: [1], tz: SH }, Date.parse('2026-11-02T08:00:00+08:00'))), '2026-11-02T01:30:00.000Z')
check('nextFireAt 每周：当天已过 → 下周', iso(nextFireAt({ kind: 'weekly', time: '09:30', weekdays: [1], tz: SH }, Date.parse('2026-11-02T10:00:00+08:00'))), '2026-11-09T01:30:00.000Z')
check('nextFireAt 每月：跨月', iso(nextFireAt({ kind: 'monthly', time: '10:00', monthDays: [1], tz: SH }, NOW)), '2026-11-01T02:00:00.000Z')
check('nextFireAt 每月：本月 31 号还在前面', iso(nextFireAt({ kind: 'monthly', time: '10:00', monthDays: [31], tz: SH }, NOW)), '2026-10-31T02:00:00.000Z')
check('nextFireAt 每月：11 月没有 31 → 12-31', iso(nextFireAt({ kind: 'monthly', time: '10:00', monthDays: [31], tz: SH }, Date.parse('2026-11-01T00:00:00+08:00'))), '2026-12-31T02:00:00.000Z')
check('nextFireAt 每月：2 月没有 31 → 3-31', iso(nextFireAt({ kind: 'monthly', time: '10:00', monthDays: [31], tz: SH }, Date.parse('2027-02-01T00:00:00+08:00'))), '2027-03-31T02:00:00.000Z')

check('nextFireAt until：已过 → null', nextFireAt({ ...daily09, until: '2026-10-29T09:00:00+08:00' }, Date.parse('2026-10-29T10:00:00+08:00')), null)
check('nextFireAt until：未过照常', iso(nextFireAt({ ...daily09, until: '2026-10-30T00:00:00+08:00' }, NOW)), '2026-10-29T01:00:00.000Z')
check('nextFireAt maxRuns：用满 → null', nextFireAt({ ...daily09, maxRuns: 10 }, NOW, { runs: 10 }), null)
check('nextFireAt maxRuns：差一次时还有', iso(nextFireAt({ ...daily09, maxRuns: 10 }, NOW, { runs: 9 })), '2026-10-29T01:00:00.000Z')
check('nextFireAt 支持对象形态的第二个参数', iso(nextFireAt(daily09, { after: NOW, runs: 1 })), '2026-10-29T01:00:00.000Z')
check('nextFireAt 认不出 spec → null', nextFireAt({ kind: '瞎写' }, NOW), null)

/* ── window / quiet 推迟 ── */

check('nextFireAt window：晚于窗口 → 次日窗口起点', iso(nextFireAt({ ...daily09, time: '20:30', window: ['09:00', '19:00'] }, NOW)), '2026-10-29T01:00:00.000Z')
check('nextFireAt window：早于窗口 → 当天窗口起点', iso(nextFireAt({ ...daily09, time: '08:00', window: ['09:00', '19:00'] }, Date.parse('2026-10-28T07:00:00+08:00'))), '2026-10-28T01:00:00.000Z')
check('nextFireAt quiet：推到免打扰结束', iso(nextFireAt({ ...daily09, time: '12:30', quiet: [['12:00', '13:30']] }, Date.parse('2026-10-28T11:00:00+08:00'))), '2026-10-28T05:30:00.000Z')
check(
  'nextFireAt quiet：推出窗口后落到下一窗口起点',
  iso(nextFireAt({ ...daily09, time: '18:30', quiet: [['18:00', '20:00']], window: ['09:00', '19:00'] }, Date.parse('2026-10-28T17:00:00+08:00'))),
  '2026-10-29T01:00:00.000Z',
)
check('nextFireAt 一次性排期也吃 window', iso(nextFireAt({ kind: 'at', at: '2026-10-29T20:30:00+08:00', window: ['09:00', '19:00'], tz: SH }, NOW)), '2026-10-30T01:00:00.000Z')

/* ── anchor（没有锚点时间就不猜） ── */

check('nextFireAt anchor：没给 anchorTs → null', nextFireAt({ kind: 'at', anchor: 'due', offsetMinutes: -120, tz: SH }, NOW), null)
check(
  'nextFireAt anchor：截止前 2 小时',
  iso(nextFireAt({ kind: 'at', anchor: 'due', offsetMinutes: -120, tz: SH }, Date.parse('2026-11-02T12:00:00+08:00'), { anchorTs: Date.parse('2026-11-02T15:00:00+08:00') })),
  '2026-11-02T05:00:00.000Z',
)

/* ── 时区：America/New_York 两个 DST 边界 ── */

check('DST 春季前拨：NY 03-08 09:00 = 13:00Z', iso(nextFireAt({ kind: 'daily', time: '09:00', tz: NY }, Date.parse('2026-03-07T15:00:00Z'))), '2026-03-08T13:00:00.000Z')
check('DST 春季前拨后一天：NY 03-09 09:00 = 13:00Z', iso(nextFireAt({ kind: 'daily', time: '09:00', tz: NY }, Date.parse('2026-03-08T14:00:00Z'))), '2026-03-09T13:00:00.000Z')
check('DST 秋季回拨：NY 11-01 09:00 = 14:00Z', iso(nextFireAt({ kind: 'daily', time: '09:00', tz: NY }, Date.parse('2026-10-31T15:00:00Z'))), '2026-11-01T14:00:00.000Z')
check('DST 秋季回拨后一天：NY 11-02 09:00 = 14:00Z', iso(nextFireAt({ kind: 'daily', time: '09:00', tz: NY }, Date.parse('2026-11-01T15:00:00Z'))), '2026-11-02T14:00:00.000Z')
check('DST 空洞时刻顺延：NY 03-08 02:30 → 03:30 EDT', iso(nextFireAt({ kind: 'daily', time: '02:30', tz: NY }, Date.parse('2026-03-07T15:00:00Z'))), '2026-03-08T07:30:00.000Z')
check('每周排期跨过 DST：NY 周日 09:00', iso(nextFireAt({ kind: 'weekly', time: '09:00', weekdays: [7], tz: NY }, Date.parse('2026-03-03T15:00:00Z'))), '2026-03-08T13:00:00.000Z')
check('上海没有 DST：03-08 09:00 仍是 01:00Z', iso(nextFireAt({ kind: 'daily', time: '09:00', tz: SH }, Date.parse('2026-03-07T15:00:00Z'))), '2026-03-08T01:00:00.000Z')
check('NY 的「同一墙钟」在夏冬令时给出不同 epoch', iso(nextFireAt({ kind: 'daily', time: '09:00', tz: NY }, Date.parse('2026-03-07T15:00:00Z'))) === iso(nextFireAt({ kind: 'daily', time: '09:00', tz: NY }, Date.parse('2026-10-31T15:00:00Z'))), false)

/* ══════════════════ evaluateSchedule：唯一调度入口 ══════════════════ */

function verdict(entry, opts = {}) {
  const r = evaluateSchedule(entry, opts)
  return {
    fire: r.fire,
    reason: r.reason,
    nextAt: iso(r.nextAt),
    waitMs: r.waitMs,
    late: r.late,
    deferredBy: r.deferredBy,
  }
}

const firedYesterday = { spec: daily09, lastFiredAt: Date.parse('2026-10-27T09:00:00+08:00'), runs: 1 }

check('到点：正好踩在触发时刻', verdict(firedYesterday, { now: Date.parse('2026-10-28T09:00:00+08:00') }), {
  fire: true,
  reason: '到点',
  nextAt: '2026-10-29T01:00:00.000Z',
  waitMs: 0,
  late: 0,
  deferredBy: 0,
})
check('到点：宽限内补跑（态晚 10 分钟）', verdict(firedYesterday, { now: Date.parse('2026-10-28T09:10:00+08:00') }), {
  fire: true,
  reason: '到点',
  nextAt: '2026-10-29T01:00:00.000Z',
  waitMs: 0,
  late: 600_000,
  deferredBy: 0,
})
check('未到点：等下一次并给出 waitMs', verdict({ ...firedYesterday, lastFiredAt: Date.parse('2026-10-28T09:00:00+08:00') }, { now: NOW }), {
  fire: false,
  reason: '未到点',
  nextAt: '2026-10-29T01:00:00.000Z',
  waitMs: 75_728_000,
  late: 0,
  deferredBy: 0,
})

const sleptTwoHours = { now: Date.parse('2026-10-28T11:00:00+08:00') }
check('missPolicy=skip：机器睡了 2 小时', verdict(firedYesterday, { ...sleptTwoHours, defaultMissPolicy: 'skip' }).reason, '机器睡了 2 小时，按 skip 跳过')
check('missPolicy=skip：不 fire 且推进到下一次', verdict(firedYesterday, { ...sleptTwoHours, defaultMissPolicy: 'skip' }).fire, false)
check('missPolicy=skip：nextAt 是明天', verdict(firedYesterday, { ...sleptTwoHours, defaultMissPolicy: 'skip' }).nextAt, '2026-10-29T01:00:00.000Z')
check('missPolicy=next：给出跳过一次的说法', verdict(firedYesterday, { ...sleptTwoHours, defaultMissPolicy: 'next' }).reason, '机器睡了 2 小时，按 next 跳到下一次')
check('missPolicy=delay：超过宽限也跳过', verdict(firedYesterday, sleptTwoHours).reason, '机器睡了 2 小时，超过 30 分钟宽限，跳过')
check('missPolicy=delay：宽限内补跑一次', verdict(firedYesterday, { ...sleptTwoHours, graceMs: 3 * 3_600_000 }), {
  fire: true,
  reason: '到点',
  nextAt: '2026-10-29T01:00:00.000Z',
  waitMs: 0,
  late: 7_200_000,
  deferredBy: 0,
})
check('spec 里的 missPolicy 优先于 opts.defaultMissPolicy', verdict({ spec: { ...daily09, missPolicy: 'skip' }, lastFiredAt: Date.parse('2026-10-27T09:00:00+08:00') }, { ...sleptTwoHours, defaultMissPolicy: 'delay' }).reason, '机器睡了 2 小时，按 skip 跳过')

/* ── 免打扰 / 工作时段 ── */

check(
  '免打扰：推迟到 13:30',
  verdict(
    { spec: { kind: 'daily', time: '12:30', quiet: [['12:00', '13:30']], tz: SH }, createdAt: Date.parse('2026-10-28T11:00:00+08:00') },
    { now: Date.parse('2026-10-28T12:00:00+08:00') },
  ),
  { fire: false, reason: '免打扰推迟到 13:30', nextAt: '2026-10-28T05:30:00.000Z', waitMs: 5_400_000, late: 0, deferredBy: 3_600_000 },
)
check(
  '工作时段外：推到下一个窗口起点',
  verdict(
    { spec: { kind: 'daily', time: '20:30', window: ['09:00', '19:00'], tz: SH }, createdAt: Date.parse('2026-10-28T11:00:00+08:00') },
    { now: Date.parse('2026-10-28T20:00:00+08:00') },
  ),
  { fire: false, reason: '不在工作时段，推迟到 09:00', nextAt: '2026-10-29T01:00:00.000Z', waitMs: 46_800_000, late: 0, deferredBy: 45_000_000 },
)

/* ── 截止 / 次数 / 任务状态 ── */

check('已过截止时间（until）', verdict({ spec: { ...daily09, until: '2026-10-28T03:00:00.000Z' } }, { now: NOW }), {
  fire: false,
  reason: '已过截止时间',
  nextAt: null,
  waitMs: 0,
  late: 0,
  deferredBy: 0,
})
check('已过截止时间（任务 endTs）', verdict({ spec: daily09 }, { now: NOW, endTs: Date.parse('2026-10-28T10:00:00+08:00') }).reason, '已过截止时间')
check('已开工不触发', verdict({ spec: daily09 }, { now: NOW, started: true }).reason, '已开工')
check('已完成不触发', verdict({ spec: daily09 }, { now: NOW, done: true }).reason, '已完成')
check('已暂停：给原因但保留 nextAt', verdict({ spec: daily09, paused: true }, { now: NOW }).reason, '已暂停')
check('已暂停仍有下一次时刻', verdict({ spec: daily09, paused: true }, { now: NOW }).nextAt, '2026-10-29T01:00:00.000Z')
check('次数用满：不再排期', verdict({ spec: { ...daily09, maxRuns: 3 }, runs: 3 }, { now: NOW }).reason, '已触发 3 次，不再排期')
check('没有 spec 不炸', verdict({}, { now: NOW }).reason, '排期不完整')

/* ── 一次性排期 ── */

const atSpec = { kind: 'at', at: '2026-10-28T15:00:00+08:00', tz: SH }
check('一次性：未到点', verdict({ spec: atSpec }, { now: NOW }), {
  fire: false,
  reason: '未到点',
  nextAt: '2026-10-28T07:00:00.000Z',
  waitMs: 10_928_000,
  late: 0,
  deferredBy: 0,
})
check('一次性：到点且下次为 null', verdict({ spec: atSpec }, { now: Date.parse('2026-10-28T15:00:00+08:00') }), {
  fire: true,
  reason: '到点',
  nextAt: null,
  waitMs: 0,
  late: 0,
  deferredBy: 0,
})
check('一次性：触发过就不再触发', verdict({ spec: atSpec, lastFiredAt: Date.parse('2026-10-28T15:00:00+08:00'), runs: 1 }, { now: NOW }).reason, '已触发过')
check('anchor 排期缺锚点时间：明说', verdict({ spec: { kind: 'at', anchor: 'due', offsetMinutes: -120, tz: SH } }, { now: NOW }).reason, '排期待定（缺少锚点时间）')
check(
  'anchor 排期给了 anchorTs 就能算',
  verdict({ spec: { kind: 'at', anchor: 'due', offsetMinutes: -120, tz: SH } }, { now: Date.parse('2026-11-02T12:00:00+08:00'), anchorTs: Date.parse('2026-11-02T15:00:00+08:00') }).nextAt,
  '2026-11-02T05:00:00.000Z',
)
check(
  'spec 字段写得很松也能跑（time=9:00）',
  verdict({ spec: { kind: 'daily', time: '9:00', tz: SH }, lastFiredAt: Date.parse('2026-10-27T09:00:00+08:00') }, { now: Date.parse('2026-10-28T09:00:00+08:00') }).fire,
  true,
)
check('endTs 过期优先于「已暂停」', verdict({ spec: daily09, paused: true }, { now: NOW, endTs: Date.parse('2026-10-28T10:00:00+08:00') }).reason, '已过截止时间')
check('endTs 过期优先于「已完成」', verdict({ spec: daily09 }, { now: NOW, done: true, endTs: Date.parse('2026-10-28T10:00:00+08:00') }).reason, '已过截止时间')
check('endTs 没过时其它判定照旧', verdict({ spec: daily09 }, { now: NOW, done: true, endTs: Date.parse('2026-10-28T20:00:00+08:00') }).reason, '已完成')

/* ══════════════════ parseWhen：设计文档 §4 表格逐行 ══════════════════ */

function when(text, opts = {}) {
  const r = parseWhen(text, { tz: SH, now: NOW, ...opts })
  return r.ok ? r.spec : { error: r.error }
}

check('表格：绝对时刻（带偏移）', atOf(when('2026-11-02T15:00:00+08:00')), '2026-11-02T07:00:00.000Z')
check('表格：绝对时刻（裸墙钟）', atOf(when('2026-11-02 15:00')), '2026-11-02T07:00:00.000Z')
check('表格：明天 15:00', atOf(when('明天 15:00')), '2026-10-29T07:00:00.000Z')
check('表格：明天下午三点', atOf(when('明天下午三点')), '2026-10-29T07:00:00.000Z')
check('表格：今晚八点', atOf(when('今晚八点')), '2026-10-28T12:00:00.000Z')
check('表格：后天上午 10 点', atOf(when('后天上午 10 点')), '2026-10-30T02:00:00.000Z')
check('表格：30 分钟后', atOf(when('30 分钟后')), '2026-10-28T04:27:52.000Z')
check('表格：两小时后（中文数字）', atOf(when('两小时后')), '2026-10-28T05:57:52.000Z')
check('表格：半小时后', atOf(when('半小时后')), '2026-10-28T04:27:52.000Z')
check('表格：下周一 9:30', atOf(when('下周一 9:30')), '2026-11-02T01:30:00.000Z')
check('表格：本周五 18:00', atOf(when('本周五 18:00')), '2026-10-30T10:00:00.000Z')
check('表格：周一（最近的未来）', atOf(when('周一')), '2026-11-02T01:00:00.000Z')
check('表格：每天 9:00', [when('每天 9:00').kind, when('每天 9:00').time], ['daily', '09:00'])
check('表格：每日 8:30', [when('每日 8:30').kind, when('每日 8:30').time], ['daily', '08:30'])
check('表格：工作日 9:00', [when('工作日 9:00').kind, when('工作日 9:00').time], ['workdays', '09:00'])
check('表格：每个工作日早上九点', [when('每个工作日早上九点').kind, when('每个工作日早上九点').time], ['workdays', '09:00'])
check('表格：每周一 9:30', [when('每周一 9:30').kind, when('每周一 9:30').weekdays, when('每周一 9:30').time], ['weekly', [1], '09:30'])
check('表格：每周五 18:00', [when('每周五 18:00').weekdays, when('每周五 18:00').time], [[5], '18:00'])
check('表格：每周一、三 10:00', [when('每周一、三 10:00').weekdays, when('每周一、三 10:00').time], [[1, 3], '10:00'])
check('表格：每月 1 号 10:00', [when('每月 1 号 10:00').kind, when('每月 1 号 10:00').monthDays, when('每月 1 号 10:00').time], ['monthly', [1], '10:00'])
check('表格：每月 15 日', [when('每月 15 日').monthDays, when('每月 15 日').time], [[15], '09:00'])
check('表格：截止前 2 小时', [when('截止前 2 小时').kind, when('截止前 2 小时').anchor, when('截止前 2 小时').offsetMinutes], ['at', 'due', -120])
check('表格：提前一天', [when('提前一天').anchor, when('提前一天').offsetMinutes], ['due', -1440])
check('表格：到期前 30 分钟', [when('到期前 30 分钟').anchor, when('到期前 30 分钟').offsetMinutes], ['due', -30])
check('表格：开工后 1 小时', [when('开工后 1 小时').anchor, when('开工后 1 小时').offsetMinutes], ['start', 60])
check('表格：带窗口', when('工作日 9:00，只在 9:00-19:00 之间').window, ['09:00', '19:00'])
check('表格：带免打扰', when('每天 9:00，午休别打扰').quiet, [['12:00', '13:30']])
check('表格：带截止（到 12 月底）', when('每周一 9:30 到 12 月底').until, '2026-12-31T15:59:59.000Z')
check('表格：带截止时仍保留星期', when('每周一 9:30 到 12 月底').weekdays, [1])

/* ── 时刻写法的各种组合 ── */

check('时间：15:00', atOf(when('15:00')), '2026-10-28T07:00:00.000Z')
check('时间：15点', atOf(when('15点')), '2026-10-28T07:00:00.000Z')
check('时间：3 点半', atOf(when('3 点半')), '2026-10-28T19:30:00.000Z')
check('时间：三点半', atOf(when('三点半')), '2026-10-28T19:30:00.000Z')
check('时间：晚上 8 点', atOf(when('晚上 8 点')), '2026-10-28T12:00:00.000Z')
check('时间：晚上八点半', atOf(when('晚上八点半')), '2026-10-28T12:30:00.000Z')
check('时间：凌晨 2 点（今天已过 → 顺延）', atOf(when('凌晨 2 点')), '2026-10-28T18:00:00.000Z')
check('时间：中午 12 点', atOf(when('中午 12 点')), '2026-10-28T04:00:00.000Z')
check('时间：下午 3:15', atOf(when('下午 3:15')), '2026-10-28T07:15:00.000Z')
check('时间：上午九点（今天已过 → 顺延）', atOf(when('上午九点')), '2026-10-29T01:00:00.000Z')
check('时间：早上 7:30（今天已过 → 顺延）', atOf(when('早上 7:30')), '2026-10-28T23:30:00.000Z')

/* ── 时区跟着 opts.tz 走 ── */

check('parseWhen 认 opts.tz：纽约的明天 15:00', atOf(when('明天 15:00', { tz: NY })), '2026-10-28T19:00:00.000Z')
check('parseWhen 结果带上 tz', when('每天 9:00', { tz: NY }).tz, NY)

/* ── 解析失败路径 ── */

{
  const bad = parseWhen('瞎写的', { tz: SH, now: NOW })
  check('解析失败：ok=false 且不抛', bad.ok, false)
  check('解析失败：给一句错因', typeof bad.error === 'string' && bad.error.length > 0, true)
  check('解析失败：给候选列表', bad.candidates.length, 4)
  check('解析失败：候选都有 label/at/spec', bad.candidates.every((c) => typeof c.label === 'string' && 'at' in c && typeof c.spec === 'object'), true)
  check('解析失败：候选里有一条「每天 09:00」', bad.candidates.some((c) => c.spec.kind === 'daily' && c.spec.time === '09:00'), true)
  check('空字符串也返回失败', parseWhen('', { now: NOW }).ok, false)
  check('非字符串输入不抛异常', parseWhen(null, { now: NOW }).ok, false)
  check('只有窗口没有时间 → 失败', parseWhen('只在 9:00-19:00 之间', { now: NOW }).ok, false)
  check('同一句话两次解析结果一致', JSON.stringify(when('下周一 9:30')), JSON.stringify(when('下周一 9:30')))
}

/* ══════════════════ describeSpec：人话文案 ══════════════════ */

check('describe：每周一 09:30', describeSpec({ kind: 'weekly', time: '09:30', weekdays: [1] }), '每周一 09:30')
check('describe：多个星期', describeSpec({ kind: 'weekly', time: '10:00', weekdays: [1, 3] }), '每周一、三 10:00')
check('describe：绝对时刻', describeSpec({ kind: 'at', at: '2026-11-02T15:00:00+08:00' }), '2026-11-02 15:00')
check('describe：绝对时刻带「还有多久」', describeSpec({ kind: 'at', at: '2026-11-02T15:00:00+08:00' }, { now: Date.parse('2026-11-02T13:00:00+08:00') }), '2026-11-02 15:00（还有 2 小时）')
check('describe：工作日', describeSpec({ kind: 'workdays', time: '09:00' }), '每天 09:00（工作日）')
check('describe：每天', describeSpec({ kind: 'daily', time: '09:00' }), '每天 09:00')
check('describe：截止前 2 小时', describeSpec({ kind: 'at', anchor: 'due', offsetMinutes: -120 }), '截止前 2 小时')
check('describe：提前一天', describeSpec({ kind: 'at', anchor: 'due', offsetMinutes: -1440 }), '截止前 1 天')
check('describe：到期前 30 分钟', describeSpec({ kind: 'at', anchor: 'due', offsetMinutes: -30 }), '截止前 30 分钟')
check('describe：开工后 1 小时', describeSpec({ kind: 'at', anchor: 'start', offsetMinutes: 60 }), '开工后 1 小时')
check('describe：每月', describeSpec({ kind: 'monthly', time: '10:00', monthDays: [1, 15] }), '每月 1、15 号 10:00')
check('describe：带窗口', describeSpec({ kind: 'daily', time: '09:00', window: ['09:00', '19:00'] }), '每天 09:00，只在 09:00-19:00')
check('describe：带截止', describeSpec({ kind: 'weekly', time: '09:30', weekdays: [1], until: '2026-12-31T15:59:59.000Z' }), '每周一 09:30，到 2026-12-31')
check('describe：认不出的 spec 给兜底', describeSpec({ kind: '瞎写' }), '未设置排期')

/* ── compact：面板 chip 只要「什么时候」 ── */

{
  const weeklyWithNoise = { kind: 'weekly', time: '09:30', weekdays: [1], window: ['09:00', '19:00'], quiet: [['12:00', '13:30']], until: '2026-12-31T15:59:59.000Z' }
  check('describe 默认仍带附加说明', describeSpec(weeklyWithNoise).includes('，免打扰 12:00-13:30'), true)
  check('describe compact：不带免打扰/工作时段/截止', describeSpec(weeklyWithNoise, { compact: true }), '每周一 09:30')
  check('describe compact：每天', describeSpec({ kind: 'daily', time: '09:00', quiet: [['12:00', '13:30']] }, { compact: true }), '每天 09:00')
  check('describe compact：绝对时刻不带「还有多久」', describeSpec({ kind: 'at', at: '2026-11-02T15:00:00+08:00' }, { now: Date.parse('2026-11-02T13:00:00+08:00'), compact: true }), '2026-11-02 15:00')
  check('describe compact：非 compact 才带「还有多久」', describeSpec({ kind: 'at', at: '2026-11-02T15:00:00+08:00' }, { now: Date.parse('2026-11-02T13:00:00+08:00') }), '2026-11-02 15:00（还有 2 小时）')
  check('describe compact：锚点表达原样保留', describeSpec({ kind: 'at', anchor: 'due', offsetMinutes: -120 }, { compact: true }), '截止前 2 小时')
  check('describe compact：工作日', describeSpec({ kind: 'workdays', time: '09:00', window: ['09:00', '19:00'] }, { compact: true }), '每天 09:00（工作日）')
}

/* ══════════════════ advance：触发后的下一状态 ══════════════════ */

{
  const next = advance({ spec: daily09, runs: 1 }, NOW)
  check('advance：runs+1', next.entry.runs, 2)
  check('advance：记下 lastFiredAt', next.entry.lastFiredAt, NOW)
  check('advance：每天排期没完', next.done, false)
  check('advance：保留原有字段', advance({ spec: daily09, runs: 1, createdAt: 123, paused: false }, NOW).entry.createdAt, 123)
}
check('advance：maxRuns 用满 → done', advance({ spec: { ...daily09, maxRuns: 2 }, runs: 1 }, NOW).done, true)
check('advance：过了 until → done', advance({ spec: { ...daily09, until: '2026-10-29T00:00:00+08:00' }, runs: 1 }, Date.parse('2026-10-29T09:00:00+08:00')).done, true)
check('advance：一次性排期触发后 → done', advance({ spec: { kind: 'at', at: '2026-11-02T15:00:00+08:00', tz: SH }, runs: 0 }, NOW).done, true)
check('advance：countRun=false 时不加次数（skip 推进用）', advance({ spec: daily09, runs: 3 }, NOW, { countRun: false }).entry.runs, 3)
check('advance：countRun=false 时也推进 lastFiredAt', advance({ spec: daily09, runs: 3 }, NOW, { countRun: false }).entry.lastFiredAt, NOW)

/* ══════════════════ interval：每隔 N 分钟 / N 小时 ══════════════════ */

{
  check('interval：每隔一小时 → 60 分钟', parseWhen('每隔一小时', { tz: SH, now: NOW }).spec, { kind: 'interval', everyMinutes: 60, tz: SH })
  check('interval：每小时', parseWhen('每小时', { tz: SH, now: NOW }).spec.everyMinutes, 60)
  check('interval：每 30 分钟', parseWhen('每 30 分钟', { tz: SH, now: NOW }).spec.everyMinutes, 30)
  check('interval：每半小时', parseWhen('每半小时', { tz: SH, now: NOW }).spec.everyMinutes, 30)
  check('interval：每隔两小时', parseWhen('每隔两小时', { tz: SH, now: NOW }).spec.everyMinutes, 120)
  check('interval：每隔两天', parseWhen('每隔两天', { tz: SH, now: NOW }).spec.everyMinutes, 2880)
  check('interval：每两周', parseWhen('每两周', { tz: SH, now: NOW }).spec.everyMinutes, 20160)
  /* 「每」字也出现在每天/每周里：这两种不能被间隔规则抢走 */
  check('interval 不抢「每天」', parseWhen('每天 9:00', { tz: SH, now: NOW }).spec.kind, 'daily')
  check('interval 不抢「每周一」', parseWhen('每周一 9:30', { tz: SH, now: NOW }).spec.kind, 'weekly')
  check('连写的星期要拆开', parseWhen('每周一三五 9:00', { tz: SH, now: NOW }).spec.weekdays, [1, 3, 5])
  check('interval：< 5 分钟被拒', compileSpec({ kind: 'interval', everyMinutes: 1 }, { tz: SH }).ok, false)
  check('interval：下次 = 创建时刻 + 步长', nextFireAt({ kind: 'interval', everyMinutes: 60, tz: SH }, NOW), NOW + 3_600_000)
  check('interval：到点触发', evaluateSchedule({ spec: { kind: 'interval', everyMinutes: 60, tz: SH }, createdAt: NOW, runs: 0 }, { now: NOW + 3_600_000 }).fire, true)
  check('interval：触发后不是 done', advance({ spec: { kind: 'interval', everyMinutes: 60, tz: SH }, runs: 0 }, NOW + 3_600_000).done, false)
  check('interval：describe', describeSpec({ kind: 'interval', everyMinutes: 60 }), '每 1 小时')
  check('interval：describe 90 分钟', describeSpec({ kind: 'interval', everyMinutes: 90 }), '每 90 分钟')
}

/* ══════════════════ describeShort：面板 chip 的短文案 ══════════════════ */

{
  check('short：每天只写日期', describeShort({ kind: 'daily', time: '09:00', tz: SH }, { now: NOW, nextAt: Date.parse('2026-10-29T09:00:00+08:00') }), '每天 09:00 · 明天')
  check('short：每周', describeShort({ kind: 'weekly', time: '09:30', weekdays: [1], tz: SH }, { now: NOW, nextAt: Date.parse('2026-11-02T09:30:00+08:00') }), '每周一 09:30 · 11-02')
  check('short：每月', describeShort({ kind: 'monthly', time: '10:00', monthDays: [1], tz: SH }, { now: NOW, nextAt: Date.parse('2026-11-01T10:00:00+08:00') }), '每月 1 日 10:00 · 11-01')
  check('short：工作日', describeShort({ kind: 'workdays', time: '09:00', tz: SH }, { now: NOW, nextAt: Date.parse('2026-10-29T09:00:00+08:00') }), '工作日 09:00 · 明天')
  check('short：interval', describeShort({ kind: 'interval', everyMinutes: 60, tz: SH }, { now: NOW, nextAt: NOW + 3_600_000 }), '每 1 小时 · 今天')
  check('short：一次性带钟点', describeShort({ kind: 'at', at: '2026-10-29T15:00:00+08:00', tz: SH }, { now: NOW, nextAt: Date.parse('2026-10-29T15:00:00+08:00') }), '明天 15:00')
  check('short：跨年写全年份', describeShort({ kind: 'at', at: '2027-01-05T09:30:00+08:00', tz: SH }, { now: NOW, nextAt: Date.parse('2027-01-05T09:30:00+08:00') }), '2027-01-05 09:30')
  check('short：锚点意图留在规则位', describeShort({ kind: 'at', at: '2026-11-05T16:00:00+08:00', note: '截止前 2 小时', tz: SH }, { now: NOW, nextAt: Date.parse('2026-11-05T16:00:00+08:00') }), '截止前 2 小时 · 11-05 16:00')
}

/* ══════════════════ 收尾 ══════════════════ */

if (failures > 0) {
  console.error(`\n${failures} / ${checks} 项失败`)
  process.exitCode = 1
} else {
  console.log(`\n${checks} 项全部通过`)
}
console.log('\nSCHEDULE_OK')
