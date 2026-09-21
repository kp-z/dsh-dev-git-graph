---
title: 沿路径运动
slug: offset-path-motion
category: 动效
tags: [路径, 运动, offset]
since: 2026-09
source: 机制来自 CSS Motion Path，自行实现
when: 元素要沿一条曲线走，而不是直线来回
stage: grid
tier: core
params:
  - { name: dur, label: 走一趟用时, type: range, min: 1, max: 8, step: 0.5, default: 3.6, unit: s }
---

## 描述

一个小方块沿一条 S 形曲线滑过去，而且它自己会跟着曲线的方向转。

机制是 ==offset-path 给元素一条运动路径，offset-distance 表示走到路径的百分之几==。它的位置不再由 `transform` 的平移量描述，而是「路径上的一个点」。而且浏览器默认会让元素的朝向跟随路径切线（`offset-rotate: auto`），所以它自己会转过弯来。

`transform` 能做直线与旋转，做不了曲线——这就是它存在的地方。

## 代码

```html
<div class="op">
  <div class="op-dot"></div>
</div>
```

```css
.op {
  position: relative;
  width: min(340px, 80vw);
  height: 180px;
  border: 1px dashed rgb(60 48 30 / 0.36);
  background: rgb(255 255 255 / 0.26);
}

.op-dot {
  width: 26px;
  height: 26px;
  background: #b4462f;
  /* @mechanism 一条曲线路径，元素的位置由路径决定 */
  offset-path: path("M 22 140 C 90 20, 170 170, 250 60");
  offset-rotate: auto;
  animation: op-travel var(--dur, 3.6s) ease-in-out infinite alternate;
}

@keyframes op-travel {
  to {
    /* @mechanism 走完路径的百分比，不是坐标 */
    offset-distance: 100%;
  }
}
```

## 边界

- `path()` 里的坐标是**元素所在坐标系**的绝对坐标，不是相对自身的偏移。路径从 `0 0` 起笔时元素会跑到容器左上角。
- `offset-rotate` 默认是 `auto`，元素会跟着切线转。只想要位置、不想要转弯时必须显式写 `offset-rotate: 0deg`。
- `path()` 直观但**不响应式**（坐标是死的）。容器一变宽，路径不会跟着变。要自适应得用 `circle()` / `ellipse()` 这类基本形状。
- 它和 `transform` 同时用时，路径位移先于元素的 `transform` 生效。想让元素在路径上再自转，得把自转写进 `transform`，但要和 `offset-rotate` 协调好，否则两个旋转会叠加。
- 路径是二维的。`offset-path` 不接受 3D 路径，配合透视也做不出「绕圈」的景深。

## 备注

- `offset-distance` 是长度也可以是百分比，用百分比时路径变换会自适应——但 `path()` 的坐标仍然不会。
- 配 `offset-anchor` 可以改「元素的哪个点贴在路径上」，默认是中心。
