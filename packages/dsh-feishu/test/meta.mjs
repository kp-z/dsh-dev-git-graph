/**
 * 任务元数据解析 + 自动开工选择的单元测试。
 *
 * 这两块是纯函数，是最值得单独测的地方：解析错一个词，任务就会在错误的工作区里开工；
 * 选择逻辑错一次，就会在不该开工的时候烧 token。
 *
 * 跑法：node test/meta.mjs
 */
import { mkdtemp, writeFile, utimes, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  adoptPreviousState,
  describeTask,
  progressCommentBody,
  deriveTaskDraft,
  docFieldValue,
  docxIdOf,
  sanitizeTaskDescription,
  evaluateAutoStart,
  parseAutoFlag,
  parseTaskMeta,
  parseTrigger,
  selectAutoStartCandidates,
  tasklistNameOf,
} from '../index.js'

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

/* ── 解析：中文键 ── */
check(
  '中文键：工作区 + 自动开工',
  parseTaskMeta({ summary: '修一下搜索', description: '工作区：dsh-plugins\n自动开工：是' }),
  { workspace: 'dsh-plugins', auto: true, source: 'description' },
)

/* ── 解析：英文键 / 等号 / 列表前缀 ── */
check(
  '英文键与等号',
  parseTaskMeta({ summary: 'x', description: '- workspace = /Users/kp/DEV/dsh-plugins\n* auto: on' }),
  { workspace: '/Users/kp/DEV/dsh-plugins', auto: true, source: 'description' },
)

/* ── 解析：标题标记 ── */
check(
  '标题里的 [ws:...] 标记',
  parseTaskMeta({ summary: '[ws:mviz] 对齐侧边栏', description: '' }),
  { workspace: 'mviz', auto: undefined, source: 'title' },
)

/* ── 显式关掉 ── */
check('自动开工：否', parseTaskMeta({ summary: 'x', description: '自动开工: 否' }).auto, false)
check('auto=false', parseAutoFlag('false'), false)
check('auto=关闭', parseAutoFlag('关闭'), false)
check('auto=乱七八糟', parseAutoFlag('也许吧'), undefined)

/* ── 描述优先于标题标记 ── */
check(
  '描述里的工作区优先',
  parseTaskMeta({ summary: '[ws:标题里的] x', description: '工作区: 描述里的' }).workspace,
  '描述里的',
)

/* ── 清单名兜底 ── */
check('清单名：对象数组', tasklistNameOf({ tasklists: [{ guid: 't', name: '感知平台' }] }), '感知平台')
check('清单名：字符串数组', tasklistNameOf({ tasklists: ['仿真'] }), '仿真')
check('清单名：空', tasklistNameOf({ tasklists: [] }), '')

/* ── 描述里的坏链（飞书会 400） ── */
check('本地路径链接降级为文字', sanitizeTaskDescription('见 [file](/Users/kp/a.js) 改完'), '见 file 改完')
check('锚点链接降级为文字', sanitizeTaskDescription('[行号](#L24)'), '行号')
check('合法链接保留地址', sanitizeTaskDescription('[文档](https://example.com/x)'), '文档 https://example.com/x')

/* ── 会话 → 任务草稿（脚本路径） ── */
const draft = deriveTaskDraft('## 结论\n\n**已完成**：面板同步卡接上。\n\n验证：npm test 全绿。')
check('草稿标题取第一行并去 markdown', draft.title, '结论')
check('草稿描述保留全文', draft.description.includes('npm test 全绿'), true)
check('空文本给兜底标题', deriveTaskDraft('', 'feishu-abc123').title, '会话工作整理（abc123）')
check('超长标题截断', deriveTaskDraft('一'.repeat(60)).title.length, 30)
const withFence = deriveTaskDraft('已提交。\n\n```dsh-ui\n{\"a\":1}\n```\n\n收尾。')
check('草稿剔除代码围栏', withFence.description.includes('dsh-ui'), false)
check('剔除围栏后描述保留正文', withFence.description.includes('收尾'), true)

/* ── 触发条件（新三态） ── */
check('trigger=自动执行', parseTrigger('自动执行'), 'auto')
check('trigger=按时执行', parseTrigger('按时执行'), 'scheduled')
check('trigger=人工触发', parseTrigger('人工触发'), 'manual')
check('trigger=旧字段 是', parseTrigger('是'), 'auto')
check('trigger=旧字段 否', parseTrigger('否'), 'manual')
check('trigger=空', parseTrigger(''), undefined)

