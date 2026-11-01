import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

/*
 * 今日洞察图表面板：不依赖浏览器，用最小假 DOM 跑面板里的真实函数。
 * 覆盖三件事：
 *   1. 每个 tab 的 spec 不同（morning / diagnose），诊断优先 AI 选图、去重、最多 4 张；
 *   2. 收起态只有一个 hero；展开态网格只放 hero 之外的图，避免重复；
 *   3. 每张图有 role=img + aria-label，空数据不抛错。
 */
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
new vm.Script(script)

class Node {
  constructor(tag) {
    this.tagName = tag
    this.nodeType = tag === '#text' ? 3 : 1
    this.children = []
    this.attrs = {}
    this.style = { setProperty() {} }
    this.textContent = ''
    this.className = ''
    this.parent = null
  }
  get firstChild() { return this.children.length ? this.children[0] : null }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null }
  insertBefore(child, next) {
    if (child.parent) child.parent.removeChild(child)
    const index = next ? this.children.indexOf(next) : this.children.length
    this.children.splice(index < 0 ? this.children.length : index, 0, child)
    child.parent = this
    return child
  }
  appendChild(child) { return this.insertBefore(child, null) }
  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parent = null
    return child
  }
  addEventListener(type, handler) {
    if (!this.listeners) this.listeners = {}
    this.listeners[type] = handler
  }
  click() {
    const handler = this.listeners && this.listeners.click
    if (handler) handler({ stopPropagation() {}, preventDefault() {} })
  }
}

const nodes = new Map(['insightCharts', 'insightBody', 'fulfillmentLine'].map((id) => [id, new Node('div')]))
const document = {
  body: new Node('body'),
  getElementById: (id) => nodes.get(id) || null,
  createElement: (tag) => new Node(tag),
  createElementNS: (_ns, tag) => new Node(tag),
  createTextNode: (text) => { const node = new Node('#text'); node.textContent = text; return node },
}

const DATASETS = {
  done_by_day_7: {
    days: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'],
    values: [1, 0, 2, 3, 0, 1, 2],
  },
  started_by_day_7: {
    days: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'],
    values: [0, 1, 0, 0, 2, 0, 1],
  },
  wip_by_day_14: {
    days: Array.from({ length: 14 }, (_, i) => '2026-10-' + String(19 + i).padStart(2, '0')),
    values: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8],
  },
  state_distribution: { labels: ['已完成', '在跑', '未开始'], values: [3, 5, 2] },
  workspace_distribution: { labels: ['W1', 'W2'], values: [4, 6] },
  cycle_days: { median: 2.5, samples: 4 },
  priority_urgency: {
    rows: ['P0', 'P1', 'P2', 'P3', '未设置'],
    cols: ['已逾期', '今天', '2–3 天', '4–7 天', '8 天+', '无截止'],
    values: [[1, 0, 0, 0, 0, 0], [0, 3, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1]],
  },
  stalled_aging: { labels: ['0–1 天', '2–3 天', '4–7 天', '8 天+'], values: [2, 1, 0, 3] },
  workspace_load: {
    labels: ['W2', 'W1'],
    series: [
      { label: '未开始', values: [3, 0] },
      { label: '在跑', values: [1, 2] },
      { label: '已完成', values: [0, 1] },
    ],
  },
  fulfillment_quality: { labels: ['提前', '准时', '延期'], values: [2, 3, 4] },
  delay_reasons: { labels: ['估时不准', '等依赖'], values: [2, 1] },
  throughput_14: {
    days: Array.from({ length: 14 }, (_, i) => '2026-10-' + String(19 + i).padStart(2, '0')),
    done: [0, 1, 2, 1, 0, 2, 3, 1, 0, 2, 1, 1, 2, 3],
    started: [0, 0, 1, 1, 0, 0, 2, 1, 0, 1, 0, 1, 0, 1],
    wip: [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8],
  },
}

const app = {
  insightTab: 'morning',
  insightOpen: false,
  insightAI: null,
  insightStats: { datasets: DATASETS },
  insightLocal: {},
  insightChartSignature: '',
  insightResults: {},
  fulfillmentSummary: null,
}

