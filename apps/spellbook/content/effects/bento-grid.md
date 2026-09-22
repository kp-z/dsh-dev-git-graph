---
title: 不对称拼贴板块
slug: bento-grid
category: 布局
tags: [grid, 卡片, 看板]
since: 2026-10
source: 机制来自 CSS Grid 的 grid-template-areas 与不等列宽组合，自行实现
when: 一块概览区要有一张主卡和几张副卡，大小不一但共用一套边线
stage: grid
tier: core
---

## 描述

一块板块区里，主信息占一大格，旁边四张小格围上来，彼此边线完全贯通。它不是「四张卡片排两行」，而是有主次的拼贴。

机制是 ==不等宽的列定义配上同一套行列间距，再用 grid-area 按名字把块挂上去==。拼贴感的来源不是跨格本身，而是**所有块共享同一套轨道线与同一个 gap**：一旦某块的边界落在轨道上、间距又是全局一致的，视觉上就自动读成「一整块被切开的板」。

所以关键是行列数要少（三列两行足够），块的大小差要明确（主块 2×2，副块 1×1），中间不要有半格。

## 代码

```html
<div class="bg">
  <div class="bg-cell bg-main">主图区</div>
  <div class="bg-cell">一</div>
  <div class="bg-cell">二</div>
  <div class="bg-cell">三</div>
  <div class="bg-cell">四</div>
</div>
```

```css
.bg {
  display: grid;
  /* @mechanism 三列两行：轨道少、块差明确，才读成一块板 */
  grid-template-columns: 1.6fr 1fr 1fr;
  grid-template-rows: repeat(2, minmax(0, 92px));
  /* @mechanism 一个 gap 管住所有接缝，是「拼贴感」的来源 */
  gap: 10px;
  width: min(560px, 90vw);
}

.bg-cell {
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: rgb(255 255 255 / 0.46);
  border: 1px solid rgb(60 48 30 / 0.3);
  font: 500 14px/1 system-ui, sans-serif;
  color: #1c1a17;
}

.bg-main {
  /* @mechanism 主块吃掉 2×2，副块自然围上来 */
  grid-column: span 2;
  grid-row: span 2;
  background: #efe9dd;
  font-size: 17px;
}
```

## 边界

- 块的大小差太小就不成立。全是 1×1 只是普通网格；全是 2×2 也没有主次。至少要有 4 倍面积差（2×2 对 1×1）才读得出层级。
- 轨道多了拼贴就散。四列以上、或者出现 1×2 这类半格，视觉上不再像一整块板，而像没对齐的网格——想保留拼贴感，块只跨整列或整行。
- `grid-row: span 2` 依赖行高有定义。行是 `auto` 时，主块的高度由内容决定，它会与副块的行高打架，接缝就会错开——所以这里写 `minmax(0, 92px)` 把行高钉住。
- 密集流 `dense` 在这里是**有害**的：它会把空出来的格位塞上后面的块，主块周围的留白意图被破坏。这个布局要的是秩序，不是填满。
- 块数少于格数时会留空洞。空洞不是错误（拼贴本来可以留白），但要确认它落在你希望的位置，而不是算法随手放的地方。

## 备注

- 用 `grid-template-areas` 写同一块板可读性更好（ASCII 图直接是版式）。这条用轨道是因为主块是 2×2，用区域图要重复写四遍同一个名字。
- 副块数量变化大时，把它们的容器改成 `grid-auto-flow: dense` 的子网格更灵活，但主块要单独 `grid-area` 钉住。
