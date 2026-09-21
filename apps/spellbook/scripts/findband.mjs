// 在一张大截图里滑动找一条「用户给的窄带」出现在哪个 y。
// 逐像素算平均绝对差，取最像的那个位置。全本地，不依赖视觉服务。
import { readFileSync } from 'node:fs'
import { decodePng } from './png.mjs'
const [page, band, x0Str, stepStr] = process.argv.slice(2)
const P = decodePng(readFileSync(page))
const B = decodePng(readFileSync(band))
const x0 = Number(x0Str), step = Number(stepStr || 8)
const at = (img, x, y, c) => { const i = (y * img.width + x) * img.channels; return [img.pixels[i], img.pixels[i+1], img.pixels[i+2]] }
let best = { diff: Infinity, y: -1 }
for (let y = 0; y + B.height <= P.height; y += step) {
  let sum = 0, n = 0
  for (let by = 0; by < B.height; by += 6) {
    for (let bx = 0; bx < B.width; bx += 6) {
      const a = at(P, x0 + bx, y + by, P.channels), b = at(B, bx, by, B.channels)
      sum += Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]); n += 3
    }
  }
  const diff = sum / n
  if (diff < best.diff) best = { diff, y }
}
console.log(JSON.stringify({ pageWidth: P.width, pageHeight: P.height, band: [B.width, B.height], x0, bestDiff: Number(best.diff.toFixed(2)), bestY: best.y }))
