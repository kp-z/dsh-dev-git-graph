/**
 * 画布节点卡片（= 面板里的飞书任务卡）的纯函数层测试：
 * 内容隐显（GRAPH_CARD_FIELDS）、徽标序列、标题按可用宽度截断。
 *
 * 这里不跑 React：卡片渲染器是纯 vnode 生成，几何来自 layout.cardGeometry，
 * 所以「标题会不会压到会话胶囊」「哪些字段上画布」都能离线断死。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cardBadges, fitText, graphCardTitle, GRAPH_CARD_FIELDS } from '../src/client/TaskNodeCard.js'
import { cardGeometry, GEOMETRY, CARD } from '../src/overview/layout.js'

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
    console.log(String((error && error.message) || error).split('\n').slice(0, 4).map((line) => `       ${line}`).join('\n'))
  }
}

const refs = (o) => ({
  predecessors: Array.from({ length: o.pre || 0 }, () => ({})),
  successors: Array.from({ length: o.post || 0 }, () => ({})),
  earlierTasks: Array.from({ length: o.time || 0 }, () => ({})),
  laterTasks: [],
})

check('内容隐显：画布卡只留标题/会话/状态/计数，列表专属字段明确排除', () => {
  assert.equal(GRAPH_CARD_FIELDS.title, 'always')
  assert.equal(GRAPH_CARD_FIELDS.session, 'bound-session-only')
  assert.equal(GRAPH_CARD_FIELDS.priority, 'chip+left-bar')
  assert.equal(GRAPH_CARD_FIELDS.actions, 'always')
  assert.deepEqual(GRAPH_CARD_FIELDS.counts, ['predecessors', 'successors', 'temporal'])
  assert.equal(GRAPH_CARD_FIELDS.number, 'footer')
  assert.equal(GRAPH_CARD_FIELDS.workspace, 'chip')
  for (const field of ['due', 'people', 'listName', 'trigger', 'docs', 'comments']) {
    assert.ok(GRAPH_CARD_FIELDS.hidden.includes(field), `${field} 应该在 hidden 里`)
  }
})

check('徽标序列：状态打头，计数只出有值的那几项', () => {
  const badges = cardBadges({ state: 'blocked', refs: refs({ pre: 2, post: 1, time: 3 }) })
  assert.deepEqual(badges.map((b) => b.key), ['state', 'pre', 'post', 'time'])
  assert.equal(badges[0].label, '阻塞')
  assert.equal(badges[0].tone, 'blocked')
  assert.equal(badges[1].label, '前置 2')
  assert.equal(badges[1].tone, 'blocked', '被阻塞时前置徽标也用错误色')
  const plain = cardBadges({ state: 'open', refs: refs({}) })
  assert.deepEqual(plain.map((b) => b.label), ['就绪'], '没有计数就只剩状态')
})

check('徽标序列：ghost 只有一个「缺失/组外」徽标', () => {
  assert.deepEqual(cardBadges({ ghost: true, missing: true }).map((b) => b.label), ['缺失'])
  assert.deepEqual(cardBadges({ ghost: true, missing: false }).map((b) => b.label), ['组外'])
})

check('标题：放得下就原样，放不下就省略号收口且不越过右边界', () => {
  assert.equal(fitText('短标题', 200, 12.5), '短标题')
  const long = '为 ClipData 的重复帧新增 shared_payloads 引用下标，再补一段更长的尾巴'
  const cut = fitText(long, 200, 12.5)
  assert.ok(cut.endsWith('…'), cut)
  assert.ok(cut.length < long.length)
  /* 宽度预算必须兜住：估算宽度（汉字 1 / ASCII 0.56）× 字号 */
  const width = [...cut].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56), 0) * 12.5
  assert.ok(width <= 200 + 0.5, `截断后仍有 ${width}px > 200px`)
})

check('标题：绑了会话就用「标题区」的宽度，没绑就用整行宽度', () => {
  const node = { label: '很长很长很长很长很长很长很长很长很长的任务标题', fullTitle: '很长很长很长很长很长很长很长很长很长的任务标题' }
  const withSess = graphCardTitle(node, cardGeometry({ x: 0, y: 0, w: GEOMETRY.NODE_W, h: GEOMETRY.NODE_H, sessionId: 's-1' }))
  const noSess = graphCardTitle(node, cardGeometry({ x: 0, y: 0, w: GEOMETRY.NODE_W, h: GEOMETRY.NODE_H, sessionId: '' }))
  assert.ok(withSess.length < noSess.length, '会话胶囊占位后标题更早收口')
  assert.ok(withSess.endsWith('…') && noSess.endsWith('…'))
  /* 都必须在各自的可画宽度里 */
  const cutWidth = (s) => [...s].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56), 0) * 12.5
  assert.ok(cutWidth(withSess) <= GEOMETRY.NODE_W - CARD.PAD_X * 2 - CARD.SESSION_W - CARD.COL_GAP + 0.5)
})

check('卡片尺寸来自 layout：300×84、圆角 9、三行（标题 / 徽标 / 页脚）', () => {
  const card = cardGeometry({ x: 0, y: 0, w: GEOMETRY.NODE_W, h: GEOMETRY.NODE_H, sessionId: 's-1', priority: 'P1' })
  assert.equal(GEOMETRY.NODE_W, 300)
  assert.equal(GEOMETRY.NODE_H, 84)
  assert.equal(card.radius, 9)
  assert.equal(card.border, 1)
  assert.ok(card.title.baseline < card.meta.y, '标题行在徽标行之上')
  assert.ok(card.meta.y + card.meta.h <= card.foot.y, '徽标行在页脚行之上')
  assert.ok(card.foot.y + card.foot.h <= GEOMETRY.NODE_H, '页脚行在卡片里')
  /* 优先级徽标占住标题左边，标题因此左移 */
  assert.ok(card.prio, '有优先级就有徽标')
  assert.ok(card.title.x > card.prio.x + card.prio.w, '标题在优先级徽标右边')
})

check('组件源码：零副作用（不读 document / 网络 / 存储）', () => {
  const source = readFileSync(new URL('../src/client/TaskNodeCard.js', import.meta.url), 'utf8')
  assert.equal(/document\.|window\.|localStorage|fetch\(/.test(source), false)
})

console.log(`\nTaskNodeCard: ${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
console.log('TASK_NODE_CARD_OK')
