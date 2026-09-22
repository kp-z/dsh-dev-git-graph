---
title: 亮度抠图
slug: luminance-key
category: 图形
tags: [svg-filter, feColorMatrix, 图片]
since: 2026-10
source: 机制来自 SVG feColorMatrix 的 alpha 行按 RGB 加权取值，自行实现
when: 一张白底的图要直接叠到深色页面上，而手上没有透明版本
stage: dark
tier: candidate
---

## 描述

白底的图放到深色页面上，白底真的消失了，只剩下图形自己——没有抠图动作，元素连同它上面的一切一起被「键控」了。

机制是 ==feColorMatrix 的第四行（alpha 行）取的不是原图的 alpha，而是输入 RGB 的加权和==。把那一行写成一串**负数**的亮度系数再补上 1，`alpha = 1 − 亮度` 就成立了：白（亮度 1）变成全透明，黑（亮度 0）保持不透明。

这一行之所以反直觉，是因为它和 R、G、B 三行是同一种东西——一个五项线性式。写 `0 0 0 1 0` 才是复制原 alpha；写一组负的亮度系数，就是把**明暗**当成了透明度。代价也在这里：原有的透明信息会被整个覆盖掉，所以原图本来就透明的像素必须先用 `operator="in"` 与原始 alpha 相乘砍掉，否则它们的 RGB（通常是 0）会被算成「亮度 0 → 不透明」，透明区就变成黑块。

## 代码

```html
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-lumakey" color-interpolation-filters="sRGB">
    <!-- @mechanism alpha 行读的是 RGB 的加权和；取负并补 1 就是 1 − 亮度 -->
    <feColorMatrix in="SourceGraphic" type="matrix" result="keyed"
      values="1 0 0 0 0
              0 1 0 0 0
              0 0 1 0 0
             -0.2126 -0.7152 -0.0722 0 1" />
    <!-- @mechanism 先与原 alpha 相乘：本来就透明的地方不能被重新点亮 -->
    <feComposite in="keyed" in2="SourceAlpha" operator="in" result="safe" />
    <!-- @mechanism 把 alpha 拉陡，压掉抗锯齿留下的半透明灰边 -->
    <feComponentTransfer in="safe">
      <feFuncA type="linear" slope="2.4" intercept="-0.35" />
    </feComponentTransfer>
  </filter>
</svg>

<div class="badge">
  <strong>白底图现在能浮在深色上</strong>
  <span>白被解释成透明，不是被盖住</span>
</div>
```

```css
.badge {
  /* @mechanism 滤镜把「白」解释成透明，所以元素自己的浅色底正是被抠掉的那部分 */
  filter: url(#sb-lumakey);
  background: linear-gradient(#ffffff, #eef2f7);
  display: grid;
  gap: 8px;
  padding: 30px 34px;
  color: #14181f;
  font: 700 22px/1.4 system-ui, sans-serif;
}

.badge span {
  color: #5b6675;
  font: 400 15px/1.5 system-ui, sans-serif;
}
```

## 边界

- 白底能抠掉，**彩色底不能**：这一行只认亮度，所以任何够亮的颜色都会被一起抠掉（浅黄的装饰、亮青的高光），任何够暗的底色都会留着。抠彩色底要按色相或饱和度算，`feColorMatrix` 的线性式做不出「只抠绿」。
- 原有透明通道会被覆盖：透明像素的 RGB 通常是 0，`1 − 0 = 1`，于是它们会变成不透明的黑块。中间那一步 `operator="in"` 与 `SourceAlpha` 不能省。
- 拉陡 `feFuncA` 能压掉灰边，但细笔画会跟着被吃掉。`slope` 给太大，小字号文字会断层、缺口。
- 系数受颜色空间影响：不写 sRGB 时它们作用在 linearRGB 上，同一张图在不同浏览器里会抠出不同结果——阈值附近的像素尤其明显。
- 它抠掉的是「白」的**不透明度**，抠不掉白底本身在抗锯齿边留下一圈浅灰。那圈灰的亮度略低于 1，会被保留成一道淡描边；要靠拉陡 alpha 才能削掉。

## 备注

- 同一行权重取正（`+0.2126 +0.7152 +0.0722`），就变成「黑底变透明」，可以抠掉黑底图——这就是亮度键控的两个方向。
- 把 alpha 行当遮罩用，还能给整棵子树做「按亮度淡出」：它作用于元素的渲染结果，比 `mask-image` 多管一层子元素。
