---
title: 滚到才播
slug: view-timeline
category: 动效
tags: [scroll-driven, 列表, 入场, 滚动]
since: 2026-09
source: 机制来自 CSS Scroll-driven Animations 的 view()，自行实现
when: 元素滚进视口时才播放动画，不想引入 IntersectionObserver
stage: plain
tier: candidate
params:
  - { name: range, label: 触发进度, type: range, min: 20, max: 100, step: 5, default: 60, unit: % }
---

## 描述

每块内容滚进视口下缘时才开始浮现，滚过头就停在那儿。

机制是 ==animation-timeline: view() 把动画进度绑到元素进入视口的比例上==。动画的驱动源不再是一个时钟，而是滚动位置：元素刚到视口下缘时进度是 0，走到 `animation-range` 指定的位置时是 100%。以前这套需要 `IntersectionObserver` 加类名，现在是纯 CSS。

这里没有 JS，也没有「滚到就播一次」的状态需要记——位置本身就是进度。

## 代码

```html
<div class="vt-scroll">
  <p class="vt-hint">往下滚</p>
  <article class="vt-item">第一块</article>
  <article class="vt-item">第二块</article>
  <article class="vt-item">第三块</article>
  <article class="vt-item">第四块</article>
  <p class="vt-hint">到底了</p>
</div>
```

```css
.vt-scroll {
  width: min(360px, 80vw);
  height: 200px;
  overflow-y: auto;
  padding: 18px;
  background: rgb(255 255 255 / 0.3);
  border: 1px solid rgb(60 48 30 / 0.28);
}

.vt-item {
  margin-bottom: 14px;
  padding: 26px 18px;
  background: #efe9dd;
  border-left: 3px solid #b4462f;
  font: 500 15px/1 system-ui, sans-serif;
  color: #1c1a17;
  animation: vt-rise linear both;
  /* @mechanism 时间轴换成「元素进入视口的比例」 */
  animation-timeline: view();
  /* @mechanism 用进入过程的哪一段 */
  animation-range: entry 12% entry var(--range, 60%);
}

.vt-hint {
  margin: 0 0 12px;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.55);
  text-align: center;
}

@keyframes vt-rise {
  from {
    opacity: 0;
    translate: 0 26px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}
```

## 边界

- 它把驱动源从**时间**换成**滚动位置**：不滚动它就永远停在某一帧，不会自己播完。想要「滚到就播一次然后不管」，得用 `animation-timeline: view()` 配 `animation-fill-mode: both` 并接受它随滚动回退。
- `animation-range` 的区间名要选对。`entry` 是元素进入视口的阶段，`exit` 是离开，`cover` 是全程——用错区间会看到动画在屏幕外就播完了。
- `animation-fill-mode: both` 基本是必需的，否则区间之外元素会回到未动画的状态，出现闪烁。
- 加了 `animation-timeline` 之后，`animation-delay` **不再表示时间**（它按进度算），原来的延迟意图会失效。
- 支持面还不宽。不支持时 `animation-timeline` 被忽略，动画会退化成**按时间播放**——页面一加载全部播一遍，这不算优雅降级。要用 `@supports (animation-timeline: view())` 把整段包起来。

## 备注

- `animation-timeline: scroll()` 是它的兄弟：参照的是**容器**的滚动位置，用来做进度条。
- 同一元素上 `animation-range` 配 `exit` 区间就能做「滚出去时淡出」，不需要第二套规则。
