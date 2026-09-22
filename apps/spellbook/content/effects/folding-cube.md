---
title: 倾斜容器里的翻折
slug: folding-cube
category: 动效
tags: [transform, 3d, keyframes, 加载, 自动]
since: 2026-09
source: tobiasahlin/SpinKit（MIT） — sk-fold，改写为独立最小示例
when: 四个方块像折纸一样依次翻面，整体还带着斜角
stage: dark
tier: core
---

## 描述

四个方块轮流翻折，整体是斜着的菱形。

机制分两层：==容器整体 `rotateZ(45deg)` 把正方形转成菱形==（这样四个方块看起来是「尖角朝上」的四个面），然后==每个方块各自绕自己的边翻折、并且有一半是半透明的==。倾斜的容器提供构图，每个面自己的旋转提供动作。

半透明是关键：没有它，翻折的面会互相遮挡，看不出「折」的关系。

## 代码

```html
<div class="fold">
  <span class="fold-cube"></span>
  <span class="fold-cube"></span>
  <span class="fold-cube"></span>
  <span class="fold-cube"></span>
</div>
```

```css
.fold {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  width: 120px;
  height: 120px;
  /* @mechanism 整体转 45 度，四个方块看起来才是尖角朝上的面 */
  transform: rotateZ(45deg);
}

.fold-cube {
  float: left;
  width: 50%;
  height: 50%;
  position: relative;
  transform: scale(1.1);
}

.fold-cube::before {
  content: "";
  position: absolute;
  inset: 0;
  /* @mechanism 半透明才能看见后面那层，翻折的关系才成立 */
  background: rgb(180 70 47 / 0.55);
  transform-origin: 100% 50%;
  animation: fold-angle 2.4s infinite ease-in-out;
}

.fold-cube:nth-child(1)::before { animation-delay: 0s; }
.fold-cube:nth-child(2)::before { animation-delay: 0.3s; }
.fold-cube:nth-child(3)::before { animation-delay: 0.9s; }
.fold-cube:nth-child(4)::before { animation-delay: 0.6s; }

@keyframes fold-angle {
  0%,
  10% {
    transform: perspective(140px) rotateX(-180deg);
    opacity: 0;
  }
  25%,
  75% {
    transform: perspective(140px) rotateX(0deg);
    opacity: 1;
  }
  90%,
  100% {
    transform: perspective(140px) rotateX(180deg);
    opacity: 0;
  }
}
```

## 边界

- **半透明不是可选项。**不透明的面翻过去之后会完全遮住后面的方块，「折」的空间关系就没了，看着只是几块色块在跳。
- 容器 `rotateZ(45deg)` 之后，四个方块的**视觉朝向也转了**。所以每个面自己的 `rotateX` 轴不是屏幕的水平轴——这是理解它运动方向的必要一步。
- `transform-origin: 100% 50%` 让翻折的轴落在每个面的右边。四个面用同一个原点，折起来才是「合拢」而不是各转各的。
- 延迟不是按顺序递增的：原实现是 `0 / 0.3 / 0.9 / 0.6`，**对角线下手、按「绕圈」的顺序排**——这是它看起来像折纸而不像流水线的关键。
- `perspective()` 值很小（140px）时透视很强，翻折感明显；值调大就接近平面旋转。
- 它用了 `::before` 承载每一个面，所以方块本身可以是空的。真实场景要注意伪元素与内容层的堆叠顺序。

## 备注

- 原实现是 tobiasahlin/SpinKit（MIT） 的 `sk-fold` / `sk-fold-cube`，延迟是 `0 / 0.3 / 0.9 / 0.6`。
- 那组「不按顺序」的延迟值得单独体会：它让四个面**分两批**动作，是折纸感的来源。
