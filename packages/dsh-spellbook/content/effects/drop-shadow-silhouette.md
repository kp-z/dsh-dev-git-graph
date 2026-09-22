---
title: 轮廓投影
slug: drop-shadow-silhouette
category: 图形
tags: [drop-shadow, 阴影, 图标, 图片]
since: 2026-10
source: 机制来自 CSS filter 的 drop-shadow 按 alpha 轮廓取形，自行实现
when: 剪影形状或不规则图标要投影，而 box-shadow 只能给出一个方块
stage: dark
tier: core
params:
  - { name: blur, label: 环境阴影模糊, type: range, min: 2, max: 30, step: 1, default: 14, unit: px }
---

## 描述

一颗星浮在暗场上，投出来的影子也是星的形状，边缘跟着星角走，而不是一个方块。

机制是 ==drop-shadow 取形于元素渲染后的 alpha 轮廓，而不是它的盒子==。`box-shadow` 画的是边框矩形，所以给 `clip-path` 剪出来的形状加 `box-shadow`，影子是方的、和图形对不上；`drop-shadow` 是滤镜，它把元素的不透明像素当遮罩，剪影、透明 PNG、文字、SVG 都能得到贴合的影子。

多层会有层次，是因为连续的多个 `drop-shadow()` **串联执行**：前一个的输出成为后一个的输入。小偏移加零模糊做接触阴影，大偏移加大模糊做环境阴影，合起来就是「东西浮起来了」。代价也在这里——每多一层就多一遍全尺寸的模糊合成，成本和层数成正比，这跟 `box-shadow` 完全不是一个量级。

## 代码

```html
<div class="scene">
  <span class="shadowed">
    <i class="star"></i>
  </span>
</div>
```

```css
.scene {
  padding: 60px 70px;
  background: #0b0d12;
}

.shadowed {
  /* @mechanism 滤镜加在父层：这一层的子元素已经被裁过，影子取的是裁剪后的轮廓 */
  filter:
    drop-shadow(0 1px 0 rgb(0 0 0 / 0.7))
    drop-shadow(0 9px var(--blur, 14px) rgb(0 0 0 / 0.5));
}

.star {
  display: block;
  width: 130px;
  height: 130px;
  background: linear-gradient(160deg, #ffe9a8, #d98b2b);
  /* @mechanism 影子跟着这里的 alpha 走，所以裁剪必须在父层的滤镜之前完成 */
  clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%,
                     21% 91%, 32% 57%, 2% 35%, 39% 35%);
}
```

## 边界

- `clip-path` 和 `filter` 写在**同一个元素**上时，裁剪发生在滤镜之后，影子会被自己剪掉——现象是「完全没有影子」，而代码看上去完全正确。所以要把滤镜提到父层，让父层看到的是裁剪后的结果。
- 影子取的是 alpha，不是颜色：图片边缘一圈半透明像素会投出一圈半透明的脏边，看起来像影子发毛。换更干净的素材比调参数有效。
- 每多一层 `drop-shadow()` 就多一遍整块面积的模糊合成。列表里几十个卡片都挂三层，滚动时会稳定掉帧。
- `filter` 会创建 containing block 与合成层：元素内的 `position: fixed` 后代会被它钉住，后代的 `backdrop-filter` 也会失灵。
- 这里的模糊量是 `stdDeviation` 语义，不是 `box-shadow` 的模糊半径。同一个数值看起来比 `box-shadow` 更散，从 box-shadow 迁过来时要往下调。

## 备注

- 把偏移写成 0、只留模糊，得到的就是贴合轮廓的发光；这也是给不规则图标做辉光的正确做法。
- 多层小偏移逐像素递增，就是「长阴影」的滤镜版——区别是那里的形状是矩形，这里的形状可以是任意 alpha。
