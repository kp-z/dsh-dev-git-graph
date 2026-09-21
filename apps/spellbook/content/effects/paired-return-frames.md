---
title: 进出各写一套关键帧
slug: paired-return-frames
category: 动效
tags: [关键帧, 回程, 缓动]
since: 2026-09
source: miniMAC/magic（MIT） — slideDown / slideDownReturn 的成对命名法，改写为独立最小示例
when: 元素进场和退场都想有自己的缓动，但不想写两份重复的位移
stage: dark
tier: core
---

## 描述

一块板子滑进来用减速、滑出去用加速——两个方向的手感不一样。

机制是 ==给「进入」和「退出」各自命名一套关键帧，而不是把其中一个用 reverse 播==。`animation-direction: reverse` 会把**缓动也一起反转**：本来「减速进场」的曲线，反着播就成了「加速退场」。物理上不对，观感也别扭。

共用位移量、分开命名与缓动，是这个问题的正解。

## 代码

```html
<div class="pair-stage">
  <div class="pair-card">
    <b>进出各一套</b>
    <span>减速进来，加速出去</span>
  </div>
</div>
```

```css
.pair-stage {
  display: grid;
  place-items: center;
  width: min(320px, 80vw);
  height: 200px;
  background: #0a0810;
  overflow: hidden;
  --travel: 160px;
}

.pair-card {
  display: grid;
  gap: 5px;
  place-items: center;
  padding: 18px 24px;
  border: 1px solid rgb(217 164 65 / 0.4);
  background: #1b1626;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
  /* @mechanism 退场用自己那套关键帧与缓动，不是把进场反着播 */
  animation: pair-out 1.1s cubic-bezier(0.5, 0, 0.9, 0.4) infinite alternate;
}

.pair-card b {
  font-size: 16px;
}

@keyframes pair-in {
  from {
    opacity: 0;
    transform: translateY(var(--travel));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* @mechanism 同一段位移，单独一套缓动 */
@keyframes pair-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(calc(var(--travel) * -1));
  }
}
```

## 边界

- `animation-direction: reverse` 反转的是**整条时间轴**，包括缓动。所以「减速进场」反着播会变成「加速退场」，与想要的正相反。
- 这不是「非要写两遍」的问题：位移量可以放进 CSS 变量共享，需要分开的只有**关键帧的名字与缓动**。两处硬编码位移才是真的重复。
- 两套关键帧要**同步维护**。改了一个忘了另一个，进出就会不对称——这是这套命名法的主要代价。
- 要保留终态得配 `animation-fill-mode: both`，否则动画结束后元素会弹回未动画的状态。
- 用 `translateY` 而不是 `top`：后者每帧触发布局重算，而且位移量的计算基准更容易出错。
- 带 `alternate` 时两套关键帧会交替播放（这里是演示用）；真实场景通常由类名切换触发其中一套。

## 备注

- 原实现在 miniMAC/magic（MIT） 里是一整套成对命名：`slideDown` / `slideDownReturn`、`puffIn` / `puffOut`、`openDownLeft` / `openDownLeftOut` / `openDownLeftReturn`。
- 「进场与退场用不同缓动」是动效设计里的基本原则——进场要快、退场要更快，或者反过来。reverse 做不到这件事。