/* ── 何时该自动开工 ── */
const base = { id: 't', isNew: true, started: false, done: false }
const NOW = 1_000_000_000_000
check('off 一律不开', evaluateAutoStart({ ...base, meta: { trigger: 'auto' } }, { autoStartMode: 'off' }, NOW).start, false)
check('人工触发不开', evaluateAutoStart({ ...base, meta: { trigger: 'manual' } }, { autoStartMode: 'all' }, NOW).start, false)
check('自动执行立刻开', evaluateAutoStart({ ...base, meta: { trigger: 'auto' } }, { autoStartMode: 'tagged' }, NOW).start, true)
check(
  '按时执行：还没到点',
  evaluateAutoStart({ ...base, meta: { trigger: 'scheduled' }, startTs: NOW + 60_000 }, { autoStartMode: 'tagged' }, NOW),
  { start: false, reason: '未到开始时间', waitMs: 60_000 },
)
check(
  '按时执行：窗口内',
  evaluateAutoStart({ ...base, meta: { trigger: 'scheduled' }, startTs: NOW - 1, endTs: NOW + 1 }, { autoStartMode: 'tagged' }, NOW).start,
  true,
)
check(
  '按时执行：已过结束时间',
  evaluateAutoStart({ ...base, meta: { trigger: 'scheduled' }, startTs: NOW - 100, endTs: NOW - 1 }, { autoStartMode: 'tagged' }, NOW).start,
  false,
)
check(
  '按时执行：没填开始时间',
  evaluateAutoStart({ ...base, meta: { trigger: 'scheduled' } }, { autoStartMode: 'tagged' }, NOW).start,
  false,
)
check('未标注 + tagged 不开', evaluateAutoStart({ ...base, meta: {} }, { autoStartMode: 'tagged' }, NOW).start, false)
check('未标注 + all 开', evaluateAutoStart({ ...base, meta: {} }, { autoStartMode: 'all' }, NOW).start, true)

/* ── 自动开工选择 ── */
const tasks = [
  { id: 'a', isNew: true, started: false, done: false, meta: { trigger: 'auto', workspace: 'w' } },
  { id: 'b', isNew: true, started: false, done: false, meta: {} },
  { id: 'c', isNew: true, started: false, done: false, meta: { trigger: 'manual' } },
  { id: 'd', isNew: true, started: true, done: false, meta: { trigger: 'auto' } },
  { id: 'e', isNew: false, started: false, done: false, meta: { trigger: 'auto' } },
]
const ids = (list) => list.map((t) => t.id)

check('mode=off 不开工', ids(selectAutoStartCandidates(tasks, { autoStartMode: 'off' })), [])
check('mode=tagged 只开标注的', ids(selectAutoStartCandidates(tasks, { autoStartMode: 'tagged' })), ['a'])
check(
  'mode=all 排除显式关闭',
  ids(selectAutoStartCandidates(tasks, { autoStartMode: 'all', maxAutoStartPerRun: 10 })),
  ['a', 'b'],
)
check(
  'mode=all 受上限约束',
  ids(selectAutoStartCandidates(tasks, { autoStartMode: 'all', maxAutoStartPerRun: 1 })),
  ['a'],
)
check(
  '已开工/旧任务不会被重复挑中',
  ids(selectAutoStartCandidates(tasks, { autoStartMode: 'tagged', maxAutoStartPerRun: 10 })),
  ['a'],
)

/* ---------- 文档：字段值拼装 + docx id 提取 ---------- */

check(
  '文档字段：去重 + 一行一个',
  docFieldValue({
    docs: [
      { url: 'https://a.feishu.cn/docx/AAA' },
      { url: 'https://a.feishu.cn/docx/AAA' },
      { url: ' https://a.feishu.cn/wiki/BBB ' },
      { url: '' },
      { title: '没链接' },
    ],
  }),
  'https://a.feishu.cn/docx/AAA\nhttps://a.feishu.cn/wiki/BBB',
)
check('文档字段：没有文档 → 空串', docFieldValue({}), '')
check('文档字段：task 为 undefined 不抛', docFieldValue(undefined), '')
check('docxIdOf：docx 链接', docxIdOf('https://x.feishu.cn/docx/Oj8ZdoWRFonRfIxkbfFcCiU0nBc'), 'Oj8ZdoWRFonRfIxkbfFcCiU0nBc')
check('docxIdOf：docx 链接带查询串', docxIdOf('https://x.feishu.cn/docx/abc123?from=chat'), 'abc123')
check('docxIdOf：wiki 链接返回空串', docxIdOf('https://x.feishu.cn/wiki/WikcnAbc'), '')
check('docxIdOf：空值不抛', docxIdOf(undefined), '')

