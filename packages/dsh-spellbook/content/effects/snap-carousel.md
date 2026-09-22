---
title: 吸附轮播
slug: snap-carousel
category: 布局
tags: [scroll-snap, 卡片, 拖拽, 滚动]
since: 2026-09
source: 机制来自 CSS Scroll Snap 规范，自行实现
when: 横向滑动一排卡片，松手后要自己停在整张上，不要停在两张之间
stage: grid
tier: core
params:
  - { name: item, label: 卡片宽度, type: range, min: 40, max: 90, step: 2, default: 68, unit: % }
---

## 描述

手指松开后，卡片自己往最近的整张上吸一下，停在恰好对齐的位置。

机制是 ==滚动容器声明 scroll-snap-type，子项声明 scroll-snap-align==。吸附由浏览器在滚动结束时完成，没有 JS、不监听 `scroll`、不计算偏移量。滑起来还保留原生滚动的惯性手感——这是用 transform 手写轮播永远做不出来的。

## 代码

```html
<div class="snap">
  <article class="snap-card"><b>一</b><span>松手吸住</span></article>
  <article class="snap-card"><b>二</b><span>停在整张</span></article>
  <article class="snap-card"><b>三</b><span>惯性还在</span></article>
  <article class="snap-card"><b>四</b><span>没有 JS</span></article>
</div>
```

```css
.snap {
  display: flex;
  gap: 10px;
  width: min(560px, 84vw);
  overflow-x: auto;
  scroll-snap-type: x mandatory; /* @mechanism 吸附发生在滚动容器上 */
  overscroll-behavior-x: contain;
  padding: 12px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.3);
}

.snap-card {
  flex: 0 0 var(--item, 68%);
  scroll-snap-align: center; /* @mechanism 吸附位置写在子项上 */
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  height: 180px;
  border: 1px solid rgb(60 48 30 / 0.32);
  background: #efe9dd;
  font: 400 14px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.snap-card b {
  font: 600 26px/1 system-ui, sans-serif;
}
```

## 边界

- `mandatory` 会强制每次滚动都吸附，滚轮或触控板精细滚动时会被「抢走」——内容比容器窄或需要停在中间位置时改用 `proximity`。
- 要配 `overscroll-behavior-x: contain`，否则滑到头会触发浏览器的后退手势，整页跳走。
- `scroll-snap-type` 必须写在**滚动容器**上、`scroll-snap-align` 写在**子项**上。写反了整条规则静默失效。
- 子项上的 `scroll-snap-stop: always` 才能防止一次滑动跳过好几张，默认是允许跳过的。

## 备注

- `scroll-padding` 能控制吸附时留出的内边距，做「卡片左边缘对齐」比给子项加 margin 干净。
- 整块滚动的动画不需要 `scroll-behavior: smooth`——那是给程序化滚动用的，手指滑动本来就带惯性。
