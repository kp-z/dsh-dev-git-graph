---
title: 骨架屏扫光
slug: skeleton-shimmer
category: 材质
tags: [骨架屏, 扫光, 加载]
since: 2026-09
source: 自行实现
when: 内容还在加载，用一块灰底加一道扫光占住位置
stage: plain
tier: core
params:
  - { name: dur, label: 扫一次用时, type: range, min: 0.6, max: 4, step: 0.1, default: 1.6, unit: s }
---

## 描述

几块灰色占位条上一道浅光缓缓扫过，提示「这里马上会有东西」。

机制是 ==用一个伪元素做亮带，动画它的 transform==。亮带是 `linear-gradient` 画的一条斜向高光，位移交给 `transform`。**不要动画 `background-position`**——那会让浏览器每一帧都重绘整块渐变，长列表里代价很大；而 `transform` 交给合成器，代价几乎为零。

## 代码

```html
<div class="sk">
  <span class="sk-line sk-w60"></span>
  <span class="sk-line sk-w90"></span>
  <span class="sk-line sk-w45"></span>
</div>
```

```css
.sk {
  display: grid;
  gap: 12px;
  width: min(420px, 84vw);
  padding: 20px;
  border: 1px solid rgb(60 48 30 / 0.24);
  background: rgb(255 255 255 / 0.34);
}

.sk-line {
  position: relative;
  display: block;
  height: 15px;
  overflow: hidden;                 /* @mechanism 少了它，扫光会漏到块外 */
  background: rgb(60 48 30 / 0.14);
}

.sk-w60 { width: 60%; }
.sk-w90 { width: 90%; }
.sk-w45 { width: 45%; }

/* @mechanism 亮带是伪元素，位移用 transform 交给合成器 */
.sk-line::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 32%,
    rgb(255 255 255 / 0.72) 50%,
    transparent 68%
  );
  transform: translateX(-100%);
  animation: sk-sweep var(--dur, 1.6s) ease-in-out infinite;
}

@keyframes sk-sweep {
  to {
    transform: translateX(100%);
  }
}
```

## 边界

- 动画 `background-position` 每一帧都要重绘整块渐变。改用伪元素的 `transform` 位移，浏览器把它交给合成器（GPU），长列表里差别非常明显。
- 伪元素所在的父级需要 `position: relative` 与 `overflow: hidden`，否则亮带会跑到块外面去。
- 亮带的对比度要低。超过 70% 白会让它看起来像故障闪烁，而不是「正在加载」。
- 没有处理 `prefers-reduced-motion`。持续不停的扫光对动效敏感的人很干扰，正式项目里应当退化成静态灰块。
- 骨架块的尺寸要贴近真实内容。差太多的话，数据到达的瞬间会整体跳版，比不做骨架屏还难受。

## 备注

- 扫光只应出现在「确实在加载」的状态。加载失败还一直扫，会让用户一直等一个不会来的东西。
- 同一招可以给按钮做「处理中」的进度感，但这些场景更推荐给用户明确的文字状态。
