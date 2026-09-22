---
title: 双色调
slug: duotone-blend
category: 图形
tags: [blend-mode, filter, 色彩, 图片]
since: 2026-09
source: 机制来自 CSS mix-blend-mode 与灰度滤镜的组合，自行实现
when: 一张彩色图片要压成只有两个颜色的风格化版本
stage: photo
tier: core
params:
  - { name: hi, label: 亮部色相, type: range, min: 0, max: 360, step: 15, default: 30, unit: deg }
---

## 描述

一张渐变图被压成了两种颜色：暗部是深紫，亮部是暖金，中间没有别的色。

机制是 ==先去掉颜色只留明暗，再用混合模式把亮部「染」上目标色==。底层放亮部色，上层放灰度图并设 `mix-blend-mode: multiply`——乘法会让暗处更暗、亮处保留底色，于是灰度信息变成了「取多少底色」的权重。

图片的信息没有消失，只是从**颜色**被搬到了**明暗**上。

## 代码

```html
<div class="dt">
  <div class="dt-ink"></div>
  <div class="dt-img"></div>
</div>
```

```css
.dt {
  position: relative;
  width: min(320px, 80vw);
  height: 190px;
  overflow: hidden;
  background: #2a1740;
}

/* 底层：亮部要染成的颜色 */
.dt-ink {
  position: absolute;
  inset: 0;
  background: hsl(var(--hi, 30deg) 78% 62%);
}

/* 上层：灰度图用 multiply 染色 */
.dt-img {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #ffffff 0%, #8a8a8a 42%, #101010 100%);
  filter: grayscale(1) contrast(1.25);
  /* @mechanism multiply 让灰度成为「取多少底色」的权重 */
  mix-blend-mode: multiply;
}
```

## 边界

- 它需要**两层配合**（底色的层 + 灰度层）。单层做不到双色调，这是最常见的误解。
- `mix-blend-mode` 混合的是**元素之间**，`background-blend-mode` 混合的是**同一元素的背景层之间**。用错位置就完全没有效果，而且不报错。
- 混合会在最近的**层叠上下文**内发生。祖先带上 `transform`、`opacity`、`filter` 时会创建新的上下文，混合范围随之缩小——现象是「在某个容器里就变了样」。
- `multiply` 适合「暗底亮部」；反过来（亮底暗部）要用 `screen` 或 `lighten`。选错会把图片压成一片黑或一片白。
- 它会丢掉原图的大部分颜色信息。压在双色调图上的文字必须有足够对比度，不能指望图片「反正比较暗」。
- 灰度化用 `filter: grayscale(1)` 与「底层放灰」是两条不同的路：前者改的是元素自身的像素，后者靠混合。混用时要想清楚谁在起作用。

## 备注

- 把底层换成一个渐变（而不是纯色），就得到「双色调还带方向」的版本——机制不变，只是权重之外又多了一个变量。
- 同一招可以用在文字上：灰底文字配彩色底层，得到双色标题。
