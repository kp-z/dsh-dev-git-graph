---
title: 粘性融合
slug: gooey-blob
category: 图形
tags: [滤镜, 融合, 阈值]
since: 2026-09
source: 机制来自 feGaussianBlur + feColorMatrix 的经典组合，自行实现
when: 两个圆形靠近时要像水银一样粘在一起，而不是各是各的
stage: dark
tier: core
params:
  - { name: blur, label: 融合半径, type: range, min: 4, max: 28, step: 2, default: 14 }
---

## 描述

两个圆靠近时中间连起一条腰、再慢慢分开——像水银。

机制是 ==先模糊、再把透明度「阈值化」，顺序不能反==。糊开之后两个圆之间的过渡区变成了半透明；阈值化把所有中间值推向两端（要么全不透明、要么全透明），于是那片半透明的连接区被判定成「实心」，两个圆就粘在了一起。

这里模糊由 CSS 的 `blur()` 负责、阈值由 SVG 的 `feColorMatrix` 负责，两者串在同一条 `filter` 声明里——**这样模糊半径才是一个能传进去的参数**。

## 代码

```html
<svg width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-goo">
    <feColorMatrix in="SourceGraphic" mode="matrix"
      values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" />
  </filter>
</svg>

<div class="goo">
  <span class="goo-a"></span>
  <span class="goo-b"></span>
</div>
```

```css
.goo {
  position: relative;
  width: min(300px, 80vw);
  height: 170px;
  /* @mechanism 模糊用 CSS、阈值用 SVG 滤镜，按书写顺序依次作用 */
  filter: blur(var(--blur, 14px)) url(#sb-goo);
  background: #0d0a14;
}

.goo span {
  position: absolute;
  top: 50%;
  width: 68px;
  height: 68px;
  margin-top: -34px;
  border-radius: 50%;
  background: #b4462f;
}

.goo-a {
  left: 60px;
  animation: goo-a 3.4s ease-in-out infinite alternate;
}

.goo-b {
  right: 60px;
  background: #d9a441;
  animation: goo-b 3.4s ease-in-out infinite alternate;
}

@keyframes goo-a {
  from { translate: 0 0; }
  to   { translate: 46px 0; }
}

@keyframes goo-b {
  from { translate: 0 0; }
  to   { translate: -46px 0; }
}
```

## 边界

- 顺序不能反。先阈值化再模糊，得到的是边缘糊掉的普通圆——完全不粘。
- 粘性的强弱由 **feColorMatrix 的 alpha 行**决定（这里是 `0 0 0 19 -9`）。那个 19 越大越容易粘，-9 是偏移。调它比调模糊半径更直接。
- 模糊半径要**大于两者之间的间隙**才连得上。半径小于间隙时它们就是两个独立的圆，看起来像「滤镜没生效」。
- 模糊半径是这一条**唯一能做成参数**的量。CSS 的 `filter` 允许把函数与 SVG 滤镜串在同一条里：`blur(...)` 负责糊、`url(#...)` 负责阈值，从左到右依次作用。反过来把模糊写进 `feGaussianBlur` 的 `stdDeviation` 就够不到了——**SVG 滤镜属性不接受 CSS 变量**（这是门禁拦下的第三类「参数够不到」）。
- 滤镜必须加在**共同容器**上。分加在各自元素上时两者不会互相粘，因为每个元素自己糊自己的。
- 滤镜会影响容器内的**所有**内容，包括文字（字也会被糊成一团）。文字必须放在滤镜容器之外。
- 滤镜会创建合成层并可能裁剪边缘。容器要留出足够的内边距，否则圆的边缘会被切掉。

## 备注

- 同一套滤镜用在「三个圆依次靠近」上就是经典的加载动画，机制完全一样。
- 它属于那种「参数只有一个、效果却很昂贵」的做法：看着是水墨，其实是模糊加阈值。
