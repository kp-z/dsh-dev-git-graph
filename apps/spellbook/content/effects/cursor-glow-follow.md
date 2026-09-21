---
title: 跟着指针的光晕
slug: cursor-glow-follow
category: 交互
tags: [指针, 光晕, 变量桥]
since: 2026-09
source: 自行实现
when: 一块面板上有一团光跟着鼠标走，但不想让脚本管样式
stage: dark
tier: core
---

## 描述

一团暖光跟着指针在面板上走，鼠标离开就淡掉。

机制是 ==JS 只做一件事：把指针位置写进 CSS 变量==。光晕的大小、颜色、模糊、淡入淡出全部由 CSS 负责。脚本与样式之间只有一个极窄的接口（两个变量），改视觉完全不用碰脚本。

这也是把「高频事件」变便宜的办法：脚本不做样式计算，只写变量。

## 代码

```html
<div class="cg" id="sb-cg">
  <b>指针光晕</b>
  <span>把鼠标移进来</span>
</div>
```

```css
.cg {
  position: relative;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  width: min(340px, 80vw);
  height: 190px;
  overflow: hidden;
  background: #0d0a14;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
}

.cg::before {
  content: "";
  position: absolute;
  /* @mechanism 位置全部来自 JS 写进来的两个变量 */
  left: var(--mx, 50%);
  top: var(--my, 50%);
  width: 230px;
  height: 230px;
  translate: -50% -50%;
  background: radial-gradient(circle, rgb(217 164 65 / 0.4), transparent 66%);
  opacity: 0;
  transition: opacity 0.3s ease;
  /* @mechanism 光晕不能吃掉底下的悬停与点击 */
  pointer-events: none;
}

.cg:hover::before {
  opacity: 1;
}

.cg b,
.cg span {
  position: relative;
  z-index: 1;
}
```

```js
const panel = document.getElementById('sb-cg')
if (panel) {
  panel.addEventListener('pointermove', (event) => {
    // 只写变量，样式一律交给 CSS
    panel.style.setProperty('--mx', event.offsetX + 'px')
    panel.style.setProperty('--my', event.offsetY + 'px')
  })
  panel.addEventListener('pointerleave', () => {
    panel.style.removeProperty('--mx')
    panel.style.removeProperty('--my')
  })
}
```

## 边界

- `pointermove` 每秒能触发上百次。直接改 `left` / `top` 会每帧触发布局重算；写成 CSS 变量并让位移走 `translate`（合成器）便宜得多。
- 光晕层必须 `pointer-events: none`，否则它会吃掉底下所有的悬停与点击——现象是「面板上的东西点不动」。
- 要监听 `pointerleave` 把光晕复位/淡掉。不做这一步时，它会停在鼠标最后离开的那个位置。
- 用 `event.offsetX` 省掉了 `getBoundingClientRect()`，也顺带绕开了「滚动后 rect 过期」的问题。用 `clientX` 就得每次重新读 rect。
- 触屏没有指针移动，这套完全无效。必须准备一个静态的等价外观。
- 它没有处理 `prefers-reduced-motion`。跟随类效果对敏感人群不友好，正式项目里应当退化成不跟随的静态光。

## 备注

- 这个「JS 写变量、CSS 画效果」的分工可以套在任何指针跟随效果上（倾斜、聚光、描边跟随）。
- 阈值节流不划算：写 CSS 变量本身很便宜，节流反而会让光晕一顿一顿。真要省就该换成 CSS 的 `translate` 位移而不是改 `left`。
