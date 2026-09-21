---
title: 横向吸附画廊
slug: scroll-snap-gallery
category: 布局
tags: [吸附, 横向滚动, 画廊]
since: 2026-09
source: 机制来自 CSS Scroll Snap，自行实现
when: 一排卡片横滑时每一张都停在正中，而不是停在任意位置
stage: grid
tier: core
params:
  - { name: card, label: 卡片宽度, type: range, min: 100, max: 280, step: 10, default: 160, unit: px }
---

## 描述

横着滑一排卡片，松手时总有一张正好停在中间，边缘还露出前后半张。

机制是 ==`scroll-snap-type` 定在容器上、`scroll-snap-align` 定在子项上==。浏览器在滚动结束时把最近的吸附点对齐到容器边缘。它和滚动驱动的动画配合，还能做出「当前是第几张」的指示器，不需要监听滚动。

关键是**露出的半张**：它是「还能继续滑」的唯一提示。

## 代码

```html
<div class="sg">
  <div class="sg-card">一</div>
  <div class="sg-card">二</div>
  <div class="sg-card">三</div>
  <div class="sg-card">四</div>
  <div class="sg-card">五</div>
</div>
```

```css
.sg {
  display: flex;
  gap: 12px;
  width: min(400px, 84vw);
  overflow-x: auto;
  padding: 4px 0 12px;
  /* @mechanism 容器上声明吸附轴与严格程度 */
  scroll-snap-type: x mandatory;
  scrollbar-width: thin;
}

.sg-card {
  /* @mechanism 子项声明对齐到哪条边 */
  scroll-snap-align: center;
  flex: 0 0 var(--card, 160px);
  display: grid;
  place-items: center;
  height: 150px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.5);
  font: 600 22px/1 system-ui, sans-serif;
  color: #1c1a17;
}
```

## 边界

- `scroll-snap-type` 必须写在**容器**上、`scroll-snap-align` 在**子项**上。写反了两边都不生效，也不报错。
- `mandatory` 是强制吸附（一定要停在某个点），`proximity` 是接近才吸附。**长内容用 `mandatory` 会很难受**：它不允许你停在两张卡片之间，用户无法浏览中间的过渡内容。
- 吸附点对齐的是容器的 `start`/`center`/`end`。`center` 需要在容器两侧留出内边距，否则第一张与最后一张永远无法居中。
- `scroll-padding` 决定「容器的哪条边」算对齐基准。有固定表头或 padding 时必须设它，否则卡片会被压在表头下面。
- 横向滚动容器要避免让整个页面也跟着横滑。`overscroll-behavior-x: contain` 能阻止滚动链传递到父级。
- 触屏上惯性滑动与吸附的配合很好，鼠标滚轮横向滚动则依赖设备（多数鼠标没有横向滚轮），需要有可见的滚动条或拖拽支持。

## 备注

- 让最后一张卡片露出半张（给容器加内边距或者给卡片一个更窄的 `flex-basis`）是「还能滑」的关键提示。
- 同一机制竖着用就是「整屏分页」——`scroll-snap-type: y mandatory` 加 `height: 100vh` 的子项。
