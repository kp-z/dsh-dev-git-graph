---
title: 滤镜噪点质感
slug: turbulence-grain
category: 图形
tags: [feTurbulence, svg-filter, blend-mode, 颗粒, 纹理]
since: 2026-09
source: 机制来自 SVG feTurbulence 滤镜，自行实现
when: 要一层颗粒感把过于干净的色块压旧一点，但不想引入任何图片文件
stage: photo
tier: core
params:
  - { name: amount, label: 颗粒强度, type: range, min: 0, max: 100, step: 5, default: 45, unit: % }
---

## 描述

一层细密的颗粒铺在色块上，把数字味的纯净压成有质感的表面。

机制是 ==SVG 的 feTurbulence 滤镜==。它在浏览器里现算分形噪声，不需要任何图片文件——一个 `<svg>` 写进 HTML 就够了。配 `mix-blend-mode: overlay` 后，颗粒只在明暗交界处显现，暗部和不亮的地方几乎不动，所以看起来像材质而不是脏点。

## 代码

```html
<div class="gr">
  <svg class="gr-noise" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <filter id="gr-filter">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" />
    </filter>
    <rect width="100%" height="100%" filter="url(#gr-filter)" />
  </svg>
</div>
```

```css
.gr {
  position: relative;
  width: min(300px, 70vw);
  aspect-ratio: 3 / 2;
  overflow: hidden;
  background: linear-gradient(135deg, #b4462f 0%, #6b3550 55%, #2a2440 100%);
}

.gr-noise {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: var(--amount, 45%); /* @mechanism 颗粒强度就是这一层的透明度 */
  mix-blend-mode: overlay;
  filter: contrast(140%);
}
```

## 边界

- `feTurbulence` 是**每次需要重绘时现算**的。铺满整个视口、又叠在会动的元素上时，GPU 会明显吃紧；做法是把它平铺成一张小尺寸的背景（`background-repeat`）而不是拉伸到全屏。
- 滤镜的 `id` 是**全局**的。同一个页面里出现两个 `id="gr-filter"` 会互相抢，第二个会拿到第一个的滤镜——从组件里搬出来时要给 id 加前缀。
- `mix-blend-mode: overlay` 需要底图本身有明暗对比。铺在纯白或纯中灰上几乎什么都看不见，会让人误以为没生效。
- 颗粒放大会露出方块感。`baseFrequency` 越小颗粒越大，超过 0.5 左右就已经能看出像素格子。
- `baseFrequency` 是写死在 SVG 属性里的，CSS 变量管不到它——想让它可调，只能用 JS 写属性，或者准备几档滤镜切换。

## 备注

- 把 `opacity` 控制在 30%–50% 之间最像胶片颗粒；超过 60% 就成了电视雪花，不再是质感。
- `numOctaves` 加大会让噪声更细但更慢。3 是质感和性能的平衡点，4 以上收益很小。
- 同一招也能给纯色背景加「纸纹」：把 `overlay` 换成 `multiply`，颗粒会往下压暗，更像旧纸。
