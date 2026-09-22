---
title: 撕纸边
slug: torn-paper-edge
category: 图形
tags: [feDisplacementMap, svg-filter, 纸感, 容器]
since: 2026-10
source: 机制来自 SVG feDisplacementMap 的各向异性位移，自行实现
when: 一块色带要做成从纸上撕下来的样子，边缘是纤维而不是刀切
stage: plain
tier: core
---

## 描述

色带的上下两条边不再是直线：边上长出长短不一的纤维，像手撕的纸。换个颜色、换个宽度，纤维的样子不变。

机制是 ==只让硬边沿垂直于它的方向被位移，而位移量的疏密由噪声的两个方向频率分别控制==。噪声在沿边方向取高频、在垂直于边的方向取低频，于是整条边朝着同一个大方向起伏，起伏的细节又足够碎——这正是纤维的样子。

之所以不用画路径：位移图只认数值不认形状，把一条直边揉成毛边不需要路径，也不需要三套边缘图片。`scale` 是纤维的**长度**，`baseFrequency` 的第一个数是纤维的**细密程度**，两者分工明确：只调 `scale`，起伏幅度变大但颗粒不变；只调频率，颗粒变细但幅度不变。频率写反（垂直方向高频、沿边低频）就得到一条整体错位的边，那是错版不是撕裂。

## 代码

```html
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-tear" x="-6%" y="-28%" width="112%" height="156%"
          color-interpolation-filters="sRGB">
    <!-- @mechanism 沿边方向高频、垂直方向低频：大方向一致，细节是碎的 -->
    <feTurbulence type="fractalNoise" baseFrequency="0.09 0.004"
                  numOctaves="3" seed="4" result="fiber" />
    <feDisplacementMap in="SourceGraphic" in2="fiber" scale="34"
                       xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>

<div class="slip">
  <strong>撕下来的票根</strong>
  <span>纤维是位移量，不是画出来的路径</span>
</div>
```

```css
.slip {
  /* @mechanism 位移作用在元素自己的像素上，所以直边是唯一被「撕」的地方 */
  filter: url(#sb-tear);
  background: repeating-linear-gradient(0deg, #c8402f 0 9px, #bd3a2a 9px 10px);
  color: #fff3e2;
  padding: 26px 30px;
  display: grid;
  gap: 6px;
  font: 600 17px/1.5 system-ui, sans-serif;
}
```

## 边界

- 位移会把像素搬到元素盒外面，滤镜区域不扩就会被裁掉——现象是纤维的尖被齐齐切平，看起来像「边缘有毛刺但顶部是一条直线」。
- 撕的是**整个元素**的四条边，上下都长纤维。只想撕一条边，得让另外三条边落在容器外面（负外边距）或者先用 `mask` 把它们切掉。
- 纤维是半透明的：位移采样到元素外面的透明像素，所以撕口会露出底下的背景。放在杂色或照片背景上，纤维会糊掉、看起来只是边缘发虚。
- 撕裂也会把元素上的文字一起扭。文字要工整，得把它放在滤镜容器之外。
- `filter` 会创建 containing block 与新的合成层：容器内 `position: fixed` 的后代会失效，`backdrop-filter` 后代也会失灵。

## 备注

- 同一套位移换个频率，就是水彩晕开、粗糙印刷的断笔；`scale` 给到 60 以上，直边会碎成孤立的墨点，适合做被虫蛀过的效果。
- 想要「只有一条边」且不挪容器，可以用 `feComposite operator="in"` 把位移结果裁回一个只覆盖那条边的矩形里。
