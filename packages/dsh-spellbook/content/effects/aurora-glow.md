---
title: 极光流动
slug: aurora-glow
category: 图形
tags: [blur, conic-gradient, 极光, 光晕, 页头]
since: 2026-09
source: 自行实现
when: 首屏背景要一片缓慢流动的彩色光，但不想上 WebGL、也不想视频
stage: dark
tier: core
params:
  - { name: blur, label: 模糊半径, type: range, min: 20, max: 120, step: 5, default: 70, unit: px }
---

## 描述

深色底上几团颜色互相晕开又缓慢游走，边界全化掉了。

机制是 ==把一块彩色渐变放大到超出容器，用大半径 blur 糊掉硬边，再慢慢旋转它==。`conic-gradient` 会给出一圈分明的色带；模糊把这些硬边化成流体的过渡。旋转让同一块色斑在视野里移动，看起来像在流动。

好看的关键全在模糊半径够不够大。半径小的时候，它就是一个「模糊的彩色圆盘」，没有那股气。

## 代码

```html
<div class="au">
  <b>极光底色</b>
  <p>一块模糊的锥形渐变在慢慢转。</p>
</div>
```

```css
.au {
  position: relative;
  isolation: isolate;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  width: min(400px, 82vw);
  height: 220px;
  overflow: hidden;
  background: #0a0810;
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.au::before {
  content: "";
  position: absolute;
  /* 必须比容器大，否则边缘会露出一圈没糊到的硬边 */
  inset: -45%;
  z-index: -1;
  /* @mechanism 分明的色带被大半径模糊化成流体 */
  background: conic-gradient(from 0deg, #14b8a6, #7c5cff, #f43f5e, #ff9a5a, #14b8a6);
  filter: blur(var(--blur, 70px));
  animation: au-spin 18s linear infinite;
}

.au b {
  font-size: 18px;
}

.au p {
  margin: 0;
  opacity: 0.7;
}

@keyframes au-spin {
  to {
    transform: rotate(1turn);
  }
}
```

## 边界

- 模糊层必须**比容器大**（这里用 `inset: -45%`）。正好铺满的话，四边会露出一圈没有糊到的硬边，看起来像没对齐。
- 半径小于 40px 左右就没有「气」了，只剩一块模糊的彩色斑。值要设得比直觉大得多，这是这个效果的全部成本所在。
- 大半径 blur 很吃 GPU，动起来更甚。铺满整屏时移动端会明显发热掉帧——把模糊层面积收小，或者减速到 30 秒以上一圈。
- `overflow: hidden` 不可少，模糊后的层会溢出容器边界，把周围全糊住。
- 没有处理 `prefers-reduced-motion`。持续旋转的背景对前庭敏感的人很不友好，正式项目里应当停掉动画只留静态底。

## 备注

- `z-index: -1` 加父级 `isolation: isolate` 把模糊层压在内容之下，同时不让它混到页面背景上去。
- 把 `conic-gradient` 换成几层 `radial-gradient` 会得到更柔的「云团」感，锥形则更接近极光的条带。
