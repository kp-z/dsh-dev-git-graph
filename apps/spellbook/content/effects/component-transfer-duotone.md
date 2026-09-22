---
title: 通道曲线双色调
slug: component-transfer-duotone
category: 图形
tags: [feColorMatrix, svg-filter, 图片, 色彩]
since: 2026-10
source: 机制来自 SVG feComponentTransfer 的逐通道查找表，自行实现
when: 一张照片要压成暗部一个色、亮部另一个色，而且中间过渡要能自己定
stage: photo
tier: core
---

## 描述

照片被压成两种颜色：暗部偏紫、亮部偏琥珀，中间不是简单的混色，而是一段被安排过的过渡。

机制是 ==feComponentTransfer 给 R、G、B 三条通道各一条「输入到输出」的查找曲线，三条曲线的起点合起来是暗部色，终点合起来是亮部色==。`tableValues` 是等距采样，浏览器把输入值在这些采样点之间插值，所以「照片 → 双色调」只用到一件事：每个像素的通道值当索引，去查三条曲线。

它和 `mix-blend-mode` 的做法有本质区别。混合模式只能用一层颜色去乘或叠，而曲线**可以直接给出任意的亮度映射**——暗部提亮、中间调压下去、亮部收一点，都是改几个数字的事。所以它做的是调色，不是染一层色。曲线的形状也无所谓，`type="linear"` 是直线、`type="gamma"` 是幂曲线、`type="discrete"` 是硬阶跃（那就是海报化）。

## 代码

```html
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-duo" color-interpolation-filters="sRGB">
    <!-- @mechanism 先把三个通道压成同一个亮度，三条曲线才有共同的输入 -->
    <feColorMatrix type="matrix" result="gray"
      values="0.2126 0.7152 0.0722 0 0
              0.2126 0.7152 0.0722 0 0
              0.2126 0.7152 0.0722 0 0
              0      0      0      1 0" />
    <feComponentTransfer in="gray">
      <!-- @mechanism 三条曲线各查各的：起点是暗部色，终点是亮部色 -->
      <feFuncR type="table" tableValues="0.06 0.42 1" />
      <feFuncG type="table" tableValues="0.03 0.16 0.72" />
      <feFuncB type="table" tableValues="0.14 0.35 0.36" />
    </feComponentTransfer>
  </filter>
</svg>

<figure class="duo">
  <span>暗部一个色，亮部一个色</span>
</figure>
```

```css
.duo {
  /* @mechanism 滤镜作用在元素的渲染结果上，背景与文字会被同一条曲线一起压 */
  filter: url(#sb-duo);
  background: radial-gradient(120% 100% at 25% 20%, #ffffff, #9a9a9a 60%, #101010 100%);
  color: #e8e2d6;
  padding: 40px 34px;
  font: 700 22px/1.4 system-ui, sans-serif;
}
```

## 边界

- 头一行 `feColorMatrix` 不能省。省掉它，三条曲线会分别作用在原始的 R、G、B 上，得到的是一张颜色错乱的图，而不是双色调。权重用的是 Rec.709 的相对亮度系数，所以「亮度」在感知上是合理的。
- alpha 行（第四行 `0 0 0 1 0`）必须原样保留。改成别的，透明区域会被重新填成不透明，透明 PNG 会变成黑块。
- 滤镜默认在 linearRGB 空间里运算，同一个 0.5 在 sRGB 与 linearRGB 下对应完全不同的视觉亮度。不显式写 `color-interpolation-filters="sRGB"`，整条曲线会系统性偏亮，而且同一个数值在不同浏览器上落的点也不一样。
- `tableValues` 的个数就是色阶数：写 3 个是 3 段，写 9 个是 9 段。同族的三个函数长度不同不会报错，只是色阶会错位。
- 滤镜作用在元素的**渲染结果**上，包括文字与子元素。只想压背景，就得把滤镜加在一个纯背景的容器上。

## 备注

- 把三条曲线换成 `type="discrete"`，同一套写法就变成海报化/色阶效果。
- `tableValues` 就是一个数组，可以按两个端点色插值生成——这就是一个能接滑杆的色带编辑器。
