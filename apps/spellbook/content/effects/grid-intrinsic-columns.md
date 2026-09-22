---
title: 让内容决定列宽
slug: grid-intrinsic-columns
category: 布局
tags: [网格, 内容宽度, 自适应]
since: 2026-10
source: 机制来自 CSS Grid 规范的 min-content / max-content / fit-content 关键字，自行实现
when: 一列要刚好装下最长的那个词，另一列吃掉剩下的全部宽度
stage: grid
tier: core
---

## 描述

左列刚好装下最长的那个标签，不多一个像素；右列把剩下的宽度全吃掉。窗口怎么缩放都不用改列定义。

机制是 ==把 min-content / max-content 当作轨道尺寸，让内容反过来决定轨道==。`auto` 是个模糊的「看着办」，而 `max-content` 明确表示「按内容不换行时的宽度」。它和 `1fr` 并列时，`fr` 分配的是**剩余**空间，所以左列缩到最小、右列自动变宽，这是同一条规则的两半。

`min-content` 是另一头：按最长的**不可断词**算，中文里基本等同于一个字。两者之差就是「这个标签挤到极限还能多窄」到「完全不换行要多少」的区间。

## 代码

```html
<dl class="ic">
  <dt>版本</dt>
  <dd>2026-10</dd>
  <dt>标签宽度</dt>
  <dd>这一列吃掉剩下的全部宽度</dd>
  <dt>依赖</dt>
  <dd>无</dd>
</dl>
```

```css
.ic {
  display: grid;
  /* @mechanism max-content 按「不换行的最长标签」定宽，1fr 吃掉剩余 */
  grid-template-columns: max-content 1fr;
  gap: 8px 16px;
  width: min(520px, 66vw);
  padding: 16px 18px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.36);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.ic dt {
  /* @mechanism fit-content 让这一列最多只占这么宽，超了就换行 */
  inline-size: fit-content(9em);
  opacity: 0.62;
}

.ic dd {
  margin: 0;
  font-weight: 500;
}
```

## 边界

- `max-content` 是**不换行**的宽度。标签长到超过容器时它不会让位，而是把网格撑出横向溢出——`1fr` 那一列可以缩到 0，但 `max-content` 列不会。长文案场景这是必然事故。
- `min-content` 与 `max-content` 很容易写反：`min-content` 是「最窄能多窄」（中文里约等于一个字/一个标点），不是「最小可用宽度」。把它用在标签列上，每个字都会换行，竖成一串。
- `auto` 与 `max-content` 在只有一行内容时表现相同，内容多行时才分道扬镳：`auto` 会被 `fr` 挤压到换行，`max-content` 不会。测试只用短内容会把两者测成一样。
- `fit-content(长度)` 的参数是**上限**，不是目标宽度。内容比它短时列就跟着短，想要固定宽度应该直接写长度。
- `1fr` 的挤压是有下限的——它不会小于 `min-content`（除非写 `minmax(0, 1fr)`）。窄屏上右列不肯再缩、整体横向溢出时，改 `minmax(0, 1fr)` 才对。

## 备注

- `minmax(0, 1fr)` 是 `1fr` 的防溢出写法：`fr` 的隐含最小值是 `auto`（即 `min-content`），显式写 `0` 才能让它真的缩到零。
- 这组关键字也是「不用 subgrid 的标签对齐」：只有一层标签/值结构时，`max-content 1fr` 就够了，不必上子网格。
