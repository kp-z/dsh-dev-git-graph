/**
 * 工单行**错开布局**（R148 / task-24）——纯函数单测。
 *
 * ## 为什么必须在这里测，而不是只靠真机截图
 *
 * 触发条件很苛刻：要**恰好有两个有单的人站到 72px 以内**，还得同时有第三个同点的（极端情况）。
 * 真机上靠等、靠走位，**不可复现**；而判据（两两 `getBounds()` 不相交、y 连续 10 帧不变）本质是
 * 几何与稳定性，恰好是纯函数能穷举的东西。所以：算的进 `core/`，渲染层只负责"把算好的位置画上去"。
 *
 * 真机那一路（`scene-phaser.js`）只做两件事：把标签尺寸喂进来、把 offsetY 按缩放折算成世界坐标。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TASK_LABEL_LINE_GAP_PX, TASK_LABEL_MAX_LEVELS, planTaskLabelStagger, staggerStep } from '../web/core/task-label.js'

/** 一行工单标签的典型尺寸（真机 13px 字号实测：约 101×13）。 */
const W = 101
const H = 13
const label = (id, x, y) => ({ id, x, y, width: W, height: H })

/** 两个标签在**错开之后**是否还相交（判据同真机：矩形相交）。 */
function overlaps(a, b, offsets) {
  const ay = a.y + offsets.get(a.id)
  const by = b.y + offsets.get(b.id)
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(ay - by) < (a.height + b.height) / 2
}

const offsetsOf = (plan) => new Map(plan.map((p) => [p.id, p.offsetY]))

test('两人靠近：**两行都还在**，只是纵向错开（这正是"藏"改成"错开"的核心）', () => {
  const items = [label('agent-1', 100, 200), label('agent-2', 130, 200)]
  const plan = planTaskLabelStagger(items, { minGapPx: 72 })
  assert.equal(plan.length, 2)
  assert.deepEqual(plan.filter((p) => p.hidden), [], '错开能解决时，一个人也不许被藏')
  const offsets = offsetsOf(plan)
  assert.deepEqual([...offsets.values()].sort((a, b) => a - b), [-TASK_LABEL_LINE_GAP_PX, 0], '一个留在基准位、一个往上挪一行')
  assert.equal(overlaps(items[0], items[1], offsets), false, '错开之后不许相交')
})

test('错开是**按 id 稳定分配**的：与输入顺序无关，同一现场结果完全一样', () => {
  const a = label('agent-7', 100, 200)
  const b = label('agent-3', 140, 210)
  const forward = planTaskLabelStagger([a, b], { minGapPx: 72 })
  const backward = planTaskLabelStagger([b, a], { minGapPx: 72 })
  assert.deepEqual(forward, backward, '换个遍历顺序就换位置 = 会抖')
  assert.equal(forward.find((p) => p.id === 'agent-3').offsetY, 0, 'id 小的留基准位')
  assert.equal(forward.find((p) => p.id === 'agent-7').offsetY, -TASK_LABEL_LINE_GAP_PX)
})

test('离得远的人**一个都不动**（不该为了统一而把所有标签都挪走）', () => {
  const plan = planTaskLabelStagger([label('agent-1', 0, 0), label('agent-2', 400, 0), label('agent-3', 0, 400)], { minGapPx: 72 })
  assert.deepEqual(plan.map((p) => p.offsetY), [0, 0, 0])
  assert.deepEqual(plan.map((p) => p.hidden), [false, false, false])
})

test('"近"是**横纵都要近**：上下隔开的人不算一组（沿用 72px 阈值）', () => {
  const plan = planTaskLabelStagger([label('agent-1', 100, 100), label('agent-2', 100, 100 + 73)], { minGapPx: 72 })
  assert.deepEqual(plan.map((p) => p.offsetY), [0, 0], '纵向差 73px > 阈值，不该错开')
  const close = planTaskLabelStagger([label('agent-1', 100, 100), label('agent-2', 100, 100 + 71)], { minGapPx: 72 })
  assert.notDeepEqual(close.map((p) => p.offsetY), [0, 0], '纵向差 71px < 阈值，要错开')
})

test('三人同点：**都在**（正好错到上限，不需要藏）', () => {
  const items = [1, 2, 3].map((i) => label(`agent-${i}`, 500, 300))
  const plan = planTaskLabelStagger(items, { minGapPx: 72 })
  assert.deepEqual(plan.map((p) => p.offsetY), [0, -TASK_LABEL_LINE_GAP_PX, -2 * TASK_LABEL_LINE_GAP_PX])
  assert.deepEqual(plan.filter((p) => p.hidden), [], '三层够放下三个人，一个都不用藏')
})

