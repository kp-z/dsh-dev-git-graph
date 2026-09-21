---
title: 按下扩散的波纹
slug: press-ripple
category: 交互
tags: [点击, 波纹, 伪元素]
since: 2026-09
source: 自行实现
when: 按钮按下去要有一圈从中间荡开的光，像水面
stage: dark
tier: core
params:
  - { name: dur, label: 扩散用时, type: range, min: 0.2, max: 1, step: 0.05, default: 0.5, unit: s }
---

## 描述

按住按钮的瞬间，一圈光从中间荡开然后散掉。

机制是 ==把动画挂在 :active 上，每次「从没按到按下」都会重新触发一次==。`:active` 是一个瞬时状态，它在 false → true 的那一帧让浏览器重新开始这条动画。不需要 JS，也不需要「撤销/重播」的状态管理。

波纹本身是一个径向渐变的伪元素，从中心向外扩、同时淡出。

## 代码

```html
<button class="pr">按住试试</button>
```

```css
.pr {
  position: relative;
  overflow: hidden;
  padding: 15px 30px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.12);
  font: 500 15px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

.pr::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 50%, rgb(255 240 200 / 0.65), transparent 62%);
  transform: scale(0);
  opacity: 0;
  /* @mechanism 波纹自己不该吃掉指针事件 */
  pointer-events: none;
}

/* @mechanism 动画挂在 :active 上，每次按下重新触发 */
.pr:active::after {
  animation: pr-spread var(--dur, 0.5s) ease-out;
}

@keyframes pr-spread {
  0% {
    transform: scale(0);
    opacity: 0.9;
  }
  100% {
    transform: scale(2.6);
    opacity: 0;
  }
}
```

## 边界

- 动画挂在 `:active` 上，只在「从非按下变成按下」那一次触发。**按住不放不会重播**，快速连点若中间没松开也不会重播。
- 伪元素要 `pointer-events: none`。少了它，伪元素盖住按钮后 `:active` 本身可能收不到，波纹变得时有时无。
- 它只能从**中心**扩散。真正的「从指尖扩散」需要 JS 把点击坐标写进 CSS 变量——纯 CSS 做不到。
- 波纹完成后必须以 `opacity: 0` 收尾，否则伪元素会一直留着，挡住按钮自己的悬停效果。
- `:active` 在触屏上同样会触发（触摸即按下），表现基本一致；但触屏上手指按住的感知不同，波纹时长可以更短。
- 页面若设了 `user-select: none` 之类的规则，长按 `:active` 的行为在各平台上有差异，需要真机确认。

## 备注

- 同一招可以给「按下」加缩放反馈，只要把关键帧里的 `scale` 改成从 1 到 1.04——机制不变。
- 波纹颜色用主题色的浅色版，比纯白柔和，深色主题上尤其明显。
