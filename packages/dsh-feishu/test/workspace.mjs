/**
 * 工作区绑定（workspace.js）的单元测试。
 *
 * 这一层的每一个分支都对应一种「开错目录」的事故：名字改了、同名不同目录、
 * 工作区删了重建成新 id……所以宁可多写几条，也别让匹配悄悄放宽。
 *
 * 跑法：node test/workspace.mjs
 */
import { looksLikeAbsolutePath, matchWorkspace, normalizeWorkspaceName, titleChangeOf } from '../workspace.js'

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

const LIST = [
  { id: 'ws-a', title: '[DSH] 插件开发', path: '/Users/kp/DEV/dsh-plugins' },
  { id: 'ws-b', title: 'MSIM', path: '/Users/kp/DEV/msim-qviz-service' },
  { id: 'ws-c', title: '同名工作区', path: '/Users/kp/DEV/same-1' },
  { id: 'ws-d', title: '同名工作区', path: '/Users/kp/DEV/same-2' },
]

/* ── 归一化 ── */
check('归一化：去括号空格标点', normalizeWorkspaceName('[DSH] 插件-开发'), 'dsh插件开发')
check('归一化：大小写', normalizeWorkspaceName('MSIM'), 'msim')
check('绝对路径识别', looksLikeAbsolutePath('/Users/kp/DEV/x'), true)
check('绝对路径识别：名字不算', looksLikeAbsolutePath('dsh-plugins'), false)

/* ── 1. 已绑定：id 是主键（改名不断链） ── */
check(
  '绑定的 id 命中：即使飞书文本是旧名字也认',
  matchWorkspace({ list: LIST, binding: { id: 'ws-a', path: '/Users/kp/DEV/dsh-plugins', title: '[DSH] 插件开发' }, text: '旧名字' }).via,
  'id',
)
check(
  'id 命中时 path 必须一致，否则失效（不静默跟着走）',
  matchWorkspace({ list: LIST, binding: { id: 'ws-a', path: '/Users/kp/DEV/old', title: '旧' }, text: '' }).hint,
  'stale',
)

/* ── 2. id 没了（删了重建）：path 接上 ── */
check(
  'id 不在、path 命中 → 重绑',
  matchWorkspace({ list: LIST, binding: { id: 'ws-gone', path: '/Users/kp/DEV/msim-qviz-service' }, text: '' }),
  { hit: LIST[1], via: 'path' },
)

/* ── 3. 首次绑定：精确名字 ── */
check('精确标题命中', matchWorkspace({ list: LIST, text: 'MSIM' }), { hit: LIST[1], via: 'title' })
check('精确同名多个 → 拒绝选', matchWorkspace({ list: LIST, text: '同名工作区' }).hint, 'ambiguous')
check('精确路径命中', matchWorkspace({ list: LIST, text: '/Users/kp/DEV/dsh-plugins' }), { hit: LIST[0], via: 'path-text' })
check('归一化命中', matchWorkspace({ list: LIST, text: 'DSH插件开发' }), { hit: LIST[0], via: 'normalized' })

/* ── 4. 不再猜：包含匹配被删掉了 ── */
check('包含匹配不再命中（以前会开到别的工作区）', matchWorkspace({ list: LIST, text: '插件' }).hint, 'not-found')
check('路径后缀匹配不再命中', matchWorkspace({ list: LIST, text: 'dsh-plugins' }).hint, 'not-found')

/* ── 5. 未登记路径：给一个可登记的提示 ── */
check('未登记绝对路径', matchWorkspace({ list: LIST, text: '/Users/kp/DEV/new-project' }).hint, 'unregistered-path')

/* ── 6. 没有绑定也没有文本 ── */
check('空文本 + 无绑定', matchWorkspace({ list: LIST, text: '' }).hint, 'not-found')

/* ── 改名检测 ── */
check(
  '改名：绑定的 title 与 registry 不一致 → 给出新名字',
  titleChangeOf({ id: 'ws-a', title: '旧名字' }, LIST),
  { id: 'ws-a', from: '旧名字', to: '[DSH] 插件开发', path: '/Users/kp/DEV/dsh-plugins' },
)
check('没改名就不返回', titleChangeOf({ id: 'ws-a', title: '[DSH] 插件开发' }, LIST), null)
check('工作区没了就不返回', titleChangeOf({ id: 'ws-gone', title: 'x' }, LIST), null)
check('没有绑定就不返回', titleChangeOf(null, LIST), null)

if (failures > 0) {
  console.error(`\n${failures} / ${checks} 项失败`)
  process.exitCode = 1
} else {
  console.log(`\n${checks} 项全部通过`)
}
console.log('\nWORKSPACE_OK')
