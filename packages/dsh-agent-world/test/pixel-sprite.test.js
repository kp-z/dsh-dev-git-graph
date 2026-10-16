/**
 * 像素精灵的纯逻辑测试（R51 / M12-3）：重上色 + 切图。
 *
 * ## 为什么这两块必须有测试
 *
 * · **重上色**：它是"8 个人各不相同"的唯一来源。映射错了不会崩，只会让 8 个人长得一样
 *   ——而这种错在浏览器里要**盯着 8 个小人看**才发现，最容易漏。尤其"细节色要原样保留"：
 *   把眼睛/工具色一起换掉，人物就糊成一色了，而截图里很难看出"眼睛本来是什么色"。
 * · **切图**：`row` 是"带"号不是像素行。切错了得到一堆 18×18 的碎片——
 *   图还在，人不成人。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BASE_SKIN,
  assignColorVariants,
  variantColor,
  DARK_DELTA,
  VARIANT_HUE_STEP,
  LIGHT_DELTA,
  MIN_STEP,
  hexToHsl,
  hslToHex,
  lightnessLadder,
  paletteOfPixels,
  parseHex,
  recolorPlan,
  rgbToHex,
} from '../web/core/pixel-recolor.js'
import { FOUR_DIRECTIONS, directionOf, frameIndex, frameRect, integerZoom, pickAnimation, spriteBox } from '../web/core/pixel-sheet.js'

/** 裸模的真实调色板形状：3 主色 + 4 个各 28 像素的细节色（任务书里核过的）。 */
const NUDE_PALETTE = [
  { hex: '#FFE6E2', count: 380 },
  { hex: '#D6A1B2', count: 260 },
  { hex: '#996B88', count: 150 },
  { hex: '#3A2A31', count: 28 },
  { hex: '#F59E0B', count: 28 },
  { hex: '#1D4ED8', count: 28 },
  { hex: '#E5E7EB', count: 28 },
]

test('色值解析：`#rgb` / `#rrggbb` 都认，认不出的返回 null（不猜）', () => {
  assert.deepEqual(parseHex('#ff0000'), { r: 255, g: 0, b: 0 })
  assert.deepEqual(parseHex('f00'), { r: 255, g: 0, b: 0 })
  assert.deepEqual(parseHex('#FFE6E2'), { r: 255, g: 230, b: 226 })
  assert.equal(parseHex('rgb(1,2,3)'), null)
  assert.equal(parseHex(''), null)
  assert.equal(parseHex(null), null)
  assert.equal(rgbToHex({ r: 255, g: 230, b: 226 }), '#ffe6e2', '输出一律小写（map 的键要对得上）')
  assert.equal(rgbToHex({ r: 300, g: -5, b: 0 }), '#ff0000', '越界夹住，不产生非法色值')
})

test('HSL 往返：转换不丢信息（±1/255）', () => {
  for (const hex of ['#ffe6e2', '#d6a1b2', '#996b88', '#FBBF24', '#000000', '#ffffff', '#4ade80']) {
    const back = hslToHex(hexToHsl(hex))
    assert.equal(back, hex.toLowerCase(), `${hex} 往返变了：${back}`)
  }
})

test('色彩阶梯：浅 > 中 > 深，且每级至少差 MIN_STEP', () => {
  const colors = ['#FBBF24', '#38BDF8', '#C084FC', '#2DD4BF', '#FB7185', '#4ADE80', '#ffffff', '#000000', '#808080', '#7f0000']
  for (const base of colors) {
    const ladder = lightnessLadder(base)
    assert.ok(ladder !== null, `${base} 应该能推出阶梯`)
    const levels = ladder.map((hex) => hexToHsl(hex).l)
    assert.ok(levels[0] > levels[1], `${base}：浅(${levels[0]}) 必须比 中(${levels[1]}) 亮`)
    assert.ok(levels[1] > levels[2], `${base}：中(${levels[1]}) 必须比 深(${levels[2]}) 亮`)
    assert.ok(levels[0] - levels[1] >= MIN_STEP - 1e-9, `${base}：浅/中 差太小 ${levels[0] - levels[1]}`)
    assert.ok(levels[1] - levels[2] >= MIN_STEP - 1e-9, `${base}：中/深 差太小 ${levels[1] - levels[2]}`)
  }
})