const context = {
  app,
  document,
  $: (id) => nodes.get(id) || null,
  renderFulfillment: () => {},
  renderFulfillmentBlocks: (body) => body.appendChild(new Node('div')),
  renderMorning: (body) => { const node = new Node('div'); node.className = 'morning-stub'; body.appendChild(node) },
}
vm.createContext(context)

function fn(name) {
  const start = script.indexOf(`  function ${name}(`)
  assert.ok(start >= 0, name)
  const end = script.indexOf('\n  function ', start + 3)
  return script.slice(start, end)
}

// 图表模块整体（常量 + 所有渲染函数）一次性执行，避免测试里复制一份配置。
const regionStart = script.indexOf('  /* INSIGHT_CHARTS_START */')
const regionEnd = script.indexOf('  /* INSIGHT_CHARTS_END */')
assert.ok(regionStart > 0 && regionEnd > regionStart, 'chart region located')
vm.runInContext(script.slice(regionStart, regionEnd), context)
for (const name of ['stablePanelSignature', 'el', 'clear']) vm.runInContext(fn(name), context)
vm.runInContext(fn('renderInsightBody'), context)

function findAll(node, predicate, out = []) {
  if (!node || node.nodeType === 3) return out
  if (predicate(node)) out.push(node)
  for (const child of node.children) findAll(child, predicate, out)
  return out
}
function cardsIn(root) {
  return findAll(root, (node) => String(node.className).split(/\s+/).includes('insight-chart'))
}
function figuresIn(root) {
  return findAll(root, (node) => node.getAttribute && node.getAttribute('role') === 'img')
}
function gridOf(section) {
  return findAll(section, (node) => String(node.className).includes('insight-chart-grid'))[0]
}
function heroOf() {
  return nodes.get('insightCharts').children[0]
}

// ---- 1. 每个 tab 一套 spec：morning 看今天/产出/负载，diagnose 看优先级/停滞/延期 ----
context.app.insightTab = 'morning'
context.app.insightAI = null
const morningSpecs = context.insightChartSpecs()
assert.deepEqual([...morningSpecs].map((spec) => spec.dataset), ['state_distribution', 'done_by_day_7', 'workspace_load'])
assert.deepEqual([...morningSpecs].map((spec) => spec.type), ['donut', 'bars', 'stacked'])

context.app.insightTab = 'diagnose'
const diagnoseSpecs = context.insightChartSpecs()
assert.deepEqual([...diagnoseSpecs].map((spec) => spec.dataset), ['priority_urgency', 'stalled_aging', 'delay_reasons'])
assert.deepEqual([...diagnoseSpecs].map((spec) => spec.type), ['heatmap', 'bars', 'hbars'])
assert.notDeepEqual(
  morningSpecs.map((spec) => spec.dataset),
  diagnoseSpecs.map((spec) => spec.dataset),
  'the two tabs must not show the same charts',
)

// AI 选图：只认已知数据集、去重、最多 4 张；形状仍由数据集决定。
context.app.insightAI = {
  charts: [
    { type: 'pie', dataset: 'state_distribution', title: 'AI 状态' },
    { type: 'pie', dataset: 'state_distribution', title: '重复' },
    { type: 'bar', dataset: 'not_a_dataset', title: '未知' },
    { type: 'bar', dataset: 'done_by_day_7' },
    { type: 'line', dataset: 'wip_by_day_14' },
    { type: 'bar', dataset: 'stalled_aging' },
    { type: 'bar', dataset: 'delay_reasons' },
  ],
}
const aiSpecs = context.insightChartSpecs()
assert.equal(aiSpecs.length, 4, 'AI chart list is capped at four')
assert.equal(new Set(aiSpecs.map((spec) => spec.dataset)).size, aiSpecs.length, 'deduplicated by dataset')
assert.deepEqual([...aiSpecs].map((spec) => spec.dataset), ['state_distribution', 'done_by_day_7', 'wip_by_day_14', 'stalled_aging'])
assert.equal(aiSpecs[0].type, 'donut', 'pie from AI becomes the panel donut')
context.app.insightAI = null

