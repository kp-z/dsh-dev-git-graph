---
title: 偏移原点的公转
slug: orbit-transform
category: 动效
tags: [transform, keyframes, easing, 加载, 自动]
since: 2026-09
source: 自行实现
when: 元素要绕着另一个点转圈，而不是绕自己打转
stage: dark
tier: core
params:
  - { name: radius, label: 轨道半径, type: range, min: 20, max: 90, step: 5, default: 62, unit: px }
---

## 描述

一颗珠子绕着中心匀速转圈，而且它自己始终不倒——朝向不变。

机制是 ==旋转的是「臂」，珠子被 translate 推到臂的末端==。`transform-origin` 默认在元素中心，所以直接给一个圆点加旋转动画，它只会原地打转、看起来根本没动。把它从旋转中心推开，旋转才变成公转。

珠子还想保持朝向，就再给它一个**反向**的旋转动画，两者抵消。

## 代码

```html
<div class="ob">
  <div class="ob-arm"></div>
  <div class="ob-core"></div>
</div>
```

```css
.ob {
  position: relative;
  display: grid;
  place-items: center;
  width: 190px;
  height: 190px;
}

.ob-core {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #d9a441;
}

.ob-arm {
  position: absolute;
  inset: 0;
  /* @mechanism 旋转这个臂（原点在中心），珠子挂在臂的末端 */
  animation: ob-spin 6s linear infinite;
}

.ob-arm::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  background: #b4462f;
  box-shadow: 0 0 14px rgb(180 70 47 / 0.6);
  /* @mechanism 推离旋转中心，旋转才会带着它绕圈 */
  translate: var(--radius, 62px) 0;
  /* @mechanism 反向自转，抵消公转带来的转动，朝向保持不变 */
  animation: ob-unspin 6s linear infinite;
}

@keyframes ob-spin {
  to {
    rotate: 1turn;
  }
}

@keyframes ob-unspin {
  to {
    rotate: -1turn;
  }
}
```

## 边界

- 直接给一个圆点加旋转动画看不出任何变化——圆是旋转对称的，而且原点就在它自己中心。要么把它推离旋转中心，要么换成不对称的形状。
- 现代独立属性 `translate` / `rotate` / `scale` 的应用顺序是**固定**的（先平移、再旋转、最后缩放），与你在 CSS 里的书写顺序无关。`transform` 简写则按书写顺序生效。两者不等价，混用时最容易搞错。
- 反向自转的时长与缓动必须与公转**完全一致**，否则珠子会肉眼可见地晃。
- `transform-origin` 只影响 `rotate` 与 `scale`，**不影响 `translate`**。想靠它来挪位置是没用的。
- 臂的尺寸决定了旋转中心的位置（这里是父级的几何中心）。父级没有明确尺寸时，原点落在哪是不确定的。
- 这颗珠子在转，但它的**布局位置**没变。做碰撞检测或点击热区时，实际区域还在原地——位移全是视觉层的。

## 备注

- 用两颗珠子、反向的臂，就得到一个简单的原子模型；用三颗就是三重轨道。
- 轨道半径做成变量后，改一个值整条轨道跟着变，不必逐个调 `translate`。