test('色彩阶梯：**只动明度**，色相与饱和度保留（换的是衣服的深浅，不是颜色）', () => {
  for (const base of ['#FBBF24', '#38BDF8', '#4ADE80']) {
    const source = hexToHsl(base)
    for (const step of lightnessLadder(base)) {
      const hsl = hexToHsl(step)
      assert.ok(Math.abs(hsl.h - source.h) < 1.5, `${base} → ${step}：色相跑了（${source.h} → ${hsl.h}）`)
      assert.ok(Math.abs(hsl.s - source.s) < 0.02, `${base} → ${step}：饱和度跑了（${source.s} → ${hsl.s}）`)
    }
  }
})

test('色彩阶梯：源图的三个主色就是"中间调 ±0.21/0.22"这条比例的经验依据', () => {
  const source = [hexToHsl(BASE_SKIN.light).l, hexToHsl(BASE_SKIN.mid).l, hexToHsl(BASE_SKIN.dark).l]
  assert.ok(Math.abs(source[1] - source[2] + DARK_DELTA) < 0.02, `源图深色差 ${source[1] - source[2]} vs 常量 ${-DARK_DELTA}`)
  assert.ok(Math.abs(source[0] - source[1] - LIGHT_DELTA) < 0.02, `源图浅色差 ${source[0] - source[1]} vs 常量 ${LIGHT_DELTA}`)
  // 拿中间调当 base 复算：应当**接近**源图那三级（说明这条阶梯确实是从图里量出来的）
  const rebuilt = lightnessLadder(BASE_SKIN.mid)
  assert.ok(Math.abs(hexToHsl(rebuilt[0]).l - source[0]) < 0.04)
  assert.ok(Math.abs(hexToHsl(rebuilt[2]).l - source[2]) < 0.04)
})

test('重上色：3 个主色换成阶梯三级，**4 个细节色原样保留**', () => {
  const plan = recolorPlan(NUDE_PALETTE, '#38BDF8')
  const ladder = lightnessLadder('#38BDF8')
  // 主色按明度从浅到深映射（源图里 #FFE6E2 最亮）
  assert.equal(plan['#ffe6e2'], ladder[0])
  assert.equal(plan['#d6a1b2'], ladder[1])
  assert.equal(plan['#996b88'], ladder[2])
  // 细节色一个都不许动
  for (const detail of ['#3a2a31', '#f59e0b', '#1d4ed8', '#e5e7eb']) {
    assert.equal(plan[detail], detail, `细节色 ${detail} 被改了——眼睛/工具会跟着变色`)
  }
})

test('重上色：细节色即使像素很少也不会被当主色（靠 count 而不是"数组前三个"）', () => {
  // 故意把细节色放在数组**前面**：只有按 count 挑主色才不会选错
  const shuffled = [...NUDE_PALETTE.slice(3), ...NUDE_PALETTE.slice(0, 3)]
  const plan = recolorPlan(shuffled, '#FBBF24')
  const ladder = lightnessLadder('#FBBF24')
  assert.equal(plan['#ffe6e2'], ladder[0])
  assert.equal(plan['#3a2a31'], '#3a2a31')
})

test('重上色：确定性（同一份输入永远同一张表）', () => {
  const a = recolorPlan(NUDE_PALETTE, '#C084FC')
  const b = recolorPlan(NUDE_PALETTE, '#C084FC')
  assert.deepEqual(a, b)
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort())
  // 不同角色配色 → 结果不同（否则 8 个人还是一样）
  assert.notDeepEqual(recolorPlan(NUDE_PALETTE, '#C084FC'), recolorPlan(NUDE_PALETTE, '#2DD4BF'))
})

test('重上色：认不出的调色板 / 色值 → 恒等映射（退回"不重上色"，不是画一片黑）', () => {
  assert.deepEqual(recolorPlan([], '#38BDF8'), {})
  assert.deepEqual(recolorPlan(null, '#38BDF8'), {})
  assert.deepEqual(recolorPlan(['不是颜色', ''], '#38BDF8'), {})
  const identity = recolorPlan(NUDE_PALETTE, '不是颜色')
  for (const entry of NUDE_PALETTE) assert.equal(identity[entry.hex.toLowerCase()], entry.hex.toLowerCase())
})

