---
title: 单元素翻折
slug: fold-plane
category: 动效
tags: [3D, 透视, 变换]
since: 2026-09
source: 机制取自 SpinKit（MIT）的 sk-plane，自行实现
when: 一个方块要有真实的翻折立体感，但不想加容器、不想加 JS
stage: grid
tier: candidate
params:
  - { name: dur, label: 一个周期, type: range, min: 0.6, max: 3, step: 0.1, default: 1.4, unit: s }
  - { name: depth, label: 透视距离, type: range, min: 80, max: 900, step: 20, default: 260, unit: px }
---

## 描述

一个方块像纸片一样绕自己的轴翻过来，中间有一瞬几乎看不见。

机制是 ==把 perspective() 直接写进 transform==。透视距离越短，近处放大得越夸张，翻折感越强。不写它、只写 `rotateY` 的话，得到的是一个横向被压扁的平行四边形，看起来像「缩窄」而不是「翻面」。

## 代码

```html
<div class="fp"></div>
```

```css
.fp {
  width: 96px;
  height: 96px;
  background: #b4462f;
  animation: fp-fold var(--dur, 1.4s) ease-in-out infinite; /* @mechanism */
}

@keyframes fp-fold {
  0% {
    transform: perspective(var(--depth, 260px)) rotateX(0deg) rotateY(0deg);
  }
  50% {
    transform: perspective(var(--depth, 260px)) rotateX(-180deg) rotateY(0deg);
  }
  100% {
    transform: perspective(var(--depth, 260px)) rotateX(-180deg) rotateY(-180deg);
  }
}
```

## 边界

- `perspective()` 写在 `transform` 列表里时**必须放在最前面**，否则后面的变换已经在平面里算完了，透视不起作用。
- 翻到 90° 时投影宽度归零，会短暂「消失」一瞬。这是几何必然，不是渲染问题——嫌太突兀就在关键帧里避开 90°，或让前后两段不同步。
- `perspective` 属性（写在祖先上）与 `perspective()` 函数（写在元素上）语义不同：前者共享一个消失点，后者各算各的。一个元素要显得在空间里，两个相邻元素必须用属性版。
- `backface-visibility` 默认是可见的，所以翻过背面时看到的是镜像的正面。要么接受它，要么设成 `hidden` 让背面透明。

## 备注

- 把 `duration` 调长、`ease-in-out` 换掉，翻折的性格会完全变——同样的关键帧能做出很不一样的东西。
- 加 `-webkit-` 前缀已经没必要了：现代浏览器都原生支持 3D 变换。
