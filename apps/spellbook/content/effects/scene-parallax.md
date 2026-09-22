---
title: 透视视差
slug: scene-parallax
category: 动效
tags: [3d, transform, 容器, 滚动]
since: 2026-09
source: 机制来自 CSS 3D Transforms 的 translateZ 与 perspective，自行实现
when: 滚动时前后景以不同速度移动，做出景深
stage: dark
tier: candidate
params:
  - { name: depth, label: 景深, type: range, min: 40, max: 220, step: 20, default: 120, unit: px }
---

## 描述

滚动时近处的层移动得快、远处的层移动得慢，画面因此有了厚度。

机制是 ==translateZ 把层推到透视空间的深处，透视让不同深度的层获得不同的表观速度==。这不是「给每层设一个不同的滚动速度」——那是 JS 的做法。这里是让浏览器按 3D 几何去算：越远的层，在同样滚动距离下位移越小。

推远之后层会变小，所以还要用 `scale()` 补回来。

## 代码

```html
<div class="px-scene">
  <div class="px-layer px-far">远景</div>
  <div class="px-layer px-mid">中景</div>
  <div class="px-layer px-near">近景</div>
</div>
```

```css
.px-scene {
  position: relative;
  width: min(340px, 80vw);
  height: 190px;
  overflow-y: auto;
  /* @mechanism 透视定义在整个滚动容器上，所有层共享同一个空间 */
  perspective: 400px;
  background: #0a0810;
}

.px-layer {
  position: absolute;
  left: 0;
  right: 0;
  display: grid;
  place-items: center;
  height: 120px;
  font: 500 15px/1 system-ui, sans-serif;
  color: #f0ead9;
}

/* @mechanism 推远 + 放大补偿，同一滚动距离下位移更小 */
.px-far {
  transform: translateZ(calc(var(--depth, 120px) * -1)) scale(calc(1 + var(--depth, 120px) / 400));
  background: rgb(124 92 255 / 0.34);
  top: 10px;
}

.px-mid {
  transform: translateZ(calc(var(--depth, 120px) * -0.5)) scale(calc(1 + var(--depth, 120px) / 800));
  background: rgb(20 184 166 / 0.38);
  top: 130px;
}

.px-near {
  transform: translateZ(0) scale(1);
  background: rgb(180 70 47 / 0.6);
  top: 250px;
}
```

## 边界

- 推远之后元素会变小，**必须**用 `scale()` 反向补偿。少了补偿，四周会露出背景，看起来像「层缩水了」。
- `scale` 的补偿量要与深度对应（大致是 `(透视距离 + 深度) / 透视距离`）。随便填一个数会得到「缩放不对版」的观感。
- `perspective` 要写在**滚动容器**上，让所有层共享一个空间。写在每个层上等于各自透视，深度关系就没了。
- 它和浏览器自带的滚动惯性会打架：快速滚动时远层会「追不上」，出现明显的拖影。
- 视差是**最容易引发前庭不适**的效果之一。正式项目必须配 `prefers-reduced-motion` 把它降级成无位移的静态版。
- `translateZ` 为正值会把层推到屏幕外（比自己更大），大多数情况下用负值把层推远。

## 备注

- `perspective-origin` 能改透视的消失点，默认在容器中心。改它可以让视差从某一侧发散。
- 它不是唯一做法：`background-attachment: fixed` 只有两层，但代价小得多；`translateZ` 方案层数不受限。
