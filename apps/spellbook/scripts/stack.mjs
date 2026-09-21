// 把多张 PNG 纵向堆叠成一张对照图，每张之间留一道底色缝并可选加一条分隔线。
import { readFileSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng } from './png.mjs'
const [out, gapStr, ...files] = process.argv.slice(2)
const gap = Number(gapStr)
const imgs = files.map((f) => ({ f, img: decodePng(readFileSync(f)) }))
const W = Math.max(...imgs.map((i) => i.img.width))
const H = imgs.reduce((a, i) => a + i.img.height, 0) + gap * (imgs.length - 1)
const px = Buffer.alloc(W * H * 4, 0)
for (let i = 0; i < W * H; i++) { px[i*4] = 11; px[i*4+1] = 9; px[i*4+2] = 16; px[i*4+3] = 255 }
let dy = 0
for (const { img } of imgs) {
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const s = (y * img.width + x) * img.channels
    const d = ((dy + y) * W + x) * 4
    const a = img.channels === 4 ? img.pixels[s+3] / 255 : 1
    px[d] = Math.round(img.pixels[s] * a + px[d] * (1 - a))
    px[d+1] = Math.round(img.pixels[s+1] * a + px[d+1] * (1 - a))
    px[d+2] = Math.round(img.pixels[s+2] * a + px[d+2] * (1 - a))
    px[d+3] = 255
  }
  dy += img.height + gap
}
writeFileSync(out, encodePng({ width: W, height: H, channels: 4, pixels: px }))
console.log(`写出 ${out}　${W}×${H}`)
