---
title: 首次出现也能过渡
slug: starting-style-enter
category: 动效
tags: [starting-style, transition, 入场, 容器]
since: 2026-09
source: 机制来自 CSS Transitions Level 2 的 @starting-style，自行实现
when: 元素从隐藏变可见时要淡入，但 transition 死活不触发
stage: plain
tier: core
params:
  - { name: dur, label: 淡入用时, type: range, min: 0.1, max: 1.2, step: 0.05, default: 0.45, unit: s }
---

## 描述

一个一直存在的元素，第一次变得可见时能淡入，而不是硬生生出现。

机制是 ==@starting-style 给元素一个「还没有渲染过时的样式」==。过渡要成立，必须有「旧值」和「新值」两个状态；而元素第一次进入渲染树时没有旧值，两侧都是同一条规则算出来的，于是没得过渡。`@starting-style` 就是补上那个不存在的起点。

## 代码

```html
<div class="ss-item">从隐藏变可见</div>
<div class="ss-item">第二块也一样</div>
<div class="ss-item">每块各自淡入</div>
```

```css
.ss-item {
  width: min(420px, 84vw);
  margin-bottom: 10px;
  padding: 14px 16px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #efe9dd;
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
  transition: opacity var(--dur, 0.45s) ease, transform var(--dur, 0.45s) ease;
  animation: ss-cycle 4s ease infinite;
}

/* @mechanism 补上「还没有渲染过」的那个起点，过渡才有得插值 */
@starting-style {
  .ss-item {
    opacity: 0;
    transform: translateY(-14px);
  }
}

@keyframes ss-cycle {
  0%,
  100% {
    opacity: 1;
    transform: translateY(0);
  }
  50% {
    opacity: 0.25;
    transform: translateY(-6px);
  }
}
```

## 边界

- 它管的是**元素第一次进入渲染树**的那一次。之后再把 `display` 从 `none` 改回来，`@starting-style` 不再参与——那种情况要配 `transition-behavior: allow-discrete`。
- `transition` 必须声明在**元素自己的最终状态**上。写进 `@starting-style` 里面完全不生效，而且不报错。
- 旧浏览器不支持时，元素直接以最终状态出现（没有淡入）。这是可接受的降级，不会破版。
- 起始值一定要和最终值不同，否则无从插值。把两者的 `opacity` 都写成 1，看起来就是「这属性没用」。

## 备注

- 它常和 `hidden` 属性、`content-visibility`、以及 popover/dialog 的显隐一起用——这些都是「元素重新进入渲染」的场景。
- `@starting-style` 可以写在选择器内部，也可以写在顶层配选择器；写在顶层更容易一眼看出它为哪条规则服务。
