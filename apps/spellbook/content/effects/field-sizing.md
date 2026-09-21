---
title: 输入框随内容自己变宽
slug: field-sizing
category: 布局
tags: [表单, 自适应, 输入框]
since: 2026-09
source: 机制来自 CSS field-sizing，自行实现
when: 用户边打边看，输入框要跟着内容长，而不是把字藏起来
stage: plain
tier: candidate
---

## 描述

输入框一开始只有几个字宽，你越打它越长，打下的每一个字都在框里。

机制是 ==field-sizing: content 让输入类元素按内容算尺寸==。输入框默认的宽度由 `size` 属性定，是个固定值——文字超出就横向滚动，你看不全自己写的东西。这个属性把宽度交给内容决定，`textarea` 同时获得「按行数长高」的能力。

它是「内容决定尺寸」这条原则第一次进到表单控件里。

## 代码

```html
<label class="fs">
  边打边长
  <input class="fs-input" value="打几个字试试" />
</label>
<label class="fs">
  多行也会长高
  <textarea class="fs-area" rows="1">换行看看</textarea>
</label>
```

```css
.fs {
  display: grid;
  gap: 6px;
  width: min(360px, 80vw);
  margin-bottom: 14px;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.fs-input,
.fs-area {
  /* @mechanism 宽度由内容决定，不再是固定值 */
  field-sizing: content;
  /* @mechanism 上下限不可少，否则会缩成一条线或撑破容器 */
  min-width: 8ch;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.35);
  background: rgb(255 255 255 / 0.52);
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
  resize: none;
}
```

## 边界

- `min-width` 不能少。没有下限时，空输入框会缩成一条细线，用户连点都点不到——这是它最现实的坑。
- `max-width` 同样不能少，否则长文本会把容器撑破。两个上下限要一起给。
- 支持面很新（Chrome 123 之后）。不支持时输入框保持原来的固定宽度，**不会破版**——可接受的降级。
- `textarea` 上它会同时长高，可能把下面的按钮顶走。只想要「宽」不想要「高」的话，这意味着它可能不适合你的表单。
- 一排自动宽度的输入框会**参差不齐**（每个按自己的内容定宽）。要么接受这种错落，要么给它们一个共同的下限。

## 备注

- 它和 `size` 属性冲突：`size` 是固定值、`field-sizing: content` 是内容驱动，后者会盖过前者。
- 做「标签即输入框」的界面（比如待办列表、标签编辑器）时它特别合适——每行宽度等于那行文字的长度。
