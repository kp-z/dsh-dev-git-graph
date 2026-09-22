---
title: 像门一样推开
slug: door-open-3d
category: 动效
tags: [transform, 3d, keyframes, 卡片, 自动]
since: 2026-09
source: miniMAC/magic（MIT） — openDownLeft，改写为独立最小示例
when: 一块面板要像被推开一扇门那样转出去，而不是原地自转
stage: dark
tier: core
params:
  - { name: angle, label: 推开角度, type: range, min: -180, max: 0, step: 10, default: -110, unit: deg }
---

## 描述

一块底板以左下角为轴转出去，像门被推开。

机制是 ==transform-origin 挪到角上，旋转就从「自转」变成「以那条边为轴铰接」==。默认原点在元素中心，`rotate()` 让它在原地打转；把原点放在 `bottom left`，同一个旋转就成了绕那条边的开合。

**同一个 `rotate`，只因为原点不同，读起来就是两件事。** 这个效果的全部就在这里。

## 代码

```html
<div class="door-stage">
  <div class="door"></div>
</div>
```

```css
.door-stage {
  display: grid;
  place-items: center;
  width: min(320px, 80vw);
  height: 210px;
  background: #0a0810;
}

.door {
  width: 150px;
  height: 150px;
  background: linear-gradient(150deg, #b4462f, #6d1f30);
  box-shadow: 0 14px 30px rgb(0 0 0 / 0.5);
  /* @mechanism 原点放在左下角，旋转变成绕这条边铰接 */
  transform-origin: bottom left;
  animation: door-swing 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate;
}

@keyframes door-swing {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(var(--angle, -110deg));
  }
}
```

## 边界

- `transform-origin` 与 `rotate` **必须写在同一处**（这里是同一个关键帧规则里）。写在元素的基础规则上而旋转写在关键帧里，原点会在动画中被重置回默认值。
- 原点决定「以哪里为轴」，这是从「自转」到「铰接」的唯一开关。原点在中心就是打转，在角上就是开门，在边中点上就是翻页。
- 转出去的部分会**超出容器**。要裁掉就加 `overflow: hidden`，要让它探出去就别加——两者是完全不同的观感，得先想清楚。
- 角度别超过 ±110 度左右。再多就转过界了，看着像「门被吹掉了」而不是「被推开」。
- 它只影响**绘制**，不影响布局。门转出去之后，它原来的位置仍然占着（也仍然能点到）。
- 如果用 `perspective` 添一点透视，会更像真的门；不加就是纯粹的平面旋转，也很干净。

## 备注

- 原实现（miniMAC/magic（MIT） 的 `openDownLeft`）还配了 `openDownLeftReturn` 作为回程；这里用 `alternate` 替代。
- 把原点换成 `top right` 就是从另一个方向开；换成 `center bottom` 就是从上往下倒。