test('重上色：三条以上同票时也确定（同票按色值排）', () => {
  const tied = [
    { hex: '#111111', count: 10 },
    { hex: '#222222', count: 10 },
    { hex: '#333333', count: 10 },
    { hex: '#444444', count: 10 },
  ]
  const first = recolorPlan(tied, '#4ADE80')
  const second = recolorPlan([...tied].reverse(), '#4ADE80')
  assert.deepEqual(first, second, '顺序不同也要给同一张表')
})

test('取像素调色板：透明像素不算，按"像素多→少"排（同票按色值）', () => {
  const rgba = [
    255, 230, 226, 255, // 1
    255, 230, 226, 255, // 2
    214, 161, 178, 255, // 1
    0, 0, 0, 0, // 透明 → 不算
    0, 0, 0, 3, // alpha 太小 → 不算
  ]
  const palette = paletteOfPixels(rgba)
  assert.deepEqual(palette, [
    { hex: '#ffe6e2', count: 2 },
    { hex: '#d6a1b2', count: 1 },
  ])
  assert.deepEqual(paletteOfPixels([]), [])
})

// ── 切图 ────────────────────────────────────────────────────────────────────

test('facing → 四向：与 `angleTo = atan2(Δz, Δx)` 且 +z 朝屏幕下方一致', () => {
  assert.equal(directionOf(0), 'right')
  assert.equal(directionOf(Math.PI / 2), 'down')
  assert.equal(directionOf(Math.PI), 'left')
  assert.equal(directionOf(-Math.PI / 2), 'up')
  // 正好 45° 是**两可**的（左下既可以算左也可以算上）：约定归竖向，且永远同一侧。
  assert.equal(directionOf(-2.356194490192345), 'up', '真机 agent-1 的 facing = -3π/4（两可）→ 约定竖向')
  assert.equal(directionOf(Math.PI / 4), 'down', '同一条约定：45° → 竖')
  assert.equal(directionOf(Math.PI / 4 - 0.01), 'right', '明显偏横 → right')
  assert.equal(directionOf(Math.PI / 4 + 0.01), 'down', '明显偏竖 → down')
  // 两可情形的确定性：同一输入必须永远同一输出（浮点最后一位不该决定朝向）
  assert.equal(directionOf(-3 * Math.PI / 4), directionOf(-2.356194490192345))
  assert.equal(directionOf(Number.NaN), 'right', '认不出当 0，不炸')
  assert.deepEqual(FOUR_DIRECTIONS, ['down', 'left', 'right', 'up'])
})

test('选动画：精确命中 → 无方向 → idle → 图集第一条（顺序确定）', () => {
  const sheet = {
    animations: {
      'walk.down': { col: 0, row: 0, frames: 4, frameMs: 120, layout: 'row', mirror: false },
      'walk': { col: 0, row: 2, frames: 2, frameMs: 200, layout: 'row', mirror: false },
      'idle': { col: 0, row: 3, frames: 2, frameMs: 400, layout: 'row', mirror: false },
    },
  }
  assert.equal(pickAnimation(sheet, { state: 'walking', direction: 'down' }).name, 'walk.down')
  assert.equal(pickAnimation(sheet, { state: 'walking', direction: 'up' }).name, 'walk', '没有 walk.up → 用不分方向的 walk')
  assert.equal(pickAnimation(sheet, { state: 'idle', direction: 'up' }).name, 'idle')
  assert.equal(pickAnimation(sheet, { state: 'working', direction: 'left' }).name, 'idle', '干活也是站着')
  assert.equal(pickAnimation({ animations: {} }, { state: 'walking', direction: 'down' }), null)
  assert.equal(pickAnimation(null, {}), null)
  // 只有奇怪的动画名时也要给一个（确定性地取名字排序第一条）
  const odd = { animations: { 'zzz': { frames: 1 }, 'aaa': { frames: 1 } } }
  assert.equal(pickAnimation(odd, { state: 'walking', direction: 'down' }).name, 'aaa')
})

