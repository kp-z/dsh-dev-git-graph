---
title: 不用量周长的环形进度
slug: path-length-ring
category: 动效
tags: [环形进度, SVG, 描边]
since: 2026-10
source: 机制来自 SVG 2 规范的 pathLength 属性，自行实现
when: 要一个环形进度，但不想为了算周长去写 2πr，也不想每次改半径就重算样式
stage: plain
tier: core
---

## 描述

一圈描边从顶部顺时针长到某个百分比，改数字只改一个变量。

机制是 ==给路径写 pathLength="100"，把路径总长归一化成 100==。SVG 里描边的虚线本来要用「用户单位」表示长度，画一个半径 52 的圆就得先算出周长 326.7，改半径、换视口、复用到不同尺寸时都要重算。`pathLength` 不改变任何实际几何，它只是告诉渲染器「这条路径的长度请当 100 看」，于是 `stroke-dasharray: 100` 就是整整一圈，`stroke-dashoffset: 100 - p` 就正好是「留出 p% 的空」。**样式从此与几何解耦**：圆多大都不用动 CSS。

起点也要处理。SVG 的圆从 3 点方向开始画，直接上色会得到一条从右侧起的长弧，而进度环应该是从顶部顺时针。把描边元素整体转 `-90deg` 即可——注意旋转的原点必须用 `transform-box: fill-box` 落到路径自己的包围盒上，否则 `transform-origin: center` 参照的是整个 SVG 视口，视口带内边距或不是正方形时圆心就跑偏了。

## 代码

```html
<svg class="plr" viewBox="0 0 120 120" role="img" aria-label="已完成 68%">
  <circle class="plr-track" cx="60" cy="60" r="52" />
  <circle class="plr-bar" cx="60" cy="60" r="52" pathLength="100" />
  <text class="plr-num" x="60" y="66" text-anchor="middle">68%</text>
</svg>
```

```css
.plr {
  width: 150px;
  height: 150px;
  font: 600 22px/1 system-ui, sans-serif;
  fill: #2a2118;
}

.plr-track,
.plr-bar {
  fill: none;
  stroke-width: 9;
  /* @mechanism 旋转原点落在路径自己的包围盒上，才真的是绕圆心转 */
  transform-box: fill-box;
  transform-origin: center;
  /* @mechanism 圆默认从 3 点起画，转 -90deg 才是从顶部出发 */
  rotate: -90deg;
}

.plr-track {
  stroke: rgb(60 48 30 / 0.14);
}

.plr-bar {
  stroke: #b4462f;
  stroke-linecap: round;
  /* @mechanism pathLength="100" 已把周长归一化，这里的 100 就是一圈 */
  stroke-dasharray: 100;
  stroke-dashoffset: calc(100 - var(--p, 68));
  transition: stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}
```

```js
const svg = document.querySelector('.plr')
const bar = document.querySelector('.plr-bar')
const num = document.querySelector('.plr-num')

function setProgress(p) {
  // @mechanism 只写一个变量，dashoffset 的算术交给 CSS 的 calc
  bar.style.setProperty('--p', p)
  num.textContent = p + '%'
  svg.setAttribute('aria-label', '已完成 ' + p + '%')
}

setProgress(68)
// 进度在变时才有得看：每 1.8 秒换一个值，补间由 transition 完成
setInterval(() => setProgress(Math.floor(Math.random() * 101)), 1800)
```

## 边界

- 不写 `pathLength` 就得在 CSS 里硬写 `stroke-dasharray: 326.7`（2π×52）。改半径、改 `viewBox`、复用到别的尺寸都要重算，且算错时现象是「进度条首尾差一小段」。
- `stroke-linecap: round` 在进度接近 0 时会多画出一个圆头，0% 也能看见一小截。要么改 `butt`，要么在 0 时把这条描边藏起来。
- 旋转时忘了 `transform-box: fill-box`：在视口带 padding、或 `viewBox` 非正方形时圆心会偏，现象是「进度从一个奇怪的角度开始」。
- 过渡要挂在 `stroke-dashoffset` 上。它是标量，插值稳定；动画 `stroke-dasharray` 在部分引擎上是离散的，会一跳一跳。
- `pathLength` 是「归一化声明」，写错值不会报错，只会让百分比不再等于真实比例——它不校验。
- 无障碍：视觉进度必须同步到 `aria-valuenow` 或可见文本。只改 `--p` 的话读屏完全不知道进度变了。

## 备注

- 同一招对任何路径都成立（折线、图标轮廓、椭圆）：加 `pathLength="100"`，就能用百分比做「描边旅行」。
- 逆时针方向只要把 `rotate` 改成正值，其余不用动。
