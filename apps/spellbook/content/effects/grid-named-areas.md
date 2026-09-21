---
title: 用名字描述布局
slug: grid-named-areas
category: 布局
tags: [网格, 命名区域, 可读性]
since: 2026-09
source: 机制来自 CSS Grid 的 grid-template-areas，自行实现
when: 布局要一眼看出结构，而不是靠一串列宽去推
stage: plain
tier: core
---

## 描述

CSS 里画出一张 ASCII 图，页面就长成那样。

机制是 ==grid-template-areas 用字符串矩阵描述布局==，每个名字代表一块区域，同名的格子会自动连成一块。它把「哪块在哪」从数字变成了图示——改布局时改的是图，不是列宽。

`grid-area` 把元素挂到某个名字上。布局的意图与实现终于是同一件事。

## 代码

```html
<div class="ga">
  <header class="ga-head">头部</header>
  <nav class="ga-side">侧栏</nav>
  <main class="ga-main">主区</main>
  <footer class="ga-foot">页脚</footer>
</div>
```

```css
.ga {
  display: grid;
  /* @mechanism ASCII 图就是布局本身，同名格子自动连成一块 */
  grid-template-areas:
    "head head"
    "side main"
    "foot foot";
  grid-template-columns: 110px 1fr;
  grid-template-rows: auto 1fr auto;
  gap: 8px;
  width: min(440px, 86vw);
  height: 250px;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.ga > * {
  display: grid;
  place-items: center;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.46);
}

/* @mechanism 元素按名字挂到区域上，不用写行号列号 */
.ga-head { grid-area: head; }
.ga-side { grid-area: side; }
.ga-main { grid-area: main; }
.ga-foot { grid-area: foot; }

/* 窄屏上直接换一张图 */
@media (max-width: 420px) {
  .ga {
    grid-template-areas:
      "head"
      "main"
      "side"
      "foot";
    grid-template-columns: 1fr;
  }
}
```

## 边界

- 每一行的字符数必须**相等**，否则整条声明被丢弃。多一个空格就会让布局完全失效，而且不报错——这是它最常见的事故。
- 同一个名字只能形成**一块矩形**区域。想要 L 形，必须用两个不同的名字（`side` 与 `side2`），再用选择器一起选中。
- 点号 `.` 表示空格子。用它留白比塞一个空 div 好，不占 DOM。
- 区域名与 `grid-area` 的对应是纯字符串匹配，改名时容易漏掉一处，结果是某个元素掉到自动放置的位置——现象是「它跑到最后一格去了」。
- 它描述的是**二维**关系。只有一维需求（比如一排卡片）用 flex 更简单，别为了整齐硬上网格。
- 窄屏换图时列定义也要跟着改（这里从两列变一列），只改图不改列会得到错位的布局。

## 备注

- 把媒体查询里的另一张图紧挨着原图写，改布局时两张图能对照着看，比数字好维护得多。
- 配 `grid-template-columns: subgrid` 可以做到区域之间共享列，那是另一个条目。
