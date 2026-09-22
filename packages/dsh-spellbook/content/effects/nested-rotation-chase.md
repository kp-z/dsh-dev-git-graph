---
title: 旋转套旋转
slug: nested-rotation-chase
category: 动效
tags: [keyframes, transform, 加载, 自动]
since: 2026-09
source: tobiasahlin/SpinKit（MIT） — sk-chase，改写为独立最小示例
when: 几个点要沿一条轨道互相追逐，而不是一起转圈
stage: dark
tier: core
params:
  - { name: dur, label: 一圈用时, type: range, min: 1, max: 6, step: 0.5, default: 2.5, unit: s }
---

## 描述

几个点沿着一个方框轨道互相追着跑，每个点自己还在转。

机制是 ==两层嵌套的旋转：外层容器整体转一圈，每个点自己也转，但周期不同、并用负延迟错开==。外层的旋转负责「位的移动」，内层的旋转负责「形的变化」，两者周期不成整数倍时，轨迹看上去就不是简单的圆。

原实现的两层周期是 **2.5s 与 2.0s**——刻意不成倍数，这样两个旋转的相对相位一直在变。

## 代码

```html
<div class="chase">
  <span class="chase-dot"></span>
  <span class="chase-dot"></span>
  <span class="chase-dot"></span>
  <span class="chase-dot"></span>
  <span class="chase-dot"></span>
  <span class="chase-dot"></span>
</div>
```

```css
.chase {
  position: relative;
  width: 110px;
  height: 110px;
  /* @mechanism 外层负责「位的移动」 */
  animation: chase-spin var(--dur, 2.5s) infinite linear both;
}

.chase-dot {
  position: absolute;
  inset: 0;
  animation: chase-dot calc(var(--dur, 2.5s) * 0.8) infinite ease-in-out both;
}

.chase-dot::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 26%;
  height: 26%;
  border-radius: 50%;
  background: #14b8a6;
}

/* @mechanism 负延迟错开相位：一个个追着走 */
.chase-dot:nth-child(1) { animation-delay: calc(var(--dur, 2.5s) * -0.44); }
.chase-dot:nth-child(2) { animation-delay: calc(var(--dur, 2.5s) * -0.40); }
.chase-dot:nth-child(3) { animation-delay: calc(var(--dur, 2.5s) * -0.36); }
.chase-dot:nth-child(4) { animation-delay: calc(var(--dur, 2.5s) * -0.32); }
.chase-dot:nth-child(5) { animation-delay: calc(var(--dur, 2.5s) * -0.28); }
.chase-dot:nth-child(6) { animation-delay: calc(var(--dur, 2.5s) * -0.24); }

@keyframes chase-spin {
  to {
    transform: rotate(360deg);
  }
}

/* @mechanism 内层负责「形的变化」，周期与外层刻意不成整数倍 */
@keyframes chase-dot {
  50% {
    transform: rotate(540deg);
  }
  100% {
    transform: rotate(1080deg);
  }
}
```

## 边界

- 两层的**周期要有意错开**。原实现是 2.5s 与 2.0s（0.8 倍）——不是整数倍，所以相对相位一直在漂移，轨迹才不平淡。若取成 1:1 或 1:2，会看到明显的重复周期，一会儿就腻。
- 每个点都是**绝对定位铺满外层**、再用 `::before` 画一个小圆。这样点的位置由外层旋转决定，而不是逐个去算坐标——这是它比「摆 6 个点」高明的地方。
- **负延迟**在这里是必需的。用正延迟时开头会有一大段「一个点都没有」的空窗；负延迟让所有点一开始就分布在不同相位上。
- 内层的关键帧转到 **1080 度**（三圈）而不是 360 度。转的圈数越多，同样的时长里角速度越快，「追」的劲儿越足。
- 它没有配 `prefers-reduced-motion`。旋转是诱发不适的主要动效类型之一，正式项目必须关掉它。
- 原实现里 `::before` 也各带一份延迟（截图里能看到的 `:nth-child(n):before`），这里简化成只给 `.chase-dot` 加延迟——两者的相位效果一致。

## 备注

- 原实现是 tobiasahlin/SpinKit（MIT） 的 `sk-chase`（外层 2.5s、内层 2.0s，负延迟 -1.1s 到 -0.6s）。
- "旋转套旋转 + 周期不成倍数"是那种看起来复杂、机制却只有两行的手段。
