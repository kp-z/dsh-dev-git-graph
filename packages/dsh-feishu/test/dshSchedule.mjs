/**
 * DSH 自动化任务桥接（dshSchedule.js）的单元测试。
 *
 * 这一层的风险不在算术，而在**映射**：插件的时间意图翻成 DSH 的 selector、
 * DSH 的记录翻回卡片文案。翻错一个字段，用户以为改了时间，DSH 里却纹丝不动。
 *
 * 跑法：node test/dshSchedule.mjs
 */
import {
  DEFAULT_AUTOMATION_PROMPT,
  automationPrompt,
  cronLabel,
  dshTime,
  dshTitle,
  everyLabel,
  primaryRecord,
  ruleOfRecord,
  toDshChange,
  toDshRequest,
  weeklyLabel,
} from '../dshSchedule.js'

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

/* ── 文本工具 ── */
check('dshTime：9:30 → 09:30:00', dshTime('9:30'), '09:30:00')
check('dshTime：09:30:05 原样补零', dshTime('09:30:05'), '09:30:05')
check('dshTime：空值', dshTime(''), '')
check('weeklyLabel：周一到周五 → 工作日', weeklyLabel([1, 2, 3, 4, 5], '09:00'), '工作日 09:00')
check('weeklyLabel：周一、周三', weeklyLabel([1, 3], '10:00'), '每周一、周三 10:00')
check('everyLabel：3600 秒 → 每 1 小时', everyLabel(3600), '每 1 小时')
check('everyLabel：300 秒 → 每 5 分钟', everyLabel(300), '每 5 分钟')
check('everyLabel：172800 秒 → 每 2 天', everyLabel(2 * 86400), '每 2 天')
check('cronLabel：每月', cronLabel('0 10 1 * *'), '每月 1 日 10:00')
check('cronLabel：多日', cronLabel('0 9 1,15 * *'), '每月 1、15 日 09:00')
check('cronLabel：每天', cronLabel('30 9 * * *'), '每天 09:30')
check('cronLabel：每周', cronLabel('30 9 * * 1,3'), '每周一、周三 09:30')
check('cronLabel：认不出就原样给', cronLabel('*/15 9-17 * * 1-5'), 'cron */15 9-17 * * 1-5')
check('dshTitle：截到 120', dshTitle('x'.repeat(200)).length, 120)
check('dshTitle：空标题兜底', dshTitle(''), '飞书任务自动化')

/* ── spec → DSH 请求 ── */
const daily = toDshRequest({ kind: 'daily', time: '09:00' }, { tz: SH, title: 'T1 修一下', prompt: '接着干' })
check('daily：selector', daily.request, { title: 'T1 修一下', prompt: '接着干', daily: { time: '09:00:00', time_zone: SH } })

const workdays = toDshRequest({ kind: 'workdays', time: '09:30' }, { tz: SH, title: 't', prompt: 'p' })
check('workdays → weekly 1-5', workdays.request.weekly, { time: '09:30:00', time_zone: SH, weekdays: [1, 2, 3, 4, 5] })

const weekly = toDshRequest({ kind: 'weekly', time: '10:00', weekdays: [1, 3] }, { tz: SH, title: 't', prompt: 'p' })
check('weekly', weekly.request.weekly, { time: '10:00:00', time_zone: SH, weekdays: [1, 3] })

const monthly = toDshRequest({ kind: 'monthly', time: '10:00', monthDays: [1, 15] }, { tz: SH, title: 't', prompt: 'p' })
check('monthly → cron', monthly.request.cron, { expression: '0 10 1,15 * *', time_zone: SH })

const every = toDshRequest({ kind: 'interval', everyMinutes: 60 }, { tz: SH, title: 't', prompt: 'p' })
check('interval → every_seconds', every.request.every_seconds, 3600)

const at = toDshRequest({ kind: 'at', at: '2026-11-02T15:00:00+08:00' }, { tz: SH, title: 't', prompt: 'p' })
check('at → ISO', at.request.at, '2026-11-02T07:00:00.000Z')

const tooTight = toDshRequest({ kind: 'interval', everyMinutes: 0.5 }, { tz: SH, title: 't', prompt: 'p' })
check('interval 太短被拒', tooTight.ok, false)

const withExtras = toDshRequest(
  { kind: 'daily', time: '09:00', quiet: [['12:00', '13:30']], until: '2026-12-31T15:59:59.000Z', maxRuns: 5 },
  { tz: SH, title: 't', prompt: 'p' },
)
check('丢掉的附加条件要报警（免打扰/截止/次数）', withExtras.warnings.length, 3)
check('附加条件不影响 selector', withExtras.request.daily, { time: '09:00:00', time_zone: SH })

/* ── spec → DSH 变更（update 用的判别字段） ── */
check('change：daily', toDshChange({ kind: 'daily', time: '08:00' }, { tz: SH, title: 't', prompt: 'p' }).change, {
  kind: 'daily',
  daily: { time: '08:00:00', time_zone: SH },
})
check('change：monthly → cron', toDshChange({ kind: 'monthly', time: '10:00', monthDays: [1] }, { tz: SH, title: 't', prompt: 'p' }).change, {
  kind: 'cron',
  cron: { expression: '0 10 1 * *', time_zone: SH },
})

/* ── DSH 记录 → 卡片文案 ── */
check('规则：daily', ruleOfRecord({ kind: 'daily', time: '09:00:00' }), '每天 09:00')
check('规则：weekly 工作日', ruleOfRecord({ kind: 'weekly', time: '09:00:00', weekdays: [1, 2, 3, 4, 5] }), '工作日 09:00')
check('规则：every', ruleOfRecord({ kind: 'every', everySeconds: 3600 }), '每 1 小时')
check('规则：cron 每月', ruleOfRecord({ kind: 'cron', expression: '0 10 1 * *' }), '每月 1 日 10:00')
check('规则：at 没有规则段', ruleOfRecord({ kind: 'at' }), '')

/* ── 多条的取舍 ── */
check(
  'primaryRecord：取最先到点',
  primaryRecord([
    { id: 'b', scheduledAt: '2026-11-02T09:00:00.000Z' },
    { id: 'a', scheduledAt: '2026-10-30T09:00:00.000Z' },
  ]).id,
  'a',
)
check('primaryRecord：空列表', primaryRecord([]), null)

/* ── 提示词 ── */
check('提示词：默认就是那句「接着干」', automationPrompt({}, { title: 'T1' }), DEFAULT_AUTOMATION_PROMPT)
check(
  '提示词：支持占位符',
  automationPrompt(
    { schedule: { automationPrompt: '继续「{{title}}」（{{list}} / {{workspace}}）：先制定计划' } },
    { title: 'T7', listName: '主线任务', workspaceName: 'DSH' },
  ),
  '继续「T7」（主线任务 / DSH）：先制定计划',
)
check('提示词：空模板回落到默认', automationPrompt({ schedule: { automationPrompt: '   ' } }, {}), DEFAULT_AUTOMATION_PROMPT)

if (failures > 0) {
  console.error(`\n${failures} / ${checks} 项失败`)
  process.exitCode = 1
} else {
  console.log(`\n${checks} 项全部通过`)
}
console.log('\nDSH_SCHEDULE_OK')
