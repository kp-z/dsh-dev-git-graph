/**
 * 场景布局纯逻辑（R58）—— **引擎不会知道的那一半**的测试。
 *
 * R58 把相机/切帧/动画/平铺/输入交给 Phaser 之后，我们自己剩下的语义就只有这些：
 * 动画回退链、多带图集 → 线性帧号的换算、方向量化、整数倍缩放、平铺相位、实时角色合成。
 * 这些全是纯函数，所以能在 node 里测；引擎那一半由浏览器里的实测验（点选、像素、绘制次数）。
 *
 * 其中**帧号换算**最值得钉死：契约里的图集是"多带"的（一条带 `rowsPerFigure` 格高，
 * 一帧在 `(col+i, row)`），而 Phaser 的 spritesheet 是**线性帧号**。
 * 这个换换算错一位，表现是"角色播到别人的帧上"——画面上像是美术问题，其实是我们算错。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ANCHOR_LIFT_PX,
  TILE_PX,
  worldFrame,
  FOUR_DIRECTIONS,
  actionOf,
  animationCandidates,
  animationFrameList,
  animationKey,
  directionOf,
  frameIndexOf,
  frameRateOf,
  framesPerRow,
  integerZoom,
  keyOfAnimationName,
  liveActors,
  originOf,
  resolveAnimationKey,
  tilePhasePx,
} from '../web/core/scene-layout.js'

/** 真图（OGA 16×16 裸模）：126×144 = 7 列 × 4 带，每带 2 格高（cellH=18）。 */
const SHEET = {
  cellW: 18,
  cellH: 18,
  rowsPerFigure: 2,
  anchor: 'bottom',
  animations: {
    'walk.down': { col: 0, row: 0, frames: 4, frameMs: 140, layout: 'row', mirror: false },
    'idle.down': { col: 4, row: 0, frames: 3, frameMs: 320, layout: 'row', mirror: false },
    'walk.up': { col: 0, row: 1, frames: 4, frameMs: 140, layout: 'row', mirror: false },
  },
}

test('多带图集：一行的帧数由**图片宽度**算（列数不是写死的）', () => {
  assert.equal(framesPerRow({ cellW: 18 }, 126), 7, '真图 126px / 18px = 7 列')
  assert.equal(framesPerRow({ cellW: 32 }, 1024), 32)
  // 认不出的输入不炸：至少 1 列
  assert.equal(framesPerRow({ cellW: 18 }, 0), 1)
  // 没有 cellW 时把格宽当 1（这样"每像素一帧"，不会除零也不会返回 0 帧）
  assert.equal(framesPerRow({}, 100), 100)
  assert.equal(framesPerRow(null, 10), 10)
})

test('多带 → 线性帧号：`row * framesPerRow + col`（行是"带"号）', () => {
  // 7 列：带 0 是帧 0..6，带 1 是帧 7..13，带 3 是帧 21..27
  assert.equal(frameIndexOf(7, 0, 0), 0)
  assert.equal(frameIndexOf(7, 4, 0), 4)
  assert.equal(frameIndexOf(7, 0, 1), 7)
  assert.equal(frameIndexOf(7, 4, 1), 11)
  assert.equal(frameIndexOf(7, 0, 3), 21)
  // 负数/缺参夹到 0（不返回负帧号，否则引擎会画上一个精灵的帧）
  assert.equal(frameIndexOf(7, -3, -2), 0)
  assert.equal(frameIndexOf(0, 2, 1), 3, 'framesPerRow 至少 1')
})

test('动画帧号数组：row 布局沿列走，column 布局沿带号走', () => {
  assert.deepEqual(animationFrameList(SHEET, SHEET.animations['walk.down'], 7), [0, 1, 2, 3])
  assert.deepEqual(animationFrameList(SHEET, SHEET.animations['idle.down'], 7), [4, 5, 6])
  assert.deepEqual(animationFrameList(SHEET, SHEET.animations['walk.up'], 7), [7, 8, 9, 10], '带 1 从第 7 帧开始')
  // column：同一列、往下一条带 × 帧数
  const column = { col: 2, row: 0, frames: 3, layout: 'column' }
  assert.deepEqual(animationFrameList(SHEET, column, 7), [2, 9, 16])
  // 单帧动画
  assert.deepEqual(animationFrameList(SHEET, { col: 4, row: 80, frames: 1 }, 32), [80 * 32 + 4])
})

