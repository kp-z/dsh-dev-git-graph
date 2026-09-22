---
title: 列优先的网格流
slug: grid-auto-flow-column
category: 布局
tags: [自动放置, 列方向, 看板]
since: 2026-10
source: 机制来自 CSS Grid 的 grid-auto-flow: column，自行实现
when: 元素要竖着先填一列再填下一列，像看板的泳道
stage: grid
tier: core
---

## 描述

六个元素排成三列，但顺序是竖着走的：1、2 在第一列，3、4 在第二列。列数固定，行数由元素个数自己长出来。

机制是 ==grid-auto-flow: column 把自动放置的方向从「逐行」换成「逐列」==。默认的 `row` 是填满第 1 行再填第 2 行；换成 `column` 后变成填满第 1 列再开第 2 列。默认只定义了三列，多出来的元素会自动生成**隐式的行**——这就是「行数不用写」。

这和 `columns`（多列布局）看着像，但完全不是一回事：多列会把元素切开、按高度均衡；网格的列优先是**整块**移动，每个元素完整落在一个格位里。

## 代码

```html
<ul class="gc">
  <li>1</li>
  <li>2</li>
  <li>3</li>
  <li>4</li>
  <li>5</li>
  <li>6</li>
</ul>
```

```css
.gc {
  display: grid;
  /* @mechanism 只定列数，行数由元素个数自己长 */
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, 68px);
  /* @mechanism 自动放置改为逐列填充：竖着先填满一列再开下一列 */
  grid-auto-flow: column;
  gap: 8px;
  width: min(420px, 88vw);
  margin: 0;
  padding: 0;
  list-style: none;
}

.gc li {
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 0.44);
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 600 15px/1 system-ui, sans-serif;
  color: #1c1a17;
}

/* @mechanism 焦点顺序仍按 DOM，视觉顺序已经竖过来了 */
.gc li:first-child {
  border-color: #b4462f;
}
```

## 边界

- 视觉顺序与 DOM 顺序不一致：DOM 里 1-2-3，视觉上 1 在第 1 列、2 在第 1 列下一个。Tab 键与读屏仍按 DOM 走，于是焦点会**竖着跳**。这是它与「堆叠」类布局共同的代价。
- 元素个数不是行数的整数倍时，最后一列会留空。想要补齐得手动塞占位元素，或者接受留白。
- 想让整组**横向溢出并滚动**（真正的看板），要配 `grid-auto-columns` 而不是 `grid-template-columns`：显式的列定义会一直压缩到容器宽度里，撑不出滚动。
- `column dense` 是另一回事：它允许算法回头补洞。普通看板用它会把顺序打得更乱，通常不需要。
- 配 `grid-template-rows` 定死行数时，超出的元素会生成**隐式行**，那部分行高由内容决定。想让隐式行也受控，写 `grid-auto-rows`。

## 备注

- 横向溢出的看板写法：`grid-auto-flow: column; grid-auto-columns: 180px; overflow-x: auto`，此时不要写 `grid-template-columns`——那是「在容器内分列」，与横向滚动互斥。
- 一维的横排（比如一排标签）用 flex 更直接；这里用它是因为要**多行成列**，那正是 flex 不擅长的。
