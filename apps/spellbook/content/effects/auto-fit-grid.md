---
title: 自动填充网格
slug: auto-fit-grid
category: 布局
tags: [grid, 卡片, 列表]
since: 2026-09
source: 机制来自 CSS Grid 规范的 auto-fit 关键字，自行实现
when: 一排卡片要随容器宽度自动增减列数，又不想写一串媒体查询
stage: grid
tier: core
params:
  - { name: min, label: 最小列宽, type: range, min: 80, max: 240, step: 10, default: 140, unit: px }
---

## 描述

列数不用你决定，容器自己算：宽了就多排一列，窄了就少排一列，永远刚好塞满。

机制是 ==repeat(auto-fit, minmax(最小列宽, 1fr))==。浏览器先按最小列宽算出「最多能放几列」，再把剩下的空间用 `1fr` 平分给它们。整个过程没有断点、没有媒体查询，也不需要知道容器有多宽。

## 代码

```html
<ul class="af-grid">
  <li>一</li>
  <li>二</li>
  <li>三</li>
  <li>四</li>
  <li>五</li>
</ul>
```

```css
.af-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--min, 140px), 1fr)); /* @mechanism */
  gap: 10px;
  width: min(620px, 84vw);
  margin: 0;
  padding: 0;
  list-style: none;
}

.af-grid li {
  display: grid;
  place-items: center;
  min-height: 78px;
  border: 1px solid rgb(60 48 30 / 0.35);
  background: rgb(255 255 255 / 0.42);
  font: 500 15px/1 system-ui, sans-serif;
  color: #1c1a17;
}
```

## 边界

- `auto-fit` 会把空轨道折叠掉，所以**只剩一个子项时它会拉满整行**。想让它保持最小列宽，换 `auto-fill`（保留空轨道）或给子项加 `max-width`。
- `minmax()` 里的最小值别用百分比或 `fr`——在自动填充里百分比相对容器计算，会自我放大成无限宽；用固定长度或 `min()`。
- 子项数量少于算出来的列数时才看得出 `auto-fit` 与 `auto-fill` 的差别，只测「刚好填满」的用例会把两者测成一样。

## 备注

- `gap` 会参与列宽计算，所以实际列宽不是「容器宽度 ÷ 列数」，而是先扣掉间隙再平分。
- 不要同时给子项写 `width`：`1fr` 已经把宽度定死了，两者打架时以 `fr` 为准，容易看错。
