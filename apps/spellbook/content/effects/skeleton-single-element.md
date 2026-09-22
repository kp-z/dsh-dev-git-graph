---
title: 一个元素画整屏骨架
slug: skeleton-single-element
category: 动效
tags: [骨架屏, 多层背景, 零子元素]
since: 2026-10
source: 机制来自 CSS 多层 background 的定位与尺寸，自行实现
when: 骨架屏的形状是固定的，不值得为它写一堆占位 div
stage: plain
tier: core
---

## 描述

一块头像加三条长短不一的文字占位条，看起来很完整，但 DOM 里只有一个空元素。

机制是 ==把每一块占位条写成一个 background 图层，用 background-size 定尺寸、background-position 定位置==。骨架是「纯装饰」的结构，它不携带任何内容，也不该进入无障碍树——既然如此，它最合适的载体不是元素，而是背景层。图层用 `linear-gradient(色 0 0)` 写：两个色标位置都是 0 的线性渐变等于一块纯色，可以当成一个任意颜色、任意尺寸的矩形来摆放。四层就是四块骨头，容器里一个子节点都不需要。

这套写法的真正好处是**骨架与真实结构解耦**：数据到达时你只管往里塞内容，不需要先把骨架删干净，也不会有「骨架 div 忘了删」的残留。代价是可读性——超过五六块就该换成真的容器加子元素，因为那时「第几层对应哪里」已经不能一眼看出来了。

## 代码

```html
<!-- 一整块骨架，零子元素：形状全在 background 里 -->
<div class="ske" role="status" aria-label="正在加载"></div>
```

```css
.ske {
  width: min(360px, 82vw);
  height: 60px;
  /* @mechanism 每一层 linear-gradient 就是一块实色矩形，共四层 */
  background-image:
    linear-gradient(rgb(60 48 30 / 0.18) 0 0),
    linear-gradient(rgb(60 48 30 / 0.18) 0 0),
    linear-gradient(rgb(60 48 30 / 0.18) 0 0),
    linear-gradient(rgb(60 48 30 / 0.18) 0 0);
  /* @mechanism size 逐层给尺寸：头像 56px 方形，三条文字高度 13px、宽度递减 */
  background-size: 56px 56px, 62% 13px, 78% 13px, 44% 13px;
  /* @mechanism position 逐层排版，文字条统一从左起 72px 处开始 */
  background-position: 0 0, 72px 6px, 72px 26px, 72px 46px;
  /* @mechanism 不平铺，否则那几块骨头会铺满整块变成网格 */
  background-repeat: no-repeat;
  border-radius: 4px;
}
```

## 边界

- 漏了 `background-repeat: no-repeat`：`background-size` 小于容器时那块骨会平铺，现象是「本该三条文字的地方铺满了一整片网格」。
- 用绝对像素做 `background-position` 时，容器一窄，右侧那条就溢出被裁掉。要让骨架跟着宽度伸缩，宽度用百分比、位置在文字区用 `calc()` 或干脆整体靠左。
- 层数不等同于元素数：看不出关系的第 7 层开始，改动的成本会超过它省下的 DOM。超过五六块就用子元素。
- 颜色深浅要拿捏：太浅看不出是占位，太深会被读成「加载失败后的空白块」。经验上是正文色 15%–20% 的透明度。
- 这些层不参与布局、也不进无障碍树。骨架读屏读不到是对的，但容器上仍应给一个 `aria-label` 或邻近的状态文字，否则整页对读屏是「什么都没有」。
- 背景层没法各自单独做动画。想让每块骨头错开扫光，只能改用子元素。

## 备注

- `linear-gradient(色 0 0)` 是把任意颜色当「实色图层」用的通用写法，画分隔线、色带、简易图标都靠它。
- 骨架的位置和尺寸可以直接从设计稿上量，它和真实内容不需要单位一致，只要视觉上对齐即可。
