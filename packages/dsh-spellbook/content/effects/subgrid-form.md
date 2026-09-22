---
title: 子网格对齐
slug: subgrid-form
category: 布局
tags: [subgrid, grid, 表单]
since: 2026-09
source: 机制来自 CSS Grid 规范的 subgrid 关键字，自行实现
when: 多行表单的标签宽度要互相对齐，但每行又是独立的一块
stage: plain
tier: candidate
params:
  - { name: gap, label: 列间距, type: range, min: 6, max: 40, step: 2, default: 18, unit: px }
---

## 描述

每一行在自己的标签列里宽度不同，但所有行的标签右边缘恰好对齐在同一条线上。

机制是 ==grid-template-columns: subgrid==。父级定义好轨道，每行声明自己要继承父级的这些轨道，于是宽度不再由各行自己决定，而是回到父级统一算。用嵌套 grid 做不出这个效果——那样每行各算各的。

## 代码

```html
<div class="sg">
  <div class="sg-row"><label>名称</label><span>咒语书</span></div>
  <div class="sg-row"><label>用途说明</label><span>前端效果速查</span></div>
  <div class="sg-row"><label>收录条数</label><span>持续增加</span></div>
  <div class="sg-row"><label>甲</label><span>最窄的标签也在同一条准线上</span></div>
</div>
```

```css
.sg {
  display: grid;
  grid-template-columns: auto 1fr; /* 父级定轨道 @mechanism */
  gap: 10px var(--gap, 18px);
  width: min(520px, 84vw);
  padding: 16px 18px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.34);
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.sg-row {
  display: grid;
  grid-template-columns: subgrid; /* @mechanism 继承父级轨道 */
  grid-column: 1 / -1;
}

.sg-row label {
  opacity: 0.62;
}

.sg-row span {
  font-weight: 500;
}
```

## 边界

- 父级的轨道必须是**显式**的。`repeat(auto-fit, …)` 或 `min-content` 这类动态轨道没有可继承的固定线，subgrid 会失效。
- 子网格元素必须横跨父级全部列（`grid-column: 1 / -1`），否则它继承到的轨道是被截断的，对不齐也看不出原因。
- Safari 16 之前、Chrome 117 之前的版本不支持，退化后子网格不会继承，行内容会全部挤进第一列——不是错位，是整块塌掉，所以要配 `@supports` 兜底。

## 备注

- `subgrid` 同样可以继承行轨道（`grid-template-rows: subgrid`），做「多列等高且行与行对齐」的卡片列表时比手算高度可靠。
- 它不是万能的对齐方案：真正需要的只是「标签右对齐」时，`grid-template-columns: max-content 1fr` 一层就够了，不用 subgrid。
