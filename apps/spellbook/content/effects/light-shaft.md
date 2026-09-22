---
title: 斜射光柱
slug: light-shaft
category: 材质
tags: [gradient, blur, transform, 发光]
since: 2026-09
source: 自行实现
when: 深色场景里要一束从上方斜射下来的光
stage: dark
tier: core
params:
  - { name: skew, label: 倾斜角, type: range, min: -40, max: 40, step: 2, default: -18, unit: deg }
---

## 描述

一束光从右上斜射下来，落在深色底上，边缘是散开的。

机制是 ==一条竖直的亮带 + skewX 拉斜 + 大半径模糊==。亮带本身只是 `linear-gradient` 从半透明的暖白渐变到全透明；`skewX` 把它压斜；模糊抹掉斜切留下的硬边。光的「射下来」感来自渐变在垂直方向的衰减——上亮下透。

那层模糊是必需的。少了它，你看到的是一块斜着的半透明矩形。

## 代码

```html
<div class="ls">
  <b>一束光</b>
</div>
```

```css
.ls {
  position: relative;
  display: grid;
  place-items: center;
  width: min(360px, 80vw);
  height: 200px;
  overflow: hidden;
  background: #0a0810;
  font: 600 20px/1 system-ui, sans-serif;
  color: #f4efe2;
}

.ls::before {
  content: "";
  position: absolute;
  top: -35%;
  left: 46%;
  width: 46%;
  height: 170%;
  pointer-events: none;
  /* @mechanism 上亮下透的亮带，斜切后模糊，才像光 */
  background: linear-gradient(180deg, rgb(255 236 194 / 0.55) 0%, transparent 74%);
  transform: skewX(var(--skew, -18deg));
  filter: blur(24px);
  opacity: 0.6;
}
```

## 边界

- 渐变必须**上亮下透明**。两端都亮就成了一根柱子，不是光——那是最容易犯的错。
- 模糊半径要够大（20px 起）。半径小的时候能看到 `skewX` 留下的硬边，整块看起来是个斜的矩形。
- `overflow: hidden` 不能少。光带故意做得比容器高（`height: 170%`），超出的部分要裁掉。
- 光层必须带 `pointer-events: none`，否则它会盖住下面所有可点、可悬停的东西——出问题时现象是「按钮点不动」。
- 多条光柱叠在一起时亮度会相加。要更接近真实光，给光层加 `mix-blend-mode: screen`，它按「光的相加」而不是「颜料叠加」来算。

## 备注

- 一束不够就用两束：第二条换个角度、更窄更淡，马上有体积感。
- 把亮带换成暖色与冷色各一条，就成了「冷暖对切」的舞台光。
