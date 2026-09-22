---
title: 网格渐变
slug: mesh-gradient
category: 材质
tags: [radial-gradient, gradient, 色彩, 容器]
since: 2026-09
source: 机制来自 CSS 多重背景叠加，自行实现
when: 要一块柔和流动的彩色底，但不想用图片、也不想上 WebGL
stage: plain
tier: core
params:
  - { name: soft, label: 柔和度, type: range, min: 30, max: 90, step: 5, default: 62, unit: % }
---

## 描述

几团颜色在角落互相晕开，边界全化掉了，像颜料在湿纸上渗。

机制是 ==多个 radial-gradient 叠在一层背景里，每个都用 transparent 收边==。单层径向渐变只能做一个光斑；叠三层、各自定在不同位置，颜色在重叠区互相加强，就出现了只有「网格渐变」工具才做得出的那种过渡。整件事没有图片，也没有滤镜。

## 代码

```html
<div class="mg"></div>
```

```css
.mg {
  width: min(340px, 74vw);
  aspect-ratio: 4 / 3;
  /* @mechanism 多层径向渐变叠加；每层都必须收成 transparent，否则露出硬边圆 */
  background-color: #241a3d;
  background-image:
    radial-gradient(circle at 20% 24%, #ff9a5a 0%, transparent var(--soft, 62%)),
    radial-gradient(circle at 80% 30%, #7c5cff 0%, transparent var(--soft, 62%)),
    radial-gradient(circle at 58% 88%, #14b8a6 0%, transparent var(--soft, 62%));
}
```

## 边界

- 每一层都必须收到 `transparent`。写成具体颜色的话，会看到三个边缘锐利的圆盘叠在一起——那是「三个圆」不是「网格渐变」。
- 层数多又铺满整个视口时，滚动会明显掉帧：多层大面积渐变在某些浏览器上会反复光栅化。固定尺寸的卡片没事，全屏背景要压层数或加 `will-change` 谨慎试探。
- 它是**叠出来的静态图**，没法用 `transition` 直接过渡。CSS 不能在两个渐变之间插值——要动只能整体位移、缩放或改透明度，或者用 `@property` 把颜色拆成可插值的变量。
- 色相跨度过大时中间会出现灰带（互补色调和的结果）。三个颜色选相近色相、或者接受那个灰调。

## 备注

- `background-color` 是兜底底色，要选三层里最深的那支，这样收边处不会透出白底。
- 加一层极淡的噪点再叠上去，能压掉渐变算法带来的色带（banding）——那种一条条的同心纹在深色大面积上尤其明显。
