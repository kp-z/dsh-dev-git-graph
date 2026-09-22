---
title: 热力格子的色阶
slug: heatmap-grid-threshold
category: 图形
tags: [color-mix, grid, 色彩, 图表, 数字]
since: 2026-10
source: 机制来自 color-mix 的百分比插值与 grid 排布，自行实现
when: 一年 365 个格子里每格一个数值，要一眼看出疏密
stage: dark
tier: core
---

## 描述

一片方格矩阵，每格按当天的量取一个深浅不同的颜色，密集处自己连成一片。

机制是 ==色阶由 color-mix 的百分比插值算出来，不再需要分级==。每个格子只带一个 `--v: 0..1`，颜色写成 `color-mix(in oklab, 冷色 calc(var(--v) * 100%), 暖色)`——`color-mix` 的百分比参数可以接 `calc()`，于是「数值」到「颜色」是一条连续函数，而不是「if 值 < 0.25 用 A 色」这种几档跳变。

连续性带来的好处不在好看，而在**不用决定分几档**。分级热力图总有一个拍脑袋的数字（为什么是 4 档不是 5 档），而且数据分布一变就得重调；连续色阶没有这个数字，`--v` 是多少就是多少。`in oklab` 也是必须的：在 sRGB 里从蓝插值到黄会经过一段发灰的脏色，oklab 是一条干净的直线。

## 代码

```html
<div class="heat" role="img" aria-label="近 5 周活跃度热力图">
  <!-- 每格一个 --v，0 到 1 -->
  <i style="--v: 0.1"></i><i style="--v: 0.35"></i><i style="--v: 0.9"></i>
  <i style="--v: 0.2"></i><i style="--v: 0.55"></i><i style="--v: 0.75"></i>
  <i style="--v: 0.0"></i><i style="--v: 0.45"></i><i style="--v: 0.6"></i>
  <i style="--v: 0.3"></i><i style="--v: 0.8"></i><i style="--v: 0.15"></i>
</div>
```

```css
.heat {
  display: grid;
  grid-template-columns: repeat(3, 22px);
  gap: 3px;
  padding: 10px;
  background: #14101a;
  border-radius: 4px;
}

.heat i {
  aspect-ratio: 1;
  border-radius: 2px;
  /* @mechanism 一个变量直接决定颜色深浅，不必先分成几档 */
  background: color-mix(in oklab, #2a2436 calc((1 - var(--v)) * 100%), #d9a441);
}
```

## 边界

- `color-mix` 的第一个颜色占比写 `calc(var(--v) * 100%)` 才是「越大越暖」；写成 `var(--v) * 100%` 而 `--v` 本身是 0..1 的**无单位数**，`calc()` 里没问题，但直接把 `--v` 当百分比用（`var(--v)%`）会得到 `0.9%`，颜色几乎不动——这是最常见的写错方式，且不报错。
- 忘了 `in oklab`（或用了 `in srgb`）时，冷色到暖色之间会经过一段灰扑扑的中间色。数据集中在中段时整片图会看着「脏」。
- 这套做法靠 `--v` 在 0..1 之间。负数或大于 1 的值不会报错，`color-mix` 会把百分比夹住，于是所有超出范围的值挤在同一个颜色上，图上出现「一片一样的深色」，看着像数据缺失。
- 每个格子都是一个真实的 `<i>` 元素。365 个还行，一年分钟级的数据就是 52 万个元素——那种量级该换成一张 `canvas` 或一个 `background-image`。CSS 变量的优势在几十到几千个元素这个区间。
- 颜色是**唯一**的编码方式。色觉障碍用户分不出深浅顺序，必须另外提供文字或数值，`role="img"` + `aria-label` 只是给整片图一个名字，不是数值本身。
