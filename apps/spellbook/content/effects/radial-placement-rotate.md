---
title: 用旋转来摆位
slug: radial-placement-rotate
category: 动效
tags: [旋转, 摆位, 圆周]
since: 2026-09
source: tobiasahlin/SpinKit（MIT） — sk-circle-fade，改写为独立最小示例
when: 一圈点要均匀分布，但不想逐个算坐标
stage: dark
tier: core
params:
  - { name: fade, label: 淡出时长, type: range, min: 0.3, max: 2, step: 0.1, default: 1.2, unit: s }
---

## 描述

一圈小点依次明灭，像钟面上的指针走过去。

机制是 ==用 `rotate(n × 30deg)` 把元素摆到圆周上==。每个点都是一个**铺满外框的方块**，方块的左上角画一个小圆——把这个方块转过 30 度的整数倍，那个小圆就被送到了圆周上的不同位置。

**摆位和旋转是同一个操作**。所以不需要写 12 组坐标，只需要 12 个旋转角度。

顶点位于方框左上角，绕中心转 30° 就落到圆的 30° 位置上——旋转一圈正好走完 12 个点。

## 代码

```html
<div class="rf">
  <span class="rf-dot"></span><span class="rf-dot"></span>
  <span class="rf-dot"></span><span class="rf-dot"></span>
  <span class="rf-dot"></span><span class="rf-dot"></span>
  <span class="rf-dot"></span><span class="rf-dot"></span>
  <span class="rf-dot"></span><span class="rf-dot"></span>
  <span class="rf-dot"></span><span class="rf-dot"></span>
</div>
```

```css
.rf {
  position: relative;
  width: 108px;
  height: 108px;
}

.rf-dot {
  position: absolute;
  inset: 0;
}

.rf-dot::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 24%;
  height: 24%;
  border-radius: 50%;
  background: #d9a441;
  animation: rf-fade var(--fade, 1.2s) infinite ease-in-out;
}

/* @mechanism 用旋转把点摆到圆周上：摆位与旋转是同一个操作 */
.rf-dot:nth-child(1)  { transform: rotate(0deg); }
.rf-dot:nth-child(2)  { transform: rotate(30deg); }
.rf-dot:nth-child(3)  { transform: rotate(60deg); }
.rf-dot:nth-child(4)  { transform: rotate(90deg); }
.rf-dot:nth-child(5)  { transform: rotate(120deg); }
.rf-dot:nth-child(6)  { transform: rotate(150deg); }
.rf-dot:nth-child(7)  { transform: rotate(180deg); }
.rf-dot:nth-child(8)  { transform: rotate(210deg); }
.rf-dot:nth-child(9)  { transform: rotate(240deg); }
.rf-dot:nth-child(10) { transform: rotate(270deg); }
.rf-dot:nth-child(11) { transform: rotate(300deg); }
.rf-dot:nth-child(12) { transform: rotate(330deg); }

/* @mechanism 延迟沿同一方向递增，看起来就是一圈依次明灭 */
.rf-dot:nth-child(1)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.00); }
.rf-dot:nth-child(2)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.08); }
.rf-dot:nth-child(3)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.17); }
.rf-dot:nth-child(4)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.25); }
.rf-dot:nth-child(5)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.33); }
.rf-dot:nth-child(6)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.42); }
.rf-dot:nth-child(7)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.50); }
.rf-dot:nth-child(8)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.58); }
.rf-dot:nth-child(9)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.67); }
.rf-dot:nth-child(10)::before { animation-delay: calc(var(--fade, 1.2s) * 0.75); }
.rf-dot:nth-child(11)::before { animation-delay: calc(var(--fade, 1.2s) * 0.83); }
.rf-dot:nth-child(12)::before { animation-delay: calc(var(--fade, 1.2s) * 0.92); }

@keyframes rf-fade {
  0%,
  39%,
  100% {
    opacity: 0.15;
  }
  40% {
    opacity: 1;
  }
}
```

## 边界

- 每个点的**形状必须是「从中心指向外」的**。原实现里每个方块都是铺满外框、小圆画在左上角——这样旋转 30° 才会把它送到圆上。如果小圆画在方块正中，转多少度它都在圆心，什么也不会发生。
- **旋转角度与延迟必须同向递增**。角度涨而延迟不涨，得到的是一圈同时明灭（看着像整体闪）；两者一致才是「依次走过」。
- `transform` 加在 `.rf-dot` 上、`animation` 加在它的 `::before` 上，两者必须分层。写在同一个元素上时，动画会覆盖掉 `transform`，点位全塌到圆心——这是最容易出错的一处。
- 关键帧的 `40%` 处突变（前 39% 是暗的，40% 突然亮）是刻意的，它让「指针」看起来是跳着走的。把这一对改成平滑过渡，观感就从「指针」变成「呼吸」。
- 点的数量与角度是绑死的：12 个点是 30 度一档。改成 8 个点就要改成 45 度一档，且延迟的步长也要跟着重算。
- 同样没有配 `prefers-reduced-motion`。原仓库是个纯加载动画库，这类考虑本来就不在它范围内——我们收进来时要自己补。

## 备注

- 原实现是 tobiasahlin/SpinKit（MIT） 的 `sk-circle-fade`（12 个 `sk-circle-fade-dot`，各 `rotate(30deg × n)`）。
- "用变换来摆位"这个思路能迁移到很多地方：环形排列的菜单、放射状的光线、表盘刻度。
