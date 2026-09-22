---
title: 首字沉进去几行
slug: initial-letter-sink
category: 排版
tags: [首字, 下沉, 字体]
since: 2026-10
source: 机制来自 CSS Inline Layout 的 initial-letter，自行实现
when: 章节开头要一个下沉首字，希望它精确占满三行而不是靠调字号凑
stage: plain
tier: core
---

## 描述

章节的第一个字放大，从第一行往下沉，占满三行的高度，它的基线正好落在第三行的基线上。

机制是 ==`initial-letter: 3` 说的是「占三行」，不是「三倍大」==。浏览器自己算出该多大的字号才能让这个字的首部对齐第一行、基线落在第三行的基线上——所以字号不必你挑，行数才是你给的参数。这与 `::first-letter { font-size: 3em }` 有本质区别：后者给的是**倍数**，而倍数与实际占几行之间的关系取决于字体度量、行高、以及字本身的形状，改一次 `line-height` 就会偏。

多出来的那个可选值控制「下沉几行」：`initial-letter: 3 2` 表示占三行、沉两行（第一行之上留出一行空）。只写一个数时两个值相同。

## 代码

```html
<p class="chapter">魔法书的第一条咒语讲的是一块玻璃。它要同时做到两件事：让背后的东西糊掉，又让边缘保持一条清晰的亮线。</p>
```

```css
.chapter {
  max-width: 30em;
  font: 400 17px/1.9 "Songti SC", "Noto Serif CJK SC", serif;
  color: #26201b;
  /* @mechanism 3 是「占三行」的行数，不是倍数 —— 字号由浏览器按度量推算 */
  initial-letter: 3;
  initial-letter-align: alphabetic;
}

/* @mechanism 用后备的 ::first-letter 给不支持 initial-letter 的浏览器一个次优解 */
@supports not (initial-letter: 3) {
  .chapter::first-letter {
    float: left;
    font-size: 3.1em;
    line-height: 1;
    margin-right: 0.08em;
  }
}
```

## 边界

- `initial-letter` 只对**块级容器的第一个行内级子元素**生效，且要靠 `::first-letter` 的选取规则来决定是哪个字符。前面若有空白或注释，多数浏览器会跳过；前面若是行内元素（比如 `<span>` 包的标签），选取结果会按浏览器而异。
- 它和 `float` 是互斥的两条路：`initial-letter` 用的是自身的排印算法，加了 `float: left` 会把它退化成 `::first-letter` 的浮动态，`initial-letter` 就失效了。回退方案要写在 `@supports not` 里，正是为了不两者同时生效。
- 首字下沉**不改变行高**。字沉下去，但第一行占的高度还是 `line-height` 决定的那个值，所以字号很大的首字会与第二行相碰。要留出空间得加 `line-height` 或给首字一点 `margin`。
- 中文首字下沉的观感与拉丁字母差别很大：汉字是方块，占三行时是一个大正方形，没有字母那种「首字与后续文字咬合」的效果。中文语境里通常用「首字放大并悬挂到左侧」更多，那是另一套做法。
- `initial-letter-align` 目前主要只在少数浏览器上有效，且取值（`alphabetic` / `cap-height` 等）各家解释不一。写它多数时候是为了表达意图，别指望它真的改变对齐。