test('帧推进：按 frameMs 走、循环、边界不炸', () => {
  const anim = { frames: 4, frameMs: 120 }
  assert.equal(frameIndex(anim, 0), 0)
  assert.equal(frameIndex(anim, 119), 0)
  assert.equal(frameIndex(anim, 120), 1)
  assert.equal(frameIndex(anim, 480), 0, '绕回第一帧')
  assert.equal(frameIndex(anim, 500), 0)
  assert.equal(frameIndex({ frames: 1, frameMs: 120 }, 999), 0, '单帧不动')
  assert.equal(frameIndex({ frames: 4, frameMs: 0 }, 999), 0, '没给帧间隔就不动（除以 0 会出 NaN）')
  assert.equal(frameIndex(null, 999), 0)
  assert.equal(frameIndex(anim, Number.NaN), 0)
})

test('切图：`row` 是**带**号（18×18 格、两条带一格 → 一条带 36px 高）', () => {
  const sheet = { cellW: 18, cellH: 18, rowsPerFigure: 2, anchor: 'bottom', animations: {} }
  const anim = { col: 0, row: 1, frames: 3, frameMs: 120, layout: 'row', mirror: false }
  assert.deepEqual(frameRect(sheet, anim, 0), { sx: 0, sy: 36, sw: 18, sh: 36 })
  assert.deepEqual(frameRect(sheet, anim, 2), { sx: 36, sy: 36, sw: 18, sh: 36 }, 'row 布局：帧沿 col 走')
  // 真机图是 126×144：7 列 × 4 条带，正好装得下
  assert.ok(frameRect(sheet, anim, 6).sx + 18 <= 126)
  assert.ok(frameRect(sheet, { ...anim, row: 3 }, 0).sy + 36 <= 144)
})

test('切图：column 布局沿带号走；帧号越界夹住（不画出图外）', () => {
  const sheet = { cellW: 16, cellH: 16, rowsPerFigure: 1, anchor: 'center', animations: {} }
  const anim = { col: 2, row: 0, frames: 3, frameMs: 100, layout: 'column', mirror: false }
  assert.deepEqual(frameRect(sheet, anim, 0), { sx: 32, sy: 0, sw: 16, sh: 16 })
  assert.deepEqual(frameRect(sheet, anim, 2), { sx: 32, sy: 32, sw: 16, sh: 16 })
  assert.deepEqual(frameRect(sheet, anim, 99), { sx: 32, sy: 32, sw: 16, sh: 16 }, '越界夹到最后一帧')
  assert.deepEqual(frameRect(sheet, anim, -3), { sx: 32, sy: 0, sw: 16, sh: 16 }, '负数夹到第一帧')
})

test('整数缩放：只给整数、至少 1、有上限（小数会让像素大小不一）', () => {
  // 真机的数：世界 16×16 格 × 16px = 256px，舞台约 740×650，留 6% 边 → 2 倍
  assert.equal(integerZoom({ viewWidth: 740, viewHeight: 650, worldPixelsW: 256, worldPixelsH: 256, fit: 1.06 }), 2)
  assert.equal(integerZoom({ viewWidth: 256, viewHeight: 256, worldPixelsW: 256, worldPixelsH: 256 }), 1)
  assert.equal(integerZoom({ viewWidth: 100, viewHeight: 100, worldPixelsW: 256, worldPixelsH: 256 }), 1, '再小也不为 0')
  assert.equal(integerZoom({ viewWidth: 1920, viewHeight: 1080, worldPixelsW: 256, worldPixelsH: 256 }), 4)
  assert.equal(integerZoom({ viewWidth: 99999, viewHeight: 99999, worldPixelsW: 16, worldPixelsH: 16, maxZoom: 6 }), 6, '封顶')
  for (const zoom of [0.5, 1.5, 2.9]) {
    assert.equal(Number.isInteger(integerZoom({ viewWidth: 256 * zoom, viewHeight: 256 * zoom, worldPixelsW: 256, worldPixelsH: 256 })), true)
  }
})

