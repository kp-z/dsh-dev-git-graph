---
title: 负延迟造波
slug: neg-delay-wave
category: 动效
tags: [keyframes, transform, 加载, 自动]
since: 2026-09
source: 机制取自 SpinKit（MIT）的 sk-wave，自行实现
when: 一排元素要依次动起来，形成波浪，但只想写一套关键帧
stage: plain
tier: core
params:
  - { name: dur, label: 一个周期, type: range, min: 0.4, max: 3, step: 0.1, default: 1.1, unit: s }
---

## 描述

五根柱子依次起伏，走过去像一道波。但整段关键帧只有一份。

机制是 ==把 animation-delay 写成负数==。负延迟不是「等一会儿再开始」，而是「这段动画假装已经跑了这么久」——于是每个元素都从同一套关键帧的不同位置上开始，彼此错开相位。用正延迟的话第一轮会先集体静止等待，看起来像卡住了。

## 代码

```html
<div class="nd">
  <span></span>
  <span></span>
  <span></span>
  <span></span>
  <span></span>
</div>
```

```css
.nd {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 84px;
}

.nd span {
  width: 11px;
  height: 100%;
  background: #b4462f;
  transform-origin: center;
  animation: nd-wave var(--dur, 1.1s) ease-in-out infinite; /* @mechanism 一套关键帧 */
}

/* @mechanism 负数延迟 = 相位偏移，不用拆成五套关键帧 */
.nd span:nth-child(1) { animation-delay: calc(var(--dur, 1.1s) * -0.00); }
.nd span:nth-child(2) { animation-delay: calc(var(--dur, 1.1s) * -0.12); }
.nd span:nth-child(3) { animation-delay: calc(var(--dur, 1.1s) * -0.24); }
.nd span:nth-child(4) { animation-delay: calc(var(--dur, 1.1s) * -0.36); }
.nd span:nth-child(5) { animation-delay: calc(var(--dur, 1.1s) * -0.48); }

@keyframes nd-wave {
  0%,
  40%,
  100% {
    transform: scaleY(0.35);
  }
  20% {
    transform: scaleY(1);
  }
}
```

## 边界

- 负延迟只有在**循环闭合**的关键帧上才成立。首尾不一致时，起点会跳一下——因为这个「已经跑了一半」的动画和真正从头开始的动画对不上。
- 把延迟写成正数是这里最常见的误用：第一轮五个元素会先一起静止不动，等各自的延迟走完才动，看起来像加载卡住。
- 负延迟不能让元素定格。要停在某个状态就用 `animation-play-state: paused` 或 `animation-fill-mode: both`，别靠调延迟硬凑。
- 元素必须真的在动才有相位可言；`display: inline` 的元素上 `transform` 不生效，会表现成「延迟没起作用」。

## 备注

- 这套机制与「旋转的容器里再放一圈脉冲点」叠加起来，就是常见的环形加载器——同一招用两次，代价还是零 JS。
- 错开量取周期的十分之一到九分之一时最像波；超过一半就看不出是一个整体了。
