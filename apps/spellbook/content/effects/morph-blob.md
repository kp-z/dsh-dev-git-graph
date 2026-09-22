---
title: 有机形状变形
slug: morph-blob
category: 图形
tags: [border-radius, keyframes, 有机, 容器]
since: 2026-09
source: 机制来自 CSS border-radius 的斜杠语法，自行实现
when: 色块要像一团会呼吸的墨，而不是圆角矩形
stage: photo
tier: core
params:
  - { name: dur, label: 变形周期, type: range, min: 3, max: 20, step: 1, default: 9, unit: s }
---

## 描述

一团色块慢慢变形，边在鼓、角在收，始终没有直角。

机制是 ==border-radius 的斜杠语法给每个角两个半径==：斜杠前是横向半径、斜杠后是纵向半径，四个角各一对。四对角的值互不相同时，边缘就被拉成了有机曲线；一变形，整块颜色像有生命。

如果四个角用同一个值，它就是圆角矩形——**「互不相同」才是这个效果的全部**。

## 代码

```html
<div class="mb"></div>
```

```css
.mb {
  width: min(220px, 60vw);
  height: min(220px, 60vw);
  background: linear-gradient(140deg, #ff9a5a, #f43f5e 58%, #7c5cff);
  /* @mechanism 四个角各一对横纵半径，互不相同才有有机曲线 */
  border-radius: 62% 38% 46% 54% / 55% 42% 58% 45%;
  animation: mb-morph var(--dur, 9s) ease-in-out infinite;
}

@keyframes mb-morph {
  0%,
  100% {
    border-radius: 62% 38% 46% 54% / 55% 42% 58% 45%;
  }
  50% {
    border-radius: 38% 62% 58% 42% / 42% 58% 45% 55%;
  }
}
```

## 边界

- 四个角用同一个值是**圆角矩形**，不是有机形状。想让它像墨点，每个角的横纵半径必须互不相同。
- 两个关键帧里的半径**顺序要对齐**（都是 左上、右上、右下、左下）。顺序错位时看到的是形状在乱扭，而不是在呼吸。
- `border-radius` 的动画是逐值插值的，每帧都要重绘，代价高于 `transform`。大元素上会明显掉帧。
- 它**不影响布局**：子元素仍然按原来的矩形排布，即使视觉上形状已经变了。文字放进 blob 会溢出边角，那需要另想办法。
- 相邻角的半径之和超过边长时，浏览器会自动按比例缩小它们。设的值太大会得到一个和预期不同的形状。
- 想要更自由的曲线（比如带凹口），`border-radius` 就无能为力了——那要 `clip-path: path()` 或 SVG。

## 备注

- 把两个关键帧写成「对角互换」的形态，变形过程会更像自然的呼吸，而不是来回摆。
- 同一招配 `blur()` 能得到柔和的色雾，配 `filter: contrast()` 则会让边缘变硬。