/* ---------- 换端口重启：状态继承 ---------- */

{
  const dir = await mkdtemp(join(tmpdir(), 'dsh-feishu-adopt-'))
  const oldFile = join(dir, 'state-11111.json')
  const newerFile = join(dir, 'state-22222.json')
  const currentFile = join(dir, 'state-33333.json')
  await writeFile(oldFile, JSON.stringify({ tasks: [{ id: 'a', sessionId: 's-1' }, { id: 'b' }] }))
  await writeFile(newerFile, JSON.stringify({ tasks: [{ id: 'a', sessionId: null }] }))
  await writeFile(currentFile, JSON.stringify({}))
  const past = new Date(Date.now() - 600_000)
  await utimes(oldFile, past, past)

  const adopted = await adoptPreviousState(currentFile)
  check('换端口后继承上一份带会话绑定的状态', adopted?.file, oldFile)
  check('不会被空绑定的新状态顶掉', adopted?.bound, 1)

  const none = await adoptPreviousState(oldFile)
  check('本端口的文件自己有绑定时不乱继承', none, null)
  await rm(dir, { recursive: true, force: true })
}

/* ---------- 任务档案渲染 ---------- */

{
  const task = {
    title: 'T7-做点事',
    status: 'todo',
    done: false,
    listName: '主线任务',
    members: [
      { id: 'ou_1', role: 'assignee', name: '张三' },
      { id: 'ou_2', role: 'follower', name: '李四' },
    ],
    creator: { id: 'ou_3', name: '王五' },
    start: '2026-10-20 10:00',
    due: '2026-10-25',
    createdAt: 1792691144226,
    customFields: [
      { name: '工作区', value: 'DSH 插件开发' },
      { name: '文档', value: '' },
    ],
    docs: [{ url: 'https://x.feishu.cn/docx/AAA', title: '设计稿' }],
    url: 'https://applink.feishu.cn/client/todo/detail?guid=1',
    subtaskCount: 3,
    origin: { title: 'deep-research' },
    repeatRule: '',
    description: '这里是说明',
  }
  const text = describeTask(task)
  check('档案含负责人/关注人/创建人', ['负责人：张三', '关注人：李四', '创建人：王五'].every((line) => text.includes(line)), true)
  check(
    '档案含自定义字段、空值字段不占行',
    text.includes('工作区：DSH 插件开发') && !text.split('\n').includes('- 文档：'),
    true,
  )
  check('档案含文档与子任务', text.includes('设计稿（https://x.feishu.cn/docx/AAA）') && text.includes('子任务：3 条'), true)
  check('档案默认不带描述', text.includes('这里是说明'), false)
  check('includeDescription 才带描述', describeTask(task, { includeDescription: true }).includes('任务说明'), true)
  check('includeDocs:false 时不列文档', describeTask(task, { includeDocs: false }).includes('设计稿'), false)
  check('已完成任务状态显示已完成', describeTask({ ...task, done: true }).includes('状态：已完成'), true)
}

/* ---------- 进度评论正文 ---------- */

{
  const now = Date.UTC(2026, 9, 23, 9, 0, 0)
  const body = progressCommentBody('做完了 A\n\n```js\ncode()\n```\n\n还有 B', {}, now)
  check('进度评论去掉代码块', body.includes('code()'), false)
  check('进度评论保留正文', body.includes('做完了 A') && body.includes('还有 B'), true)
  check('进度评论带时间戳', body.includes('【进度】'), true)
  check('空的正常轮次不写评论', progressCommentBody('   ', {}), '')
  check(
    '失败轮次写原因',
    progressCommentBody('', { failed: true, reason: 'tool timeout' }).includes('本轮失败') &&
      progressCommentBody('', { failed: true, reason: 'tool timeout' }).includes('tool timeout'),
    true,
  )
  const long = progressCommentBody('x'.repeat(900), {}, now)
  check('超长正文截断并标注', long.includes('已截断') && long.length < 900, true)
}

if (failures > 0) {
  console.error(`\n${failures} 项失败`)
  process.exit(1)
}
console.log('\nMETA_OK')
process.exit(0)
