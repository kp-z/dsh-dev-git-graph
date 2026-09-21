// 把两张图并排/上下拼成一张对照图。纯 Node，用仓库自带的 png 编解码。
import { readFileSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng } from './png.mjs'
const src = decodePng(readFileSync(process.argv[2]))
const crop = (r) => { const [x1,y1,x2,y2] = r.split(',').map(Number)
  return { w: x2-x1, h: y2-y1, x1, y1 } }
const specs = process.argv.slice(4)
const parts = specs.map((s) => { const [r, off] = s.split('@'); const [dx, dy] = off.split(',');
  return { ...crop(r), dx: Number(dx), dy: Number(dy) } })
const W = Math.max(...parts.map(p => p.dx + p.w)), H = Math.max(...parts.map(p => p.dy + p.h))
const px = Buffer.alloc(W*H*src.channels, 0)
for (let i = 0; i < W*H; i++) px[i*src.channels+3] = 255
for (const p of parts){
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++){
    const s = ((p.y1+y)*src.width + (p.x1+x))*src.channels
    const d = ((p.dy+y)*W + (p.dx+x))*src.channels
    for (let c = 0; c < src.channels; c++) px[d+c] = src.pixels[s+c]
  }
}
writeFileSync(process.argv[3], encodePng({ width: W, height: H, channels: src.channels, pixels: px }))
console.log(`写出 ${process.argv[3]} ${W}×${H}`)
