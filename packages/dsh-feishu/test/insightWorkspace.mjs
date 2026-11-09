/**
 * 工作区归组：图表里「工作区」以名字最前面 [] 里的内容为准，
 * [] 内相同就算同一个工作区，工作区负载/分布不能再按全名各算一块。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const start = source.indexOf('  function workspaceGroup(name) {')
const end = source.indexOf('\n  /** 趋势数据', start)
assert.ok(start > 0 && end > start, 'workspaceGroup located')
const context = { asString: (value) => (value == null ? '' : String(value)) }
vm.createContext(context)
vm.runInContext(source.slice(start, end) + '\nthis.workspaceGroup = workspaceGroup', context)
const group = context.workspaceGroup

assert.equal(group('[QVIZ] 坐标转换'), 'QVIZ', '方括号里的内容就是工作区')
assert.equal(group('[QVIZ]qviz-scenepack'), 'QVIZ', '无空格写法同样归到 QVIZ')
assert.equal(group('[MvizLite] 前端工作区 C'), 'MvizLite', '不同子方向合并到同一工作区')
assert.equal(group('  [QVIZ] 带空格前缀  '), 'QVIZ', '首尾空白不影响归组')
assert.equal(group('[A][B] 嵌套'), 'A', '只取最前面一对括号')

/* 没有 [] 或 [] 为空时不能并成一个：按原名单列 */
assert.equal(group('QVIZ'), 'QVIZ', '没有方括号就保留原工作区名')
assert.equal(group('MvizLite 前端'), 'MvizLite 前端', '没有方括号就保留原工作区名')
assert.equal(group('[] 空括号'), '[] 空括号', '空括号不归组，避免把无关任务并到一起')
assert.equal(group('   '), '未分配', '空名落到未分配')
assert.equal(group(''), '未分配', '空名落到未分配')

/* 归组确实发生在统计口径上：两段同前缀工作区合并为一块 */
const statsStart = source.indexOf('  function insightStats(days = 14) {')
const statsEnd = source.indexOf('\n  /** 给模型看的紧凑数据', statsStart)
assert.ok(statsStart > 0 && statsEnd > statsStart, 'insightStats located')
assert.ok(
  source.slice(statsStart, statsEnd).includes('workspaceGroup('),
  '工作区统计必须走 workspaceGroup，否则图表还是按全名各算一块',
)

console.log('INSIGHT_WORKSPACE_OK: [] 前缀归组，工作区负载/分布不再按全名拆开')
