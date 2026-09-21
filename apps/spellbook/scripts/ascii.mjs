/**
 * 把 PNG（截图）转成终端字符画。
 *
 * 视觉工具被限流时，这是唯一能「看见」渲染结果的办法：
 * 自己解 PNG、降采样、按亮度打字符。
 *
 *   node scripts/ascii.mjs <图.png> [x1,y1,x2,y2] [列数] [行数]
 *
 * 字符按亮度从暗到亮： . : - = + * # %
 * 另外还会打一张「颜色分类图」，用字母标出画面里是什么：
 *   K 暗底  G 金  P 纸/浅  R 朱红  B 蓝  M 品红  O 橙  T 青  W 白
 */

import { readFileSync } from 'node:fs'
import { decodePng } from './png.mjs'

const RAMP = ' .:-=+*#%@'

function classify(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const sat = max === 0 ? 0 : (max - min) / max
  if (sat < 0.14) return l < 0.22 ? 'K' : l < 0.62 ? '-' : 'W'
  // 有彩色，按色相分
  let h = 0
  const d = max - min
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = ((h * 60) + 360) % 360
  if (h < 40 || h >= 330) return l < 0.35 ? 'R' : 'O'
  if (h < 70) return 'G'
  if (h < 165) return '-'
  if (h < 200) return 'T'
  if (h < 265) return 'B'
  return 'M'
}

const [file, region, colsArg, rowsArg] = process.argv.slice(2)
if (!file) {
  console.error('用法: node scripts/ascii.mjs <图.png> [x1,y1,x2,y2] [列数] [行数]')
  process.exit(2)
}

const img = decodePng(readFileSync(file))
const { width, height, channels, pixels } = img
console.log(`${file}  ${width}x${height}  ${channels} 通道`)

let [x1, y1, x2, y2] = region
  ? region.split(',').map(Number)
  : [0, 0, width, height]
x1 = Math.max(0, Math.min(width - 1, x1))
y1 = Math.max(0, Math.min(height - 1, y1))
x2 = Math.max(x1 + 1, Math.min(width, x2))
y2 = Math.max(y1 + 1, Math.min(height, y2))

const cols = Number(colsArg) || 76
const rows = Number(rowsArg) || Math.max(6, Math.round((cols * (y2 - y1)) / (x2 - x1) / 2.1))

function cell(gx, gy) {
  const sx = x1 + Math.floor(((x2 - x1) * gx) / cols)
  const ex = Math.max(sx + 1, x1 + Math.floor(((x2 - x1) * (gx + 1)) / cols))
  const sy = y1 + Math.floor(((y2 - y1) * gy) / rows)
  const ey = Math.max(sy + 1, y1 + Math.floor(((y2 - y1) * (gy + 1)) / rows))
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) {
      const i = (y * width + x) * channels
      r += pixels[i]
      g += pixels[i + 1]
      b += pixels[i + 2]
      n++
    }
  }
  return [r / n, g / n, b / n]
}

const lumLines = []
const colorLines = []
for (let gy = 0; gy < rows; gy++) {
  let lLine = ''
  let cLine = ''
  for (let gx = 0; gx < cols; gx++) {
    const [r, g, b] = cell(gx, gy)
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    lLine += RAMP[Math.min(RAMP.length - 1, Math.round(l * (RAMP.length - 1)))]
    cLine += classify(r, g, b)
  }
  lumLines.push(lLine)
  colorLines.push(cLine)
}

console.log(`\n区域 (${x1},${y1})-(${x2},${y2})   ${cols}x${rows}\n`)
console.log('── 亮度 ──────────────────────────────────────────────────────────')
console.log(lumLines.join('\n'))
console.log('\n── 颜色分类（K暗 G金 P纸 R红 B蓝 M品 O橙 T青 W白）────────────────')
console.log(colorLines.join('\n'))
