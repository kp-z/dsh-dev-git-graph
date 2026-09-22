---
title: 看不见的行轨道
slug: grid-auto-rows-implicit
category: 布局
tags: [grid, 隐式轨道, auto-rows]
since: 2026-10
source: 机制来自 CSS Grid 规范的隐式轨道与 grid-auto-rows，自行实现
when: 网格只声明了列、项数事先不知道，多出来的那些行得由你说了算
stage: grid
tier: core
---

## 描述

网格只写了列，行一条没写，往里扔七个格子也排得下——多出来的那些行是浏览器现场造的，高度默认随内容。

机制是 ==没被显式声明的行由 grid-auto-rows 决定，它们叫隐式轨道==。`grid-template-rows` 只描述你点名的那几行；自动放置一旦把子项排到声明范围之外，浏览器就按 `grid-auto-rows` 现造新行。默认值是 `auto`（该行内容要多少就多少），所以「什么都没写」也能跑，代价是行高会随内容忽高忽低。

把它设成固定长度，所有隐式行就有了统一的尺子——代价是内容不再能撑高自己的行：行高定死之后，装不下的内容会**溢出到行框之外**（默认可见），而不是把行顶开。这两件事是分开的：轨道负责定尺寸，内容溢不溢出是盒子的 `overflow` 说了算。所以「让行统一」和「让内容装得下」往往要做两次决定。

## 代码

```html
<!-- @mechanism 两个网格都只声明列，行全靠自动放置现造 -->
<div class="board">
  <span>1</span><span>2</span><span>3</span>
  <span class="tall">4 这一格内容比别人多，可行高不归内容管</span>
  <span>5</span><span>6</span><span>7</span>
</div>

<div class="board board-auto">
  <span>1</span><span>2</span><span>3</span>
  <span class="tall">4 同样的内容，这里的行跟着它一起长高</span>
  <span>5</span><span>6</span><span>7</span>
</div>
```

```css
.board {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  /* @mechanism 只声明列；行是自动放置时现造的隐式轨道，尺寸全归 grid-auto-rows 管 */
  grid-auto-rows: 56px;
  gap: 8px;
  width: min(320px, 84vw);
  margin: 0 0 18px;
  padding: 10px;
  background: rgb(255 255 255 / 0.5);
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 400 12px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

.board span {
  display: grid;
  place-items: center;
  padding: 4px;
  text-align: center;
  background: rgb(60 48 30 / 0.08);
}

.tall {
  /* @mechanism 固定轨道不为内容让步：装不下的部分溢出到行框外，行本身不变高 */
  align-content: start;
  background: rgb(180 70 47 / 0.16);
}

.board-auto {
  /* @mechanism auto 是默认值：每一行按自己的内容定高，行与行因此高矮不齐 */
  grid-auto-rows: auto;
}
```

## 边界

- 隐式轨道在**列**方向同样存在：项数超过 `grid-template-columns` 里声明的列数时，多出来的列由 `grid-auto-columns` 决定。只调 `auto-rows` 治不了横向溢出。
- `grid-auto-rows` 与 `grid-template-rows` 是两套。写了 `grid-template-rows: 60px 60px` 只固定前两行，第三行开始仍吃 `auto-rows`——现象是「前两行整齐、后面几行高矮不齐」。
- 固定长度的轨道**不会为内容让步**。装不下的内容溢出到行框外（默认可见），不会把行撑高，也不报错；要截断得自己写 `overflow`。
- `auto` 是按每一行的内容各算各的，所以整片网格的行高可能都不相同。要整片等高就得显式声明行——那样行也不再是隐式的了。
- 隐式轨道不参与 `grid-template-areas` 的命名；`grid-row: span 2` 这类跨度也可能落到隐式行上，显式行号与隐式轨道混用时行号容易算错。
- 自动放置往哪个方向增长由 `grid-auto-flow` 决定。写 `column` 时增长的是列，`grid-auto-rows` 基本不参与。

## 备注

- 「声明骨架、让内容决定多长」是网格的常态：显式轨道定版式，隐式轨道兜住那些没预料到的项。
- 配 `grid-auto-flow: dense` 时，回填小项会改变隐式行的条数，视觉顺序与 DOM 顺序脱钩，得单独确认。