test('帧间隔 → 引擎的 frameRate（帧/秒）；0/缺省不产生除零', () => {
  assert.equal(frameRateOf({ frameMs: 140 }), 1000 / 140)
  assert.equal(frameRateOf({ frameMs: 0 }), 0)
  assert.equal(frameRateOf({}), 0)
  assert.equal(frameRateOf({ frameMs: -5 }), 0)
})

test('锚点交给引擎的 setOrigin：人/家具贴地是 (0.5, 1)，地砖居中 (0.5, 0.5)', () => {
  assert.deepEqual(originOf(SHEET), [0.5, 1])
  assert.deepEqual(originOf({ anchor: 'center' }), [0.5, 0.5])
  assert.deepEqual(originOf(null), [0.5, 0.5])
})

test('facing → 四向：`atan2(Δz, Δx)` 且 +z 朝屏幕下方；正好 45° 归竖向', () => {
  assert.equal(directionOf(0), 'right')
  assert.equal(directionOf(Math.PI / 2), 'down')
  assert.equal(directionOf(Math.PI), 'left')
  assert.equal(directionOf(-Math.PI / 2), 'up')
  // 真机数据：agent-1 的 facing 正是 -3π/4（浮点最后一位会决定结果 → 必须有偏置）
  assert.equal(directionOf(-2.356194490192345), 'up')
  assert.equal(directionOf(Math.PI / 4), 'down', '正好 45° 约定归竖向')
  assert.equal(directionOf(Number.NaN), 'right')
  assert.equal(FOUR_DIRECTIONS.length, 4)
})

test('动作名：只有 walking 算走，其余都当站着', () => {
  assert.equal(actionOf('walking'), 'walk')
  assert.equal(actionOf('idle'), 'idle')
  assert.equal(actionOf(undefined), 'idle')
})

test('动画 key：契约的点分名 ↔ 引擎的 key（`walk.down` → `walk-down`）', () => {
  assert.equal(animationKey('walk', 'down'), 'walk-down')
  assert.equal(animationKey('idle', null), 'idle')
  assert.equal(keyOfAnimationName('walk.down'), 'walk-down')
  assert.equal(keyOfAnimationName('idle'), 'idle')
})

test('动画回退链：`动作.方向` → `动作` → `idle.方向` → `idle`，且去重', () => {
  assert.deepEqual(animationCandidates({ state: 'walking', direction: 'down' }), ['walk-down', 'walk', 'idle-down', 'idle'])
  assert.deepEqual(animationCandidates({ state: 'idle', direction: 'left' }), ['idle-left', 'idle'])
  assert.deepEqual(animationCandidates({ state: 'idle', direction: null }), ['idle'])
})

test('回退链的选择：谁存在用谁；一个都不存在返回 null（**不要放错动画**）', () => {
  const has = (keys) => (key) => keys.includes(key)
  assert.equal(resolveAnimationKey(has(['walk-down', 'idle']), { state: 'walking', direction: 'down' }), 'walk-down')
  // 只有不分方向的 walk → 命中第二条
  assert.equal(resolveAnimationKey(has(['walk']), { state: 'walking', direction: 'left' }), 'walk')
  // 只有 idle-left → 命中第三条（走的动作没有，就用站的，不能播一个错的）
  assert.equal(resolveAnimationKey(has(['idle-left']), { state: 'walking', direction: 'left' }), 'idle-left')
  assert.equal(resolveAnimationKey(has(['idle']), { state: 'walking', direction: 'down' }), 'idle')
  assert.equal(resolveAnimationKey(has([]), { state: 'walking', direction: 'down' }), null)
})

test('整数倍缩放：只给整数、至少 1、有上限（小数会让像素大小不一）', () => {
  // 真机那一档：1400×748，世界 256 源像素、留边 1.06 → floor(748/271.36) = 2
  assert.equal(integerZoom({ viewWidth: 1400, viewHeight: 748, worldPixels: 256 }), 2)
  for (const [w, h] of [[4000, 3000], [1400, 748], [800, 600], [320, 240], [10, 10], [0, 0]]) {
    const zoom = integerZoom({ viewWidth: w, viewHeight: h, worldPixels: 256 })
    assert.ok(Number.isInteger(zoom), `必须是整数：${zoom}`)
    assert.ok(zoom >= 1 && zoom <= 6, `夹在 [1,6]：${zoom}（${w}×${h}）`)
  }
})

