---
title: 让自定义属性可过渡
slug: property-transition
category: 动效
tags: [property, conic-gradient, 色彩, 自动]
since: 2026-09
source: 机制来自 CSS Properties and Values API，自行实现
when: 渐变的角要转起来，或者自定义属性要参与过渡，但改了值只会硬跳
stage: dark
tier: core
params:
  - { name: dur, label: 一圈用时, type: range, min: 1, max: 12, step: 0.5, default: 4, unit: s }
---

## 描述

一束锥形渐变绕着中心转，颜色随之扫过整块。

机制是 ==@property 给自定义属性一个类型，它才可以被插值==。默认的自定义属性是「无类型字符串」——浏览器拿到 `0deg` 和 `360deg` 不知道该怎么算中间值，所以 `transition` 与 `animation` 对它完全无效，值会直接跳变。用 `@property` 声明 `syntax: '<angle>'` 之后，它变成真正的角度，就有了中间态。

这是让渐变角度、颜色、长度这类**变量**能动起来的唯一途径。

## 代码

```html
<div class="pt">
  <span class="pt-label">旋转的渐变</span>
</div>
```

```css
/* @mechanism 声明类型，自定义属性才有中间值 */
@property --pt-angle {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}

.pt {
  position: relative;
  display: grid;
  place-items: center;
  width: 190px;
  height: 190px;
  overflow: hidden;
  background: #0a0810;
  font: 500 15px/1 system-ui, sans-serif;
  color: #f0ead9;
}

.pt::before {
  content: "";
  position: absolute;
  inset: -30%;
  /* @mechanism 变量参与渐变，靠 @property 才能被动画插值 */
  background: conic-gradient(
    from var(--pt-angle),
    #b4462f,
    #d9a441,
    #7c5cff,
    #14b8a6,
    #b4462f
  );
  animation: pt-spin var(--dur, 4s) linear infinite;
}

.pt-label {
  position: relative;
  z-index: 1;
  padding: 7px 14px;
  background: rgb(10 8 16 / 0.72);
}

@keyframes pt-spin {
  to {
    --pt-angle: 360deg;
  }
}
```

## 边界

- 不注册 `@property` 时，自定义属性的动画会**直接跳变**，而且不报错。这是最典型的「动画写了没反应」。
- `initial-value` 在没有它的情况下整条 `@property` 会被忽略（除非 `syntax` 是 `*`），症状和不写一模一样——很难从现象倒推回来。
- `inherits: false` 通常是想要的：渐变角度这类值不该往下传，传下去子元素的同名变量会互相干扰。
- 它注册的是**自定义属性**，不是已有 CSS 属性。别指望用它让 `width` 这类属性能被某种新方式动画。
- 每帧都要重算整块渐变，代价远高于 `transform`。能用 `transform: rotate()` 解决的场景就别用它——它真正的价值是给那些**本来无法动画**的值开口子。
- 支持面上注意 Firefox 的版本，不支持的浏览器会退回「跳变」，动画看起来是静止的。

## 备注

- 同一招能让 `background-image` 里的颜色位置、`clip-path` 的百分比都动起来——凡是「写死在函数参数里的值」都有机会。
- 它也是「渐变描边能旋转」的钥匙：把 `metal-foil` 里的 `from` 角度注册成 `<angle>` 就能转。
