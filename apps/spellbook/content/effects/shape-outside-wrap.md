---
title: 文字绕着形状排
slug: shape-outside-wrap
category: 图形
tags: [绕排, 浮动, 形状]
since: 2026-09
source: 机制来自 CSS Shapes 的 shape-outside，自行实现
when: 圆形图片旁边的文字要沿着弧形排，而不是留一块方形的空
stage: plain
tier: core
---

## 描述

一个圆形的图案，右边的文字沿着圆弧往回收，没有围着方框留空。

机制是 ==shape-outside 让浮动元素的「形状」不等于它的盒子==。浮动的基准是元素的外框（一个矩形），文字会绕开那个矩形；`shape-outside: circle(50%)` 把绕排的边界改成圆，文字于是贴着弧线排。

它改的是**文字怎么绕**，不改元素自己长什么样。

## 代码

```html
<div class="so">
  <div class="so-orb"></div>
  <p>文字会沿着那个圆排。浮动的基准本来是元素的外框——一个方形，
  所以文字会围着一块方形的空白走。把绕排的边界换成圆，文字就贴上了弧线。</p>
  <p>它只改变文字绕行的路径，不改变这个圆本身的绘制。</p>
</div>
```

```css
.so {
  width: min(420px, 84vw);
  font: 400 14px/1.9 system-ui, sans-serif;
  color: #1c1a17;
}

.so-orb {
  /* @mechanism shape-outside 只对浮动元素生效 */
  float: inline-start;
  width: 130px;
  height: 130px;
  margin: 4px 20px 4px 0;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #ff9a5a, #b4462f 70%);
  /* @mechanism 绕排边界改成圆：文字贴弧线，不留方形空 */
  shape-outside: circle(50%);
}

.so p {
  margin: 0 0 12px;
}
```

## 边界

- **必须配 `float`。**`shape-outside` 只对浮动元素生效——元素不是浮动时整条声明被忽略，也不报错。
- 元素自己**仍然是矩形**。`shape-outside` 改的是「文字绕它时的边界」，不改它的边框、背景或命中区域。要让绘制也是圆的，得同时写 `border-radius` 或 `clip-path`。
- 父级是 flex 或 grid 时浮动失效，`shape-outside` 跟着一起失效。它只能用在同一块级格式化上下文里。
- 形状函数（`circle()`/`ellipse()`/`polygon()`/`inset()`）的坐标是**相对这个元素自己的盒子**，不是相对父级。
- 它是**逐行**生效的：行高变了、字号变了、容器宽度变了，绕排结果都会变。响应式下形状要跟着调。
- `shape-margin` 可以给绕排边界加一点外扩距离，比给元素加 `margin` 更精确——后者改的是盒子而不是形状。

## 备注

- 配 `clip-path` 让绘制与绕排形状一致，是这类排版最完整的做法；只写一个会出现「看着是圆的、文字却绕方形」。
- `polygon()` 能让文字绕出一段不规则的弧形，是杂志式排版里最常用的一招。
