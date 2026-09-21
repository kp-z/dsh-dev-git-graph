// 把一张截图里某条带上的「金 / 非金」按原始像素逐点打出来。
// ASCII 亮度图在每个字符吃掉 2 个设备像素之后就看不出金饰内部是实心还是空心了，所以需要这个。
import { readFileSync } from 'node:fs'
import { decodePng } from './png.mjs'
const [file, sx, sy, w, h, step] = process.argv.slice(2)
const img = decodePng(readFileSync(file))
const ch = img.channels
const at = (x,y) => { const i=(y*img.width+x)*ch; return [img.pixels[i],img.pixels[i+1],img.pixels[i+2]] }
console.log(`图 ${img.width}×${img.height} 通道 ${ch}　扫描区 ${sx},${sy} ${w}×${h}`)
for (let y = 0; y < Number(h); y += Number(step || 3)){
  let line = ''
  for (let x = 0; x < Number(w); x++){
    const [r,g,b] = at(Number(sx)+x, Number(sy)+y)
    line += (r > 90 && r > b + 25 && g > b) ? '#' : '.'
  }
  console.log(String(y).padStart(3) + ' ' + line)
}
