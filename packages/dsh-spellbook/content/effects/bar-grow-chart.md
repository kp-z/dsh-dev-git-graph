---
title: 条形从底部生长
slug: bar-grow-chart
category: 动效
tags: [transform, keyframes, 图表, 入场]
since: 2026-09
source: 自行实现
when: 图表里的条要在出现时从底部往上长，而不是从中间撑开
stage: plain
tier: core
params:
  - { name: dur, label: 生长用时, type: range, min: 0.3, max: 3, step: 0.1, default: 1.1, unit: s }
---

## 描述

几根条从底部往上长出来，长的长得更久一点。

机制是 ==`scaleY()` 配 `transform-origin: bottom`，让缩放的原点落在底部==。默认原点在中心，直接缩放会让条上下同时变化——看着像在跳，不像在生长。把原点挪到底部，缩放的唯一效果就是「高度在变」。

一个 `transform-origin` 决定了这块东西「以哪里为基准变化」。

## 代码

```html
<div class="bg">
  <div class="bg-col"><span class="bg-bar" style="--h: 42%"></span><b>42</b></div>
  <div class="bg-col"><span class="bg-bar" style="--h: 68%"></span><b>68</b></div>
  <div class="bg-col"><span class="bg-bar" style="--h: 91%"></span><b>91</b></div>
  <div class="bg-col"><span class="bg-bar" style="--h: 57%"></span><b>57</b></div>
</div>
```

```css
.bg {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  width: min(320px, 80vw);
  height: 190px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgb(60 48 30 / 0.34);
  font: 600 12px/1 system-ui, sans-serif;
  color: #1c1a17;
}

.bg-col {
  display: grid;
  justify-items: center;
  gap: 6px;
  height: 100%;
  align-content: end;
}

.bg-bar {
  width: 46px;
  height: var(--h, 50%);
  background: linear-gradient(180deg, #b4462f, #8d3524);
  /* @mechanism 原点挪到底部，缩放才只影响高度 */
  transform-origin: bottom;
  transform: scaleY(0);
  animation: bg-grow var(--dur, 1.1s) cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}

@keyframes bg-grow {
  to {
    transform: scaleY(1);
  }
}
```

## 边界

- `transform-origin: bottom` 是**必需的**。默认的 `center` 会让条从中间往两头长，看起来像弹簧而不是生长。
- `scaleY` 会**拉伸内容**。条里如果有文字，字也会被拉长——正确做法是外层缩放、内容单独放一层并反向缩放（或干脆把标签放在条外面）。
- 用 `height` 做动画会每帧触发布局重算，长列表上明显掉帧。`transform` 走合成器，代价低得多。
- 条长是「数据到尺寸」的映射。用百分比时 `height: 42%` 的基准是**父级的高度**，父级没有明确高度时百分比会失效。
- 数值标签要用等宽数字（`tabular-nums`），否则数字变化时标签自身的宽度会抖，条的位置跟着动。
- 纯粹的装饰性动画应当能被 `prefers-reduced-motion` 关掉——关掉之后条要**直接以最终高度出现**，而不是停在 0（`forwards` 保证了终态，但关动画时要注意这一点）。

## 备注

- 用 `animation-delay` 给每根条错开一点，就有「依次长出来」的节奏——和交错入场是同一套做法。
- 换成 `scaleX` 配 `transform-origin: left` 就是横向条形图，机制完全对称。