// ---- 2. 收起态：只有一张 hero，没有网格 ----
context.app.insightTab = 'morning'
context.app.insightOpen = false
context.app.insightChartSignature = ''
context.renderInsightCharts()
const chartsBox = nodes.get('insightCharts')
assert.equal(findAll(chartsBox, (node) => node.getAttribute && node.getAttribute('data-chart-hero') === '1').length, 1, 'collapsed state renders exactly one hero chart')
const hero = heroOf()
assert.equal(hero.getAttribute('data-chart-hero'), '1')
assert.equal(hero.getAttribute('data-chart-dataset'), 'state_distribution')
const heroFigures = figuresIn(hero)
assert.equal(heroFigures.length, 1)
assert.ok(heroFigures[0].getAttribute('aria-label').length > 6)
assert.match(heroFigures[0].getAttribute('aria-label'), /已完成 3/)
// hero donut：中心总数 + 图例数值
const centerText = findAll(hero, (node) => node.tagName === 'strong')[0]
assert.equal(centerText.textContent, '10', 'donut center shows the total')
assert.equal(chartsBox.children.filter((node) => node.getAttribute('data-chart-hero') === '1').length, 1, 'only the hero carries the hero marker')

context.renderInsightBody()
const body = nodes.get('insightBody')
assert.equal(body.hidden, true)
assert.equal(findAll(body, (node) => node.getAttribute && node.getAttribute('data-chart-grid') === '1').length, 0, 'collapsed body has no grid')

// ---- 3. 展开态：网格只放 hero 之外的图，避免重复 ----
context.app.insightOpen = true
context.renderInsightCharts()
context.renderInsightBody()
const section = body.children[0]
assert.equal(section.getAttribute('data-chart-grid'), '1', 'grid section is first in the expanded body')
const grid = gridOf(section)
assert.ok(grid, 'grid container exists')
const gridCards = cardsIn(grid)
assert.equal(gridCards.length, morningSpecs.length - 1, 'grid excludes the hero chart')
assert.deepEqual(
  gridCards.map((card) => card.getAttribute('data-chart-dataset')),
  [...morningSpecs.slice(1)].map((spec) => spec.dataset),
)
assert.ok(!gridCards.some((card) => card.getAttribute('data-chart-dataset') === morningSpecs[0].dataset), 'details never repeat the hero')
for (const card of gridCards) {
  assert.ok(findAll(card, (node) => String(node.className).includes('chart-title')).length > 0, 'card has a title')
  assert.ok(findAll(card, (node) => String(node.className).includes('chart-note')).length > 0, 'card has a one-line note')
  const figures = figuresIn(card)
  assert.equal(figures.length, 1, 'one accessible figure per card')
  assert.ok(figures[0].getAttribute('aria-label').length > 6)
}

// 左右切换：hero 换一张，网格自动换成另外几张，仍然不重复
const switchBox = findAll(chartsBox, (node) => String(node.className).includes('chart-switch'))[0]
assert.ok(switchBox, 'hero has a left/right switch')
const navButtons = findAll(switchBox, (node) => node.tagName === 'button')
assert.equal(navButtons.length, 2, 'previous and next buttons')
navButtons[1].click()
assert.equal(heroOf().getAttribute('data-chart-dataset'), morningSpecs[1].dataset, 'next switches the hero')
const afterSwitch = cardsIn(gridOf(body.children[0]))
assert.deepEqual(
  afterSwitch.map((card) => card.getAttribute('data-chart-dataset')),
  [...morningSpecs.slice(1)].map((spec) => spec.dataset),
  'detail charts stay fixed instead of being recomputed for the current hero',
)
navButtons[0].click()
assert.equal(heroOf().getAttribute('data-chart-dataset'), morningSpecs[0].dataset, 'previous switches back')

