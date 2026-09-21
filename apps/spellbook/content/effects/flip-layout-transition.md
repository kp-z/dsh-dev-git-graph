---
title: 布局变化的平滑过渡
slug: flip-layout-transition
category: 动效
tags: [视图过渡, 布局, 快照]
since: 2026-09
source: 机制来自 View Transitions API，自行实现
when: 点一下要在两种布局间切换，希望变化是滑过去的而不是瞬间跳
stage: dark
tier: candidate
---

## 描述

点一下，一排卡片换个排法，每张卡片从旧位置滑到新位置。

机制是 ==`startViewTransition()` 在变化前后各截一张快照，再让新旧快照交叉过渡==。浏览器不需要知道你改了什么 CSS，它只是把「之前的样子」和「之后的样子」都画成静态图层，然后做动画。

关键是给元素起 `view-transition-name`：起了名字的元素会被**单独配对**，于是从旧位置滑到新位置，而不是整页淡入淡出。

## 代码

```html
<div class="vt">
  <button class="vt-btn" id="sb-vt-btn">换一种排法</button>
  <div class="vt-grid" id="sb-vt">
    <div class="vt-card" style="view-transition-name: c1">一</div>
    <div class="vt-card" style="view-transition-name: c2">二</div>
    <div class="vt-card" style="view-transition-name: c3">三</div>
  </div>
</div>
```

```css
.vt {
  width: min(360px, 82vw);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
}

.vt-btn {
  margin-bottom: 12px;
  padding: 10px 18px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.14);
  font: 500 13px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

.vt-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  transition: none;
}

/* @mechanism 换布局就是换这一段，过渡由浏览器截图完成 */
.vt-grid.is-stacked {
  grid-template-columns: 1fr;
}

.vt-card {
  display: grid;
  place-items: center;
  height: 62px;
  border: 1px solid rgb(180 70 47 / 0.5);
  background: #1b1626;
  font: 600 17px/1 system-ui, sans-serif;
}
```

```js
const btn = document.getElementById('sb-vt-btn')
const grid = document.getElementById('sb-vt')
if (btn && grid && typeof document.startViewTransition === 'function') {
  btn.addEventListener('click', () => {
    // @mechanism 在回调里同步改 DOM，浏览器负责前后快照的过渡
    document.startViewTransition(() => {
      grid.classList.toggle('is-stacked')
    })
  })
}
```

## 边界

- `view-transition-name` 必须**全页唯一**。两个元素同名会让整个过渡直接失效（不是报错，是没动画）——这是它最常见的坑。同一元素在切换前后都保留同一个名字才对。
- DOM 的修改必须发生在传给 `startViewTransition` 的**回调里**。在回调外面改，浏览器截「旧快照」的时机已经过了，过渡看不出变化。
- 它截的是**快照**，不是真实元素。过渡期间页面上的内容不能交互，长过渡会有「按不动」的感觉。
- 默认只有交叉淡入。要「移动」的观感，必须给元素起名字——不起名字时整页一起淡，变化看起来软但不清。
- 支持面还新，且各引擎的默认时长与缓动不同。要一致必须显式写 `::view-transition-group(*)` 的 `animation-duration`。
- 它不是状态机动画：只在 A 到 B 之间过渡，做不出「回到中间态再走」的编排。复杂编排要回到关键帧。

## 备注

- 用 `@view-transition { navigation: auto }` 还能把它用到跨页面跳转上，机制一样。
- 配 prefers-reduced-motion 关掉它，否则对敏感人群就是不必要的大幅位移。
