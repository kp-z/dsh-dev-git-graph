/**
 * 地面平铺与染色的测试（R55 / M13-3）。
 *
 * ## 为什么这份测试值钱
 *
 * "平铺"看着是件小事，但两个错法都**不会报错**：
 * · **相位没对齐**：每个区各自从自己的左上角起贴，跨区交界处花纹错半格 → 一条明显的缝；
 * · **格子里挑错**：上一轮索引表把 `(1,4)` 当过候选，它**平均色几乎一样**（`rgb(183,193,212)`
 *   vs `rgb(184,194,212)`）但**左右缝差 652**——"看着颜色对"完全掩盖"铺起来有缝"。
 *   这一条我在真图上量过（`/tmp/png-inspect.mjs`），所以这里把"我们对的是 (4,80) 的 128/2560 偏移"
 *   也钉进测试。
 *
 * 染色那部分是乘算，也能算：`round(砖色 × 区色 / 255)`。测试直接断言四个区的实际色值，
 * 这样"四个区是不是真的不同"是一个**算得出来的数**，而不只是截图上的印象。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_TILE_PX, planGroundTiles, rgbToHexString, tintRgb } from '../web/core/ground-tiles.js'

/** 真机那一局的四个区（8×8，中心在 ±4），以及它们的地砖。 */
const DISTRICTS = [
  { id: 'district.engineering', x: -4, z: -4, width: 8, depth: 8, color: '#333A48' },
  { id: 'district.infra', x: 4, z: -4, width: 8, depth: 8, color: '#2F3A3C' },
  { id: 'district.meeting', x: -4, z: 4, width: 8, depth: 8, color: '#363040' },
  { id: 'district.commons', x: 4, z: 4, width: 8, depth: 8, color: '#3C342C' },
]
/** 真图里那一格的底色（从 `16_Office_32x32.png` 的 (4,80) 逐像素量出来的平均色）。 */
const FLOOR_RGB = [184, 194, 212]

test('平铺：8×8 的区、32px 的砖、1 单位 16px → 4×4 = 16 块，全是整格', () => {
  const plan = planGroundTiles({ district: DISTRICTS[0], half: 8, unitPx: 16, tilePx: 32, cell: { col: 4, row: 80 } })
  assert.equal(plan.width, 128)
  assert.equal(plan.height, 128)
  assert.equal(plan.tileUnits, 2, '一格地板 = 2×2 世界单位')
  assert.equal(plan.placements.length, 16)
  for (const p of plan.placements) {
    assert.equal(p.sw, 32)
    assert.equal(p.sh, 32)
    assert.equal(p.dx % 32, 0, `dx 没落在整格上：${p.dx}`)
    assert.equal(p.dy % 32, 0)
  }
  // **每一块都取同一格**（平铺就是"同一张砖重复贴"）：col4 → sx 128，row80 → sy 2560。
  // 真图 1024×3040 装得下（128+32 ≤ 1024、2560+32 ≤ 3040）。
  assert.deepEqual([...new Set(plan.placements.map((p) => p.sx))], [128])
  assert.deepEqual([...new Set(plan.placements.map((p) => p.sy))], [2560])
  assert.ok(128 + 32 <= 1024 && 2560 + 32 <= 3040, '那一格必须在真图范围内')
})

test('平铺：**相位对齐到世界格**（区起点不是整格时，边缘那块砖要裁）', () => {
  // 这一区的世界范围是 x ∈ [-0.5, 3.5]、z ∈ [-1.5, 2.5]：两个方向都不是整格起点
  const district = { x: 1.5, z: 0.5, width: 4, depth: 4, color: '#333A48' }
  const col4 = 4
  const row80 = 80
  const plan = planGroundTiles({ district, half: 8, unitPx: 16, tilePx: 32, cell: { col: col4, row: row80 } })
  assert.equal(plan.width, 64)
  assert.equal(plan.height, 64)
  // 每块砖的**世界起点**必须是 2 单位的整数倍（= 与全局网格同相位：跨区不会错半格）。
  // 注意 `dx` 是"可见部分的左边"，被裁过的砖要先把裁掉的那截加回去才是砖的真实起点：
  //   砖起点 = dx - cutLeft，而 cutLeft = sx - col*tilePx（裁在源图那一侧）。
  const leftWorld = district.x - district.width / 2 // -0.5
  const topWorld = district.z - district.depth / 2 // -1.5
  const cutX = col4 * 32
  const cutY = row80 * 32
  for (const p of plan.placements) {
    const originX = leftWorld + (p.dx - (p.sx - cutX)) / 16
    const originZ = topWorld + (p.dy - (p.sy - cutY)) / 16
    // 用 `=== 0` 而不是 `assert.equal`：JS 里 `-2 % 2` 是 `-0`，而 `Object.is(-0, 0)` 是 false，
    // 会报一个看起来像"没对齐"的假警报。
    assert.ok(originX % 2 === 0, `砖的世界起点没对齐到 2 单位：${originX}`)
    assert.ok(originZ % 2 === 0, `砖的世界起点没对齐到 2 单位：${originZ}`)
  }
  // 贴着区左上角的那一块：世界格从 (-2,-2) 起，所以左边/上边各有 24px 在区外 → 裁掉
  // 四个角上那块砖：横向世界格从 -2 起（区左边界 -0.5）→ 横裁 1.5 单位 = 24px；
  // 纵向世界格从 -2 起（区上边界 -1.5）→ 纵裁 0.5 单位 = 8px。两个方向各裁各的。
  const first = plan.placements.find((p) => p.dx === 0 && p.dy === 0)
  assert.ok(first !== undefined)
  assert.equal(first.sw, 8, '横裁掉 24px，只剩 8px 可见')
  assert.equal(first.sh, 24, '纵裁掉 8px，剩 24px')
  assert.equal(first.sx, 128 + 24, '裁在**源图**那一侧（sx 带 24px 偏移），不是先画出去再靠容器裁')
  assert.equal(first.sy, 2560 + 8)
})

