---
title: 膨胀描边
slug: morphology-outline
category: 图形
tags: [svg-filter, feMorphology, 描边, 标题, 图标]
since: 2026-10
source: 机制来自 SVG feMorphology 在 alpha 通道上的膨胀与收缩，自行实现
when: 文字或图标要一圈贴纸式的实心描边，而且笔画不能被描边吃掉
stage: dark
tier: core
---

## 描述

文字外面多了一圈实心描边，像贴纸；字形本身一点没被吃掉，细笔画也照样干净。

机制是 ==feMorphology 在 alpha 通道上做膨胀，把所有不透明的区域往外扩若干像素，得到一圈比原形更大的实心轮廓==，再用 `feComposite operator="in"` 拿这块轮廓当剪刀去剪一块纯色，露出来的那一圈就是描边。原形最后压在最上面，所以描边只往外长，永远不吃笔画。

这正是它比 `-webkit-text-stroke` 可靠的地方：CSS 的文字描边是**居中**的，一半压在字形里侧，字重越细被吃掉的越多；而膨胀只动 alpha，不看形状怎么画。它也不挑对象——文字、图标、透明 PNG、`clip-path` 剪出来的块，一律按不透明像素处理，所以「给任何东西加贴纸边」只需要一条滤镜。描边色来自 `feFlood`，与元素的填充色完全无关。

## 代码

```html
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-sticker" x="-30%" y="-30%" width="160%" height="160%"
          color-interpolation-filters="sRGB">
    <!-- @mechanism 在 alpha 上膨胀：原形不动，往外扩出一圈 -->
    <feMorphology in="SourceAlpha" operator="dilate" radius="5" result="fatter" />
    <feFlood flood-color="#38e0c8" result="ink" />
    <!-- @mechanism 用膨胀后的 alpha 去剪纯色，剩下的一圈就是描边 -->
    <feComposite in="ink" in2="fatter" operator="in" result="outline" />
    <!-- @mechanism 原形压在最上面，所以描边只往外长、不吃笔画 -->
    <feMerge>
      <feMergeNode in="outline" />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>
</svg>

<h1 class="sticker">贴纸描边</h1>
```

```css
.sticker {
  /* @mechanism 滤镜区域要外扩，往外长的描边超出默认的 10% 就会被裁掉 */
  filter: url(#sb-sticker);
  margin: 0;
  color: #171a1f;
  font: 800 46px/1 system-ui, sans-serif;
  letter-spacing: 0.02em;
}
```

## 边界

- `radius` 是 SVG 属性，**不接受 CSS 变量**：写成 `radius="var(--r)"` 整条滤镜会被判为非法、整个效果消失。所以粗细做不成滑杆，只能预备两三个固定粗细的滤镜，或者用 JS 改属性。
- 滤镜区域默认只外扩 10%，而 dilate 是实实在在地往外长像素。区域不够时描边会在最外圈被齐平切掉，现象是「描边只在某几个方向有」。
- `radius` 的单位是用户单位：元素被 `transform: scale()` 放大时描边跟着变粗。要恒定粗细得反过来缩 radius。
- 膨胀会把**半透明像素也推成不透明**：原本柔和的抗锯齿边会变硬变宽，笔画细到一定程度会糊成一团。
- 不写 `color-interpolation-filters="sRGB"` 时，`feFlood` 的颜色会经过 linearRGB 转换，同一个十六进制值出来的描边明显偏亮偏艳。
- 滤镜作用在容器的全部内容上：容器里若同时有图标和文字，它们各自得到一圈描边，而不是合并成一个共同的外轮廓。

## 备注

- 把 `operator` 换成 `erode`，再用 `feComposite operator="out"` 与原图相减，得到的是**内侧**描边——这就是「负描边」。
- 同一套滤镜加在透明 PNG 图标上，就是不用重画矢量的最短贴纸边路径。
