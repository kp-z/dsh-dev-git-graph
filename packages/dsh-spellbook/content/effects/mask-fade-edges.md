---
title: 遮罩渐隐边缘
slug: mask-fade-edges
category: 图形
tags: [mask, gradient, 渐隐, 卡片]
since: 2026-09
source: 机制来自 CSS Masking 的 mask-image，自行实现
when: 横向滚动的内容要在一侧淡出，暗示「还有更多」
stage: plain
tier: core
params:
  - { name: fade, label: 渐隐长度, type: range, min: 4, max: 30, step: 2, default: 14, unit: % }
---

## 描述

一排卡片在最右边渐渐淡去，而不是被硬生生切断。

机制是 ==mask-image 用一张渐变图控制每个像素的可见度==。和 `opacity` 的差别在于它是**逐像素**的：同一块内容可以左边实、右边虚，`opacity` 只能整体一起变。

那张渐变图就是「可见度曲线」，写多长就淡多长。

## 代码

```html
<div class="mf">
  <div class="mf-card">一</div>
  <div class="mf-card">二</div>
  <div class="mf-card">三</div>
  <div class="mf-card">四</div>
  <div class="mf-card">五</div>
</div>
```

```css
.mf {
  display: flex;
  gap: 12px;
  width: min(360px, 82vw);
  overflow-x: auto;
  /* @mechanism 渐变图就是可见度曲线，逐像素生效 */
  -webkit-mask-image: linear-gradient(
    to right,
    #000 0,
    #000 calc(100% - var(--fade, 14%)),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    #000 0,
    #000 calc(100% - var(--fade, 14%)),
    transparent 100%
  );
}

.mf-card {
  flex: 0 0 120px;
  display: grid;
  place-items: center;
  height: 130px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.5);
  font: 600 20px/1 system-ui, sans-serif;
  color: #1c1a17;
}
```

## 边界

- `mask-image` 要配 `-webkit-mask-image` 才能在部分旧版引擎生效。两套都写才安全。
- 遮罩的取值方式由 `mask-mode` 决定：默认 `match-source`——**图片用 alpha、SVG 的 `<mask>` 用亮度**。用反了会得到完全反相的遮罩。
- 它**不改变布局**：被遮掉的部分仍然占着位置、仍然参与滚动。所以「看不见但还能滑到」是正常的。
- 被遮掉的区域**仍然可以点击**（这是它和 `clip-path` 的一个实际差别）。要让不可见部分不可交互，得另外配 `pointer-events`。
- 遮罩会创建层叠上下文，子元素的 `position: fixed` 会被限制在这块区域内。
- 渐变的色标位置决定淡出的速度。把停靠点放得太靠后（比如 `95%`）会得到一个极窄的淡出区，看着像硬边。

## 备注

- 两侧都渐隐就把 `mask-image` 写成两头黑中间透明以外的形状——本质上是「可见度曲线」，想怎么淡就怎么写。
- 它和滚动阴影分工不同：滚动阴影是「有内容在滚才出现」，遮罩是「永远淡出」。两者叠在一起用最完整。
