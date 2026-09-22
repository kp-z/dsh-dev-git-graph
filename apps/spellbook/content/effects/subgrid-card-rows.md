---
title: 子网格的行轨道
slug: subgrid-card-rows
category: 布局
tags: [subgrid, 行轨道, 等高]
since: 2026-10
source: 机制来自 CSS Grid 规范的 grid-template-rows: subgrid，自行实现
when: 若干张卡片并排，要求标题、正文、操作在卡片之间横向对齐
stage: grid
tier: candidate
---

## 描述

三张卡片并排，每张的内容长短不一，但标题、正文、操作按钮各自横向对齐在三条带上——像一张表格，而不是三张各自为政的卡片。

机制是 ==grid-template-rows: subgrid 让子网格继承父级的行轨道==。父级先按所有卡片里最长的内容定下三行的高度，卡片本身再用 `subgrid` 声明「我这几行就是父级的那几行」。这样高度不再由每张卡片自己算，而是回到父级统一分配，于是行与行天然对齐。

关键在**行**上。用列方向做对齐（`grid-template-columns`）只能让宽度对齐，而卡片之间真正的错位来自内容高度不同——正文两行还是四行，直接决定下面那条线在哪。

## 代码

```html
<div class="sc">
  <article class="sc-card">
    <h3>短标题</h3>
    <p>一行正文。</p>
    <button>打开</button>
  </article>
  <article class="sc-card">
    <h3>长一点的标题会换行</h3>
    <p>这段正文有三行那么长，它会把父级的第二行撑高，另外两张卡片跟着一起变高，于是按钮仍然落在同一条线上。</p>
    <button>打开</button>
  </article>
  <article class="sc-card">
    <h3>短标题</h3>
    <p>两行正文。仍然对齐。</p>
    <button>打开</button>
  </article>
</div>
```

```css
.sc {
  display: grid;
  /* @mechanism 父级先定下三行轨道，行高由内容最长的那张卡片决定 */
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: auto auto auto;
  gap: 10px;
  width: min(640px, 90vw);
}

.sc-card {
  display: grid;
  grid-template-columns: 1fr;
  /* @mechanism 继承父级的行轨道：三张卡片的行是同三条线 */
  grid-template-rows: subgrid;
  grid-row: span 3;
  gap: 8px;
  padding: 14px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.42);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.sc-card h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.sc-card p {
  margin: 0;
  opacity: 0.72;
}

.sc-card button {
  /* @mechanism 按钮落在第三条带上，所以每张卡片都从同一条线起跳 */
  align-self: start;
  justify-self: start;
  font: inherit;
  padding: 4px 12px;
  border: 1px solid rgb(60 48 30 / 0.4);
  background: transparent;
  cursor: pointer;
}
```

## 边界

- 父级的行轨道必须是**显式的**。写成 `grid-template-rows: auto` 却让卡片跨三行，`subgrid` 就没有三条线可继承，等于没写。子项声明的 `span` 数要与父级轨道数一致。
- 卡片必须跨满父级该方向的全部轨道（这里是 `grid-row: span 3`）。只跨一部分，继承到的轨道被截断，对齐关系就与预期错位，而且看不出原因。
- 它统一的是**轨道线**，不是内容。第三行比第一行高，空隙自然落在行里；想改成 `align-content` 分布，那是子网格自己不能改的——轨道由父级定。
- Chrome 117 / Safari 16 之前不支持。退化表现是子网格不继承、卡片按自身内容各自成行，于是**按钮高低不齐**——布局不塌，但效果没了。
- 每张卡片里的行数必须结构与父级一致。少一个子元素，`h3 / p / button` 与三条带的对应就整体上移一格。

## 备注

- 同一招可以嵌更深：卡片里的 `<dl>` 再声明一层 `subgrid`，术语与释义能一路对齐到最外层。
- 若要的是「标签右边缘对齐」，那是列方向的 subgrid，和这里是两个机制。这条只管行。
