---
title: 液体波纹折射
slug: liquid-ripple-displacement
category: 图形
tags: [svg-filter, feTurbulence, feDisplacementMap, 液体, 图片, 自动]
since: 2026-10
source: 机制来自 SVG 滤镜规范里 feTurbulence 与 feDisplacementMap 的通道约定，自行实现
when: 一张静止的图想要像隔着一层晃动的水面，但不想引入视频或 WebGL
stage: photo
tier: core
---

## 描述

一张图被一层水揉过：边缘在缓慢起伏，颜色被轻微扯开，像隔着水面看水底的瓷砖。晃动是连续的，没有一跳一跳的感觉。

机制是 ==用 feTurbulence 现算一张噪声，让 feDisplacementMap 把噪声的 R、G 两个通道分别读成横向与纵向的位移量==。噪声本身没有形状，它只是一片 0–1 之间的数字；位移图不关心它长什么样，只拿这些数字去查表，于是「噪声 → 位移场 → 画面被揉皱」是一条纯数值的链子，不需要任何图片资源。

让这条链子动起来，只要让噪声自己变——这里用一条 `<animate>` 缓慢改 `baseFrequency`。位移场每帧变一点点，静止的图就有了流动感；变化足够慢，看起来才是水而不是抖动。`xChannelSelector` 与 `yChannelSelector` 决定哪一层数值管横、哪一层管竖，两者对调，水纹的走向跟着换。

## 代码

```html
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <!-- @mechanism 位移场是现算的，这一条不需要任何图片资源 -->
  <filter id="sb-water" x="-14%" y="-14%" width="128%" height="128%"
          color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.008 0.019"
                  numOctaves="2" seed="9" result="field">
      <!-- @mechanism 动的是噪声的频率而不是图形：位移场自己会流 -->
      <animate attributeName="baseFrequency" dur="18s" repeatCount="indefinite"
               values="0.008 0.019; 0.019 0.008; 0.008 0.019" />
    </feTurbulence>
    <feDisplacementMap in="SourceGraphic" in2="field" scale="24"
                       xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>

<div class="pond">
  <span>静止的图，被一层水揉过</span>
</div>
```

```css
.pond {
  /* @mechanism 位移会把像素挪出元素盒，边缘要留白，否则水纹在最外圈被裁平 */
  padding: 20% 9%;
  filter: url(#sb-water);
  background: radial-gradient(120% 90% at 20% 15%, #ffd9a0, #d1663f 45%, #4a2350 100%);
  border-radius: 14px;
  color: #fff8ec;
  font: 600 20px/1.5 system-ui, sans-serif;
}
```

## 边界

- 滤镜区域（`x`/`y`/`width`/`height`）默认只外扩 10%，位移会把像素推出这个盒子，推出去的部分直接被裁掉——现象是水纹在最外圈忽然变直。这里是按位移量外扩到 14%。
- 位移量由 `scale` 与噪声的对比度共同决定：`fractalNoise` 的取值集中在 0.5 附近，所以 `scale` 要给到 20 上下才看得出揉皱；给 5 的时候你会以为滤镜没生效。
- SMIL 完全不理会 `prefers-reduced-motion`。CSS 的媒体查询管不到 `<animate>`，要尊重用户的减少动效偏好，只能另外用 JS 把这条动画停掉。
- 动画滤镜每一帧都要重跑整条滤镜链，开销与滤镜区域的面积成正比。铺满整屏的水纹会是页面上最贵的那个属性，比 `transform` 动画贵好几个数量级。
- 位移发生在**栅格化之后**：文字、图标、阴影会被一起揉。想让文字保持清晰，文字必须放在滤镜容器之外。

## 备注

- 同一套位移，把色带换成黑→红→橙→黄就是火焰，把频率调高、尺度调大就是热浪。
- 和「折射边缘」「手绘抖线」的分工：那两条要的是**静态**的位移图（一条做玻璃边、一条做毛边），这一条的机制在时间维度上——位移场自己在流。
