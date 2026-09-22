---
title: 继承祖先的轨道
slug: subgrid-tracks-inherit
category: 布局
tags: [subgrid, grid, 卡片]
since: 2026-10
source: 机制来自 CSS Grid 规范的 grid-template-columns: subgrid，自行实现
when: 卡片里的每一行要跟卡片外的其它卡片共用同一套列线，边缘才对得齐
stage: grid
tier: candidate
---

## 描述

一排卡片里的图标、标题、数值分三列排开，跨卡片一比就能看出列线整齐划一——而每张卡片其实是各自独立的网格。

机制是 ==subgrid 让子网格不再自己造轨道，而是直接采用父网格的轨道==。子元素自己声明 `grid-template-columns: subgrid` 后，它跨过的那几根父级列线就成了它的列线：子网格里的项在同一根线上对齐，不在同一根线上的项也共享同一套间距。没有 subgrid 时，每张卡片各算各的列宽，列线永远对不齐——这才是「嵌套网格对齐」真正难的地方。

子网格不是复制父级的列宽数值，而是**加入父级的轨道集合**：父级后续按内容重算列宽，子网格跟着变。所以父级列宽可以是 `auto`、`max-content` 这类由内容决定的尺寸，对齐依然成立。

## 代码

```html
<div class="ledger">
  <div class="row">
    <span class="icon">◆</span>
    <span class="name">基建</span>
    <span class="num">1,240</span>
  </div>
  <div class="row">
    <span class="icon">◆</span>
    <span class="name">数据中心与网络互联</span>
    <span class="num">86</span>
  </div>
  <div class="row">
    <span class="icon">◆</span>
    <span class="name">研发</span>
    <span class="num">4,502</span>
  </div>
</div>
```

```css
.ledger {
  display: grid;
  /* @mechanism 父级用内容决定列宽：图标列按最宽图标、名称列按最长名称 */
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  gap: 4px 12px;
  width: min(340px, 82vw);
  padding: 14px;
  background: rgb(255 255 255 / 0.5);
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.row {
  display: grid;
  grid-column: 1 / -1;
  /* @mechanism subgrid 采用父级那三根列线，而不是自己算一套列宽 */
  grid-template-columns: subgrid;
  align-items: baseline;
  padding-block: 5px;
  border-block-end: 1px solid rgb(60 48 30 / 0.14);
}

.row:last-child {
  border-block-end: 0;
}

.icon {
  color: #b4462f;
  font-size: 12px;
}

.num {
  font-variant-numeric: tabular-nums;
  text-align: end;
}
```

## 边界

- 子网格必须**横跨出**父级那几根轨道才有意义。`.row` 只占一列时，`subgrid` 也只会得到一根线，看起来跟没写一样。
- `subgrid` 只继承**它跨过的**那些线，不是继承父级全部轨道。跨两根就得到两根，跨到隐式轨道上时行为取决于父级实际有多少根。
- 子网格自己不能再用 `repeat()`、`1fr` 去"改写"继承来的轨道——那就不再是 subgrid 了。要调整间距得在父级的 `gap` 上改。
- 支持面比网格本体窄。不支持时整条 `grid-template-columns` 声明被丢弃，子网格退化成单列，现象是「每行内容堆成一列」而不是排版破掉。
- 父级用 `gap` 时，子网格也继承同一套间距；子网格上再写 `gap` 会在继承的轨道之间额外插入空隙，容易把对齐搞乱。
- 父级列宽若含 `1fr`，子网格项会一起参与那根弹性轨道的分配，某个卡片里出现超长内容时，**所有**卡片的列宽都会被它牵动。

## 备注

- 同一套机制也能对齐表格式表单：标签列与控件列在两块独立的表单之间共线。
- `grid-template-rows: subgrid` 是另一个方向，用来让卡片内部的行在卡片之间对齐——两者可以同时用。
