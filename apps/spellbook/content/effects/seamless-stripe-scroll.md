---
title: 无缝走动的条纹
slug: seamless-stripe-scroll
category: 图形
tags: [background-size, keyframes, 图案, 加载, 自动]
since: 2026-10
source: 机制来自背景图块的平铺晶格与 background-position 的整格平移，自行实现
when: 要一条「正在运行」的条纹带（加载、传输、警戒线），循环点必须完全看不出来
stage: grid
tier: core
params:
  - { name: step, label: 条纹周期, type: range, min: 6, max: 24, step: 2, default: 12, unit: px }
---

## 描述

一条条纹带自己往前走，永远走不到头，也永远不跳。

机制是 ==把图块宽度定成条纹自身的周期，每轮动画正好平移一个图块宽==。`background-size` 定下的是平铺晶格：只要位移量等于一个晶格向量，位移前后的渲染结果就是同一个函数，动画的首尾逐像素重合，`infinite` 就成了无缝传送带。所以这里必须精确——`background-position` 的百分比算的是「元素尺寸减图块尺寸」的比例，**不是**条纹周期，写 `to { background-position: 100% 0 }` 几乎不可能等于一格，于是每轮都跳一下。

为什么竖条纹最省事：条纹的周期是沿渐变轴量的，而平铺的周期是沿 x 轴量的，两者只在角度为 90° 时数值相等。换成斜纹就必须把图块宽度放大 1/sin θ 倍（45° 时是 √2 倍）才能让相邻图块的条纹接上——这是「角度改变了视觉周期」的同一个坑。

周期是唯一的旋钮，但它同时管两件事：改小周期，条纹更密、看起来走得更快。走得快不快其实由 `animation-duration` 决定（一秒走几格），而 `duration` 不变时每秒走过的格数不变，只是每格的距离变了。想只调快慢就别动周期。

## 代码

```html
<!-- @mechanism 盒子里放的是一张静止的条纹图，走动全靠背景自身的平移 -->
<div class="bp"><span>seamless</span></div>
```

```css
.bp {
  display: grid;
  place-items: center;
  width: min(320px, 78vw);
  height: 110px;
  background-color: #12101c;
  /* @mechanism 竖条纹：角度 90° 时，条纹周期与 x 方向的平铺周期是同一个数 */
  background-image: repeating-linear-gradient(
    90deg,
    rgb(217 164 65 / 0.9) 0 calc(var(--step, 12px) / 2),
    rgb(18 16 28 / 0) calc(var(--step, 12px) / 2) var(--step, 12px)
  );
  /* @mechanism 图块宽度就是一个周期，它定义了平铺晶格 */
  background-size: var(--step, 12px) 100%;
  font: 500 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
  animation: bp-march 0.9s linear infinite;
}

@keyframes bp-march {
  from {
    background-position: 0 0;
  }
  /* @mechanism 位移量 = 一个图块宽 = 一个周期，首尾因此逐像素相同 */
  to {
    background-position: var(--step, 12px) 0;
  }
}
```

## 边界

- 周期与图块宽必须是同一个值。两者写成两个独立数字时，斜纹会在每条图块接缝处错位，整块出现等距的竖线裂痕（这就是「角度改变视觉周期」暴露出来的地方）。
- 斜纹要用 45°/135° 时，图块宽得写成 `calc(<周期> * 1.4142)`，同时把法线方向也留够——漏掉这个系数，条纹会一格一格地错开。
- 动画的是 `background-position`，它会触发重绘而不是合成。小条带没问题；铺满整屏的图案每帧重绘代价很实在。要更省，把图案放在一个比元素大一圈的伪元素上，用 `transform: translate` 位移它。
- 元素尺寸不是整数像素时（flex/grid 分出来的半像素宽），`background-position` 的终点落在半像素上，条纹边走边被抗锯齿，看起来像在抖。
- 条纹的周期小于 2 设备像素时会糊成一片灰，看不清也不好看；高 DPI 屏幕上可以比 1× 屏幕上更细。

## 备注

- 这套「平移一个晶格向量」对任何平铺图案都成立。点阵、棋盘一样可以用它做无限流动，位移量换成对应的图块宽即可。
- 只想让条纹随时间缓慢错位（不要连续滚动），用 `animation-fill-mode` 加一个很长的 `duration` 也能做，但相位会一直漂到元素外——不如直接滚动。
