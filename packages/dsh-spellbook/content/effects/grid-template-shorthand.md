---
title: 网格简写与它的重置
slug: grid-template-shorthand
category: 布局
tags: [grid, 容器, 导航]
since: 2026-10
source: 机制来自 CSS Grid 规范的 grid-template 简写及其重置行为，自行实现
when: 行列定义都简单，想在一行里写完，又需要顺便给网格线起名字
stage: grid
tier: core
---

## 描述

一份侧栏加两块面板的版式，用一句话写完，顺便给六条网格线都起了名字。

机制是 ==grid-template 简写按「行 / 列」的顺序赋值，并把 grid-auto-* 与 grid-template-areas 一并重置为初始值==。它要能完整表达「显式轨道 + 命名网格」这一整套，所以规范让它把这些相关属性全部接管。于是写简写之后，前面设的 `grid-auto-flow: dense`、`grid-auto-rows` 会**无声消失**——不报错，只是失效。

顺序也反直觉：属性名是 `grid-template-rows` 在前，但简写里斜杠的左边是行、右边是列，而线名可以贴在任意一条轨道的前后。左列的固定宽度、右列的弹性、两行等高，一句话里都有了。

## 代码

```html
<div class="gt">
  <div class="gt-side">侧栏</div>
  <div class="gt-main">主区</div>
  <div class="gt-foot">底部信息</div>
</div>
```

```css
.gt {
  display: grid;
  /* @mechanism 简写顺序是「行 / 列」，线名可贴在任意轨道前后 */
  grid-template:
    [top] 68px
    [mid] 68px
    [bot] / [left] 96px
    [split] 1fr
    [right];
  gap: 8px;
  width: min(440px, 88vw);
  font: 500 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.gt > * {
  display: grid;
  place-items: center;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.44);
}

/* @mechanism 按线名定位：top 到 bot 是两行，left 到 split 是第一列 */
.gt-side {
  grid-area: top / left / bot / split;
  background: #efe9dd;
}

/* @mechanism 第二列被两块面板上下分掉，靠的就是 mid 这条中间线 */
.gt-main {
  grid-area: top / split / mid / right;
}

.gt-foot {
  grid-area: mid / split / bot / right;
  font-size: 11px;
  opacity: 0.7;
}
```

## 边界

- **顺序反直觉。**斜杠左边是行、右边是列，而习惯上先写 rows。写反了不会报错，只会得到一个转置的布局——行列数不同时最难发现，因为画面看起来「还挺像对的」。
- 简写会重置 `grid-auto-rows`、`grid-auto-columns`、`grid-auto-flow`、`grid-template-areas`。典型事故是上一行写了 `grid-auto-flow: dense`、下面又写 `grid-template`，dense 被清掉、空洞又回来了。要共存就得**简写在前、细项在后**。
- 一旦简写里出现区域字符串，行部分就整体变成「区域图」形式：每一行必须是一个字符串（后面可选跟一个轨道高度），不能一半字符串一半裸长度。`grid-template: "a" 1fr 100px / 1fr` 无效，因为 `100px` 前面没有字符串。
- 斜杠两侧的线名不能只写一半。`[left] 96px [split] 1fr` 后面省的 `[right]` 是最后一条线，不写就等于它没有名字——想要这个名字必须显式写出来，否则 `grid-area` 里引用 `right` 会静默退回自动放置。
- 只有一维需求（一排或一列）时别用简写。`grid-template-columns: 1fr 1fr` 更明确，也不会误伤 auto 属性。

## 备注

- 排查「我的 `grid-auto-flow: dense` 没生效」时，第一件事是看同一个规则里有没有 `grid-template` 或 `grid` 简写——它们会重置它。
- `grid` 简写比 `grid-template` 更狠：连 `gap` 都会一并重置。不确定时用 `grid-template`，别用 `grid`。
