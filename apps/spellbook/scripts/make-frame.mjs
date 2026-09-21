/**
 * 生成「双细线」画框素材 —— src/frames/rule-frame.png
 *
 * 为什么是双细线：试过的花框（Lustro 002、Ostell 1848、若干 Openclipart 线描框）
 * 在 13px 的缩略图框上，花纹细过一个像素就糊成一排锯齿；把边框加宽到能看清花纹时，
 * 花框又压过了内容。古书里的整版插图本来也大多只用**双细线**锁边——朴素、像印上去的，
 * 而且没有任何会随缩放坏掉的细节。
 *
 * 几何：素材 96×96，切片 32（=3 倍），所以九宫格九块都是 32×32，中间那块不会被绘制。
 * 每一点的「深度」取到最近边的距离，两条线分别落在深度 0–4 与 8–12。
 * 于是无论边框画多宽（缩略图 13px、图版 30px），线宽与线距都是边框宽度的固定比例，
 * 缩放时只会变粗变细，不会糊成一团。
 *
 * 用法：node scripts/make-frame.mjs
 */
import { writeFileSync } from 'node:fs'
import { encodePng } from './png.mjs'

const C = 32            // 切片宽度，必须与 CSS 里 border-image 的 slice 一致
const SIZE = C * 3      // 96：让九宫格的九块都是 C×C
const SS = 4            // 超采样倍数，用来把斜接处的毛边磨平

// 两条线：外侧一道略暗、内侧一道略亮，读起来有「压印」的层次，而不是一块死金
const LINE_A = [168, 136, 74]   // 外线  #a88848
const LINE_B = [196, 166, 104]  // 内线，稍亮
const GAP = [10, 8, 14]         // 线缝处压一点底色，避免两条线糊成一条

/** 深度 d（离最近边的像素距离）处该上什么色 */
function colorAt(d) {
  if (d < 4) return LINE_A
  if (d < 8) return GAP
  if (d < 12) return LINE_B
  return null
}

function render() {
  const px = Buffer.alloc(SIZE * SIZE * 4, 0)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS
          const fy = y + (sy + 0.5) / SS
          // 到最近边的距离。九宫格每一块只读自己那个轴，所以这个公式对九块都成立。
          const d = Math.min(fx, fy, SIZE - fx, SIZE - fy)
          const c = colorAt(d)
          if (!c) continue
          r += c[0]; g += c[1]; b += c[2]; a += 255
        }
      }
      const n = SS * SS
      const i = (y * SIZE + x) * 4
      if (a > 0) {
        const cov = a / 255
        px[i] = Math.round(r / cov); px[i + 1] = Math.round(g / cov); px[i + 2] = Math.round(b / cov)
        px[i + 3] = Math.round(a / n)
      }
    }
  }
  return px
}

const out = 'src/frames/rule-frame.png'
writeFileSync(out, encodePng({ width: SIZE, height: SIZE, channels: 4, pixels: render() }))
console.log(`写出 ${out}　${SIZE}×${SIZE}　切片 ${C}`)
