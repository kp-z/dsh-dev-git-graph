---
title: 逐字打出
slug: steps-typing
category: 动效
tags: [steps, 打字机, 时序函数]
since: 2026-09
source: 机制来自 CSS Easing Functions 的 steps()，自行实现
when: 一行字要一个字一个字出现，像有人在打
stage: plain
tier: core
params:
  - { name: chars, label: 字数, type: range, min: 4, max: 20, step: 1, default: 14 }
  - { name: dur, label: 用时, type: range, min: 0.6, max: 5, step: 0.2, default: 2.4, unit: s }
---

## 描述

文字从左到右一个字一个字冒出来，末尾还跟着一个闪烁的光标。

机制是 ==steps() 把连续动画量化成 N 段离散跳动==。宽度本来会平滑增长，但 `steps(14)` 把它切成 14 跳——每跳正好一个字宽，于是看起来是「打出来」而不是「拉开」。打字机感全部来自这个「离散」，跟内容无关。

## 代码

```html
<div class="ty">
  <span class="ty-text">咒语书·逐字打出</span>
</div>
```

```css
.ty {
  display: flex;
  align-items: center;
  font: 400 20px/1.5 ui-monospace, "SF Mono", Menlo, monospace;
  color: #1c1a17;
}

.ty-text {
  display: inline-block;
  overflow: hidden;
  white-space: nowrap;
  width: 0;
  /* @mechanism steps 把宽度量化成离散跳动，打字感就来自这里 */
  animation: ty-type var(--dur, 2.4s) steps(var(--chars, 14)) forwards;
  border-right: 2px solid #b4462f;
  /* 光标闪烁是第二个动画，必须分开写，否则简写会互相覆盖 */
  animation-name: ty-type, ty-caret;
  animation-duration: var(--dur, 2.4s), 0.9s;
  animation-timing-function: steps(var(--chars, 14)), step-end;
  animation-iteration-count: 1, infinite;
  animation-fill-mode: forwards, none;
}

@keyframes ty-type {
  to {
    width: calc(var(--chars, 14) * 1ch);
  }
}

@keyframes ty-caret {
  50% {
    border-color: transparent;
  }
}
```

## 边界

- 必须用 `steps()`。换成 `linear` 宽度会连续增长，看到的是元素被「拉开」，完全不像在打字。
- `steps(n)` 的 n 要与字数一致，宽度单位用 `ch`。两者对不上就会吞字（`n` 偏小）或打完之后还空着一段（`n` 偏大）。
- `ch` 是「0」这个字符的宽度，只在等宽字体下近似一个字宽。**中英混排时汉字与 `ch` 不相等**，会提前或滞后结束——要求精确就按实际字数算宽度。
- `white-space: nowrap` 不能少。少了它文本会换行，宽度动画就失去意义了。
- 两个动画要分开写完整属性。用 `animation` 简写只会保留最后一个，光标或打字效果会有一个不生效。
- 动画结束后的状态靠 `forwards` 保持。少了它，打完的瞬间文字会缩回宽度 0。

## 备注

- 光标用 `border-right` 而不是伪元素，省一层结构；缺点是无法单独控制它的垂直位置。
- 真需要「一个字一个字出现、且换行正常」时，纯 CSS 的宽度动画会失效——那是必须上 JS 的场景，别硬撑。
