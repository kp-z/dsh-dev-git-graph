---
title: 像素放不糊
slug: pixelated-magnify
category: 图形
tags: [image-rendering, 像素, 图片]
since: 2026-10
source: 机制来自 CSS Images 的 image-rendering: pixelated，自行实现
when: 小尺寸像素画要放大展示，默认的平滑插值会把它糊成一团
stage: grid
tier: core
params:
  - { name: zoom, label: 放大倍数, type: range, min: 4, max: 20, step: 1, default: 14 }
---

## 描述

一颗 16×16 的像素红心被放大成一面方块阵：每个源像素铺成一个边缘锐利的色块，高光和暗部都各自成块，没有任何过渡色。

机制是 ==image-rendering: pixelated 让放大时的重采样改成最近邻，一个源像素铺成一个方块==。位图放大时默认要做重采样，双线性或双三次插值会拿相邻像素算出中间色——在照片上那是「平滑」，在像素画上就是把作者一个个摆好的色块边界抹成一条渐变的糊边。最近邻不给中间色：目标像素直接抄离它最近的那个源像素，于是「放大」真的只是把格子做大，形状信息一点没动。像素画和照片在这一点上的诉求正好相反，所以这不是「清晰与模糊」之争，而是两种正确。

倍数在示例里做成了按整数步进的滑杆，因为整数倍是干净方块的前提（不是优化项）。另一个可选项是 `crisp-edges`：它同样要求引擎不要平滑，但具体用什么算法交给引擎自己决定，可能带一点锐化；`pixelated` 明确就是最近邻。还有一处选择是「放大的是什么」——canvas、`<img>`、背景图、视频帧都按同一条属性决定采样，而背景图要把属性写在承载它的那个元素上，不是写在伪元素或者某个祖先上。

## 代码

```html
<div class="px">
  <canvas class="px-art" width="16" height="16"></canvas>
  <p class="px-note">源图 16×16，放大后仍是方块</p>
</div>
```

```css
.px {
  display: grid;
  justify-items: center;
  gap: 12px;
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1b1710;
}

.px-art {
  /* @mechanism 放大时按最近邻取样，一个源像素铺成一个方块 */
  image-rendering: pixelated;
  /* @mechanism 整数倍的尺寸，方块才会一样宽 */
  width: calc(16px * var(--zoom, 14));
  height: calc(16px * var(--zoom, 14));
  border-radius: 4px;
  box-shadow: 0 12px 28px rgb(60 48 30 / 0.28);
}

.px-note {
  margin: 0;
  opacity: 0.7;
}
```

```js
const art = [
  '................',
  '...RR......RR...',
  '..R.WR....RW.R..',
  '.R....RRRR....R.',
  '.R..RRRRRRRR..R.',
  '.RRRRRRRRRRRRRR.',
  '.RRRRRRRRRRRRRR.',
  '..RRRRRRRRRRRR..',
  '...RRRRRRRRRR...',
  '....RRRRRRRR....',
  '.....RRRRRR.....',
  '......RRRR......',
  '.......RR.......',
  '................',
  '................',
  '................',
]
const ink = { R: '#d9483b', W: '#f4a08d' }
const ctx = stage.querySelector('.px-art').getContext('2d')

art.forEach((row, y) => {
  // @mechanism 每个字符就是一个源像素，画完不必管它会被放大多少倍
  ;[...row].forEach((ch, x) => {
    if (!ink[ch]) return
    ctx.fillStyle = ink[ch]
    ctx.fillRect(x, y, 1, 1)
  })
})
```

## 边界

- 只对位图有意义。SVG、文字、渐变都是按当前尺寸重绘的矢量或程序化内容，没有「源像素」可采样，写上去什么也不会发生。
- 非整数倍放大时最近邻会让一些方块占 2 个像素、另一些占 3 个，出现宽度不均的条纹，比插值更难看。倍数取整是使用前提。
- 缩小方向别用它：目标比源还小时最近邻直接丢像素，细节会闪烁、出摩尔纹；那种场合该让引擎做平均化的插值。
- 它不创造细节。源图是 16×16 就只有 256 个色块，放大到 320px 之后每块都成了大色块，不会变清楚。
- 高 DPI 屏上 1 个 CSS 像素对应多个物理像素，「整数倍」要按物理像素算才干净，或者干脆用 `image-set()` 备两套源图。
- 与 `srcset` / `image-set()` 一起用时，浏览器可能自己挑一张更高分辨率的源图，实际放大倍数随之变小——同一段 CSS 在不同设备上的锐利程度取决于它挑中了哪一张。
