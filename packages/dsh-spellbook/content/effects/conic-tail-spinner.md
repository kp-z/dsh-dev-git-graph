---
title: 带渐隐尾巴的转圈
slug: conic-tail-spinner
category: 动效
tags: [conic-gradient, mask, keyframes, 加载, 自动]
since: 2026-10
source: 机制来自 CSS conic-gradient 的角向插值与 mask 挖空，自行实现
when: 要一个转圈等待指示器，尾巴要自然淡出，但不想切图也不想引 SVG
stage: dark
tier: core
params:
  - { name: dur, label: 转一圈用时, type: range, min: 0.4, max: 3, step: 0.1, default: 0.9, unit: s }
---

## 描述

一圈青色弧在转，尾巴那头渐渐消失在背景里，看起来像一支被拖住的笔。

机制是 ==conic-gradient 的色标按角度插值，从全透明渐到实色，尾巴是渐变的自然产物==。常见的做法是「一圈单色弧 + 一个白色方块盖住一头」，那需要第二个元素、还得猜背景色；而锥形渐变的取值单位是角度，`transparent 0deg` 到实色 `320deg` 之间浏览器会自己插值，于是**淡出这件事不需要额外元素，它是渐变的形状本身**。再用 `mask` 的径向渐变把圆心挖掉，彩色圆盘就成了一定粗细的环。

两个细节决定它像不像「在转」。第一，环的粗细由 mask 内外两个半径决定，两个色标之间要留 1px 的过渡带，否则边缘会有锯齿。第二，旋转用独立的 `rotate` 属性而不是 `transform: rotate()`：两者都动画时不会互相覆盖，这个元素上还能再挂别的位移或缩放动画。

## 代码

```html
<!-- 尾巴的方向由渐变的实色端决定，所以它天然有"前进"的读法 -->
<span class="cts" role="status" aria-label="加载中"></span>
```

```css
.cts {
  display: inline-block;
  width: 46px;
  aspect-ratio: 1;
  border-radius: 50%;
  /* @mechanism 色标按角度分布：从全透明渐到实色，尾巴就是这个渐变本身 */
  background: conic-gradient(from 0deg, transparent 0deg, #5eead4 320deg);
  /* @mechanism mask 挖空圆心，彩色圆盘才变成一圈有粗细的弧 */
  mask: radial-gradient(
    farthest-side,
    transparent calc(100% - 6px),
    /* @mechanism 内外半径留 1px 过渡带，不留就是锯齿边 */
    #000 calc(100% - 5px)
  );
  /* @mechanism 用独立的 rotate，不占用 transform 的位置 */
  animation: cts-spin var(--dur, 0.9s) linear infinite;
}

@keyframes cts-spin {
  to {
    rotate: 1turn;
  }
}
```

## 边界

- 两个 mask 色标写同一个值（都写 `calc(100% - 5px)`）：边缘会出现锯齿，因为抗锯齿需要至少一个像素的过渡带。
- 旧版 Safari 需要 `-webkit-mask` 前缀，只写标准属性时它会退化成一个实心彩色扇形圆盘——不破版，但完全不是你要的东西。
- 透明端是真的透明。放在浅色背景上，尾巴那一段看起来像「环缺了一块」；要让它像有底的弧，得另外画一层轨道。
- 匀速（`linear`）是这里的正确选择。加缓动会让角速度忽快忽慢，看起来像卡顿而不是呼吸。
- 周期太短（比如 0.3s）时视觉上会开始摩尔纹式的抖动。这不是浏览器的问题，是刷新率与角速度的采样关系。
- 没有 `prefers-reduced-motion` 分支：持续的旋转对动效敏感的人最不友好，应退化成静态的弧或进度文字。

## 备注

- 同一套「角向渐变 + 环状 mask」可以做成仪表盘、录音计时圈、能量环，只要把实色端换成多段色标。
- 旋转方向要和渐变的透明端对齐：实色端在前方拖着尾巴是对的，反过来会读成「倒放」。