test('★ 极端重叠（同点超过错开层数）：错开后仍相交的才藏，且**留下的人带 +N**——不许静默消失', () => {
  const items = [1, 2, 3, 4].map((i) => label(`agent-${i}`, 500, 300))
  const plan = planTaskLabelStagger(items, { minGapPx: 72 })
  const visible = plan.filter((p) => !p.hidden)
  const hidden = plan.filter((p) => p.hidden)
  assert.equal(visible.length + hidden.length, 4, '每个人都要有交代（可见或明确隐藏）')
  assert.ok(visible.length >= 1, '至少留一个')
  assert.ok(hidden.length >= 1, `超过 ${TASK_LABEL_MAX_LEVELS} 层仍相交，必须藏掉多余的`)
  assert.equal(
    visible.reduce((sum, p) => sum + p.hiddenCount, 0),
    hidden.length,
    '藏了几个就必须报几个（调用方靠它显示 +N）',
  )
  assert.ok(visible.some((p) => p.hiddenCount > 0), '留下的那个人要带计数，否则用户不知道这里还有人')
})

test('隐藏计数只落在**仍然可见**的标签上（宿主自己被挤掉时不许把计数一起丢掉）', () => {
  // 六人同点：可见的人更少，计数必须全部落在可见者头上。
  const items = [1, 2, 3, 4, 5, 6].map((i) => label(`agent-${i}`, 0, 0))
  const plan = planTaskLabelStagger(items, { minGapPx: 72 })
  const visible = plan.filter((p) => !p.hidden)
  const hidden = plan.filter((p) => p.hidden)
  assert.ok(hidden.length > 0, `六人同点应当有人被藏：${JSON.stringify(plan)}`)
  assert.equal(visible.reduce((sum, p) => sum + p.hiddenCount, 0), hidden.length, `计数丢了：${JSON.stringify(plan)}`)
  assert.ok(visible.some((p) => p.hiddenCount > 0), '留下的标签要带 +N，否则用户不知道这里还有人')
})

test('错开的间距够开：任意两人的矩形在错开后两两不相交（判据的纯函数版）', () => {
  const items = [label('agent-1', 300, 500), label('agent-2', 340, 505), label('agent-5', 320, 520), label('agent-9', 900, 500)]
  const plan = planTaskLabelStagger(items, { minGapPx: 72 })
  const offsets = offsetsOf(plan)
  const shown = items.filter((i) => plan.find((p) => p.id === i.id).hidden !== true)
  let intersections = 0
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) if (overlaps(shown[i], shown[j], offsets)) intersections += 1
  }
  assert.equal(intersections, 0, `可见标签两两相交 ${intersections} 对`)
})

test('空输入 / 单个标签：原样返回，不动也不藏', () => {
  assert.deepEqual(planTaskLabelStagger([], {}), [])
  assert.deepEqual(planTaskLabelStagger(undefined, {}), [])
  assert.deepEqual(planTaskLabelStagger([label('agent-1', 5, 5)], {}), [
    { id: 'agent-1', offsetY: 0, hidden: false, hiddenCount: 0 },
  ])
})

test('★ 真机尺寸（高 15.08px，比 15px 下限高一点点）：步长必须让开，**不许把第二行藏掉**', () => {
  // R148 真机踩到：标签实测高 15.079…，固定用 15 当步长时错开一行仍重叠 0.08px，
  // 于是被判"仍然相交"→ 第二行被藏 + 显示 +1。用户看到的就是"有人被藏了"，正是本轮要消灭的现象。
  const H_REAL = 15.07958984375
  assert.ok(staggerStep(H_REAL) > H_REAL, `步长 ${staggerStep(H_REAL)} 没让开高度 ${H_REAL}`)
  const items = [
    { id: 'agent-1', x: 640, y: 315.64, width: 122, height: H_REAL },
    { id: 'agent-6', x: 652, y: 315.64, width: 110, height: H_REAL },
  ]
  const plan = planTaskLabelStagger(items, { minGapPx: 72 })
  assert.deepEqual(plan.filter((p) => p.hidden), [], '两个人都在，谁都不许被藏')
  assert.deepEqual(plan.map((p) => p.hiddenCount), [0, 0], '不该出现 +N')
  const offsets = offsetsOf(plan)
  assert.equal(overlaps(items[0], items[1], offsets), false, '错开后仍相交')
})