test('精灵盒：`bottom` 贴地、`center` 居中（人 vs 地砖的区别）', () => {
  const frame = { sx: 0, sy: 0, sw: 18, sh: 36 }
  const bottom = spriteBox({ anchor: 'bottom' }, frame, { cx: 100, groundY: 200, scale: 2 })
  assert.deepEqual(bottom, { x: 100 - 18, y: 200 - 72, w: 36, h: 72 }, '底边中点贴 (cx, groundY)')
  const center = spriteBox({ anchor: 'center' }, frame, { cx: 100, groundY: 200, scale: 2 })
  assert.deepEqual(center, { x: 100 - 18, y: 200 - 36, w: 36, h: 72 }, '图心对准格心')
  // 锚点缺省按 bottom（人物/家具是多数）
  assert.deepEqual(spriteBox({}, frame, { cx: 0, groundY: 100, scale: 1 }), { x: -9, y: 64, w: 18, h: 36 })
})

test('撞色兜底：variant 0 完全不动原配色，正数才错开色相（稳定、可区分）', () => {
  const base = '#38BDF8'
  const plain = recolorPlan(NUDE_PALETTE, base)
  assert.deepEqual(recolorPlan(NUDE_PALETTE, base, { variant: 0 }), plain, '第 1 个用这个色的角色必须拿到原色')
  const second = recolorPlan(NUDE_PALETTE, base, { variant: 1 })
  const third = recolorPlan(NUDE_PALETTE, base, { variant: 2 })
  assert.notDeepEqual(second, plain, '第 2 个要能和第 1 个区分')
  assert.notDeepEqual(third, second, '第 3 个又要和第 2 个不同')
  assert.deepEqual(recolorPlan(NUDE_PALETTE, base, { variant: 1 }), second, '确定性')
  // 错开的是色相，不是明暗：三级阶梯仍然单调
  const levels = lightnessLadder(base, { variant: 1 }).map((hex) => hexToHsl(hex).l)
  assert.ok(levels[0] > levels[1] && levels[1] > levels[2])
  // 错开的幅度就是常量（+14°）
  const h0 = hexToHsl(lightnessLadder(base)[0]).h
  const h1 = hexToHsl(lightnessLadder(base, { variant: 1 })[0]).h
  const diff = ((h1 - h0) % 360 + 360) % 360
  assert.ok(Math.abs(diff - VARIANT_HUE_STEP) < 2, `色相差 ${diff} 度，期望约 ${VARIANT_HUE_STEP}`)
  // 细节色在任何 variant 下都不动
  assert.equal(second['#3a2a31'], '#3a2a31')
})

test('撞色分配：同一配色按 id 依次拿 0/1/2…，不同配色各自从 0 开始（画布与花名册共用）', () => {
  const actors = [
    { id: 'agent-3', color: '#38BDF8' },
    { id: 'agent-2', color: '#38BDF8' },
    { id: 'agent-4', color: '#38BDF8' },
    { id: 'agent-5', color: '#C084FC' },
    { id: 'agent-1', color: '#FBBF24' },
  ]
  const variants = assignColorVariants(actors)
  assert.equal(variants.get('agent-2'), 0, '按 id 排序的第一个工程师拿 0（保持原色）')
  assert.equal(variants.get('agent-3'), 1)
  assert.equal(variants.get('agent-4'), 2)
  assert.equal(variants.get('agent-5'), 0, '另一个配色重新从 0 开始')
  assert.equal(variants.get('agent-1'), 0)
  // 输入顺序不影响结果（稳定）
  assert.deepEqual([...assignColorVariants([...actors].reverse()).entries()].sort(), [...variants.entries()].sort())
  assert.equal(assignColorVariants([]).size, 0)
  assert.equal(assignColorVariants(null).size, 0)
})

test('变体色：variant 0 原样、正数错开且互相不同（HTML 色点与画布同色相）', () => {
  assert.equal(variantColor('#38BDF8', 0), '#38bdf8', '第 1 个必须是内容给的原色')
  assert.equal(variantColor('#38BDF8'), '#38bdf8')
  const v1 = variantColor('#38BDF8', 1)
  const v2 = variantColor('#38BDF8', 2)
  assert.notEqual(v1, '#38bdf8')
  assert.notEqual(v1, v2)
  assert.equal(variantColor('#38BDF8', 1), v1, '确定性')
  assert.equal(variantColor('不是颜色', 2), '不是颜色', '认不出就原样返回')
  // 与画布上的阶梯中间调一致
  assert.equal(v1, lightnessLadder('#38BDF8', { variant: 1 })[1])
})
