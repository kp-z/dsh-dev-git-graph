---
title: 锥形渐变环
slug: conic-ring
category: 图形
tags: [锥形渐变, 遮罩, 环]
since: 2026-09
source: 机制来自 CSS conic-gradient 与 mask，自行实现
when: 要一个多色渐变的圆环，但不想用 SVG、不想切图
stage: dark
tier: core
params:
  - { name: hole, label: 中空比例, type: range, min: 20, max: 88, step: 2, default: 62, unit: % }
---

## 描述

一圈颜色绕着中心均匀转过去，中间是空的。

机制是 ==conic-gradient 画满圆盘，再用 mask 挖掉圆心==。`conic-gradient` 的色标按**角度**分布，不是按距离——所以它天然是绕圈的，`linear-gradient` 无论怎么转都做不出这个。`border-radius: 50%` 只裁外轮廓，不挖中间，所以必须靠 `mask` 把圆心透出来。

## 代码

```html
<div class="cr"></div>
```

```css
.cr {
  width: 150px;
  aspect-ratio: 1;
  border-radius: 50%;
  /* @mechanism 色标按角度绕圈分布 */
  background: conic-gradient(from 210deg, #b4462f, #d9a441, #14b8a6, #7c5cff, #b4462f);
  /* @mechanism mask 挖空圆心，做出环 */
  mask: radial-gradient(circle at 50% 50%, transparent var(--hole, 62%), #000 calc(var(--hole, 62%) + 1%));
}
```

## 边界

- `mask` 在部分浏览器上仍需要 `-webkit-mask` 前缀；只写标准属性时，旧版 Safari 会退化成一个实心彩色圆盘。
- `radial-gradient` 的两个色标要留一点点差值（这里用了 `+1%`）。写成同一个值会让边缘出现锯齿，因为抗锯齿需要至少一个像素的过渡带。
- `conic-gradient` 是从 12 点方向、顺时针开始的。`from` 只在需要把某个色标对齐到特定方向时才写，不写默认从顶部起。
- 在两个色标之间直接跳到下一个颜色会出现硬边。想要柔和的过渡，两个色标之间必须留出一段距离让浏览器插值。

## 备注

- `aspect-ratio: 1` 换来正方形，比同时写 `width` 和 `height` 更好改——只动一个值就能缩放整环。
- 同一个 `conic-gradient` 配 `@property` 声明角度、再动画 `from` 的角度，就能让环转起来；不声明 `@property` 的话角度是离散的，动画会突兀地跳。
