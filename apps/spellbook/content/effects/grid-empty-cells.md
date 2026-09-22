---
title: 点号留白与跨区共享
slug: grid-empty-cells
category: 布局
tags: [留白, 点号, 跨区]
since: 2026-10
source: 机制来自 CSS Grid 区域图里的点号语法与区域跨列，自行实现
when: 头部要有一部分空着不铺元素，正文又有几块共用同一行高度
stage: grid
tier: core
---

## 描述

头部左边是标题、右边空着，正文里一块宽图和一段文字共用同一条基线。空着的地方是真的空——没有占位 div，也没有 `margin` 去凑。

机制是 ==区域图里的点号表示「这一格不分配给任何元素」==。它是网格自己认识的一个记号，不是元素，所以不占 DOM、不参与选择器、也不影响无障碍树。用空 div 填位则要额外处理它的高度与 `aria-hidden`。

同一张图里还能让**不连续的区域名共享轨道**：两块区域分别占同一行，它们的高度由这一行统一决定，于是基线天然对齐。

## 代码

```html
<div class="ge">
  <h2 class="ge-title">标题</h2>
  <figure class="ge-figure">宽图：跨两列</figure>
  <p class="ge-note">与宽图共用同一行高</p>
  <p class="ge-body">正文铺满整行。</p>
</div>
```

```css
.ge {
  display: grid;
  /* @mechanism 点号是「不分配」的记号，不占 DOM 也不会被读屏念到 */
  grid-template-areas:
    "title ."
    "fig   fig"
    "note  body";
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto auto;
  gap: 10px;
  width: min(520px, 88vw);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.ge > * {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.44);
}

/* @mechanism 块按名字归位，不需要写行列号 */
.ge-title { grid-area: title; font-size: 17px; }
.ge-figure { grid-area: fig; background: #efe9dd; font-weight: 600; }

/* @mechanism note 与 body 同处第三行，高度由这一行统一决定 */
.ge-note { grid-area: note; font-size: 12px; }
.ge-body { grid-area: body; }
```

## 边界

- 点号只是**一个记号**，不是一个可命名的区域。`grid-area: .` 不成立；想让某块元素落到点号处，还是得给它一个名字。
- 每一行的字符数必须**严格相等**（用空格分隔的列数）。多一个点或少一个空格，整条 `grid-template-areas` 声明被丢弃——布局整个跑回自动放置，而且不报错。
- 点号**不参与轨道尺寸计算**。整列都是点号时，那一列的宽度仍由 `grid-template-columns` 决定；如果你希望它自动收窄，得用 `auto`，但那样相邻列也会被拉动——留白列用 `1fr` 或固定值更稳。
- 靠点号做的留白**在窄屏上不会自动消失**。它占着一整格，屏幕越窄、留给内容的空间越少。要响应式，得在媒体查询里换一张图。
- 「跨区共享轨道」只能共享**高度**。两块区域在同一行，高度一致；但宽度仍是各自列宽的总和，不会自动变一样——那是列定义的事。

## 备注

- 点号可以连写，但 `...` 仍然只算**一个格子**——它是单个空单元记号，不是三个。想空出三格要写 `. . .`（三个独立的点）。连写时容易少数一个，于是那一行的列数与其他行不匹配，整条 `grid-template-areas` 直接失效。
- 区域图与命名网格线不冲突：图管「块在哪」，线名管「边界在哪」。两者可以同时用。
