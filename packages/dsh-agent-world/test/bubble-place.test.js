/**
 * 气泡定位测试（R39 / M7-11）。
 *
 * ## 为什么这份测试值钱
 *
 * 真机截图里，小铁的气泡**一半伸进了右侧浮动抽屉底下**——而这种事情在浏览器里
 * 只有"人在右边说话"的那几秒才看得到，靠眼睛盯是碰运气。把定位抽成纯函数之后，
 * "1280/1024/800 三种宽度下、锚点在抽屉里/在抽屉边上/在抽屉外"这些组合都能算。
 *
 * 这里钉的是三件事：
 * 1. 气泡的盒子**不许与抽屉矩形相交**（贴边之后不相交，这是那段 UI 缺陷的判据）；
 * 2. 锚点（人）在抽屉底下时**不消失**，而是贴可见区右边缘并打 `pinnedRight`（附理由见实现）；
 * 3. 纵向也要夹得住（头顶贴到画面顶端时不能把气泡整块裁掉）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_MARGIN, occludedBubbles, placeBubble } from '../web/core/bubble-place.js'

/** 一块常见尺寸的气泡（`max-width: 200px`，两三行文字）。 */
const SIZE = { width: 180, height: 46 }
/** 舞台：1280×700，右侧抽屉打开占 352px（340 宽 + 12 呼吸）——与面板里量的口径一致。 */
const VIEW = { width: 1280, height: 700 }
const DRAWER = 352
/** 抽屉的真实矩形（用于相交检查；世界坐标 = 舞台坐标，两者都在 `.stage` 里）。 */
const DRAWER_RECT = { left: VIEW.width - DRAWER, top: 16, right: VIEW.width, bottom: 640 }

/** 把 `placeBubble` 的结果换回"气泡盒子的矩形"（CSS 是 translate(-50%,-100%)）。 */
function boxOf(placed, size = SIZE) {
  return {
    left: placed.left - size.width / 2,
    right: placed.left + size.width / 2,
    top: placed.top - size.height,
    bottom: placed.top,
  }
}

test('锚点在中间：不夹、不贴边，正交（尾巴指中间）', () => {
  const placed = placeBubble({ anchor: { x: 500, y: 300 }, size: SIZE, view: VIEW, insetRight: DRAWER })
  assert.equal(placed.left, 500)
  assert.equal(placed.top, 300)
  assert.equal(placed.clamped, false)
  assert.equal(placed.pinnedRight, false)
  assert.equal(placed.occluded, false)
  assert.equal(placed.tailPercent, 50)
})

test('锚点贴着抽屉边缘（人还看得见）：往左夹，气泡盒子与抽屉**不相交**', () => {
  const anchor = { x: VIEW.width - DRAWER - 10, y: 300 } // 可见区右边缘往里 10px
  const placed = placeBubble({ anchor, size: SIZE, view: VIEW, insetRight: DRAWER })
  const box = boxOf(placed)

  assert.ok(placed.clamped, '贴边的锚点必须夹住气泡（否则半个气泡会压在抽屉玻璃下）')
  assert.ok(box.right <= VIEW.width - DRAWER + 0.001, `右边缘越界：${box.right}`)
  assert.equal(placed.pinnedRight, false, '人还看得见，就不该打"被挡住"的箭头')
  assert.equal(placed.occluded, false)
  assert.ok(placed.tailPercent > 50, `尾巴要指向右边那个真实头顶（实际 ${placed.tailPercent}）`)
  assert.equal(occludedBubbles([{ id: 'a', rect: box }], DRAWER_RECT).length, 0)
})

test('锚点在抽屉底下（人看不见）：贴可见区右边缘 + 打箭头，**不消失**', () => {
  const anchor = { x: VIEW.width - 100, y: 300 } // 落在抽屉的横向范围里
  const placed = placeBubble({ anchor, size: SIZE, view: VIEW, insetRight: DRAWER })
  const box = boxOf(placed)

  assert.equal(placed.pinnedRight, true, '人要看不见了，气泡要靠箭头说明方向')
  assert.equal(placed.occluded, true, '锚点确实在抽屉下面（供核验用）')
  assert.ok(box.right <= VIEW.width - DRAWER + 0.001)
  assert.equal(placed.tailPercent, 96, '尾巴被压到最右（锚点在气泡右边外面）')
  assert.equal(occludedBubbles([{ id: 'a', rect: box }], DRAWER_RECT).length, 0, '贴边之后不许与抽屉相交')
})

test('抽屉收起（insetRight = 0）：一切照旧，不再避让', () => {
  const anchor = { x: VIEW.width - 100, y: 300 }
  const placed = placeBubble({ anchor, size: SIZE, view: VIEW, insetRight: 0 })
  assert.equal(placed.left, anchor.x)
  assert.equal(placed.pinnedRight, false)
  assert.equal(placed.occluded, false)
})

