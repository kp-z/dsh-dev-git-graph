---
title: 行内迷你趋势线
slug: sparkline-inline
category: 图形
tags: [svg, stroke, 图表, 卡片]
since: 2026-10
source: 机制来自 SVG polyline 与 viewBox 的等比拉伸，自行实现
when: 表格或卡片里要在一个文字行的高度内显示一串数据的走势
stage: plain
tier: core
---

## 描述

一行文字旁边跟着一条细折线，几十个数据点的起伏一眼看得出，却只占 18px 高。

机制是 ==把数据归一化成 0..1 的坐标，交给 viewBox 去拉伸==。折线的 `points` 全部用 0..1 的小数写成，配一个 `viewBox="0 0 1 1"`，再用 `preserveAspectRatio="none"` 让 SVG 把这一单位见方**非等比**地铺满容器。于是「数据在哪」与「图表多大」彻底分开：数据不用知道容器多宽，容器也不用知道数据多少。

代价是非等比拉伸会把线宽一起拉扁——横向拉 100 倍、纵向拉 20 倍，`stroke-width: 1` 就变成横粗竖细。所以线宽必须用 `vector-effect: non-scaling-stroke` 声明为不参与变换。这是整个做法里最容易漏掉的一步，漏了也不会报错，只会看着「有点怪」。

## 代码

```html
<svg class="spark" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
  <polyline points="0,0.80 0.1,0.62 0.2,0.70 0.3,0.45 0.4,0.50 0.5,0.28 0.6,0.36 0.7,0.12 0.8,0.20 0.9,0.05 1,0.10"/>
</svg>
```

```css
.spark {
  width: 96px;
  height: 18px;
  color: #4ea1d3;
}

.spark polyline {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
  /* @mechanism 线宽不参与 viewBox 的非等比拉伸，否则会横粗竖细 */
  vector-effect: non-scaling-stroke;
}
```

## 边界

- 漏了 `vector-effect: non-scaling-stroke` 时，线的粗细随容器尺寸变化，而且横竖不一致——现象是「同一条线在宽表格里变细、在窄卡片里变粗」，很难联想到是拉伸造成的。
- `preserveAspectRatio="none"` 会把**有形状**的标记一起拉扁。想标出最高点就得再加一个 `<circle>`，而圆会被拉成椭圆。要么放弃标记，要么把 `viewBox` 改成真实像素、归一化只用在算坐标那一步。
- 数据全相等时，归一化的分母是 0，坐标变成 `NaN`，整条折线**静默消失**。要在归一化之前挡掉极差为 0 的情况，退化成一条水平中线。
- `aria-hidden` 只是把它移出无障碍树，读屏器读不到任何数值。真正的数字必须在旁边用文字给出，图只是补充。
- 点数超过容器像素宽度之后，相邻点会落在同一个像素列上，折线开始出现「台阶」。这时该做的是按像素抽样（每像素取该列的最小最大值），而不是继续加宽。
