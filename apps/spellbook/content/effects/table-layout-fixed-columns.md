---
title: 表格列宽只认首行
slug: table-layout-fixed-columns
category: 布局
tags: [table-layout, text-overflow, 表格]
since: 2026-10
source: 机制来自 CSS Table 规范的 table-layout: fixed 列宽算法，自行实现
when: 同一张表格换一批数据列宽就跟着挪位，想要列宽稳定、长内容自己截断
stage: plain
tier: core
---

## 描述

两张表，数据一模一样，列宽却完全不同：一张的首列固定在三分之一，长标识符被截成省略号；另一张的首列被那个长标识符撑宽了。

机制是 ==table-layout: fixed 只用第一行与 <col> 上的宽度声明定列，其余行的内容一律不参与列宽计算==。默认的 `auto` 算法要把所有行的内容都量一遍、再折中分配列宽，所以任何一行里出现一个长词，整张表的列宽就跟着变；`fixed` 直接跳过这道测量，第一行/`col` 上有宽度就按它，没有的列平分剩下的宽度。

代价与收益是一体两面：列宽变得**可预测**（不再取决于某一行恰好有多长），但内容也失去了"把自己那一列撑开"的能力——超出的部分只能靠换行、`overflow` 或省略号处理。省略号恰恰只有在列宽先定下来之后才可靠，所以 `table-layout: fixed` 通常是 `text-overflow: ellipsis` 的前置条件。

## 代码

```html
<!-- @mechanism 两张表结构与数据完全相同，差别只在列宽算法 -->
<table class="tbl">
  <colgroup><col class="tbl-name" /><col /></colgroup>
  <thead><tr><th>名称</th><th>状态</th></tr></thead>
  <tbody>
    <tr><td>汇总任务</td><td>运行中</td></tr>
    <tr><td>DataExportPipeline</td><td>排队</td></tr>
  </tbody>
</table>

<table class="tbl tbl-auto">
  <colgroup><col class="tbl-name" /><col /></colgroup>
  <thead><tr><th>名称</th><th>状态</th></tr></thead>
  <tbody>
    <tr><td>汇总任务</td><td>运行中</td></tr>
    <tr><td>DataExportPipeline</td><td>排队</td></tr>
  </tbody>
</table>
```

```css
.tbl {
  /* @mechanism fixed 跳过内容测量，列宽只由首行与 col 的声明决定 */
  table-layout: fixed;
  width: min(320px, 82vw);
  margin: 0 0 14px;
  border-collapse: collapse;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.tbl-name {
  /* @mechanism 只给一列宽度，剩下未声明的列平分其余宽度 */
  width: 34%;
}

.tbl th,
.tbl td {
  padding: 6px 8px;
  border: 1px solid rgb(60 48 30 / 0.25);
  text-align: start;
}

.tbl td {
  /* @mechanism 列宽定下来之后省略号才可靠：先有确定的宽度，才有可截断的余地 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tbl-auto {
  /* @mechanism auto 是默认算法：它要量完所有行，列宽被最长的那个单元格撑开 */
  table-layout: auto;
}

.tbl-auto td {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
}
```

## 边界

- 列宽只看**首行**与 `<col>`。写在后续数据行单元格上的 `width` 会被忽略——现象是「我给那一行的 td 设了宽度，毫无反应」。
- `fixed` 不是「永不溢出」的保证。各列声明的宽度加起来超过表格宽度时，表格会直接变宽、溢出容器（表宽取声明宽度与各列宽之和中较大的那个），算法不会替你压缩列。
- 表格自身宽度是 `auto` 时，`fixed` 下表格宽度怎么定取决于引擎实现细节。要结果稳定，先给表格一个明确宽度（`width: 100%` 或具体值）。
- 首行出现 `colspan` 时，它跨过的那几列要摊分这个宽度，与 `col` 上的声明叠加后很难预测。`fixed` 表格的首行最好保持规整的单元格数量。
- 长 URL、长标识符这类不可断的内容在 `fixed` 下**溢出列框**而不是撑宽列；要它们换行就得显式写 `overflow-wrap`，这一步不会自动发生。
- 内容比列宽高得多时，行会变高而不是变宽，`vertical-align` 的默认值 `baseline` 会让单元格里的内容按基线对齐，看起来像"没有垂直居中"——这跟列宽算法无关，要另调。

## 备注

- 分工很清楚：要**稳定**用 `fixed`（配显式截断），要**自适应**用默认的 `auto`。同页两种表格都存在很正常。
- 列表类界面（日志、任务队列、监控面板）几乎总是 `fixed`，因为列宽跳动比截断更难读。
