/**
 * 统一空间模型（R227）：`nav + 精细碰撞体 + 站点` 合成一套 `SceneSpace`。
 *
 * 这套结构存在的理由只有一个：**让"能不能走 / 挡什么 / 谁在前"读同一份数据**。
 * 所以测试也按这三件事分别钉住，而不是只测"函数返回了对象"。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildSceneSpace } from '../lib/scene/space.js'

/** 3×1 网格：中间 blocked。世界坐标一格 = 1，originX = -1.5。 */
function nav3() {
  return { width: 3, height: 1, unitsPerCell: 1, originX: -1.5, originZ: -0.5, blocked: [false, true, false] }
}

function station(extra = {}) {
  return {
    id: 'station.test',
    name: '测试站',
    kind: 'desk',
    district: 'engineering',
    anchor: { x: 0, z: 0 },
    capacity: 1,
    capabilities: ['code'],
    model: 'model.x',
    parts: [],
    slots: [{ x: 1, z: 0 }],
    ...extra,
  }
}

test('没有精细碰撞体时：不补整格（只报 uncoveredCells，不造看不见的墙）', () => {
  const space = buildSceneSpace({ nav: nav3(), fineRects: null, stations: [], tilePx: 1 })
  assert.ok(space)
  assert.equal(space.audit.blockedCells, 1)
  assert.equal(space.audit.fineRects, 0)
  assert.equal(space.audit.uncoveredCells, 1, '要报出来，但**不是**补一格')
  assert.deepEqual(space.obstacles, [], '物理障碍只来自精细几何')
})

test('精细碰撞体盖住格中心时：不再补格（避免过度阻挡）', () => {
  // 地图像素一格 1px；矩形的世界范围 -0.5..0.5 正好盖住中间格中心 (0,0)。
  const space = buildSceneSpace({ nav: nav3(), fineRects: [[1, 0, 1, 1]], stations: [], tilePx: 1 })
  assert.ok(space)
  assert.equal(space.audit.fineRects, 1)
  assert.equal(space.audit.uncoveredCells, 0)
  assert.equal(space.obstacles.length, 1)
  assert.equal(space.obstacles[0].source, 'fine')
})

test('实体：占地取锚点格，基础深度取 anchor.z，吸附点落在 blocked 格会被计数', () => {
  const space = buildSceneSpace({
    nav: nav3(),
    fineRects: null,
    stations: [
      station({
        slots: [
          { x: 1, z: 0 }, // 可走
          { x: 0, z: 0 }, // blocked
        ],
      }),
    ],
    tilePx: 1,
  })
  assert.ok(space)
  assert.equal(space.entities.length, 1)
  const entity = space.entities[0]
  assert.equal(entity.id, 'station.test')
  assert.equal(entity.base, 0, '深度基准必须是站点锚点的世界 z')
  assert.deepEqual(
    { x: entity.footprint.x, z: entity.footprint.z, w: entity.footprint.w, h: entity.footprint.h },
    { x: -0.5, z: -0.5, w: 1, h: 1 },
  )
  assert.equal(space.audit.slots, 2)
  assert.equal(space.audit.slotsBlocked, 1, '有吸附点落在墙里必须被审计出来')
})

test('没有 nav 时返回 null（老内容没有地图的回退路径）', () => {
  assert.equal(buildSceneSpace({ nav: null, fineRects: [], stations: [], tilePx: 1 }), null)
})

test('同一输入两次构建结果逐字段相同（可复现）', () => {
  const input = { nav: nav3(), fineRects: [[1, 0, 1, 1]], stations: [station()], tilePx: 1 }
  assert.deepEqual(buildSceneSpace(input), buildSceneSpace(input))
})

test('美术占位格：画面上确实有家具的格要生成整格障碍（不是空气墙）', () => {
  // 3×1 网格，全可走；把中间格声明为"美术占位"。
  const nav = { width: 3, height: 1, unitsPerCell: 1, originX: -1.5, originZ: -0.5, blocked: [false, false, false] }
  const space = buildSceneSpace({ nav, fineRects: null, stations: [], occupancyCells: [1], tilePx: 1 })
  assert.ok(space)
  assert.equal(space.audit.artCells, 1)
  assert.equal(space.obstacles.length, 1)
  assert.equal(space.obstacles[0].source, 'art')
  assert.deepEqual(
    { x: space.obstacles[0].x, z: space.obstacles[0].z },
    { x: -0.5, z: -0.5 },
  )
  // 即使 nav 已经标成 blocked，只要精细几何没盖住格中心，也要补 art 障碍：
  // nav 只让寻路绕开，手动操控靠的是物理体。
  const blockedNav = { width: 3, height: 1, unitsPerCell: 1, originX: -1.5, originZ: -0.5, blocked: [false, true, false] }
  const again = buildSceneSpace({ nav: blockedNav, fineRects: null, stations: [], occupancyCells: [1], tilePx: 1 })
  assert.ok(again)
  assert.equal(again.audit.artCells, 1)
})

test('整块美术矩形：占位格属于小连通块时，用整块而不是单格（防"半截墙"）', () => {
  const nav = { width: 4, height: 2, unitsPerCell: 1, originX: -2, originZ: -1, blocked: [false, false, false, false, false, false, false, false] }
  // 地图像素 16/格：整块从 (16,0) 起、48×32（跨 3 格宽 2 格高），格 (1,0) 的中心落在里面。
  const space = buildSceneSpace({
    nav,
    fineRects: null,
    stations: [],
    occupancyCells: [1],
    occupancyRects: [[16, 0, 48, 32]],
    tilePx: 16,
  })
  assert.ok(space)
  assert.equal(space.audit.artCells, 1)
  assert.equal(space.obstacles.length, 1)
  const o = space.obstacles[0]
  assert.equal(o.source, 'art')
  assert.deepEqual({ x: o.x, z: o.z, w: o.w, h: o.h }, { x: -1, z: -1, w: 3, h: 2 })
})