test('平铺相位：按**世界网格**取（跨区花纹才对得上；R55 为此量过缝率）', () => {
  // 世界像素口径：8×8 的区、32px 的砖 → 左边界落在整格上，相位 0
  assert.equal(tilePhasePx({ leftWorld: -128, tileUnits: 32, scale: 1 }), 0)
  assert.equal(tilePhasePx({ leftWorld: 0, tileUnits: 32, scale: 1 }), 0)
  // 左边界在 -8（世界像素）→ 上一格起点是 -32，偏了 24
  assert.equal(tilePhasePx({ leftWorld: -8, tileUnits: 32, scale: 1 }), 24)
  assert.equal(tilePhasePx({}), 0)
})

test('实时角色合成：位姿来自 world、外观来自内容计划', () => {
  const scene = {
    extent: { half: 8 },
    noteColors: { report: '#7C8CFF' },
    actors: [
      { id: 'agent-1', name: '甲', role: 'lead', x: -4, z: -4, color: '#FBBF24', modelId: 'model.a' },
      { id: 'agent-2', name: '乙', role: 'docs', x: 4, z: 4, color: '#4ADE80', modelId: 'model.b' },
    ],
  }
  const world = {
    agents: [
      { id: 'agent-1', name: '甲', state: 'idle', position: { x: 1.6, z: 6.4 }, facing: 0 },
      { id: 'agent-2', name: '乙', state: 'walking', position: { x: 6.4, z: 1.6 }, facing: Math.PI },
    ],
  }
  const actors = liveActors(world, scene)
  assert.equal(actors.length, 2)
  assert.deepEqual([actors[0].x, actors[0].z], [1.6, 6.4], '画的必须是**实时**位姿，不是快照那一帧')
  assert.equal(actors[0].color, '#FBBF24', '配色来自内容计划')
  assert.equal(actors[0].modelId, 'model.a')
  assert.equal(actors[1].state, 'walking')
  // 计划里没有的角色：中性色，不凭空编人设（D37）
  const extra = liveActors({ agents: [{ id: 'x', name: '新来的', position: { x: 0, z: 0 } }] }, scene)
  assert.equal(extra[0].color, '#7C8CFF')
  assert.equal(extra[0].modelId, null)
  // 快照还没回来 → 退回计划本身
  assert.deepEqual(liveActors(null, scene), scene.actors)
})

test('气泡抬高常量：锚点比脚下高 26px（HTML 气泡挂在那儿）', () => {
  assert.equal(ANCHOR_LIFT_PX, 26)
})

test('真数据：`16_Office_32x32.png`（1024×3040）里 `(col4,row80)` → 帧号 2564', () => {
  // 这一格是 R55 逐像素量过缝率选出来的地板砖，帧号算错就会铺到别的格上
  const sheet = { cellW: 32, cellH: 32, rowsPerFigure: 1, anchor: 'center' }
  const perRow = framesPerRow(sheet, 1024)
  assert.equal(perRow, 32)
  assert.equal(frameIndexOf(perRow, 4, 80), 2564)
  // 真图只有 95 行 → 行号不能越界
  assert.ok(80 < Math.floor(3040 / 32))
})

test('回退链：两条都存在时**先动作后 idle**（不能因为图集里刚好有 idle 就先播站着的）', () => {
  const has = (keys) => (key) => keys.includes(key)
  assert.equal(resolveAnimationKey(has(['idle-down', 'walk-down']), { state: 'walking', direction: 'down' }), 'walk-down')
  assert.equal(resolveAnimationKey(has(['walk', 'walk-down', 'idle']), { state: 'walking', direction: 'down' }), 'walk-down')
})

test('飞行的朝向不影响动画选择：站着+朝左 → idle-left（没有就退到 idle）', () => {
  const has = (keys) => (key) => keys.includes(key)
  assert.equal(resolveAnimationKey(has(['idle-left', 'idle']), { state: 'idle', direction: 'left' }), 'idle-left')
  assert.equal(resolveAnimationKey(has(['idle']), { state: 'idle', direction: 'left' }), 'idle')
  assert.equal(resolveAnimationKey(has(['walk-left']), { state: 'idle', direction: 'left' }), null, '不该拿走的动画来站着')
})

test('整数缩放：上限与会跟随视口（同一世界，视口大一倍 → 倍数更大，但仍然整数）', () => {
  const small = integerZoom({ viewWidth: 800, viewHeight: 600, worldPixels: 256 })
  const large = integerZoom({ viewWidth: 1600, viewHeight: 1200, worldPixels: 256 })
  assert.ok(large > small)
  assert.ok(Number.isInteger(small) && Number.isInteger(large))
  assert.equal(integerZoom({ viewWidth: 99999, viewHeight: 99999, worldPixels: 256, maxZoom: 4 }), 4, '上限生效')
})

