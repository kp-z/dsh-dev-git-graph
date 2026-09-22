---
title: 把线画出来
slug: svg-stroke-draw
category: 图形
tags: [svg, stroke, 描边, 图标, 入场]
since: 2026-09
source: 机制来自 SVG 的 stroke-dasharray / stroke-dashoffset，自行实现
when: 图标或下划线要像被一笔画出来，而不是直接出现
stage: dark
tier: core
params:
  - { name: dur, label: 画完用时, type: range, min: 0.5, max: 6, step: 0.5, default: 2.4, unit: s }
---

## 描述

一个圆圈被一笔一笔画出来，画完就停住。

机制是 ==stroke-dasharray 设成路径总长、stroke-dashoffset 从总长动到 0，线就像被画出来==。虚线长度等于周长时，整条路径被表示成「一段实线 + 一段等长的空隙」；偏移量等于周长时实线段被推到看不见的地方。把偏移量推到 0，实线段就沿路径铺开。

它不改变路径的形状，只改变**从哪一段开始可见**。

## 代码

```html
<svg class="sd" viewBox="0 0 120 120" aria-label="被画出来的圆">
  <circle class="sd-track" cx="60" cy="60" r="50" />
  <circle class="sd-line" cx="60" cy="60" r="50" />
</svg>
```

```css
.sd {
  width: 150px;
  height: 150px;
  fill: none;
  stroke-linecap: round;
}

.sd-track {
  stroke: rgb(240 234 217 / 0.14);
  stroke-width: 6;
}

.sd-line {
  stroke: #b4462f;
  stroke-width: 6;
  /* 半径 50 的周长约 314 */
  /* @mechanism 虚线长度 = 路径总长，于是只有一段实线 */
  stroke-dasharray: 314;
  /* @mechanism 偏移等于总长时实线被推出视野 */
  stroke-dashoffset: 314;
  animation: sd-draw var(--dur, 2.4s) ease-in-out infinite alternate;
}

@keyframes sd-draw {
  to {
    stroke-dashoffset: 0;
  }
}
```

## 边界

- `stroke-dasharray` 必须**大于等于**路径总长。小于它时会出现多段虚线，看到的是「蚂蚁线绕着走」而不是「一笔画出来」。
- 路径总长最好用 `getTotalLength()` 取真实值。凭经验填一个偏小的数字，会出现「画了两遍」的观感；填得偏大只会让开头多等一会儿，比填小安全。
- 它只作用于 **stroke**，对 `fill` 无效。填充色不会跟着「画」出来——想要填充一起出现得另外叠一层透明度动画。
- 多条路径依次画时要用 `animation-delay` 排阶梯，但每条总长不同，**同样的时长会让长的慢、短的快**。要视觉匀速，得按总长分别设时长。
- 圆、矩形这类基本图形可以直接写数字；任意 `<path>` 只能靠 JS 拿总长，纯 CSS 无法计算。

## 备注

- 两个动画方向相反就是「画出来又擦掉」，`alternate` 一行就能得到。
- 这一招是各类加载动画与签名动画的共同基础，机制只有一句话：用虚线偏移伪装出「长度」。