test('平铺：裁完之后**既不重叠也不留缝**（覆盖面积 = 区面积）', () => {
  const cases = [
    { x: -4, z: -4, width: 8, depth: 8 },
    { x: 1.5, z: 0.5, width: 3, depth: 3 },
    { x: -0.5, z: -0.5, width: 1, depth: 1 }, // 比一块砖还小
    { x: 2.25, z: -1.75, width: 5.5, depth: 3.25 },
  ]
  for (const district of cases) {
    const plan = planGroundTiles({ district, half: 8, unitPx: 16, tilePx: 32 })
    const area = plan.placements.reduce((sum, p) => sum + p.sw * p.sh, 0)
    assert.equal(area, plan.width * plan.height, `${district.x},${district.z} ${district.width}×${district.depth}：覆盖面积对不上`)
    for (const p of plan.placements) {
      assert.ok(p.dx >= 0 && p.dy >= 0 && p.dx + p.sw <= plan.width && p.dy + p.sh <= plan.height, '画到了区外')
      assert.ok(p.sw > 0 && p.sh > 0)
    }
  }
})

test('平铺：确定性 + 认不出的输入不炸', () => {
  const input = { district: DISTRICTS[2], half: 8, unitPx: 16, tilePx: 32 }
  assert.deepEqual(planGroundTiles(input), planGroundTiles(input))
  const degenerate = planGroundTiles({ district: { x: 0, z: 0, width: 0, depth: 0 } })
  assert.equal(degenerate.placements.length, 0)
  assert.equal(degenerate.width, 0)
  const noInput = planGroundTiles()
  assert.equal(noInput.placements.length, 0)
  assert.equal(DEFAULT_TILE_PX, 32, '缺省砖尺寸 = 契约里那一格的尺寸')
})

test('染色（multiply 的算术版）：四个区的实际颜色算得出来，而且互不相同', () => {
  const tinted = DISTRICTS.map((d) => ({ id: d.id, color: d.color, floor: tintRgb(FLOOR_RGB, d.color) }))
  // 真值：地砖是浅色 rgb(184,194,212)，乘上深区色得到深色调
  assert.deepEqual(tinted[0].floor, [37, 44, 60]) // #252c3c
  assert.deepEqual(tinted[1].floor, [34, 44, 50]) // #222c32
  assert.deepEqual(tinted[2].floor, [39, 37, 53]) // #272535
  assert.deepEqual(tinted[3].floor, [43, 40, 37]) // #2b2825
  assert.equal(rgbToHexString(tinted[0].floor), '#252c3c')

  const hexes = tinted.map((t) => rgbToHexString(t.floor))
  assert.equal(new Set(hexes).size, 4, `四个区应当四种颜色，实际 ${hexes.join(' / ')}`)
  // 最接近的一对差多少：把"一眼能不能分出"变成数字
  let closest = null
  for (let i = 0; i < tinted.length; i += 1) {
    for (let j = i + 1; j < tinted.length; j += 1) {
      const a = tinted[i].floor
      const b = tinted[j].floor
      const distance = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
      if (closest === null || distance < closest.distance) closest = { pair: `${tinted[i].id} ↔ ${tinted[j].id}`, distance }
    }
  }
  assert.ok(closest.distance >= 8, `最接近的两个区只差 ${closest.distance}（${closest.pair}）——那就不能靠颜色区分了`)
})

test('染色：认不出的色值返回 null（渲染层据此不染色），不返回黑色', () => {
  assert.equal(tintRgb(FLOOR_RGB, '不是颜色'), null)
  assert.equal(tintRgb(null, '#333A48'), null)
  assert.equal(tintRgb([0, 0, 0], '#FFFFFF').join(','), '0,0,0')
  assert.equal(tintRgb([255, 255, 255], '#FFFFFF').join(','), '255,255,255')
})
