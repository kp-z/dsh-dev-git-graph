---
title: 依次入场
slug: stagger-enter
category: 动效
tags: [入场, 延迟, 交错]
since: 2026-09
source: 机制来自 CSS Animations 的 animation-fill-mode，自行实现
when: 一列元素要一个个出现，而不是同时冒出来
stage: plain
tier: core
params:
  - { name: step, label: 间隔, type: range, min: 20, max: 300, step: 10, default: 90, unit: ms }
---

## 描述

一排卡片从下方依次升起，一个接一个，不是一起冒出来。

机制是 ==递增的 animation-delay 配 animation-fill-mode: both==。`both` 让元素在延迟期间就保持住关键帧的起始状态（透明、位移），所以它不会先以最终样子闪一下再重播。这是**正**延迟的正当用法——与「负延迟错相」正好相反：那里是要相位偏移，这里要的就是等待。

## 代码

```html
<div class="se">
  <article class="se-card">一</article>
  <article class="se-card">二</article>
  <article class="se-card">三</article>
  <article class="se-card">四</article>
  <article class="se-card">五</article>
</div>
```

```css
.se {
  display: flex;
  gap: 10px;
  width: min(520px, 84vw);
}

.se-card {
  flex: 1;
  display: grid;
  place-items: center;
  height: 130px;
  background: #efe9dd;
  border: 1px solid rgb(60 48 30 / 0.3);
  font: 600 20px/1 system-ui, sans-serif;
  color: #1c1a17;
  animation: se-rise 0.5s ease both; /* @mechanism both 让元素先保持在起始态 */
}

/* @mechanism 递增延迟 = 依次入场 */
.se-card:nth-child(1) { animation-delay: calc(var(--step, 90ms) * 0); }
.se-card:nth-child(2) { animation-delay: calc(var(--step, 90ms) * 1); }
.se-card:nth-child(3) { animation-delay: calc(var(--step, 90ms) * 2); }
.se-card:nth-child(4) { animation-delay: calc(var(--step, 90ms) * 3); }
.se-card:nth-child(5) { animation-delay: calc(var(--step, 90ms) * 4); }

@keyframes se-rise {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

## 边界

- 漏掉 `animation-fill-mode: both`（或 `backwards`）会先闪一下：延迟期间元素显示的是它**正常的**样子，动画一开始才跳回透明再升起来。
- 延迟是「等待」，元素多了总时长线性增长。20 个元素、每个 90ms 就要等 1.8 秒——超过十来个就该封顶间隔或改用负延迟压缩总时长。
- 动画只走 `opacity` 与 `transform` 才不重排。动 `height`、`margin`、`top` 会每帧重排，一屏元素同时跑会明显卡。
- 这是「页面加载即播」的一次性动画，不是滚动到才播。要按可见性触发得配 `animation-timeline: view()` 或 IntersectionObserver。
- 没有处理 `prefers-reduced-motion`：对前庭敏感的用户，整排元素同时位移会很不舒服。正式项目要把它关掉。

## 备注

- 延迟用 `calc(var(--step) * n)` 表达，改间隔时只动一个地方，不用逐个改数字。
- 入场距离控制在 12–24px 之间最自然。超过 40px 就像在「飞」，注意力会被动画本身抢走。
