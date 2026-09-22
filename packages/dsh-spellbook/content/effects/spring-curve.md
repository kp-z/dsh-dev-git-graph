---
title: 会过冲的弹簧曲线
slug: spring-curve
category: 动效
tags: [easing, keyframes, 容器, 自动]
since: 2026-09
source: 机制来自 CSS Easing Functions Level 2 的 linear()，自行实现
when: 元素要冲过目标再弹回来，但 cubic-bezier 怎么调都弹不起来
stage: grid
tier: core
params:
  - { name: dur, label: 用时, type: range, min: 0.3, max: 1.6, step: 0.1, default: 0.8, unit: s }
---

## 描述

方块冲过目标位置，再退回一点，最后停稳——有重量的感觉。

机制是 ==linear() 用一串采样点手写任意缓动曲线==。`cubic-bezier` 的两个控制点被规范限制在纵轴 0–1 之间，所以**它做不出超过 1 的过冲**。`linear()` 没有这个限制，可以给出 `1.06`、`0.97` 这样的值，于是能表达弹簧。

## 代码

```html
<div class="sp-wrap">
  <div class="sp-box"></div>
</div>
```

```css
.sp-wrap {
  display: flex;
  align-items: center;
  width: min(420px, 84vw);
  height: 90px;
  padding: 0 10px;
  border: 1px dashed rgb(60 48 30 / 0.4);
  background: rgb(255 255 255 / 0.28);
}

.sp-box {
  width: 52px;
  height: 52px;
  background: #b4462f;
  /* @mechanism linear() 的采样点可以超过 1，这是贝塞尔做不到的过冲 */
  animation: sp-slide var(--dur, 0.8s) linear(0, 0.35 12%, 0.86 24%, 1.06 36%, 0.97 48%, 1.01 62%, 1) infinite alternate;
}

@keyframes sp-slide {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(100% + 280px));
  }
}
```

## 边界

- `cubic-bezier` 的纵轴被规范限制在 0–1，**做不出过冲**。这就是弹簧感必须用 `linear()` 的原因，不是风格偏好。
- 采样点太少会一顿一顿的（`linear()` 本质是折线）。转折处给密一点，平缓段可以稀。
- 过冲会让元素越出容器边界。父级有 `overflow: hidden` 时，超出部分直接被裁掉，看起来像「弹到一半消失了」。
- 括号里的百分比是**时间轴**上的位置，不是数值占比。写错顺序（不是单调递增）会得到乱七八糟的跳动。
- 它同样受 `prefers-reduced-motion` 影响：过冲对前庭敏感的人是明显的不适源，正式项目要能关掉。

## 备注

- `linear()` 也能表达「分段停顿」，等价于把多个动画串在一个属性里，比叠加多个 keyframes 好调。
- 弹簧参数（刚度、阻尼）通常由设计工具导出成采样点，直接贴进来即可，不必手推。
