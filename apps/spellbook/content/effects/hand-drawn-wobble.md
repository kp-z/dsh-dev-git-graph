---
title: 手绘抖线
slug: hand-drawn-wobble
category: 图形
tags: [手绘, 滤镜, 位移]
since: 2026-09
source: 机制来自 SVG feDisplacementMap，自行实现
when: 规整的边框和图形想变成手绘的，但不想重画路径
stage: plain
tier: candidate
---

## 描述

方框的边不再笔直，圆的轮廓不太圆，看起来是徒手画的。

机制是 ==feDisplacementMap 用一张噪声图去「挪」源图形的每个像素==。噪声的数值决定这一点往哪挪、挪多远，于是直线弯了、圆鼓了、边框抖了。用的是 `fractalNoise`（分形噪声），所以抖动本身粗细有层次，不像随机像素那么刺。

这是给**任意元素**加手绘感的最短路径：不用手绘 SVG 路径，也不用准备三套边框图片。

## 代码

```html
<svg width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-wobble">
    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="noise" />
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>

<div class="hw">
  <b>手绘方框</b>
  <p>它其实还是矩形，只是像素被挪了。</p>
</div>
```

```css
.hw {
  width: min(330px, 78vw);
  padding: 24px 26px;
  border: 3px solid #b4462f;
  background: rgb(255 255 255 / 0.42);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
  /* @mechanism 噪声把像素挪开，直线因此变弯 */
  filter: url(#sb-wobble);
}

.hw b {
  display: block;
  margin-bottom: 6px;
  font-size: 19px;
  font-weight: 700;
}

.hw p {
  margin: 0;
  opacity: 0.7;
}
```

## 边界

- `scale` 是抖动幅度。2–6 之间才是「手绘」，超过 10 形状会散架，边框会断成几截。
- `baseFrequency` 决定抖动的**波长**：小值给长波（像徒手画的慢弯），大值给细毛边（像炭笔）。两个参数要配合着调，只调 `scale` 出不来笔感。
- 位移作用在**整个元素**上，包括里面的文字。文字上只能用很小的值，否则笔画会粘连在一起糊掉。
- SVG 滤镜会创建新的合成层，在部分引擎上还会把结果栅格化——放大后能看到像素感，且大面积实时动画会明显掉帧。
- 不同引擎的滤镜插值实现不同，输出**不会逐像素一致**。跨浏览器一样好看，但不可能一模一样。
- `filter` 会创建包含块，里面的 `position: fixed` 子元素会失效——滤镜的经典副作用。
- **抖动幅度做不成 CSS 变量。**`scale` 是 SVG 滤镜属性，不是 CSS 属性；定义在外面的 `<filter>` 也收不到使用元素的 CSS 变量。所以这一条没有滑杆——摆一个拖了不动的滑杆比没有更糟。要让它可调只能复制出几份不同参数的滤镜，按类名切换。

## 备注

- `seed` 换个数字就是另一种手感，做多个「手绘」元素时给不同的种子，免得抖得一模一样。
- 同一招也能用在图片上做「水彩边」：加大 `scale` 并配一个较大的 `baseFrequency`。
- 和「滤镜噪点质感」是同一个根因：但凡是 SVG 滤镜里的参数，CSS 变量都够不到。
