---
title: 色散边缘
slug: chromatic-edge
category: 材质
tags: [色差, 描边, 混合模式]
since: 2026-10
source: 机制来自 CSS Compositing 规范的 screen 叠加与通道错位，自行实现
when: 玻璃的切边要有一道彩边，像真镜头那样把红绿蓝分开了
stage: dark
tier: core
params:
  - { name: split, label: 错位量, type: range, min: 0, max: 6, step: 0.2, default: 1.6, unit: px }
---

## 描述

一块玻璃板的边缘不是一条白线，而是一道从暖红过渡到冷蓝的窄彩边——就像隔着一段厚玻璃看轮廓，红绿蓝没对齐。中间的玻璃面倒是干干净净。

机制是 ==把同一条 1px 描边复制三份、各留一个颜色通道、错开一点点，再用 screen 叠回去==。色差的成因就是三个通道没有对齐；这里不去分离底图的通道（CSS 做不到），而是让**描边本身**分三次画，红的一份往左偏、蓝的一份往右偏、绿的一份不动。因为参与的只有那 1px 宽的边，面积极小，色偏不会漫到玻璃中间去。

描边必须用 `inset` 的 `box-shadow` 而不是 `border`：`border` 会把元素撑大，三层错位后就对不上同一个外框了。`border-radius: inherit` 也要显式写上，否则三层圆角各画各的。

## 代码

```html
<!-- @mechanism 三条同形状的描边各自只取一个通道，错位后 screen 叠回去 -->
<div class="chroma-pane">
  <span class="chroma-line chroma-r"></span>
  <span class="chroma-line chroma-g"></span>
  <span class="chroma-line chroma-b"></span>
  <p class="chroma-label">色散边缘</p>
</div>
```

```css
.chroma-pane {
  position: relative;
  width: min(320px, 80vw);
  height: 170px;
  border-radius: 18px;
  backdrop-filter: blur(7px) saturate(1.15);
  background: rgb(255 255 255 / 0.05);
}

.chroma-line {
  position: absolute;
  inset: 0;
  /* @mechanism 只画 1px 的描边，色差才停在边上，不会漫进玻璃中间 */
  box-shadow: inset 0 0 0 1px var(--ink);
  border-radius: inherit;
  mix-blend-mode: screen;
  translate: var(--shift, 0) var(--shift-y, 0);
}

.chroma-r {
  --ink: rgb(255 64 64 / 0.75);
  --shift: calc(var(--split, 1.6px) * -1);
}

.chroma-g {
  --ink: rgb(64 255 128 / 0.45);
}

.chroma-b {
  --ink: rgb(72 118 255 / 0.75);
  --shift: var(--split, 1.6px);
  --shift-y: calc(var(--split, 1.6px) * 0.5);
}

.chroma-label {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 1;
  margin: 0;
  font: 500 16px/1 system-ui, sans-serif;
  letter-spacing: 0.16em;
  color: #eaf0ff;
}
```

```js
// @mechanism 错位量写进 CSS 变量：脚本只管数值，三层描边共用同一个旋钮
const pane = document.querySelector('.chroma-pane')
if (pane) {
  const ease = (value) => pane.style.setProperty('--split', value.toFixed(2) + 'px')
  pane.addEventListener('pointerenter', () => ease(4.4))
  pane.addEventListener('pointerleave', () => ease(1.6))
}
```

## 边界

- 三层 `screen` 叠起来得到的不是「白 + 彩边」，而是比单描边更亮的一条线。要压回原来的亮度，得把每个通道的 alpha 降到 0.6 一带。
- 通道之间的错位一旦超过几个像素，彩边就从「玻璃切边」变成了「没对齐的印刷」，观感完全不同。
- 用 `border` 代替 `inset box-shadow` 会让三层各撑开 1px，位置对不上，彩边会歪掉。
- 圆角处是这套最弱的地方：三层圆角的错位在弧线上会被放大，四角容易出现一小段断开的彩边。
- 绿色那层不偏移，是为了让叠加后的中心还保持偏白。三层都偏，整条边会变成一根彩虹而不是切边。

## 备注

- 同一招用在文字上：三层 `text-shadow` 各取一个通道错位，就是老电视的彩边，比 `filter: drop-shadow` 可控得多。
- 想更像真镜头，就让红色层带一点模糊（`filter: blur(0.4px)`）——长波长的色差本来就更容易散开。
