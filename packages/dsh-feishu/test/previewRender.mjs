/**
 * 离线渲染产物（`scripts/render-runs-preview.mjs` → `.runs-preview.html`）的结构红线。
 *
 * 为什么值得一个测试：这份产物是我每轮**唯一能自己看**的效果证据（真组件 + 真样式在 Node 里渲染），
 * 但它本身没人守 —— 之前就靠人工截图才发现「计时覆盖」卡渲染出了 `undefined 条`。
 * 现在把「产物里不该出现的东西」和「三页该有的结构」钉住：谁改坏了，不用等截图就能红。
 *
 * 跑法：node test/previewRender.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  FAIL ${name}`)
    console.log(String((error && error.stack) || error).split('\n').slice(0, 4).map((line) => `       ${line}`).join('\n'))
  }
}

const root = new URL('..', import.meta.url)
const out = new URL('../.runs-preview.html', import.meta.url)
execFileSync('node', ['scripts/render-runs-preview.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' })
check('产物已生成', () => assert.equal(existsSync(out), true))

const html = readFileSync(out, 'utf8')
const frames = html.split('<h2>')
const frameOf = (label) => {
  const hit = frames.find((part) => part.startsWith(label))
  assert.ok(hit, `产物里缺「${label}」这一段`)
  return hit
}

check('产物里不出现 undefined / NaN（模板里漏字段最容易在这里暴露）', () => {
  /* 允许出现在注释/文案里（比如这张卡的解释文字），但**不允许**出现在可见数值位 */
  const bad = html.match(/>[^<]*\b(undefined|NaN)\b[^<]*</g) || []
  assert.deepEqual(bad, [], `可见文本里出现了 ${JSON.stringify(bad.slice(0, 3))}`)
})

check('运行页：9 张卡 + 每行 4 列的跨度', () => {
  const runs = frameOf('运行')
  const labels = [...runs.matchAll(/aria-label="([^"]+)"[^>]*class="frx-card|class="frx-card[^"]*"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1] || m[2])
  assert.ok(runs.includes('frx-grid'), '缺网格容器')
  for (const label of ['运行状态', '项目分布（旭日图）', '阻塞排行', '待处理', '跑得最久', '暂缓', '计时覆盖', '执行历史', '快捷操作']) {
    assert.ok(runs.includes(label), `缺卡片：${label}`)
  }
  assert.ok((runs.match(/frx-card is-span2/g) || []).length >= 2, '第 1/3 行的跨列卡要还在')
})

check('运行页：旭日图两层环 + 状态徽标 + KPI 胶囊都渲出来了', () => {
  const runs = frameOf('运行')
  assert.ok((runs.match(/class="frx-sun"/g) || []).length === 1, '旭日图 svg 只有一个')
  assert.ok((runs.match(/<path d="M[\d.]+ [\d.]+A/g) || []).length >= 4, '内外圈至少 4 段弧')
  /* 已完成的气泡按用户口径**不挂徽标**，所以这里只会有 dots / alert / clock 三种 */
  for (const badge of ['dots', 'alert', 'clock']) {
    assert.ok(runs.includes(`data-badge="${badge}"`), `缺 ${badge} 徽标`)
  }
  assert.equal(runs.includes('data-badge="check"'), false, '已完成的气泡不该有徽标')
  assert.equal((runs.match(/frx-kpi"/g) || []).length, 4, 'KPI 胶囊必须是 4 个')
})

check('洞察页：渲染成功（没有红框错误）', () => {
  const insight = frameOf('洞察')
  assert.equal(insight.includes('渲染失败：'), false, '洞察页渲染失败')
  assert.ok(insight.includes('fd-donut') || insight.includes('fd-kpi'), '洞察页该有 KPI/分布卡')
})

check('关系页：侧栏树（真模型 rows）+ 画布节点都渲出来了', () => {
  const graph = frameOf('关系')
  assert.equal(graph.includes('渲染失败：'), false, '关系页渲染失败')
  assert.ok(graph.includes('aria-level'), '侧栏树要渲染出 treeitem 的 aria-level')
  for (const label of ['全部任务', '未分组']) assert.ok(graph.includes(label), `侧栏缺「${label}」`)
  assert.ok((graph.match(/class="fo-node"/g) || []).length >= 3, '画布至少 3 个节点')
  assert.ok(graph.includes('飞书任务集开发'), '节点标题要用 label/fullTitle（不是 id）')
})

console.log(`\npreviewRender.mjs: ${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
