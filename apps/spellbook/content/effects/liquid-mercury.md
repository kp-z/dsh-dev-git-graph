---
title: 液态水银
slug: liquid-mercury
category: 材质
tags: [blur, feColorMatrix, radial-gradient, 金属, 液体]
since: 2026-10
source: 机制来自 CSS blur 与 SVG feColorMatrix 的 alpha 阈值化（gooey 融合），自行实现
when: 几个圆形要合并成一大滴镜面液态金属，像水银在表面上聚散
stage: dark
tier: core
params:
  - { name: goo, label: 融合强度, type: range, min: 2, max: 16, step: 1, default: 8, unit: px }
---

## 描述

几颗圆球缓慢移动，靠近时会像水银一样并成一颗大的，分开时又拉断成两颗。

机制是 ==先模糊、再对 alpha 通道做阈值化==。顺序是关键：模糊把两颗球之间的空隙抹成一层半透明的灰度带，阈值再把「够浓的部分」切成实心——于是原本不相连的两颗球之间凭空长出一座桥，看起来就是液体表面张力在把它们拉拢。顺序一反就完全不成立：先阈值后模糊，只会得到两颗边缘发虚的球，中间永远没有桥。

镜面感是第二件事，而且它和融合是两个独立机制。融合出来的形状如果没有反光，只是一坨灰色的胶。所以填充用的是明暗跳变极快的径向渐变——边缘一圈暗、中间一道窄亮弧，正是水银球面上倒映的暗房间与一扇窗。两者叠加，才从「黏土」变成「水银」。

`goo` 是模糊半径，也就是融合强度。它一个参数同时决定两件事：多远的球会被拉在一起，以及融合处那座桥有多粗。

## 代码

```html
<svg class="lm-defs" width="0" height="0" aria-hidden="true">
  <filter id="goo-threshold">
    <!-- @mechanism 只做阈值化：把模糊出来的半透明空隙切成实心，桥就是这么长出来的 -->
    <feColorMatrix
      type="matrix"
      values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
    />
  </filter>
</svg>

<div class="lm">
  <span class="lm-drop" style="--x: 20%; --y: 44%; --d: 0s"></span>
  <span class="lm-drop" style="--x: 50%; --y: 36%; --d: -1.1s"></span>
  <span class="lm-drop" style="--x: 72%; --y: 56%; --d: -2.2s"></span>
</div>
```

```css
.lm {
  position: relative;
  width: 280px;
  height: 200px;
  /* @mechanism blur 负责造空隙、SVG 阈值负责切边，两者串联才有融合；顺序不可反 */
  filter: blur(var(--goo, 8px)) url(#goo-threshold);
}

.lm-drop {
  position: absolute;
  left: var(--x);
  top: var(--y);
  width: 76px;
  height: 76px;
  border-radius: 50%;
  /* @mechanism 明暗跳变极快才有镜面感，平滑渐变只会像一坨塑料 */
  background: radial-gradient(
    circle at 34% 28%,
    #ffffff 0%,
    #cfd6dd 12%,
    #6f7883 30%,
    #1b2028 58%,
    #4c5560 76%,
    #0d1116 100%
  );
  animation: lm-float 7s ease-in-out infinite;
  animation-delay: var(--d);
}

@keyframes lm-float {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(-26px, 14px) scale(1.12);
  }
}
```

## 边界

- **阈值化必须作用在一整层像素上。**所以 `filter: blur(...) url(#goo-threshold)` 要挂在**父容器**上：子元素在这一层里被一起模糊、一起切边，才会互相长桥。把滤镜挂到每颗球上时，模糊与阈值各自独立发生，永远不融合——这是最常见的失败写法，而且完全不报错，只是看起来像几颗球在撞。
- alpha 矩阵那行 `0 0 0 20 -8` 是线性重映射：斜率 20 越陡边缘越硬、越像金属；降到 10 上下会变糊，融合处露出灰边。它和 `var(--goo)` 是一对，改一个就得重看另一个。
- **滤镜会裁剪。**滤镜区域默认贴着元素边界，球移出容器时会被一刀削平。所以要给容器留出余量（示例里 280×200 装了 76px 的球），或显式放大滤镜区域。
- 球一旦带上自己的 `filter`、`opacity` 或 `clip-path`，就会被提成独立的合成层，父容器上的模糊看不到它们的内部像素，融合立刻失效。示例里动画只动 `transform`，正是为了避开这一点。
- SVG 滤镜在模糊半径很大时是逐像素的软件光栅化，几个球配 16px 模糊在低端机上会掉帧。`goo` 的上限因此是 16 而不是 60。

## 备注

- 同一招是「果冻按钮」「黏液加载动画」的底子：把镜面渐变换成纯色，立刻从金属变成橡皮糖。
- 斜率取负值会把实心切成镂空，得到相反的「蚀刻」形状——同一套矩阵，方向反过来用。
