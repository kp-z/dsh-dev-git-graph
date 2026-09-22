---
title: 环形进度靠描边偏移
slug: progress-ring-dashoffset
category: 图形
tags: [svg, stroke, custom-property, 进度]
since: 2026-10
source: 机制来自 SVG 的 stroke-dasharray / stroke-dashoffset，自行实现
when: 需要一个能精确停在任意百分比、且端口是圆头的环形进度
stage: dark
tier: core
---

## 描述

一个圆环，已走过的部分用颜色画出来，末端是一个圆头，停在 0% 到 100% 之间的任意位置。

机制是 ==用「虚线的一段」当可见弧，靠偏移把它推到起点==。给圆的 `stroke-dasharray` 设成「周长 周长」，虚线的实线段就恰好绕满一圈；再把 `stroke-dashoffset` 设成 `周长 × (1 - 进度)`，实线段就被推走了一部分，剩下的正好是进度对应的弧长。可见的弧不是「画出来的长度」，而是「被推到视野外之后剩下的长度」——这也是它比 `conic-gradient` 更好的地方：`conic-gradient` 的端头只能是平的，而描边可以是 `round`。

周长不必手算。用 `r: 1` 配 `viewBox="0 0 44 44"` 会把半径固定在 22，但更省事的做法是保留 `r="15.9155"`（周长正好 100），于是 `dasharray` 与 `dashoffset` 可以直接写百分数，不必和 `2πr` 纠缠。

## 代码

```html
<svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
  <circle class="ring-track" cx="18" cy="18" r="15.9155"/>
  <circle class="ring-fill" cx="18" cy="18" r="15.9155" style="--p: 68"/>
</svg>
```

```css
.ring {
  width: 84px;
  height: 84px;
  /* @mechanism 从 12 点方向开始画，否则默认从 3 点方向起，进度条会歪 90 度 */
  rotate: -90deg;
}

.ring circle {
  fill: none;
  stroke-width: 3;
}

.ring-track {
  stroke: #2b2434;
}

.ring-fill {
  stroke: #d9a441;
  stroke-linecap: round;
  /* @mechanism r=15.9155 让周长正好是 100，于是这里可以直接写百分数 */
  stroke-dasharray: 100;
  stroke-dashoffset: calc(100 - var(--p));
  transition: stroke-dashoffset 0.4s ease;
}
```

## 边界

- 忘了 `rotate: -90deg` 时，进度从 3 点方向开始顺时针走，而不是从 12 点方向。看上去只是「起点位置不对」，很容易被当成设计选择而不是 bug。
- `stroke-dashoffset` 用负值或超过周长的值都不会报错，只会让弧出现在意料之外的位置。写之前先夹到 `0..100`。
- `r="15.9155"` 这个数字是 `100 / (2π)` 的近似。取整成 `15.9` 时周长是 99.9，走满一圈会差一点点（约 0.4°），平时看不出来，做「恰好闭合」的动效时会露出一个缝。
- 圆头 `stroke-linecap: round` 会让弧**两端**都超出实际长度约半个描边宽度。进度接近 0 时，一个 0% 的环上仍然看得见一个圆点——这是圆头本身有面积，不是 bug，但需要知道它在那儿。
- 描边宽度是沿半径**居中**分布的。`stroke-width: 3` 在 `r=15.9155`、`viewBox` 36 的坐标系里占 3 个单位，容器缩到 40px 时它只剩约 1.7px，细得几乎看不见。
