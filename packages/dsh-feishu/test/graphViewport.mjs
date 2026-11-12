/**
 * 关系图画布的视口几何单测：缩放（以光标为锚点）/ 平移 / 聚焦居中 / transform 串。
 *
 * 为什么单独一份：这些公式错了，用户看到的是「滚轮一滚画面就飘走」「聚焦了主角还在屏幕外」，
 * 而组件测试很难稳定复现指针坐标。这里只测纯函数，不需要 DOM。
 *
 * 跑法：node test/graphViewport.mjs
 */
import assert from 'node:assert/strict'
import {
  IDENTITY_VIEW,
  VIEW_ZOOM_MAX,
  VIEW_ZOOM_MIN,
  centerOn,
  clampZoom,
  normalizeView,
  panView,
  viewOf,
  viewportTransform,
  zoomView,
} from '../src/client/GraphView.js'

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
    console.log(String((error && error.message) || error).split('\n').slice(0, 5).map((line) => `       ${line}`).join('\n'))
  }
}

/* 视口公式：user = content * k + t。把 content 点映射到视口坐标，用来验证锚点不动。 */
const toViewport = (view, point) => ({ x: point.x * view.k + view.x, y: point.y * view.k + view.y })
const toContent = (view, point) => ({ x: (point.x - view.x) / view.k, y: (point.y - view.y) / view.k })
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

check('clampZoom：下限 / 上限 / 坏值', () => {
  assert.equal(clampZoom(1), 1)
  assert.equal(clampZoom(0.01), VIEW_ZOOM_MIN)
  assert.equal(clampZoom(99), VIEW_ZOOM_MAX)
  assert.equal(clampZoom('abc'), 1)
  assert.equal(clampZoom(0), 1)
  assert.equal(clampZoom(-2), 1)
})

check('normalizeView：坏值一律退回恒等视口（不做半截缩放）', () => {
  assert.deepEqual(normalizeView(undefined), IDENTITY_VIEW)
  assert.deepEqual(normalizeView({ k: 0, x: 5, y: 5 }), IDENTITY_VIEW)
  assert.deepEqual(normalizeView({ k: 'x', x: 0, y: 0 }), IDENTITY_VIEW)
  assert.deepEqual(normalizeView({ k: 2, x: 0, y: NaN }), IDENTITY_VIEW)
  assert.deepEqual(normalizeView({ k: 2, x: 10, y: -5 }), { k: 2, x: 10, y: -5 })
  assert.deepEqual(normalizeView({ k: 99, x: 0, y: 0 }), { k: VIEW_ZOOM_MAX, x: 0, y: 0 })
})

check('viewOf：按图 key 取视口，缺省 / 坏值都退回恒等', () => {
  const views = { a: { k: 1.5, x: 3, y: 4 } }
  assert.deepEqual(viewOf(views, 'a'), { k: 1.5, x: 3, y: 4 })
  assert.deepEqual(viewOf(views, 'zzz'), IDENTITY_VIEW)
  assert.deepEqual(viewOf(null, 'a'), IDENTITY_VIEW)
})

check('zoomView：锚点在缩放前后落在同一处（以光标为中心缩放的核心保证）', () => {
  const view = { k: 1, x: 40, y: 20 }
  const content = { x: 300, y: 180 }
  const anchor = toViewport(view, content)
  for (const factor of [1.25, 0.8, 2, 0.5]) {
    const next = zoomView(view, factor, anchor)
    /* 锚点（视口坐标）缩放后仍然指向同一个内容点 —— 这就是「以光标为中心」。 */
    assert.ok(close(toContent(next, anchor).x, content.x), `锚点下的内容点 x 漂了：${factor}`)
    assert.ok(close(toContent(next, anchor).y, content.y), `锚点下的内容点 y 漂了：${factor}`)
    assert.ok(close(toViewport(next, toContent(next, anchor)).x, anchor.x), `锚点 x 漂了：${factor}`)
  }
})

check('zoomView：缩放比例累积并夹在上下限内', () => {
  let view = IDENTITY_VIEW
  for (let i = 0; i < 10; i += 1) view = zoomView(view, 1.25, { x: 0, y: 0 })
  assert.equal(view.k, VIEW_ZOOM_MAX)
  for (let i = 0; i < 20; i += 1) view = zoomView(view, 0.8, { x: 0, y: 0 })
  assert.equal(view.k, VIEW_ZOOM_MIN)
  /* 到顶之后继续放大：平移量不能被继续改写（否则画面会一直飘）。 */
  const capped = zoomView({ k: VIEW_ZOOM_MAX, x: 12, y: -7 }, 2, { x: 100, y: 100 })
  assert.deepEqual(capped, { k: VIEW_ZOOM_MAX, x: 12, y: -7 })
})

check('zoomView：没给锚点时以视口原点为准（不抛、不乱跳）', () => {
  const next = zoomView(IDENTITY_VIEW, 2)
  assert.deepEqual(next, { k: 2, x: 0, y: 0 })
  const bad = zoomView(IDENTITY_VIEW, 2, { x: 'x', y: 1 })
  assert.deepEqual(bad, { k: 2, x: 0, y: 0 })
})

check('panView：位移累加，k 不变；坏值原样返回', () => {
  const moved = panView({ k: 1.5, x: 10, y: 10 }, -4, 6)
  assert.deepEqual(moved, { k: 1.5, x: 6, y: 16 })
  assert.deepEqual(panView(moved, 4, -6), { k: 1.5, x: 10, y: 10 })
  assert.deepEqual(panView(moved, NaN, 1), moved)
})

check('centerOn：把内容点搬到视口正中（聚焦时看得见主角）', () => {
  const box = { width: 800, height: 600, top: 400 }
  const point = { x: 1200, y: 900 }
  const view = centerOn({ k: 1, x: 0, y: 0 }, point, box)
  const should = { x: 800 / 2, y: 400 + 600 / 2 }
  assert.ok(close(toViewport(view, point).x, should.x))
  assert.ok(close(toViewport(view, point).y, should.y))
  /* 放大状态也要居中。 */
  const zoomed = centerOn({ k: 2, x: 0, y: 0 }, point, box)
  assert.ok(close(toViewport(zoomed, point).x, should.x))
  assert.ok(close(toViewport(zoomed, point).y, should.y))
})

check('centerOn：缺 box / 坏坐标时不动（不把画布甩到空白处）', () => {
  const view = { k: 1.4, x: 9, y: 9 }
  assert.deepEqual(centerOn(view, { x: 1, y: 1 }, null), view)
  assert.deepEqual(centerOn(view, { x: 1, y: 1 }, { width: 0, height: 0 }), view)
  assert.deepEqual(centerOn(view, { x: 'a', y: 1 }, { width: 100, height: 100 }), view)
})

check('viewportTransform：恒等视口不挂 transform；否则先缩放再平移', () => {
  assert.equal(viewportTransform(IDENTITY_VIEW), undefined)
  assert.equal(viewportTransform({ k: 1.25, x: -79, y: -42 }), 'translate(-79 -42) scale(1.25)')
  assert.equal(viewportTransform({ k: 2.5, x: 1.23456, y: 0 }), 'translate(1.23 0) scale(2.5)')
  assert.equal(viewportTransform({ k: 1, x: 0, y: 0 }), undefined)
})

console.log(`\nGraphView 视口: ${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
console.log('GRAPH_VIEWPORT_OK')
