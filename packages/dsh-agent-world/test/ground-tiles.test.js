/**
 * 地面染色算术的测试（R55 起，R58 后只剩"染色"这一半）。
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

import { parseRgb, rgbToHexString, tintRgb } from '../web/core/ground-tiles.js'

/** 真机那一局的四个区（8×8，中心在 ±4），以及它们的地砖。 */
const DISTRICTS = [
  { id: 'district.engineering', x: -4, z: -4, width: 8, depth: 8, color: '#333A48' },
  { id: 'district.infra', x: 4, z: -4, width: 8, depth: 8, color: '#2F3A3C' },
  { id: 'district.meeting', x: -4, z: 4, width: 8, depth: 8, color: '#363040' },
  { id: 'district.commons', x: 4, z: 4, width: 8, depth: 8, color: '#3C342C' },
]
/** 真图里那一格的底色（从 `16_Office_32x32.png` 的 (4,80) 逐像素量出来的平均色）。 */
const FLOOR_RGB = [184, 194, 212]





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