test('可见区放不下整块气泡：**不画**（而不是画一半在抽屉底下）', () => {
  // 极窄视口下抽屉会变成整幅宽浮层（`@media (max-width: 720px)` 把 left/right 都贴边），
  // 可见区几乎为零：这时候把它挤进去，结果就是"半个气泡在抽屉下面"——正是要修的缺陷。
  const placed = placeBubble({
    anchor: { x: 200, y: 200 },
    size: { width: 180, height: 46 },
    view: { width: 640, height: 400 },
    insetRight: 636, // 可见区只剩 4px
  })
  assert.equal(placed.visible, false, '放不下就别画')
  assert.equal(placed.tight, true)

  // 边界：刚好放得下（宽度 + 两侧留边）→ 画。
  const exact = placeBubble({
    anchor: { x: 100, y: 200 },
    size: { width: 180, height: 46 },
    view: { width: 196 + 152, height: 400 },
    insetRight: 152,
  })
  assert.equal(exact.visible, true, '刚好放得下就要画（196 = 180 + 8*2）')
})

test('800px 宽（验收口径）仍然放得下：要画、要贴边、且不与抽屉相交', () => {
  const view = { width: 800, height: 560 }
  const drawer = 332 // 320 + 12 呼吸
  const placed = placeBubble({ anchor: { x: 400, y: 400 }, size: SIZE, view, insetRight: drawer })
  assert.equal(placed.visible, true)
  assert.ok(placed.left + SIZE.width / 2 <= view.width - drawer + 0.001)
  assert.deepEqual(
    occludedBubbles([{ id: 'a', rect: boxOf(placed) }], { left: view.width - drawer, top: 16, right: view.width, bottom: 500 }),
    [],
  )
})

test('纵向：头顶贴到画面顶端时整块压回可见区（不然会被裁掉）', () => {
  const placed = placeBubble({ anchor: { x: 500, y: 10 }, size: SIZE, view: VIEW, insetRight: 0 })
  assert.equal(placed.top, SIZE.height + DEFAULT_MARGIN, '底边至少留出一个气泡的高度 + 留边')
  const box = boxOf(placed)
  assert.ok(box.top >= 0)
})

test('底部看板展开时会顶开气泡（看板也是盖住场景的玻璃）', () => {
  const board = { left: 16, top: 400, right: 1264, bottom: 690 }
  const placed = placeBubble({ anchor: { x: 500, y: 500 }, size: SIZE, view: VIEW, insetRight: 0, board })
  assert.ok(placed.top <= board.top - DEFAULT_MARGIN + 0.001, `要抬到看板之上（实际 ${placed.top}）`)
  const box = boxOf(placed)
  assert.ok(box.bottom <= board.top, '气泡盒子不许压在看板上')
})

test('同一份输入给同一份输出（纯函数，可复现）', () => {
  const input = { anchor: { x: 900, y: 320 }, size: SIZE, view: VIEW, insetRight: DRAWER, board: null }
  assert.deepEqual(placeBubble(input), placeBubble(input))
})

test('occludedBubbles：只有真的相交才算被遮（贴边之后必须为空）', () => {
  const inside = { left: 1000, top: 100, right: 1100, bottom: 140 } // 压在抽屉上
  const outside = { left: 800, top: 100, right: 900, bottom: 140 }
  assert.deepEqual(
    occludedBubbles(
      [
        { id: 'blocked', rect: inside },
        { id: 'fine', rect: outside },
      ],
      DRAWER_RECT,
    ).map((o) => o.id),
    ['blocked'],
  )
  assert.deepEqual(occludedBubbles([{ id: 'a', rect: outside }], null), [], '抽屉收起时没有"被遮"这回事')
  // 恰好贴着左边缘（不重叠）不算被遮——浮点边界也要稳。
  const touching = { left: 700, top: 100, right: DRAWER_RECT.left, bottom: 140 }
  assert.deepEqual(occludedBubbles([{ id: 't', rect: touching }], DRAWER_RECT), [])
})

test('三种视口宽度下都不会被右下角的抽屉遮住（含最右一列的角色）', () => {
  const cases = [
    { view: { width: 1280, height: 700 }, drawer: 352 },
    { view: { width: 1024, height: 620 }, drawer: 332 },
    { view: { width: 800, height: 560 }, drawer: 320 },
  ]
  for (const { view, drawer } of cases) {
    const rect = { left: view.width - drawer, top: 16, right: view.width, bottom: view.height - 60 }
    // 锚点从最左扫到最右（角色会走到任何地方），每个位置都不许相交。
    for (let x = 20; x <= view.width - 10; x += 13) {
      const placed = placeBubble({ anchor: { x, y: view.height - 120 }, size: SIZE, view, insetRight: drawer })
      const box = boxOf(placed)
      assert.deepEqual(
        occludedBubbles([{ id: `x=${x}`, rect: box }], rect),
        [],
        `${view.width}px 宽、锚点 x=${x} 时气泡压在抽屉上了（left=${placed.left}）`,
      )
    }
  }
})
