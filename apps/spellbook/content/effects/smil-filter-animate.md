---
title: 用 SMIL 驱动滤镜参数
slug: smil-filter-animate
category: 动效
tags: [svg-filter, blur, 光晕, 按钮, 自动]
since: 2026-10
source: 机制来自 SMIL animate 对滤镜原语属性的驱动，自行实现
when: 想让模糊、噪声、位移这些滤镜参数自己动起来，而 CSS 动画根本够不到它们
stage: dark
tier: candidate
---

## 描述

一层柔光自己在呼吸，一胀一缩，而改它的不是 CSS 动画，是滤镜内部的一条 `<animate>`。

机制是 ==滤镜原语的数值——`stdDeviation`、`baseFrequency`、`seed`、`radius`、`dx`——是 XML 属性而不是 CSS 属性，CSS 的 transition、`@keyframes`、变量都改不动它们==。要在这些数值上做动画只有两条路：把 `<animate>` 写进滤镜原语里（SMIL），或者在 JS 里 `setAttribute` 改属性。

值得单独记下来的原因：CSS 的 `filter: blur(4px)` 能动画，是因为那是**元素级**的滤镜函数；参数一旦落进 `url(#f)` 这个黑盒，浏览器就没有把它暴露给 CSS 的通道——`--blur` 传不进去，`@keyframes` 也不认。所以「用滑杆调滤镜参数」这类需求，最后都得回到改属性上。SMIL 的好处是不写 JS 就能跑，坏处是它对用户偏好一无所知，得自己补一道关。

## 代码

```html
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-breathe" x="-70%" y="-70%" width="240%" height="240%"
          color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="soft">
      <!-- @mechanism stdDeviation 是 XML 属性，只能由滤镜内部的 animate 驱动 -->
      <animate attributeName="stdDeviation" dur="3.2s" repeatCount="indefinite"
               values="3; 15; 3" keyTimes="0; 0.5; 1" calcMode="spline"
               keySplines="0.4 0 0.2 1; 0.4 0 0.2 1" />
    </feGaussianBlur>
    <feFlood flood-color="#63f0c8" result="glow" />
    <feComposite in="glow" in2="soft" operator="in" result="halo" />
    <feMerge>
      <feMergeNode in="halo" />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>
</svg>

<button class="lamp" type="button">会呼吸的柔光</button>
```

```css
.lamp {
  /* @mechanism CSS 只能决定「用哪条滤镜」，滤镜内部的参数由 SMIL 自己动 */
  filter: url(#sb-breathe);
  background: none;
  border: 0;
  padding: 22px 28px;
  color: #d8fff2;
  font: 700 24px/1 system-ui, sans-serif;
}
```

```js
// @mechanism SMIL 不看 prefers-reduced-motion，减少动效必须自己停掉它
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.querySelectorAll('#sb-breathe animate').forEach((node) => node.remove())
}
```

## 边界

- SMIL 完全无视 `prefers-reduced-motion`。CSS 媒体查询碰不到 `<animate>`，不自己停，就是在给「减少动效」的用户强播动画。
- `<animate>` 改的是属性，`values` 里写 `calc()`、`var()`、CSS 函数一律无效——必须是滤镜属性本身认的字面量。这也是它和 CSS 动画最容易混淆的地方。
- 动画滤镜每一帧都要重跑整条滤镜链。让 `stdDeviation` 在一整屏的背景上呼吸，等于每帧重新模糊一次全屏，开销远高于 `transform` 动画。
- 用 JS 改参数必须 `setAttribute('stdDeviation', ...)`；改 `style` 没有任何作用——这正是「CSS 够不到」的另一面。
- 模糊半径变大时光晕会伸出元素盒，滤镜区域不跟着外扩就会被切成一条直线。这里的 ±70% 是为最大半径留的。

## 备注

- 同一套写法可以驱动 `feTurbulence` 的 `baseFrequency`——水波、火焰的流动感都靠它。
- 要做真滑杆：把 `var` 写进滤镜属性是没用的，得在 `input` 事件里 `setAttribute`，改完的属性值会立刻生效，不需要重建滤镜。
