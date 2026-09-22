---
title: 金属拼缝
slug: panel-seam
category: 材质
tags: [repeating-gradient, 金属, 纹理, 容器]
since: 2026-10
source: 机制来自 repeating-linear-gradient 的对称亮暗色标对，自行实现
when: 一大块金属要切成几块面板，接缝处有上一块压住下一块的厚度
stage: dark
tier: core
params:
  - { name: pitch, label: 拼缝间距, type: range, min: 60, max: 220, step: 10, default: 132, unit: px }
---

## 描述

一块金属被几条细缝分成若干块，每条缝的左边有一道亮线、右边有一道暗线。

机制是 ==一条重复的、对称的亮暗色标对==。拼缝不是「画一条深色线」，而是一对方向相反的边缘：左边的面板压住右边，于是缝的左侧是它被照亮的侧壁（亮），右侧是它投下的阴影（暗）。只有一条深线的拼缝看起来像画上去的格线；有了亮暗这一对，它才读作「两块板有厚度、并且一块压在另一块上面」。

关键在于这对色标必须**紧贴**。`repeating-linear-gradient` 的色标是按百分比或长度连续的，亮线和暗线之间只要隔开哪怕 2px，中间就会露出底色，边缘立刻失去「相邻两面」的错觉，变成两条平行的装饰线。示例里用陡峭的 1px 跨度把它们钉在一起，正因为物理上那个侧壁的宽度就是亚像素级的。

第二个关键是对称：亮暗这对色标在一个周期里只能出现一次。周期里重复出现两组时，会得到「双线缝」的观感，那是焊道或双面胶带，不是拼缝。

## 代码

```html
<div class="ps" role="img" aria-label="带拼缝的金属面板"></div>
```

```css
.ps {
  width: 300px;
  height: 200px;
  border-radius: 6px;
  background:
    /* @mechanism 紧贴的亮/暗色标对＝左侧面受光、右侧面投影，拼缝的厚度全靠这一对 */
    repeating-linear-gradient(
      90deg,
      rgb(0 0 0 / 0) calc(var(--pitch, 132px) - 1px),
      rgb(255 255 255 / 0.5) calc(var(--pitch, 132px) - 1px),
      rgb(0 0 0 / 0.62) var(--pitch, 132px),
      rgb(0 0 0 / 0) var(--pitch, 132px)
    ),
    /* @mechanism 叠一层同样周期、方向相反的竖缝，构成整块面板的网格 */
    repeating-linear-gradient(
      0deg,
      rgb(0 0 0 / 0) 99px,
      rgb(255 255 255 / 0.34) 99px,
      rgb(0 0 0 / 0.44) 100px,
      rgb(0 0 0 / 0) 100px
    ),
    linear-gradient(150deg, #98a0a8, #6d757d 46%, #878f97 78%, #5e666e);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.35),
    0 10px 26px rgb(0 0 0 / 0.5);
}
```

```js
// @mechanism 拼缝是同一套色标的周期平移，改一个变量整块面板重新分格
const panel = document.querySelector('.ps')
panel?.addEventListener('pointermove', (event) => {
  const rect = panel.getBoundingClientRect()
  const y = Math.round(((event.clientY - rect.top) / rect.height) * 8) + 4
  panel.style.setProperty('--pitch', `${Math.min(160, 48 + y * 10)}px`)
})
```

## 边界

- **亮线和暗线之间不能留空隙。**这是这套机制唯一的硬约束。写成 `#fff 0 1px, transparent 2px 3px, #000 4px 5px` 之类，中间露出底色，边缘就从「相邻两个面」退化成「两条线」。`repeating-linear-gradient` 的色标位置必须首尾相接。
- 两条缝的接法决定谁压在谁上面。示例里亮线在左、暗线在右＝左板压右板。把顺序对调，立刻变成右板压左板——这个方向必须和整幅画面的光向一致，否则同一个界面里会同时出现两种压盖关系。
- 横竖两组缝的间距不同（132px 与 100px）是刻意的：真面板的分割不是等距网格，等距会让它看起来像瓷砖或表格。要等距也行，但那时观感会偏向「工业地砖」而不是「机箱盖板」。
- `repeating-linear-gradient` 的周期是**绝对长度**，不随容器缩放。响应式布局里容器变宽时缝的数量会变，可能正好有一块面板被切在边缘上——这是不可控的，除非用 JS 按容器宽度算周期。
- 缝本身没有高光扫掠、没有凹陷感的纵深。它只给「分块」这件事；要每块板各自有独立的高光，必须真的用多个元素，一条背景渐变做不到。
- 拼缝是水平重复的，所以在**圆形或斜放的**容器上会很怪——缝到边缘是垂直切断的，除非容器本来就该是矩形的。

## 备注

- 换成 `repeating-radial-gradient` 就得到同心圆环的「车削纹」，那是另一种常见的金属分块方式。
- 把这对色标直接用作 `border-image` 的源图，可以只给某一条边装缝，机制不变。
