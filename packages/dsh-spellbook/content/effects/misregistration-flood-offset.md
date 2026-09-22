---
title: 印刷错版
slug: misregistration-flood-offset
category: 图形
tags: [svg-filter, 标题, 色彩]
since: 2026-10
source: 机制来自 SVG feFlood 与 feOffset 加 feComposite 的 in 运算符，自行实现
when: 标题要有廉价印刷那种套色没对准的味道，而不是加一圈硬阴影
stage: dark
tier: candidate
---

## 描述

文字的轮廓旁边浮出一层青、一层品红，两块颜色朝相反方向偏出去几个像素，像旧印刷机套色没对准。

机制是 ==把同一份 alpha 复制成两份、各自偏移几个像素、各自用 feFlood 灌上纯色，再压回原形下面==。`feFlood` 生成的是无限大的纯色面，`operator="in"` 用 alpha 把它剪成形状——所以上色这一步完全不碰源图的颜色，只借用它的轮廓。改颜色就是改 `flood-color`，一个像素都不用重画。

它和「外发光」的区别在于偏移是**矢量**而不是模糊：两份色版各自位移，边缘是硬的、色块是实的；两个方向的偏移量还能不同（青偏左、品红偏右），合起来才是套印不准的味道，而不是一圈均匀的光。同一套机制反过来用 `operator="out"` 就是挖洞——用 in2 的 alpha 从 in 上减掉交集。

## 代码

```html
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-misreg" x="-18%" y="-18%" width="136%" height="136%"
          color-interpolation-filters="sRGB">
    <feOffset in="SourceAlpha" dx="-4" dy="2" result="shiftL" />
    <feOffset in="SourceAlpha" dx="4" dy="-2" result="shiftR" />
    <!-- @mechanism feFlood 是无限色面，operator="in" 用 alpha 把它剪成这个形状 -->
    <feFlood flood-color="#25d3d3" result="cyan" />
    <feComposite in="cyan" in2="shiftL" operator="in" result="plateC" />
    <feFlood flood-color="#ff3d7f" result="magenta" />
    <feComposite in="magenta" in2="shiftR" operator="in" result="plateM" />
    <!-- @mechanism 两块色版先叠，原形压在最上面，颜色只从字形边缘露出来 -->
    <feMerge>
      <feMergeNode in="plateC" />
      <feMergeNode in="plateM" />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>
</svg>

<h1 class="misreg">套色没对准</h1>
```

```css
.misreg {
  /* @mechanism 偏移的色版会伸出元素盒，滤镜区域不扩就只剩一侧有色版 */
  filter: url(#sb-misreg);
  margin: 0;
  color: #f6f1e7;
  font: 800 46px/1.2 system-ui, sans-serif;
  letter-spacing: 0.03em;
}
```

## 边界

- 偏移量是绝对的用户单位，不随字号缩放：同一套 `dx`/`dy` 用在小字号上，错版会比笔画还宽。字号变了要手动调偏移。
- 原形必须**不透明**才能盖住色版。半透明的文字（或 `opacity` 小于 1）会让两块色版从字身里透出来，变成一团脏色的叠印。
- `feFlood` 的颜色会经过 linearRGB 转换，同一个十六进制值出来的颜色偏亮偏艳；要跟设计稿一致就必须写 `color-interpolation-filters="sRGB"`。
- 这条链上有两次 `feFlood`（各是一次整块区域的填充）加三次合成，元素面积大时开销明显，只有标题级别的元素才划算。
- 错版只加在轮廓上，所以它对**细笔画**几乎不可见：笔画宽度小于偏移量时，两块色版会各自独立、看起来像重影而不是套印。

## 备注

- 两份色版偏移量取同一个方向、不同大小，就是「重影」；取相反方向才是经典的错版。
- 把 `operator="in"` 换成 `operator="out"`，就能用任意 alpha 在另一层形状上挖洞——文字镂空、印章缺口都是这一条。
