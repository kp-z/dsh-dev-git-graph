---
title: 拿字号量行长
slug: reading-measure
category: 布局
tags: [logical-property, custom-property, 正文]
since: 2026-09
source: 机制来自排版的 measure 原则与 ch 单位，自行实现
when: 正文长度要靠字号来定，而不是写死一个像素宽度
stage: plain
tier: core
params:
  - { name: measure, label: 行长（字符）, type: range, min: 30, max: 90, step: 5, default: 62, unit: ch }
---

## 描述

正文的宽度随字号一起变——字号调大了，行也跟着变长一点，但每行仍然是那么多字。

机制是 ==`ch` 单位是「0」这个字符的宽度，用它量行长就等于按字数定宽==。阅读的舒适度取决于**每行多少个字**，不是多少像素。写死 `600px` 时，字号一改每行的字数就变了；写 `62ch` 则始终保持同样的节奏。

字号变了行长跟着变，这才是「以排版为中心」的写法。

## 代码

```html
<article class="rm">
  <p>行长是排版里对可读性影响最大的单一变量。太宽，眼睛回行时容易串行；太窄，换行太频繁，读起来一顿一顿的。</p>
  <p>用字符数来量而不是像素，是为了让字号的变化不破坏这个节奏。字号调大，行也变长，每行仍然是差不多的字数。</p>
</article>
```

```css
.rm {
  /* @mechanism 用「0」的宽度当尺子，等于按字数定宽 */
  max-inline-size: var(--measure, 62ch);
  margin: 0 auto;
  padding: 0 4px;
  font: 400 15px/1.9 system-ui, sans-serif;
  color: #1c1a17;
}

.rm p {
  margin: 0 0 14px;
}

.rm p:last-child {
  margin-bottom: 0;
}
```

## 边界

- `ch` 是**数字「0」的宽度**，只在等宽字体下近似于「一个字符的宽度」。中文的字宽与 `ch` 不等（通常是 2 倍左右），所以中文场景用 `ch` 会得到比预期窄的行——可以用 `em` 或直接按字数换算。
- `max-inline-size` 是逻辑属性，在竖排书写模式下它管的是**高度**。用它做行长限制比 `max-width` 更正确。
- 换字体时最优行长会变（不同字体的字宽与 x 高度都不同），所以这个值需要在选定字体之后调。
- 行长只是可读性的一个变量。行高、字号、对比度、段间距同样重要——单靠行长调不出「好读」。
- `margin: 0 auto` 只在容器有明确宽度时能居中。父级是 flex/grid 项时，居中由父级控制，这里的 auto 不起作用。

## 备注

- 英文的舒适区间大约在 45–75 字符，中文大约 25–40 字。这两个区间对应的 `ch` 值不同，不能直接套用。
- 把它和「通栏突破」配对很自然：中列用 `62ch` 定阅读宽度，通栏元素跨出去。
