---
title: 给任意形状加辉光
slug: svg-glow-filter
category: 材质
tags: [svg-filter, 发光, 光晕, 图标]
since: 2026-10
source: 机制来自 SVG 滤镜的 feGaussianBlur 加 feMerge 子链，自行实现
when: 要发光的是一个非矩形的形状或路径，box-shadow 与 text-shadow 都用不上
stage: dark
tier: core
---

## 描述

一条折线在暗底上发着光，光从线条两侧均匀渗出——线条怎么拐弯，光晕就跟着怎么拐。

机制是 ==把同一张来源图模糊成几个不同半径的副本，再用 feMerge 按「远的在下、原图在上」堆回去==。`box-shadow` 只认盒模型、`text-shadow` 只认文字、`drop-shadow()` 也只能给一次轮廓；而 SVG 滤镜拿到的 `SourceGraphic` 是任意形状的像素，所以 `feGaussianBlur` 出来的模糊层天生就贴着形状的轮廓走。叠几层不同半径，就有了「紧贴的亮边 / 中距的晕 / 远处的雾」这种灯管式的层次。关键在 `feMerge` 的顺序：`in` 列表里越靠后的画在越上层，所以 `SourceGraphic` 必须放最后，否则会被上面的模糊层糊掉，线条失去锐度。

可变的是各层的半径、层数与颜色（用 `feFlood` 配 `feComposite in="SourceAlpha"` 可以让每一层独立着色）。要注意 `stdDeviation` 是高斯核的标准差、不是「半径」，数值比 CSS 的 `blur()` 小得多——视觉上 14px 左右的扩散，`stdDeviation` 只要 5 上下。

## 代码

```html
<svg class="glow" viewBox="0 0 240 140" role="img" aria-label="发光的折线">
  <defs>
    <!-- @mechanism 滤镜区域必须放大，默认的 -10% / 120% 会把辉光直接裁掉 -->
    <filter id="sb-glow" x="-40%" y="-60%" width="180%" height="220%">
      <feGaussianBlur stdDeviation="6" result="mist" />
      <feGaussianBlur stdDeviation="2" result="halo" />
      <!-- @mechanism merge 里越靠后画在越上层，原图放最后才不会被糊掉 -->
      <feMerge>
        <feMergeNode in="mist" />
        <feMergeNode in="halo" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
  <path d="M28 108 L72 40 L120 96 L166 34 L212 100" filter="url(#sb-glow)" />
</svg>
```

```css
.glow {
  display: block;
  width: min(440px, 88vw);
  padding: 24px;
  /* @mechanism SVG 会裁掉画布外的内容，辉光溢出必须显式放行 */
  overflow: visible;
  background: #05060a;
  box-sizing: border-box;
}

.glow path {
  fill: none;
  stroke: #9be8ff;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

## 边界

- 滤镜区域的默认值是相对元素包围盒的 `-10%` 到 `120%`，辉光超出这个范围会被硬裁。半径越大、区域要开得越宽，忘了这一步的现象是「光晕突然被切平」。
- 被 `filter` 引用的元素重绘一次，整条滤镜链就重跑一次。所以绝不能给它做逐帧动画（改 `stroke-dashoffset`、`transform` 都一样），那会让栅格化每帧重来。要动就把动画放在外层容器上，只做 `transform` 和 `opacity`。
- `feGaussianBlur` 的 `stdDeviation` 是标准差，不是模糊半径。按 CSS `blur()` 的量级去填，会得到一坨把形状整个吞掉的雾。
- 滤镜里的模糊对 alpha 也生效，所以发光是越靠外越透明，得不到 `box-shadow` 那种带硬边扩散的效果——`box-shadow` 有 spread，SVG 模糊没有。
- 滤镜用 `id` 引用，同一个文档里 `id` 重名会串台。页面上同时有两份同样的示例时，后一份会用到前一份的滤镜，参数也就跟着错了。
- `overflow: visible` 让辉光溢出到 SVG 盒子之外，但父级若有 `overflow: hidden`，一样会被切掉。
- 模糊层叠在原图**下方**，所以它不能表现「光遮住形状」的效果，只能表现光从形状后面渗出。

## 备注

- 给每一层接一个 `feColorMatrix` 或 `feComponentTransfer`，就能做出「芯子偏白、外圈偏紫」的霓虹灯管质感，比单纯加半径更接近真实灯管。
- 同一套滤镜可以直接挂在 `<text>` 上，这样发光的字可以是不规则字体轮廓，不受 `text-shadow` 只能叠色块的限制。
