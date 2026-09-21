---
title: 多栏正文
slug: multi-column-prose
category: 布局
tags: [多栏, 正文, 断行]
since: 2026-09
source: 机制来自 CSS Multi-column Layout，自行实现
when: 正文要分两栏排，但不想手工切成两个 div
stage: plain
tier: core
params:
  - { name: width, label: 栏宽下限, type: range, min: 140, max: 320, step: 20, default: 220, unit: px }
---

## 描述

一段长正文自动分成两栏，宽度不够时退回一栏。

机制是 ==`columns` 按给定的栏宽下限自动决定栏数，`column-gap` 定栏间距==。列切分与内容均衡都是浏览器做的：它不只是把文字倒进两个盒子，还会尽量让两栏等高。

正文分栏真正的学问在**断行控制**——标题不能被孤立在栏底、句子不能跨栏劈开。

## 代码

```html
<div class="mp">
  <h4 class="mp-title">机制是承重墙</h4>
  <p>描述里最要紧的不是「这是什么效果」，而是「靠什么成立」。一句说得清的效果不值得入库，因为抄的人拿不到可以迁移的东西。</p>
  <p>栏数由栏宽下限算出来，宽度不足时自动退回一栏，不需要媒体查询。这也让它天然适配不同容器。</p>
  <p>标题用 column-span 跨越所有栏，否则它会缩在某一栏的顶部，看起来像漏排了。</p>
</div>
```

```css
.mp {
  /* @mechanism 栏数由栏宽下限算出来，不需要媒体查询 */
  columns: var(--width, 220px);
  column-gap: 26px;
  column-rule: 1px solid rgb(60 48 30 / 0.2);
  width: min(520px, 88vw);
  font: 400 14px/1.85 system-ui, sans-serif;
  color: #1c1a17;
}

.mp-title {
  margin: 0 0 10px;
  font-size: 17px;
  /* @mechanism 标题跨所有栏，否则会缩在某一栏顶部 */
  column-span: all;
}

.mp p {
  margin: 0 0 12px;
  /* @mechanism 避免落单行与孤行 */
  orphans: 2;
  widows: 2;
}
```

## 边界

- `orphans` 与 `widows` 控制的是「一段话被拆开时，留在栏底/栏顶的最少行数」。不设时可能出现栏底孤零零一行，很难看。
- `column-span: all` 只有 `all` 和 `none` 两个值，做不出「跨两栏」。要跨特定栏数只能用 grid。
- 栏内的元素**不能**是定位包含块或带 `transform` 的，否则会被强制推到新栏，出现半栏空白。
- 栏数是浏览器按内容量算的，与内容多少有关。同一套 CSS 在内容变短时可能从两栏变一栏——这通常是你想要的，但要有心理准备。
- 阅读顺序仍是**先填满一栏再换下一栏**（竖着走）。要求按行阅读的场景不适用。
- 中文正文的行长在 25–35 字之间比较舒服。栏宽换算成字数大概就是 220–300px 这个区间（14–16px 字号）。

## 备注

- `column-rule` 是栏之间的分隔线，它不占宽度（与 `border` 不同），所以加了不会改变栏宽。
- 想让它随容器宽度变栏数，配容器查询单位（`cqi`）比媒体查询更自然。
