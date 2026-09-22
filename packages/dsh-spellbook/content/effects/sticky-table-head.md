---
title: 表头留在滚动区里
slug: sticky-table-head
category: 布局
tags: [sticky, 表格, 表头, 滚动]
since: 2026-10
source: 机制来自 CSS Position Layout 规范中 sticky 的粘附范围与表格盒的绘制分层，自行实现
when: 长表格要在一个固定高度的区域里滚动，表头始终停在顶部
stage: plain
tier: core
---

## 描述

表格在一个固定高度的框里滚动，表头一直留在框顶，滚过去的行从它下面经过——但它一开始是会跟着走的，直到把粘附规则写在**单元格**上。

机制是 ==sticky 让表头脱离表格的绘制顺序，改为按最近的滚动祖先定位，粘附范围止于它的包含块==。`position: sticky` 的元素在没到阈值前是普通流里的成员（所以表格不会被挖出一个洞），越过阈值之后就被钉在滚动容器上；它能在表头方向上一直粘住，是因为它的包含块就是这张表——表滚出滚动区，它当然也跟着走。

这里有个分层的坑：`border-collapse: collapse` 时边框属于**表格**的边框网格，由表格盒绘制，而 sticky 的是**单元格**。两者不在同一层，表头一旦粘住、表格那层滚走，表头的下边框就消失了。所以 sticky 表头通常配 `border-collapse: separate` 并把边框画在单元格上。

## 代码

```html
<!-- @mechanism 粘附需要一个可滚动的视口，滚动容器就是粘附的参照物 -->
<div class="scroll">
  <table class="tbl">
    <thead>
      <tr><th>阶段</th><th>耗时</th></tr>
    </thead>
    <tbody>
      <tr><td>解压</td><td>0.4s</td></tr>
      <tr><td>扫描</td><td>1.2s</td></tr>
      <tr><td>去重</td><td>0.8s</td></tr>
      <tr><td>归一化</td><td>2.1s</td></tr>
      <tr><td>写入</td><td>3.4s</td></tr>
      <tr><td>校验</td><td>0.6s</td></tr>
    </tbody>
  </table>
</div>
```

```css
.scroll {
  /* @mechanism 没有滚动容器就没有可粘的视口，sticky 会退化成 static */
  max-block-size: 168px;
  overflow: auto;
  width: min(320px, 84vw);
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.5);
}

.tbl {
  /* @mechanism collapse 的边框归表格绘制，粘住的单元格带不走它，所以改用 separate */
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.tbl th {
  /* @mechanism sticky 把表头从表格的绘制顺序里拿出来，按滚动容器定位 */
  position: sticky;
  top: 0;
  z-index: 1;
  /* @mechanism 背景必须不透明，否则滚过去的行会从表头文字下面透出来 */
  background: #efe9dd;
  text-align: start;
}

.tbl th,
.tbl td {
  padding: 7px 10px;
  /* @mechanism 边框画在单元格上，才会跟着表头一起粘住 */
  border-block-end: 1px solid rgb(60 48 30 / 0.22);
}
```

## 边界

- 用了 `border-collapse: collapse` 时，表头粘住后**下边框会消失**：边框由表格盒绘制，粘住的单元格带不走它。现象是「一滚动表头就少了那条线」，换 `separate` 并把边框画在单元格上即可。
- 表头必须有不透明背景。默认是透明的，粘住后滚过去的行会从表头文字后面穿过去。
- 祖先里任何一层出现 `overflow: hidden / auto / scroll`（哪怕只是为了裁个圆角），粘附的参照物就变成那一层，表头再也不动。这是 sticky 最常见的失效原因。
- 表格滚到底之后表头跟着滚走，这不是失效：它的包含块就是这张表，表出了滚动区它自然不再粘。
- 把 `position: sticky` 写在 `thead` 或 `tr` 上时，各引擎对行、行组的行为并不一致；写在 `th`（单元格）上最可靠。
- 要同时「冻结表头 + 冻结首列」，左上角那个单元格是两个方向的重叠区，得单独给它更高的 `z-index` 和不透明背景，否则会被另一方向盖住。

## 备注

- 逻辑属性版本是 `inset-block-start: 0`，竖排或 RTL 文档里比 `top: 0` 更稳。
- 冻结首列是同一招：`th:first-child { position: sticky; left: 0 }`，两个方向可以叠加使用。
