---
title: 放倒一样的翻面
slug: perspective-unfold
category: 动效
tags: [3d, transform, keyframes, 卡片, 退场]
since: 2026-09
source: miniMAC/magic（MIT） — perspectiveDown，改写为独立最小示例
when: 一张卡片要绕底边往后倒下去，像立牌被放倒
stage: dark
tier: core
---

## 描述

一张卡片绕底边往后栽下去，倒到贴平为止。

机制是 ==perspective() 写在 transform 里、原点放在底边，rotateX(180deg) 就把它放倒==。这里有个容易混的点：`perspective()` 是 **transform 的一个函数**（只作用于这一个元素自己的变换），而 `perspective` 是 **父级上的属性**（作用于所有子元素的空间关系）。这一条用的是前者。

原点在底边，所以倒的方向是「贴着那条边往后」。

## 代码

```html
<div class="unfold-stage">
  <div class="unfold-card">
    <b>立牌</b>
  </div>
</div>
```

```css
.unfold-stage {
  display: grid;
  place-items: center;
  width: min(320px, 80vw);
  height: 220px;
  background: #0a0810;
}

.unfold-card {
  display: grid;
  place-items: center;
  width: 140px;
  height: 140px;
  background: linear-gradient(150deg, #241d33, #120f1c);
  border: 1px solid rgb(217 164 65 / 0.42);
  font: 600 17px/1 system-ui, sans-serif;
  color: #f0ead9;
  /* @mechanism 原点在底边，绕这条边往后倒 */
  transform-origin: 0 100%;
  animation: unfold 3s cubic-bezier(0.5, 0, 0.3, 1) infinite alternate;
}

@keyframes unfold {
  from {
    transform: perspective(800px) rotateX(0deg);
  }
  to {
    /* @mechanism perspective() 是 transform 的函数，只作用于本元素 */
    transform: perspective(800px) rotateX(-180deg);
  }
}
```

## 边界

- `perspective()` **函数**与`perspective` **属性**不是一回事。函数写在 `transform` 里、只作用于本元素自身；属性写在**父级**上、决定所有子元素共享的透视空间。用错位置会得到「压扁」而不是「倒下去」。
- `perspective()` 必须**写在 `rotate` 前面**（`transform: perspective(800px) rotateX(...)`）。写在后面等于先转再透视，效果完全不同。
- 倒到 180 度时元素是**背面朝前**的，文字会镜像。要避免就给卡片单独设 `backface-visibility: hidden`，或者别倒满 180 度。
- 透视距离（800px）决定「相机多远」。数值越小透视越夸张，太小时元素会变形到认不出。
- 原点决定了倒向哪一侧：`0 100%` 是绕左下角，`50% 100%` 是绕底边中点，`100% 100%` 是绕右下角。这是三个不同的效果。
- 和所有 3D 变换一样，它**不影响布局**，倒下去之后原位置还占着。

## 备注

- 原实现（miniMAC/magic（MIT） 的 `perspectiveDown`）配了 `perspectiveDownReturn` 做回程；这里用 `alternate`。
- 把 `rotateX` 换成 `rotateY`、原点换成左边，就是左右开合——机制完全对称。
