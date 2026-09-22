---
title: 换行之后的末行
slug: flex-wrap-last-row
category: 布局
tags: [flex, grid, 列表, 卡片]
since: 2026-10
source: 机制来自 Flexbox 规范「剩余空间按行分配」的弹性长度算法，自行实现
when: 标签按宽度自动换行铺开，末行项数少，不该被拉得比上面几行宽
stage: plain
tier: core
---

## 描述

一串标签按可用宽度自动换行，每一行都铺满。看起来像网格，直到最后一行只剩两项——它们被撑得比上面几个宽，整块版式在末行「塌了一下」。上下两行内容完全一样，只有 `flex-grow` 不同，差别就出在末行。

机制是 ==flex-grow 在每一行内部独立分配剩余空间，弹性盒并不知道总共有几列==。换行是「先分行、再在行内分配」：每行的剩余空间除以这一行里可增长的项数，所以行内项数越少，每项分到得越多。这跟网格恰好相反——网格先定轨道（列），所有行共用同一套列宽，项数填不满一行时只是留空，宽度纹丝不动。所以「按列对齐的自动铺开」本质上是二维需求，用 `repeat(auto-fit, minmax(…))` 那种轨道定义去表达才是对的。

如果必须留在弹性盒里，做法是不给 `grow`、只把目标宽度写在 `flex-basis` 上，让末行保持宽度、右侧留一块不规则的空。要不要接受这块空白，取决于这些卡片在语义上是不是「等宽网格」——是的话，留白就是错的。

## 代码

```html
<div class="wrap">
  <ul class="tags grow">
    <li>网格</li><li>内在尺寸</li><li>容器查询</li><li>流式间距</li><li>粘性定位</li>
  </ul>
  <ul class="tags">
    <li>网格</li><li>内在尺寸</li><li>容器查询</li><li>流式间距</li><li>粘性定位</li>
  </ul>
</div>
```

```css
.wrap {
  display: grid;
  gap: 14px;
  width: min(360px, 82vw);
}

.tags {
  display: flex;
  flex-wrap: wrap;         /* @mechanism 先分行，之后每一行各自分配剩余空间 */
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tags li {
  flex: 0 0 88px;          /* @mechanism 目标宽度写在 basis 上，不参与增长：末行保持宽度 */
  padding: 8px 0;
  text-align: center;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.4);
  font: 400 14px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

.tags.grow li {
  flex: 1 1 88px;          /* @mechanism grow 只在行内分配，末行项少就被拉得更宽 */
}
```

## 边界

- 同一个容器里每行的项宽可以不同，这不是 bug，也不能用 `justify-content` 修——它分配的是行内剩余空间，改它只会让已铺满的行更糟。想跨行统一列宽只有换网格。
- `flex-basis` 的百分比按容器宽度算，不按行算。写 `33%` 想凑三列，会在有 `gap` 时溢出（`gap` 之外还要放三个 33%），而 `flex-grow` 不会帮你修这个，它只会把溢出的行分得更宽。
- 末行的拉伸量还受 `min-width: auto` 影响：行内某项内容特别长时，它先按内容撑住，剩下的再分给别人，于是同一行的项宽就更不整齐了。
- 只有一项的末行最明显：给了 grow 就被拉成整行宽，看起来像一条分段标题而不是标签。

## 备注

- 如果末行只有一项、你又希望它别铺满，`justify-content: flex-start` 没用（空间已经被 grow 吃掉了），得去掉那一行的增长——比如给最后一项单独写 `flex-grow: 0`，或者干脆整块换成 `repeat(auto-fill, minmax(88px, 1fr))` 让它留空。
