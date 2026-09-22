---
title: 无缝噪声瓦片
slug: tileable-noise-stitch
category: 材质
tags: [feTurbulence, svg-filter, 颗粒, 纹理, 容器]
since: 2026-10
source: 机制来自 SVG feTurbulence 的 stitchTiles 与 feTile 的配合，自行实现
when: 同一片颗粒要用在很多元素上，既不想每次随机、也不想存一张图片
stage: plain
tier: candidate
---

## 描述

两块并排的面板上是同一片颗粒，位置对齐、颗粒一致，看起来是同一种材料，而不是两块碰巧都带噪点的板。

机制是 ==先让噪声只在一个固定大小的区域里生成、把它的频率对齐到这个尺寸（`stitchTiles="stitch"`），再用 feTile 把这一小块复制满整个滤镜区域==。噪声本身没有周期，所以「无缝」不是它自带的性质，而是靠把频率对齐到区域尺寸换来的：瓦片边长正好是噪声晶格周期的整数倍，两条边上的值才接得上。

这条机制真正解决的问题是**可重复**。浏览器现算噪声很容易，但默认每次都不一样——同一个滤镜用在十张卡片上，会得到十块互不相干的纹理，滚动时还能看出它们各自在闪。把噪声限制在瓦片大小、进而只算一遍再复制出去，纹理就统一了，而且要算的面积也只有那片瓦片那么大。

## 代码

```html
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-tile" color-interpolation-filters="sRGB">
    <!-- @mechanism 噪声只算这一小块；stitch 把频率对齐到这块尺寸，边界才对得上 -->
    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3"
                  seed="5" stitchTiles="stitch"
                  x="0" y="0" width="160" height="160" result="grain" />
    <!-- @mechanism feTile 认的就是上面那个子区域，把它复制满整个滤镜区域 -->
    <feTile in="grain" />
  </filter>
</svg>

<div class="grain-row">
  <div class="grain-card"></div>
  <div class="grain-card"></div>
</div>
```

```css
.grain-row {
  display: flex;
  gap: 14px;
}

.grain-card {
  width: 150px;
  height: 150px;
  /* @mechanism 滤镜区域是「画布」，feTile 负责用 160px 的瓦片把它铺满 */
  filter: url(#sb-tile);
  background: #2a2f36;
  border-radius: 10px;
}
```

## 边界

- `stitchTiles` 被忽略时，瓦片边界会露出一条明显的接缝（现象是等距的竖线或横线）。可以退让的办法是让「`baseFrequency` × 瓦片边长」接近整数——这里 0.05 × 160 = 8，噪声的自然周期刚好落在瓦片边界上。
- 不做 `feTile` 时噪声是按**滤镜区域**算的，同一个滤镜在十张卡片上会算出十块不同的颗粒。要统一就必须 tile。
- 瓦片越大重复越不明显，但 `feTile` 的成本与滤镜区域成正比，而那个区域可以是整屏。瓦片是「一次算、多次复制」，所以真正的成本在复制面积上，不在瓦片大小上。
- 这条链上没有用 `SourceGraphic`，所以元素的**内容会被整个换掉**：文字、背景都会消失，只剩噪声。要保留内容，得把颗粒做成单独的一层叠上去，或者用 `feBlend` 混回去。
- `numOctaves` 越高细节越丰富，成本也随之上涨；做颗粒 3 阶已经够用，再往上只是更贵。

## 备注

- 把 `seed` 换一个就是另一块料，但仍然是**可重复**的另一块料——这比每次随机可控得多。
- 和「用噪点打散色带」的分工：那一条要的是看不见的平滑，只把 `stitch` 当作防接缝的补丁；这一条要的是一块能反复使用的料，`feTile` 才是主角。
