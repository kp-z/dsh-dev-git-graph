---
title: 沿对角线错开的波
slug: diagonal-stagger
category: 动效
tags: [keyframes, transform, 加载, 自动]
since: 2026-09
source: tobiasahlin/SpinKit（MIT） — sk-grid，改写为独立最小示例
when: 一片格子要有一道波斜着扫过，而不是整体一起动
stage: dark
tier: core
params:
  - { name: step, label: 相邻延迟, type: range, min: 0.05, max: 0.3, step: 0.05, default: 0.1, unit: s }
---

## 描述

九个小方块依次缩下去又弹回来，那道波是**斜着**扫过去的。

机制是 ==延迟沿对角线递增==。原实现的九个延迟是：

```
0.2  0.3  0.4
0.1  0.2  0.3
0.0  0.1  0.2
```

看规律：**延迟 = (行 + 列) × 0.1s**。所以同一时刻，沿「左上到右下」那条线上所有方块的动作是同步的——人眼把这条同相位的线读成一道斜向的波。

「错开」不是简单地把延迟等差排下去，而是**按二维位置算**。

## 代码

```html
<div class="dg">
  <i></i><i></i><i></i>
  <i></i><i></i><i></i>
  <i></i><i></i><i></i>
</div>
```

```css
.dg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  width: 108px;
  height: 108px;
}

.dg i {
  background: #d9a441;
  animation: dg-beat 1.3s ease-in-out infinite;
}

/* @mechanism 延迟 = (行 + 列) × step，同一条斜线同相位 → 斜向的波 */
.dg i:nth-child(1) { animation-delay: calc(var(--step, 0.1s) * 2); }
.dg i:nth-child(2) { animation-delay: calc(var(--step, 0.1s) * 3); }
.dg i:nth-child(3) { animation-delay: calc(var(--step, 0.1s) * 4); }
.dg i:nth-child(4) { animation-delay: calc(var(--step, 0.1s) * 1); }
.dg i:nth-child(5) { animation-delay: calc(var(--step, 0.1s) * 2); }
.dg i:nth-child(6) { animation-delay: calc(var(--step, 0.1s) * 3); }
.dg i:nth-child(7) { animation-delay: calc(var(--step, 0.1s) * 0); }
.dg i:nth-child(8) { animation-delay: calc(var(--step, 0.1s) * 1); }
.dg i:nth-child(9) { animation-delay: calc(var(--step, 0.1s) * 2); }

@keyframes dg-beat {
  0%,
  70%,
  100% {
    transform: scale(1);
  }
  35% {
    transform: scale(0);
  }
}
```

## 边界

- 延迟要按**二维位置**算，不是按 `nth-child` 的顺序。按顺序排等差延迟得到的是「一行一行扫」，不是斜的。
- 周期必须**明显长于总延迟跨度**（这里 1.3s 对 0.4s）。周期不够时所有方块还没错开完就开始下一轮，看着是一片乱闪。
- 写九条 `nth-child` 是原实现的做法。列数变化时这套编号需要重算——这也是它不够工程化的地方，真实项目里通常由预处理器或 JS 生成。
- 延迟用**正延迟**：动画开头会有一段「什么都没动」的空窗。用**负延迟**可以从中段切入，看起来是「已经在动了」。
- 它是装饰性动画，格子的缩放会持续占用合成层。作为整屏背景时要留意代价。
- 原实现用 `float: left` + 33.33% 宽度排版。用 grid 更稳，也就不需要清浮动了。

## 备注

- 原实现是 tobiasahlin/SpinKit（MIT） 的 `sk-grid`（九个 `sk-grid-cube` + 九个 `nth-child` 延迟）。
- 把延迟改成 `(行 - 列) × step` 就是另一条对角线的方向——一个符号改变整道波的角度。
