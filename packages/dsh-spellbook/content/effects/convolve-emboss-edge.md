---
title: 卷积浮雕
slug: convolve-emboss-edge
category: 图形
tags: [svg-filter, 浮雕, 描边, 标题]
since: 2026-10
source: 机制来自 SVG feConvolveMatrix 的 3x3 卷积核，自行实现
when: 文字或线稿要一条自己长出来的立体边，而不是另画一层描边
stage: plain
tier: candidate
---

## 描述

一行字被压出了浅浅的立体感：左上受光、右下背光，像从纸里浮起来，而笔画本身没有变粗。

机制是 ==feConvolveMatrix 把每个像素换成它邻居的加权和；权重加起来是 0 时，平坦区域的加权和互相抵消，只有明暗变化的地方留下非零值==。所以「和为零」的核算出来的不是颜色，而是**明暗的变化率**——也就是边。

`bias` 必须补 0.5，原因也在同一句话里：变化率可以是负数，而通道值会被截断在 0 以下，浮雕就只剩亮的半边。`bias="0.5"` 把整张图抬到中灰再算，负的差值才有地方落下去。同一个机制还能两头翻：权重和改成 1（比如 `0 -1 0 / -1 5 -1 / 0 -1 0`），算出来的就是「像原来的图、但边被加强」，也就是锐化。**核的和是 0 还是 1，决定它是提取边还是保留图。**

## 代码

```html
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-relief" x="-6%" y="-6%" width="112%" height="112%"
          color-interpolation-filters="sRGB">
    <!-- @mechanism 权重和为 0：平坦处抵消，只有边留下；bias 把 0 抬到视觉中灰 -->
    <!-- 对角线上的那个 0 不是留白：它保证正负权重只落在核的两侧，浮雕方向才干净 -->
    <feConvolveMatrix order="3" preserveAlpha="true" divisor="1" bias="0.5"
      kernelMatrix="-2 -1  0
                    -1  0  1
                     0  1  2" />
  </filter>
</svg>

<p class="relief">凸起来的一行字</p>
```

```css
.relief {
  /* @mechanism 卷积吃的是已栅格化的结果：文字的抗锯齿边就是它要「雕」的那些边 */
  filter: url(#sb-relief);
  margin: 0;
  color: #ffffff;
  font: 800 44px/1.3 system-ui, sans-serif;
}
```

## 边界

- 纯色与纯渐变的**平坦区域做卷积后是一片中灰**：变化率为 0，只剩下 bias 抬起来的 0.5。所以给一块纯色加浮雕，看到的只是它的轮廓，不是「整块鼓起来」——块面感要内阴影，那是另一条（见「压印浮雕」）。
- `bias` 漏写（默认 0）时所有负值被截断，浮雕只剩亮边，看起来像单侧描边，很容易误判成「滤镜没生效」。
- 权重和为 1 之外的核会整体改变亮度；`divisor` 不跟着补齐时会整体溢出成纯白或纯黑。
- 1px 的细线在 3×3 窗口里会被上下两行的正负权重抵消掉，整条线消失。线宽小于核的阶数时，卷积看不见它。
- 卷积按设备像素计算，`order` 增大成本按平方涨：3×3 是最常用的，5×5 在移动端已经能感到延迟。
- 不写 `color-interpolation-filters="sRGB"` 时，同一组权重作用在 linearRGB 上，明暗分布不同，`bias="0.5"` 也不会落在视觉中灰。

## 备注

- 把核的上下两行对调、左右两列对调，受光方向就从左上换成右下，不用重画素材。
- 锐化就是同一条链上最常见的用途：`0 -1 0 / -1 5 -1 / 0 -1 0`，和为 1。
