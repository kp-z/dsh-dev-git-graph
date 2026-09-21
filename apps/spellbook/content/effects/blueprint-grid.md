---
title: 蓝图网格
slug: blueprint-grid
category: 图形
tags: [网格, 纹理, 技术感]
since: 2026-09
source: 机制来自 CSS 线性渐变平铺，自行实现
when: 要一层技术图纸那样的细网格，做深色底或图版背衬
stage: dark
tier: core
params:
  - { name: cell, label: 格子边长, type: range, min: 8, max: 48, step: 2, default: 26, unit: px }
---

## 描述

一层淡淡的网格线铺在深色底上，像工程图纸或者绘图软件的画布。

机制是 ==两条 1px 的线性渐变，各管一个方向，再靠 background-size 定格子大小==。一条 `linear-gradient` 画水平线、一条画垂直线，两条都不重复（`no-repeat` 不写也能工作，因为平铺的就是这张最小图块）。格子边长由 `background-size` 一个值控制，纵横同时生效。

## 代码

```html
<div class="bp">
  <b>蓝图底</b>
  <p>两条渐变，一层网格。</p>
</div>
```

```css
.bp {
  width: min(380px, 80vw);
  padding: 30px;
  background-color: #0d1a24;
  /* @mechanism 两条 1px 渐变，一个方向一条 */
  background-image:
    linear-gradient(rgb(120 190 255 / 0.24) 1px, transparent 1px),
    linear-gradient(90deg, rgb(120 190 255 / 0.24) 1px, transparent 1px);
  /* @mechanism 一个值同时定纵横格子 */
  background-size: var(--cell, 26px) var(--cell, 26px);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #cfe4f5;
}

.bp b {
  display: block;
  margin-bottom: 6px;
  font-size: 18px;
}

.bp p {
  margin: 0;
  opacity: 0.66;
}
```

## 边界

- 1px 的线在高 dpi 屏上会因为像素取整而时粗时细。要绝对均匀就写 `0.5px`，或者让网格间距是设备像素的整数倍。
- 网格从左上角起算，容器出现半格时看起来像「没对齐」。要么用 `background-position` 挪到中心，要么让容器尺寸是格子边长的整数倍。
- 两条渐变的顺序决定谁画在上面。它们颜色相同时看不出差别，加了两种颜色做「主次网格」才需要留意。
- 深底浅线看得清，浅底深线在低对比屏幕上容易消失。做浅色主题时透明度要往上调。

## 备注

- 加第三条更大间距、更亮的线，就能做出「每五格一条粗线」的工程图纸效果——经典的三层网格。
- `background-color` 与 `background-image` 分开写，改底色的时不会碰坏网格。
