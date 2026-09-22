---
title: 负外边距做重叠
slug: negative-margin-overlap
category: 布局
tags: [margin, flex, z-index, 头像, 悬停]
since: 2026-10
source: 机制来自 CSS 盒模型中负外边距参与布局、负值只缩小占位，自行实现
when: 一排头像要互相叠一点，或者一块内容要压到上一块的边上
stage: plain
tier: core
---

## 描述

四个头像互相叠压，整组占的宽度比「四个头像之和」小一截。没有绝对定位、没有负的 `z-index`、没有把父元素改成网格——只是给除第一个之外的每个头像写了一个负的 `margin-left`。

机制是 ==负外边距只缩小元素在流里占的位置，盒子本身照旧那么大==。布局阶段算的是「这个元素占多少空间」，绘制阶段画的是「这个盒子多大」，负外边距只改前者。于是行内占位变少、后面的内容提前开始，而边框盒一像素没缩，两者的差额就变成了重叠区。也正因为重叠的是「占位」而不是尺寸，负外边距不能拿来把元素撑宽——想真的出血，得另外写 `width: calc(100% + 48px)`。

重叠落在哪一侧完全由负值写在哪一侧决定：`margin-left` 是后一个往前压、`margin-inline` 是两边一起探。谁盖住谁则由绘制顺序说了算，同一个层叠上下文里按文档顺序画——所以「后一个压前一个」是默认结果，要让被压的那个翻身，得把它的绘制顺序抬起来，而不是去改外边距。

## 代码

```html
<!-- @mechanism 重叠只由相邻兄弟的负外边距产生，结构里没有任何定位元素 -->
<div class="group">
  <span class="who">咒</span>
  <span class="who">语</span>
  <span class="who">书</span>
  <span class="who plus">+7</span>
</div>
```

```css
.group {
  display: flex;
  padding: 12px;
}

.who {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 2px solid #fffdf9;
  background: #efe9dd;
  font: 500 15px/1 system-ui, sans-serif;
  color: #1c1a17;
}

.who + .who {
  /* @mechanism 负值缩的是「占位」：盒子仍是 46px，于是后一个盖住前一个 */
  margin-left: -14px;
}

.who:hover {
  position: relative;   /* @mechanism 重叠顺序按文档顺序，抬到定位层才能翻上来 */
  z-index: 1;
}
```

## 边界

- 负外边距不会改变盒子的宽度，只改变占位。用「负 margin 凑宽度」的想法做出血一定会失败：盒子没变宽，只是位置提前了，另一侧就会出现对不齐的空白。要出血得让宽度也参与计算。
- 父元素的尺寸跟着占位一起变小。父元素有背景或边框时，子元素探出去的部分会盖在父元素外面，看起来像「漏出去了」；父元素若带 `overflow: hidden` 或 `clip`，反而被裁掉一角。
- 竖方向的百分比负外边距按**宽度**解析（外边距百分比的参照永远是包含块的宽度），所以 `margin-top: -20%` 的位移量取决于容器有多宽，换个宽度就换一个重叠量，很难预测。
- 被重叠的一方如果可点，命中的是盖在上面的那个元素。一排可点头像叠起来时，每个头像实际可点的宽度只有露出来的那 32px，被压住的部分点不到。

## 备注

- 同一招也用来把「网格间的空隙」收紧：给网格项写负外边距，露出一半到容器外，比给容器加 padding 再手算偏移更省事。
- 头像组的可点区域问题一般靠 `:hover` 抬 z-index 缓解，或者干脆接受只有露出的那一块可点。
