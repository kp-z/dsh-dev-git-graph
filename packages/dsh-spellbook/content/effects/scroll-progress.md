---
title: 滚动驱动进度条
slug: scroll-progress
category: 动效
tags: [scroll-driven, sticky, 进度, 滚动]
since: 2026-09
source: 机制来自 CSS Scroll-driven Animations 规范，自行实现
when: 一条进度条要跟着滚动位置长出来，但不想监听 scroll 事件
stage: dark
tier: candidate
params:
  - { name: thick, label: 条粗, type: range, min: 2, max: 16, step: 1, default: 5, unit: px }
---

## 描述

往下滚，顶上的条跟着变长，滚到底正好走满一整条。

机制是 ==animation-timeline: scroll()==。动画的进度不再由时间驱动，而是由滚动位置驱动：滚到 0% 就是关键帧的 0%，滚到底就是 100%。没有 `scroll` 事件、没有 `requestAnimationFrame`，浏览器在合成器上直接算——所以滚动时不会掉帧。

## 代码

```html
<div class="sp">
  <i class="sp-bar"></i>
  <div class="sp-body">
    <p>往下滚，顶部的条会长出来。</p>
    <p>它的长度就是滚动进度。</p>
    <p>整段没有任何 JavaScript。</p>
    <p>也没有监听 scroll 事件。</p>
    <p>滚到底，条正好走满。</p>
    <p>再滚回去，它会退回去。</p>
    <p>——到这里就到底了。</p>
  </div>
</div>
```

```css
.sp {
  position: relative;
  width: min(460px, 84vw);
  height: min(320px, 54vh);
  overflow-y: auto;
  border: 1px solid rgb(255 255 255 / 0.18);
  background: rgb(0 0 0 / 0.28);
  font: 400 15px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.sp-bar {
  position: sticky;
  top: 0;
  display: block;
  height: var(--thick, 5px);
  background: #b4462f;
  transform-origin: left center;
  animation: sp-grow linear both;    /* @mechanism 由滚动位置驱动 */
  animation-timeline: scroll(nearest);
}

.sp-body {
  padding: 18px 20px 24px;
}

.sp-body p {
  margin: 0 0 14px;
}

@keyframes sp-grow {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
```

## 边界

- **Safari 与 Firefox 目前还不支持**（Chromium 115+ 才有）。不支持的浏览器会把它当成普通动画：时长缺省、时间线不成立，结果是条静止不动——不报错，所以线上很难发现。上线前要包一层 `@supports (animation-timeline: scroll())`。
- `scroll(nearest)` 找的是最近的**可滚动祖先**。条必须在滚动容器内部（这里靠 `position: sticky` 留在顶部），放到容器外面时间线永远是 0。
- 进度用 `transform: scaleX()` 而不是 `width`。`width` 每帧都要重排，滚动时正好是最不能重排的时候。
- `animation-duration` 必须写成 `auto` 或不写——写了具体秒数就不再是滚动驱动了，那是回退行为。

## 备注

- `scroll(root)` 查的是整个页面，`scroll(self)` 查元素自己滚动。写错时现象都是「进度一直是 0」。
- 同一套时间线也能驱动 `opacity`，做「滚到才淡入」的入场也用它，比 IntersectionObserver 省一半代码。
