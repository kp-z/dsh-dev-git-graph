---
title: 按比例占位，防抖动
slug: aspect-ratio-box
category: 布局
tags: [比例, 防抖动, 图片]
since: 2026-09
source: 机制来自 CSS aspect-ratio，自行实现
when: 图片还没加载，但版面不能等它；加载完也不能把下面的内容顶走
stage: grid
tier: core
params:
  - { name: ratio, label: 高宽比, type: range, min: 0.5, max: 2, step: 0.05, default: 0.62 }
---

## 描述

图片还没到，位置已经留好了；图片加载完，周围的东西纹丝不动。

机制是 ==给盒子声明一个只由宽度决定的高度比例==。图片加载前它的高度是 0，加载完高度突然出现，下面的内容被整体推下去——这就是布局位移。声明比例之后，高度在图片到达之前就已经确定，没有东西需要挪。

比例的作用不是「好看」，是**提前把高度定下来**。

## 代码

```html
<div class="ar">
  <div class="ar-box">
    <div class="ar-inner">图片位</div>
  </div>
  <p>这块的高度在内容到达前就已经定了。</p>
</div>
```

```css
.ar {
  width: min(300px, 76vw);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.ar-box {
  /* @mechanism 比例把高度提前定下来，内容到达时不必重排 */
  aspect-ratio: var(--ratio, 1.6);
  width: 100%;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.5);
  overflow: hidden;
}

.ar-inner {
  display: grid;
  place-items: center;
  height: 100%;
  background: repeating-linear-gradient(
    45deg,
    rgb(60 48 30 / 0.09) 0 8px,
    rgb(60 48 30 / 0) 8px 16px
  );
  font: 400 13px/1 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.6);
}
```

## 边界

- `aspect-ratio` 的参照轴取决于**另一个轴是不是自动的**。宽高都写死了，比例就失效——它不是「强制」，是「补一个缺的值」。
- 内容超出比例框时会**溢出**，不会把框撑大（`overflow: hidden` 能裁掉，但内容就没了）。它管的是盒子尺寸，不管内容。
- 它是长期占位方案，**不能替代图片的 `width` / `height` 属性**。后者在图片字节到达前浏览器就能读到，防抖效果更早、更好。两者都写是最稳的。
- 图片本体还要配 `object-fit: cover`，否则会被拉伸变形——比例框负责框，`object-fit` 负责图。
- 比例写在**容器**上比写在 `<img>` 上更可控：图片被换掉时比例不会跟着变。

## 备注

- `aspect-ratio: 16 / 9` 与 `aspect-ratio: 1.777` 等价，但分数写法更易读、也更精确。
- 同一招给占位块用，就是骨架屏里防抖动的那一层。
