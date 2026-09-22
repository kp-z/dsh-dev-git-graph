---
title: 水波焦散
slug: caustics
category: 材质
tags: [repeating-gradient, radial-gradient, 液体, 自动]
since: 2026-09
source: 自行实现
when: 深色水面上要有那种网状的、缓慢游动的光纹
stage: dark
tier: core
params:
  - { name: dur, label: 游动周期, type: range, min: 4, max: 30, step: 2, default: 14, unit: s }
---

## 描述

深蓝的水面上浮着一层网状亮纹，缓慢地流动、变形。

机制是 ==两层 `repeating-radial-gradient` 的环，用不同的速度平移==。每一层给出等距的同心环；两层环以不同速度移动、互相错开，叠加处就形成了不断变化的网状亮纹——这正是水面把所有波纹的成像叠在一起的样子。

两层都要用 `translate` 移动，不要动 `background-position`。

## 代码

```html
<div class="cx">
  <span class="cx-l1"></span>
  <span class="cx-l2"></span>
</div>
```

```css
.cx {
  position: relative;
  width: min(330px, 80vw);
  height: 190px;
  overflow: hidden;
  background: radial-gradient(120% 100% at 50% 0%, #0d3350 0%, #05121d 78%);
}

.cx span {
  position: absolute;
  /* 比容器大，移动时边缘不会露 */
  inset: -35%;
  /* @mechanism 一层等距同心环 */
  background: repeating-radial-gradient(
    circle at 32% 40%,
    transparent 0 9px,
    rgb(190 235 255 / 0.075) 10px 11px
  );
}

.cx-l1 {
  /* @mechanism 两层环以不同速度平移，叠加处形成游动的网 */
  animation: cx-drift-a var(--dur, 14s) linear infinite alternate;
}

.cx-l2 {
  background: repeating-radial-gradient(
    circle at 68% 58%,
    transparent 0 13px,
    rgb(150 220 255 / 0.055) 14px 15px
  );
  animation: cx-drift-b calc(var(--dur, 14s) * 1.4) linear infinite alternate;
}

@keyframes cx-drift-a {
  to {
    translate: 46px 30px;
  }
}

@keyframes cx-drift-b {
  to {
    translate: -54px 38px;
  }
}
```

## 边界

- 两层环的**间距必须不同**（这里 9px 与 13px）。间距一样时两层会同步，看到的是整体平移，没有「网在变」的感觉。
- 用 `translate` 移动，不要动 `background-position`。后者每帧重绘整块渐变；前者交给合成器。
- 两层都要比容器大（`inset: -35%`），否则移动时会从边缘露出没画到的区域。
- 环的亮度要极低（这里 5%–8%）。提亮之后就成了同心圆图案，不是水光。
- 它完全不看内容。压在上面的文字要另加底色或阴影，否则会与光纹互相干扰。

## 备注

- 把 `alternate` 去掉、加个 `ease-in-out` 会让游动更「水」，但会出现周期性的停顿感。
- 同一招用在浅色底上就是「阳光照进泳池」的墙面光斑，把底色换成暖白即可。