// ---- 4. 诊断 tab 没有 AI 结果也能显示本地图表，且切 tab 会重渲染 hero ----
context.app.insightTab = 'diagnose'
context.app.insightAI = null
context.app.insightOpen = true
context.app.insightChartSignature = ''
context.renderInsightCharts()
context.renderInsightBody()
const diagnoseHero = heroOf()
assert.equal(diagnoseHero.getAttribute('data-chart-dataset'), 'priority_urgency')
assert.equal(diagnoseHero.getAttribute('data-chart-type'), 'heatmap')
const heatCells = findAll(diagnoseHero, (node) => String(node.className).includes('heat-cell'))
assert.equal(heatCells.length, 30, '5 × 6 heatmap cells')
assert.match(heatCells[1].title, /^P0 · 今天 · 0$/)
assert.match(findAll(diagnoseHero, (node) => node.title && node.title.startsWith('P1 · 今天 · 3'))[0].title, /3$/)
assert.match(figuresIn(diagnoseHero)[0].getAttribute('aria-label'), /P1 · 今天 3/)
const diagnoseGridCards = cardsIn(gridOf(body.children[0]))
assert.deepEqual(diagnoseGridCards.map((card) => card.getAttribute('data-chart-dataset')), ['stalled_aging', 'delay_reasons'], 'diagnose grid excludes the heatmap hero')
const stalledFigure = figuresIn(diagnoseGridCards[0])[0]
assert.match(stalledFigure.getAttribute('aria-label'), /8 天\+ 3/)
const delayFigure = figuresIn(diagnoseGridCards[1])[0]
assert.match(delayFigure.getAttribute('aria-label'), /估时不准 2/)

const beforeSwitch = heroOf()
context.app.insightTab = 'morning'
context.app.insightChartSignature = ''
context.renderInsightCharts()
assert.notEqual(heroOf(), beforeSwitch, 'tab switch rebuilds the hero')
assert.equal(heroOf().getAttribute('data-chart-dataset'), 'state_distribution')

// 开合也必须刷新：签名包含 insightOpen。
const beforeOpen = heroOf()
context.app.insightOpen = false
context.renderInsightCharts()
assert.notEqual(heroOf(), beforeOpen, 'open/close rebuilds the hero')

// 收起后展开区清空，只剩 mid hero。
context.renderInsightBody()
assert.equal(body.children.length, 0, 'collapsing clears the grid from the body')

// ---- 5. 空数据：spec 跳过、hero 显示暂无数据、不抛错 ----
context.app.insightOpen = false
context.app.insightTab = 'morning'
context.app.insightChartSignature = ''
context.app.insightStats = { datasets: {} }
assert.equal(context.insightChartSpecs().length, 0)
assert.doesNotThrow(() => context.renderInsightCharts())
assert.equal(heroOf().getAttribute('data-chart-hero'), '1')
assert.equal(figuresIn(heroOf())[0].getAttribute('aria-label'), '暂无数据')
context.app.insightOpen = true
assert.doesNotThrow(() => context.renderInsightBody())
assert.equal(findAll(body, (node) => node.getAttribute && node.getAttribute('data-chart-grid') === '1').length, 0, 'no empty grid section when only the hero exists')

context.app.insightTab = 'diagnose'
context.app.insightChartSignature = ''
assert.equal(context.insightChartSpecs().length, 0)
assert.doesNotThrow(() => context.renderInsightCharts())
assert.equal(heroOf().getAttribute('data-chart-hero'), '1')

// 全 0（有字段但没信号）同样按空处理，不画空图。
context.app.insightStats = {
  datasets: {
    state_distribution: { labels: ['已完成', '在跑', '未开始'], values: [0, 0, 0] },
    done_by_day_7: { days: [], values: [0, 0, 0, 0, 0, 0, 0] },
    workspace_load: { labels: ['W'], series: [{ label: '未开始', values: [0] }] },
    priority_urgency: { rows: ['P0'], cols: ['今天'], values: [[0]] },
  },
}
assert.equal(context.insightChartSpecs().length, 0)
assert.doesNotThrow(() => context.renderInsightCharts())
assert.doesNotThrow(() => context.renderInsightBody())

console.log('INSIGHT_CHARTS_PANEL_OK: per-tab specs, one hero collapsed, grid expanded, aria labels, empty data')
