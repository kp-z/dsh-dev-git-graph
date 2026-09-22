---
title: 看不见的行轨道
slug: grid-auto-rows-implicit
category: 布局
tags: [grid, 隐式轨道, auto-rows]
since: 2026-10
source: 机制来自 CSS Grid 规范的隐式轨道与 grid-auto-rows，自行实现
when: 网格里的项数事先不知道，行高不能听天由命，也不能让多出来的行把容器撑破
stage: grid
tier: core
---

## 描述

网格只声明了列，没声明行，往里扔多少项都排得下——但多出来的那些行到底多高，是浏览器替你做的一个决定。

机制是 ==没被显式声明的行由 grid-auto-rows 决定，叫隐式轨道==。`grid-template-rows` 只描述你点名的那几行；一旦子项自动放置溢出到声明范围之外，浏览器就按 `grid-auto-rows` 现造新行。默认值是 `auto`（按内容自适应的最大值），所以「什么都没写」也能跑，只是行高会随内容忽高忽低。

把它设成固定值，所有隐式行就有了统一的尺子；设成 `min-content`，每行收到该行内容的**最小尺寸**，多出来的内容不再把行撑高，而是溢出到网格外——滚动交给容器的 `overflow: auto`，网格自己不会因为行内内容而变高。这两者的差别在行内内容比轨道大时立刻显形：固定值下内容会溢出行框，`min-content` 下行框贴着内容的最窄可能宽度收住。

## 代码

```html
<div class="board">
  <span class="cell">1</span>
  <span class="cell">2</span>
  <span class="cell">3</span>
  <span class="cell cell-tall">4 这一格比别人高，它会把隐式行撑开</span>
  <span class="cell">5</span>
  <span class="cell">6</span>
  <span class="cell">7</span>
</div>

<div class="board board-tight">
  <span class="cell">1</span>
  <span class="cell">2</span>
  <span class="cell cell-tall">4 这一格还是高，但行不再跟着长</span>
  <span class="cell">5</span>
</div>
```

```css
.board {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  /* @mechanism 只声明列；行是自动放置时现造的隐式轨道，由 grid-auto-rows 定尺寸 */
  grid-auto-rows: 60px;
  gap: 8px;
  width: min(320px, 80vw);
  padding: 10px;
  background: rgb(255 255 255 / 0.5);
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 400 12px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

.board-tight {
  /* @mechanism min-content 让隐式行只按内容的最小尺寸收，多出来的部分溢出而不撑高 */
  grid-auto-rows: min-content;
  max-height: 150px;
  overflow: auto;
}

.cell {
  display: grid;
  place-items: center;
  padding: 4px;
  text-align: center;
  background: rgb(60 48 30 / 0.08);
}

.cell-tall {
  align-content: start;
  background: rgb(180 70 47 / 0.16);
}
```

## 边界

- 隐式轨道也会出现在**列**方向：项数超过 `grid-template-columns` 里写的列数时，多出来的列同样由 `grid-auto-columns` 决定。只调 `auto-rows` 解决不了横向溢出。
- `grid-auto-rows` 与 `grid-template-rows` 是两套东西。写了 `grid-template-rows: 60px 60px` 只固定前两行，第 3 行开始仍吃 `auto-rows`，现象是「前两行对齐、后面几行高度不齐」。
- `min-content` 轨道不意味着内容被裁剪。行收到最小尺寸后内容溢出到行框外，只是不参与网格的尺寸计算；要真正裁掉得给项或容器加 `overflow: hidden`。
- 隐式轨道不参与 `grid-template-areas` 的命名，`grid-row: span 2` 这类跨度也可能跨到隐式行上，命名区域与隐式轨道混用时行号容易算错。
- 自动放置下，一个项是否落到隐式行取决于 `grid-auto-flow`。用 `column` 方向时增长的是列，`auto-rows` 就基本不参与了。

## 备注

- 「声明骨架、让内容决定多长」是网格的常态：显式轨道定版式，隐式轨道兜住意外多出来的那些项。
- 与 `grid-auto-flow: dense` 搭配时，回填小项会让隐式行的个数变化，视觉顺序与 DOM 顺序脱钩，需要单独确认。
