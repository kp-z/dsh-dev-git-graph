---
title: 一侧固定一侧流式
slug: sidebar-fluid
category: 布局
tags: [flex, 容器, 正文]
since: 2026-09
source: 机制来自 CSS Flexbox 的 flex-grow 与 flex-wrap，自行实现
when: 侧栏宽度固定，主区吃掉剩余空间，窄屏时自动堆叠
stage: plain
tier: core
params:
  - { name: side, label: 侧栏宽度, type: range, min: 120, max: 320, step: 20, default: 200, unit: px }
---

## 描述

侧栏是它该有的宽度，主区把剩下的都吃掉；窄到一定程度，主区自己落到下一行。全程没有媒体查询。

机制是 ==主区给一个极大的 flex-grow，只要还放得下，它就一定和侧栏同一行==。侧栏的 `flex-basis` 是它的目标宽度，主区的 `flex-basis` 是一个百分比；两个 basis 加起来放不进一行时，`flex-wrap` 让主区换行并独自占满整行。

一个百分比同时决定了「多宽时并排」和「多窄时堆叠」——这就是它不需要断点的原因。

## 代码

```html
<div class="sb">
  <aside class="sb-side">侧栏</aside>
  <div class="sb-main">主区吃掉剩下的空间</div>
</div>
```

```css
.sb {
  display: flex;
  /* @mechanism 允许换行，放不下时主区自己落到下一行 */
  flex-wrap: wrap;
  gap: 10px;
  width: min(520px, 88vw);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.sb > * {
  min-height: 90px;
  padding: 16px 18px;
  border: 1px solid rgb(60 48 30 / 0.28);
}

.sb-side {
  /* @mechanism 目标宽度就是侧栏的 flex-basis */
  flex: 1 1 var(--side, 200px);
  background: rgb(217 164 65 / 0.16);
}

.sb-main {
  /* @mechanism 极大的 grow 吃掉所有剩余宽度；basis 决定何时放不下 */
  flex: 999 1 45%;
  background: rgb(255 255 255 / 0.44);
}
```

## 边界

- 主区的 `flex-basis` 是这套的**开关**：它同时决定了多宽时并排、多窄时堆叠。改它等于改断点，而且不用写媒体查询。
- `flex-grow: 999` 那个大数字不是随手写的。它要**远大于**侧栏的 grow，才能保证同行时剩余宽度全归主区；两侧 grow 相近时它们会平分剩余空间。
- `flex-wrap: wrap` 是必需的。默认的 `nowrap` 不换行，只会把元素压扁——现象是「窄屏下侧栏被挤成一条，字都竖起来了」。
- 侧栏的 `flex-basis` 只是**目标**宽度，不是硬宽度。内容比它宽时它仍会被撑大（因为 `min-width: auto`），正是这一点让窄容器不横向溢出。要让它绝不被撑开得另外配 `min-width: 0`。
- 这套本质是 flex 的分配规则，不是网格。要精确控制轨道与跨行跨列，grid 更合适；这里要的只是「一个会换行的两栏」。
- 两个 basis 的比例决定堆叠时机，所以改宽度后要重新算一遍。这一点比媒体查询隐晦，属于它的代价。

## 备注

- 换行之后主区的 `flex-basis` 百分比是按**整行**算的，于是它自然占满整行——不需要为堆叠状态另写样式。
- 同一招的经典用法是卡片列表自动排列：每张卡 `flex: 1 1 220px`，容器一变宽就自动多排几列。
