---
title: 让离散属性也能过渡
slug: allow-discrete
category: 动效
tags: [离散属性, display, 过渡]
since: 2026-09
source: 机制来自 CSS Transitions 规范的 transition-behavior，自行实现
when: 元素要淡出之后再消失，而不是淡出未完就已经不见
stage: dark
tier: candidate
params:
  - { name: dur, label: 淡出用时, type: range, min: 0.2, max: 2, step: 0.1, default: 0.7, unit: s }
---

## 描述

一块浮层淡出到看不见，然后才从布局里消失——而 `display` 本身是没法平滑变化的。

机制是 ==transition-behavior: allow-discrete==。`display` 这类属性的值没有中间态（只能是 none 或 block），默认不参与过渡。`allow-discrete` 不创造中间值，它的作用是**把切换时机推迟到过渡结束**：过渡期间继续用旧值渲染，走完再切成新值。所以淡出能完整播完。

## 代码

```html
<div class="ad">
  <span class="ad-dot"></span>
  <p>这块浮层靠 allow-discrete 才敢淡出。</p>
</div>
```

```css
.ad {
  width: min(340px, 78vw);
  padding: 20px 22px;
  border: 1px solid rgb(180 70 47 / 0.55);
  background: #1b1626;
  font: 400 15px/1.7 system-ui, sans-serif;
  color: #f0ead9;
  /* @mechanism allow-discrete 让 display 的切换推迟到过渡结束 */
  transition: opacity var(--dur, 0.7s) ease, transform var(--dur, 0.7s) ease,
    display var(--dur, 0.7s) allow-discrete;
  animation: ad-breathe 3.6s ease-in-out infinite;
}

.ad-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 8px;
  border-radius: 50%;
  background: #b4462f;
}

.ad p {
  margin: 8px 0 0;
  opacity: 0.76;
}

@keyframes ad-breathe {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.97);
  }
}
```

## 边界

- `allow-discrete` 不产生中间值。`display` 的「过渡」效果其实是**等待**：光学属性走完，才轮到它切换。别指望 `display` 本身有任何渐变。
- **关闭方向最容易失效。**元素一旦 `display: none` 就不再渲染，动画来不及播。要双向都成立，需要把 `@starting-style` 和它配合起来，或者把会切换到 `none` 的属性放在过渡列表的末尾。
- 各引擎的支持进度不一致，退化的表现是「瞬间消失」——不破版，但动画没了，而且不报错。
- `overlay` 属性（让弹层在过渡期间留在顶层）也是同一招，但只对 popover、dialog 这类顶层元素有意义；写在普通元素上无效。
- 一次过渡里把多个离散属性都加上，容易出现「这个走完那个才开始」的错位，要按实际观感逐个调。

## 备注

- 判断某属性是不是离散的：问它「两个值之间有没有中间值」。`opacity` 有，`display` 没有。
- 同一套机制也是原生弹层做进出动画的正路——`popover` 与 `dialog` 的显隐都是离散切换。
