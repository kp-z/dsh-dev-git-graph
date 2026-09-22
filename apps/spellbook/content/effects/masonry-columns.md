---
title: 多列瀑布流
slug: masonry-columns
category: 布局
tags: [multi-column, 卡片, 列表]
since: 2026-09
source: 机制来自 CSS Multi-column Layout，自行实现
when: 一组高矮不一的卡片要紧凑排成几列，不留大洞
stage: plain
tier: core
params:
  - { name: col, label: 列宽下限, type: range, min: 100, max: 240, step: 10, default: 150, unit: px }
---

## 描述

几张高矮不一的卡片排成三列，每列自己往下接，底部基本齐平。

机制是 ==columns 把内容切进若干列，浏览器按高度去均衡==。这不是 grid——grid 里同一行的卡片高度是统一的，做不出参差。多列布局的均衡是浏览器算的，不需要 JS 测高度。

代价在阅读顺序上：列是**先填满一列再填下一列**，不是从左往右逐行。

## 代码

```html
<div class="mc">
  <article class="mc-card">一<br />短</article>
  <article class="mc-card mc-tall">二<br />高一些<br />再高一点</article>
  <article class="mc-card">三</article>
  <article class="mc-card mc-tall">四<br />也高</article>
  <article class="mc-card">五</article>
  <article class="mc-card">六</article>
</div>
```

```css
.mc {
  /* @mechanism 列数自适应，浏览器按高度均衡分配 */
  columns: var(--col, 150px);
  column-gap: 12px;
  width: min(500px, 86vw);
}

.mc-card {
  /* @mechanism 不加这条，卡片会被从中间劈到两列 */
  break-inside: avoid;
  margin: 0 0 12px;
  padding: 16px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.44);
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.mc-tall {
  padding-bottom: 44px;
}
```

## 边界

- 列是**从上往下填满一列再填下一列**，不是逐行从左到右。阅读顺序是竖着走的——要求按行顺序就不能用它，这是它最硬的限制。
- 每一项必须 `break-inside: avoid`。少了它，一张卡片会被从中间劈开，上半截在一列底部、下半截在另一列顶部。
- 它没有真正的跨列。`column-span` 只有 `all` 和 `none` 两个值，做不出「跨两列」的中间态。
- 均衡是按**高度**算的。最后几项很少时会出现一列明显比其他列短，看着像没排满。
- `overflow: hidden` 或某些 `transform` 会改变断行行为，可能让卡片意外断裂或整体挪到下一列。
- 顺序对读屏友好度不好：DOM 里第 2 项可能视觉上在第 3 项下面。要严格顺序就退回 grid。

## 备注

- `columns` 写单个长度就是「列宽下限」，写两个值（`3 150px`）就是「最多 3 列、且每列不小于 150px」。
- 同一招也是排版里做「多栏正文」的办法，把 `break-inside` 换成 `orphans`/`widows` 的控制即可。