test('平铺相位：负半轴（左边界 -8 世界像素）也与世界网格对齐', () => {
  // -8 / 32 → 上一格是 -32 → 偏 24
  assert.equal(tilePhasePx({ leftWorld: -8, tileUnits: 32, scale: 1 }), 24)
  // 正好整格 → 0
  assert.equal(tilePhasePx({ leftWorld: -64, tileUnits: 32, scale: 1 }), 0)
  // 同一块砖在四个区里相位必须一致（跨区无缝的前提）
  const phases = [-128, -128, 0, 0].map((left) => tilePhasePx({ leftWorld: left, tileUnits: 32, scale: 1 }))
  assert.deepEqual(phases, [0, 0, 0, 0])
})

test('世界取景框（R62）：有底图时按**图**算 —— 37×21 格 / 32px / 每格 2 单位 → 74×42 单位、1184×672 像素', () => {
  const plan = { extent: { half: 35 }, map: { url: 'microverse/scene/office.png', width: 37, height: 21, cellPx: 32, unitsPerCell: 2 } }
  const frame = worldFrame(plan)
  assert.equal(frame.source, 'map')
  assert.equal(frame.halfW, 37, '74 单位宽 → 半宽 37')
  assert.equal(frame.halfH, 21, '42 单位高 → 半高 21')
  assert.equal(frame.worldPxW, 1184, '37 × 32 = 1184 源像素')
  assert.equal(frame.worldPxH, 672)
  // 图左上角的世界像素坐标：世界坐标**中心为 0**，图坐标**左上为 0** —— 这一步最容易差半张图
  assert.equal(frame.originPxX, -592, '-37 单位 × 16 像素')
  assert.equal(frame.originPxY, -336)
  // 图的一格 = 2 单位 = 32 世界像素 = 图上 32 像素 → **1:1，scale 1**
  assert.equal(frame.unitsPerCell * TILE_PX, frame.cellPx)
})

test('世界取景框：没有底图时退回 extent（正方形），喂进老的世界也不会变', () => {
  const frame = worldFrame({ extent: { half: 8 } })
  assert.equal(frame.source, 'extent')
  assert.equal(frame.halfW, 8)
  assert.equal(frame.worldPxH, 256)
  assert.equal(frame.originPxX, -128)
  // 缺 extent 时按 8 处理（不炸）
  assert.equal(worldFrame({}).halfW, 8)
  assert.equal(worldFrame(null).halfW, 8)
})

test('整数缩放按**两个轴**算：74×42 的办公室在 1400×748 的舞台上正好 1 倍（不会算成看不清）', () => {
  const frame = worldFrame({ map: { width: 37, height: 21, cellPx: 32, unitsPerCell: 2 } })
  const zoom = integerZoom({ viewWidth: 1400, viewHeight: 748, worldPixelsW: frame.worldPxW, worldPixelsH: frame.worldPxH })
  assert.equal(zoom, 1, '1184×672 塞得进 1400×748，1 倍')
  // 只按短边（老算法）会得到 0.59 → 夹到 1；按两轴才是"真的装得下"
  const naive = integerZoom({ viewWidth: 1400, viewHeight: 748, worldPixels: 1184 })
  assert.equal(naive, 1)
  // 轴会分别起作用：又宽又扁的视口里，限制来自高度
  assert.equal(integerZoom({ viewWidth: 4000, viewHeight: 700, worldPixelsW: 1184, worldPixelsH: 672 }), 1)
  // 视口够大时给整数倍（不出现小数）
  const big = integerZoom({ viewWidth: 3000, viewHeight: 1600, worldPixelsW: 1184, worldPixelsH: 672 })
  assert.ok(Number.isInteger(big) && big >= 1)
})

test('整数缩放：上限仍然生效，0 尺寸视口给 1（不返回 0 或负数）', () => {
  assert.equal(integerZoom({ viewWidth: 0, viewHeight: 0, worldPixelsW: 1184, worldPixelsH: 672 }), 1)
  assert.equal(integerZoom({ viewWidth: 99999, viewHeight: 99999, worldPixelsW: 1184, worldPixelsH: 672, maxZoom: 3 }), 3)
})
