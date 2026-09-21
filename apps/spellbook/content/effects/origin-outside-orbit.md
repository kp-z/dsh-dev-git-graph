---
title: 支点在元素之外
slug: origin-outside-orbit
category: 动效
tags: [变换原点, 公转, 甩出]
since: 2026-09
source: miniMAC/magic（MIT） — bombLeftOut，改写为独立最小示例
when: 元素要像被甩出去一样画一条大弧离场
stage: dark
tier: core
---

## 描述

一块小方块被甩出去，走的是一条很大的弧线，同时模糊掉。

机制是 ==把 transform-origin 放到元素**外面**，旋转就成了绕远处一个点的公转==。原实现用的是 `-100% 50%`——原点的横坐标是元素的**左侧再往左一个元素宽度**的地方。

原点可以落在元素之外，这是「公转」与「自转」的分水岭；也是「甩」这个动作的全部来源。

## 代码

```html
<div class="orbit-stage">
  <div class="orbit-chip"></div>
</div>
```

```css
.orbit-stage {
  display: grid;
  place-items: center;
  width: min(320px, 80vw);
  height: 220px;
  background: #0a0810;
  /* @mechanism 原点在元素外面，公转的弧会扫出很远，必须裁掉 */
  overflow: hidden;
}

.orbit-chip {
  width: 76px;
  height: 76px;
  border-radius: 14px;
  background: linear-gradient(150deg, #14b8a6, #0d6e63);
  /* @mechanism 原点落在元素左侧之外一个宽度处 —— 绕远处一个点公转 */
  transform-origin: -100% 50%;
  animation: chip-fling 2.6s cubic-bezier(0.4, 0, 0.8, 0.4) infinite alternate;
}

@keyframes chip-fling {
  from {
    opacity: 1;
    transform: rotate(0deg);
    filter: blur(0);
  }
  to {
    opacity: 0;
    transform: rotate(-160deg);
    filter: blur(6px);
  }
}
```

## 边界

- 原点的**负百分比**含义是「元素外侧」。`-100% 50%` 指左边界再往左一个元素宽度处——这是最容易看错的地方，写 `-100px` 与 `-100%` 完全不是一回事。
- 公转半径很大时会**扫出容器很远**。原实现靠容器的 `overflow: hidden` 裁掉，不加的话元素会盖住页面其他部分。
- 它是「甩出去」而不是「滑出去」：弧线是支点偏离造成的。想要直线退场就别动原点。
- 半径（原点距离）决定弧的弯曲程度。原点在元素内是自转，贴着边缘是小弧，离得远是大弧——**同一个 rotate 能给出三种完全不同的运动**。
- 配 `filter: blur()` 会让它在飞出去的过程中「化掉」，代价是每帧重算像素。
- 和所有位移类动画一样，它不影响布局；元素飞走之后原位置仍然占着。

## 备注

- 原实现是 miniMAC/magic（MIT） 的 `bombLeftOut`（还有 `bombRightOut` 是对称的）。
- 把它和「偏移原点的公转」对比着看：那一条原点在容器中心、元素被推出去；这一条原点在元素之外、元素被甩出去。机制同源，方向相反。
