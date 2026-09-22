---
title: 漏光
slug: light-leak-streak
category: 材质
tags: [blend-mode, gradient, 胶片, 图片]
since: 2026-10
source: 机制来自胶片漏光与 plus-lighter 的加光混合，自行实现
when: 一张暗色画面想要胶片的意外曝光，光从某一侧边缘渗进来
stage: dark
tier: core
params:
  - { name: bleed, label: 渗入深度, type: range, min: 60, max: 340, step: 10, default: 200, unit: px }
---

## 描述

画面左侧边缘有一片橙红的光渗进来，斜着扫过左下角；右侧也有一抹淡淡的洋红。像胶卷在暗盒里被边缝漏进的光烧了一下。

机制是 ==漏光是往画面里「加」光，必须用 plus-lighter 这种真加法混合，而不是 screen==。`screen` 会把两个通道按 `1-(1-a)(1-b)` 压，多层叠加时很快顶到白，色相被冲干净，最后只剩一片灰白；`plus-lighter` 是通道直接相加，叠几层仍然留得住色相，只有真的超出才截断——这正是「曝光」这件事的数学。配合大半径、贴边的线性渐变就成立了：光是从边缘进来的，所以渐变轴要垂直于那条边，而不是随便歪一个角度。

漏光还落在内容的上面、与画面内容无关，所以用伪元素承载最合适，两层各管一侧。可变的是渗入深度 `--bleed`、方向、颜色与层数。红橙与洋红是最常见的组合，因为漏光色的成因是片基与背纸的透过光谱，它们天然偏长波长。

## 代码

```html
<div class="leak">
  <p>胶片漏光</p>
</div>
```

```css
.leak {
  position: relative;
  display: grid;
  place-items: center;
  width: min(440px, 88vw);
  height: 240px;
  overflow: hidden;
  background: #0a0806;
  color: #b9a894;
  font: 400 13px/1.6 system-ui, sans-serif;
  isolation: isolate;
}

.leak::before,
.leak::after {
  content: "";
  position: absolute;
  inset: 0;
  /* @mechanism 通道相加而不是 screen，叠两层之后还留得住色相 */
  mix-blend-mode: plus-lighter;
  pointer-events: none;
}

/* @mechanism 渐变轴垂直于左边，光才读得出「从边缘渗进来」 */
.leak::before {
  background: linear-gradient(
    100deg,
    rgb(255 122 40 / 0.5) 0%,
    rgb(255 64 28 / 0.22) calc(var(--bleed, 200px) / 2),
    rgb(255 40 20 / 0) var(--bleed, 200px)
  );
}

/* @mechanism 另一侧改用洋红，两个方向的加光叠起来才有「边缘曝光」的脏感 */
.leak::after {
  background: linear-gradient(
    280deg,
    rgb(255 40 120 / 0.34) 0%,
    rgb(190 30 190 / 0.12) calc(var(--bleed, 200px) / 2),
    rgb(190 30 190 / 0) var(--bleed, 200px)
  );
}

.leak p {
  position: relative;
  z-index: 1;
}
```

## 边界

- `plus-lighter` 里各层的 alpha 是相加的。三层以上、每层都超过 0.4 就必然顶成白色块，那时画面已经不像漏光，而像糊了一层奶。
- 混合只在自己的隔离组里成立。父级缺 `isolation: isolate` 时，漏光会越过这一块和页面其他部分叠加，把别的东西也染红。
- 渐变终点用的是同色相的零 alpha，不是 `transparent`。在加光混合下后者会贡献一点黑，边缘多出一圈发灰的过渡带。
- 漏光贴在边缘，一旦容器的圆角大于渗入深度，四角会露出没被覆盖的直角区域。
- 它盖在内容之上，正文的对比度会随之变化。浅色文字压在高饱和红上几乎读不出来，正式项目里要给文字层留出避让区域。

## 备注

- 同一套两层加光渐变反过来用就是「屏幕反光」——颜色换成偏冷的白，贴边改成顶边，立刻变成玻璃上的环境反光。
- 想要更脏的漏光质感，可以在渐变上再叠一层很淡的噪点，让光斑边缘不那么数学。
