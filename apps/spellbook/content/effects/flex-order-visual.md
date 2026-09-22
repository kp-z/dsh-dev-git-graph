---
title: 不动物件挪动位置
slug: flex-order-visual
category: 布局
tags: [flex, 按钮, 卡片]
since: 2026-10
source: 机制来自 CSS Flexbox 规范的 order 属性与主轴排序，自行实现
when: 小屏时要把操作按钮排到最后，大屏时排在前面，但不想用两份 HTML
stage: grid
tier: core
---

## 描述

屏幕一窄，工具条里的「保存」就跑到最右侧去了，DOM 里它其实排在第一个。

机制是 ==order 只重排主轴上的绘制与布局顺序，不改变 DOM 顺序==。flex 项按 `order` 数值升序排列，同值之间仍按文档顺序，所以 `order: -1` 能把一个项提到最前、`order: 1` 把它压到最后，而它仍然在 DOM 的那个位置上。这意味着你可以用一份结构应付两种版式：断点里只改 `order`。

代价在于「视觉顺序」和「语义顺序」从此分家。屏幕阅读器和 Tab 键走的是 DOM 顺序，不是 `order` 排出来的顺序。所以这条机制适合**顺序无关紧要**的那类项（工具按钮、装饰块），不适合正文段落或表单字段——那类挪动会让键盘用户看到焦点在屏幕上跳来跳去。

## 代码

```html
<div class="bar">
  <button class="bar-save">保存</button>
  <span class="bar-title">未命名的草稿</span>
  <button class="bar-more">更多</button>
</div>

<div class="bar bar-compact">
  <button class="bar-save">保存</button>
  <span class="bar-title">未命名的草稿</span>
  <button class="bar-more">更多</button>
</div>
```

```css
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(360px, 84vw);
  margin-block-end: 16px;
  padding: 10px 12px;
  background: rgb(255 255 255 / 0.5);
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 400 14px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.bar-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar button {
  padding: 4px 10px;
  font: inherit;
  color: inherit;
  background: rgb(60 48 30 / 0.08);
  border: 1px solid rgb(60 48 30 / 0.3);
  border-radius: 4px;
}

.bar-compact .bar-save {
  /* @mechanism order 只重排主轴顺序；保存按钮在 DOM 里仍排第一，视觉上落到最后 */
  order: 1;
}

/* @mechanism 其余项保持默认的 order: 0，同值之间按文档顺序，所以它们仍排在保存按钮之前 */
```

## 边界

- `order` 不影响键盘与读屏顺序。视觉排到最右的「保存」仍是 Tab 到的第一个——这是可访问性缺陷，不是 bug。要真正调顺序就改 DOM。
- 仅对 **flex 项与 grid 项**生效。写在普通块级子元素上完全无效，而且不报错，现象是「改了 order 没反应」。
- `order` 默认是 `0` 而不是 `1`。想往后压得写正值、往前提取负值；写成 `order: 1` 想让某项排第一是不成立的。
- 同值项按文档顺序是稳定排序，但浏览器不会因为 `order` 变化去重排可聚焦元素的可达性顺序，混合正负值时很容易出现「Tab 走位与视觉完全错位」。
- `flex-direction: row-reverse` 也会翻转主轴顺序，和 `order` 叠在一起时两套反序会互相抵消或叠加，排查时要一起看。
- 用 `order` 做视觉重排后，`:first-child`、`:last-child` 之类的结构选择器仍按 DOM 判定，与视觉首位/末位不一致。

## 备注

- 判断某个项能不能用 `order`：问一句「键盘用户按 Tab 走过去的顺序和眼睛看到的顺序不一样，会不会让人困惑」。会，就别用。
- 同一套思路在 CSS Grid 里由 `grid-auto-flow` 与显式 `grid-row` 承担——网格里更常直接用行号，而不是 `order`。
