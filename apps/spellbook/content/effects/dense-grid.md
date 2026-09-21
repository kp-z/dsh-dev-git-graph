---
title: 自动填空的网格
slug: dense-grid
category: 布局
tags: [网格, 密集, 自动放置]
since: 2026-09
source: 机制来自 CSS Grid 的 grid-auto-flow: dense，自行实现
when: 网格里有大小不一的块，不希望大块后面留下空洞
stage: grid
tier: core
---

## 描述

大块占用两个格位，后面的小块会自动回头把大块留下的空洞填上。

机制是 ==grid-auto-flow: dense 允许自动放置算法回头扫描==。默认的 `row` 是「按顺序找下一个能放下的位置」，遇到放不下的就让开、留空；`dense` 让它回头去补前面的洞。这是同一个算法的两种策略，不是一个新特性。

代价很明确：视觉顺序与 DOM 顺序脱钩了。

## 代码

```html
<div class="dg">
  <div class="dg-cell dg-wide">宽</div>
  <div class="dg-cell">1</div>
  <div class="dg-cell">2</div>
  <div class="dg-cell dg-tall">高</div>
  <div class="dg-cell">3</div>
  <div class="dg-cell">4</div>
  <div class="dg-cell dg-wide">宽</div>
  <div class="dg-cell">5</div>
  <div class="dg-cell">6</div>
  <div class="dg-cell">7</div>
</div>
```

```css
.dg {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  /* @mechanism 允许算法回头补前面的空洞 */
  grid-auto-flow: dense;
  grid-auto-rows: 56px;
  gap: 8px;
  width: min(420px, 84vw);
}

.dg-cell {
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 0.46);
  border: 1px solid rgb(60 48 30 / 0.26);
  font: 500 14px/1 system-ui, sans-serif;
  color: #1c1a17;
}

.dg-wide {
  grid-column: span 2;
}

.dg-tall {
  grid-row: span 2;
}
```

## 边界

- 视觉顺序与 DOM 顺序会**不一致**：键盘 Tab 与读屏按 DOM 走，于是焦点会跳来跳去。这是它最实际的代价，无障碍上要慎重评估。
- 它是「尽力填空」，不是「完美排列」。只有当确实存在能放下的项时才会回头补。
- 洞太大、或剩下的项都放不进去时，洞依然留着。
- 必须配 `grid-auto-rows`（或行高定义）才会有不等高的块；只定义列的话所有块一样高，就没有洞可补，`dense` 也就看不出作用。
- 可预测性下降：做入场动画、滚动定位、或者「第 N 个元素」这类逻辑时，视觉位置与索引对不上。

## 备注

- 默认值是 `grid-auto-flow: row`。加 `dense` 之前先确认你真的愿意牺牲顺序——它治的是洞，不是排布难看。
- `column dense` 是另一个方向（按列填充并回头补），适合横向滚动的看板。
