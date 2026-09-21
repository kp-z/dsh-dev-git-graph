---
title: 滚动堆叠卡片
slug: sticky-stack
category: 布局
tags: [粘性定位, 堆叠, 滚动]
since: 2026-09
source: 机制来自 CSS position: sticky，自行实现
when: 几张卡片要一张张钉在顶部，被下一张盖住，像翻一叠牌
stage: plain
tier: core
params:
  - { name: offset, label: 钉住位置, type: range, min: 0, max: 60, step: 2, default: 14, unit: px }
---

## 描述

每张卡片滚到顶部就停在那里不动，下一张继续往上滚，最后把上一张盖住。

机制是 ==position: sticky 配一个滚动容器==。sticky 的元素在「自己和滚动容器之间」的范围内是普通元素，一旦到达 `top` 指定的位置就变成钉住，直到容器边界把它推走。卡片一张张钉在同一个位置，自然叠成一摞。

## 代码

```html
<div class="stk">
  <article class="stk-card"><h3>第一张</h3><p>滚到顶部就钉住。</p></article>
  <article class="stk-card"><h3>第二张</h3><p>它会把上一张盖住。</p></article>
  <article class="stk-card"><h3>第三张</h3><p>以此类推。</p></article>
  <article class="stk-card"><h3>第四张</h3><p>到底为止。</p></article>
</div>
```

```css
.stk {
  width: min(460px, 84vw);
  height: min(330px, 56vh);
  overflow-y: auto;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.3);
  scroll-behavior: smooth;
}

.stk-card {
  position: sticky;              /* @mechanism 每张都钉在同一个位置 */
  top: var(--offset, 14px);
  min-height: 168px;
  margin: 0 0 10px;
  padding: 16px 18px;
  border: 1px solid rgb(60 48 30 / 0.32);
  background: #efe9dd;
  box-shadow: 0 10px 24px rgb(40 30 14 / 0.18);
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.stk-card h3 {
  margin: 0 0 6px;
  font: 600 17px/1.3 system-ui, sans-serif;
}

.stk-card p {
  margin: 0;
  opacity: 0.72;
}
```

## 边界

- **必须有一个真正能滚的祖先。**页面本身不滚（或容器没设高度、`overflow` 是 visible）时，sticky 一点效果都没有——现象是「完全没反应」，不报错，最难查。
- 祖先只要带了 `overflow: hidden`、`overflow: clip` 或 `overflow: auto`，sticky 就被限制在那个祖先里活动。这个经典坑通常来自外层某个「顺手加的」`overflow: hidden`。
- 让每张露出一点的做法是让 `top` 递增（第一章 0、第二章 12px……），全都写同一个值才是完全盖住。
- 卡片高度为 0 或没有内容时钉不住——sticky 是相对元素盒子生效的。

## 备注

- 柱状图之外，同一个容器里 `position: sticky` 的层叠顺序按 DOM 顺序，后面的盖住前面的；要改顺序得动 `z-index`，别动 DOM。
- `scroll-behavior: smooth` 只影响程序化滚动（锚点跳转），不会让用户的手动滚变顺滑。
