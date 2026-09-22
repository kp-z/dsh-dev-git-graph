---
title: 逐字揭示
slug: text-reveal
category: 动效
tags: [custom-property, keyframes, 标题, 入场]
since: 2025-09
source: 自行实现
when: 想让一句标题一个字一个字浮上来，而不是整段淡入
stage: dark
tier: core
params:
  - { name: stagger, label: 字间隔, type: range, min: 0, max: 160, step: 5, default: 45, unit: ms }
  - { name: rise, label: 上浮距离, type: range, min: 0, max: 48, step: 1, default: 18, unit: px }
---

## 描述

标题从左到右一个字一个字浮起来，前面的字先落地，后面的跟上。

机制是 ==给每个字一个序号变量，延迟用 CSS 的 calc 算出来==。延迟不是 JS 一个个设的定时器，只是一个 `calc(var(--i) * var(--stagger))`——所以改节奏只要动一个数，而且整段动画由合成器统一跑，不会因为字多而抖。

## 代码

```html
<p class="reveal">一句话带来一个效果</p>
```

```css
.reveal {
  font: 600 34px/1.5 system-ui, sans-serif;
  color: #f2f2f0;
  letter-spacing: 0.02em;
}

.reveal span {
  display: inline-block;
  opacity: 0;
  transform: translateY(var(--rise, 18px));
  animation: letter-rise 640ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  animation-delay: calc(var(--i) * var(--stagger, 45ms)); /* @mechanism */
}

@keyframes letter-rise {
  to {
    opacity: 1;
    transform: none;
  }
}
```

```js
const target = document.querySelector('.reveal')
const text = target.textContent
target.textContent = ''

Array.from(text).forEach((char, index) => {
  const span = document.createElement('span')
  // 空格在 inline-block 里会塌掉，换成不换行空格
  span.textContent = char === ' ' ? '\u00a0' : char
  span.style.setProperty('--i', index) // @mechanism
  target.append(span)
})
```

## 边界

- 只适合短标题。拆字会把整句变成一个个 `inline-block`，**中英文混排的换行行为跟着变**：原本能在词中断行的地方，现在只能按字断，长段落会碎得很难看。
- 拆成字之后，屏幕阅读器会一口气读成乱码般的停顿。必须给整句加 `aria-label`，否则读屏用户听不到一句完整的话。
- 没有处理 `prefers-reduced-motion`，逐字延迟在敏感用户那里就是一连串闪烁。

## 备注

- 字间隔乘上字数才是总时长。20 个字、间隔 45ms，最后一个字要等 900ms 才开始动。
