---
title: 内发光
slug: inner-glow
category: 材质
tags: [发光, 阴影, 质感]
since: 2026-09
source: 机制来自 CSS box-shadow 的 inset，自行实现
when: 深色面板要有一圈从边缘渗进去的光，像里面有东西在亮
stage: dark
tier: core
params:
  - { name: spread, label: 渗入深度, type: range, min: 4, max: 40, step: 2, default: 16, unit: px }
---

## 描述

面板边缘有一圈柔光往里渗，中间反而更暗，看着像凹进去或者里面有光源。

机制是 ==box-shadow 加 inset==。默认的阴影画在盒子外面，`inset` 把它翻到里面——于是阴影从边缘向内投射，形成内发光。可以用逗号叠好几层，一层管近处的锐利光边、一层管远处的弥散，质感比单层好得多。

关键是底下那层不能是纯黑：要有底色，光才有东西可以落在上面。

## 代码

```html
<div class="ig">
  <b>内发光</b>
  <p>光从边缘往里渗。</p>
</div>
```

```css
.ig {
  width: min(320px, 78vw);
  padding: 26px 28px;
  border: 1px solid rgb(217 164 65 / 0.3);
  background: radial-gradient(120% 120% at 50% 0%, #241d33 0%, #120f1c 72%);
  /* @mechanism inset 把阴影翻到盒子里面，从边缘向内投 */
  box-shadow:
    inset 0 0 var(--spread, 16px) rgb(217 164 65 / 0.3),
    inset 0 0 calc(var(--spread, 16px) * 3) rgb(124 92 255 / 0.18);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.ig b {
  display: block;
  margin-bottom: 6px;
  font-size: 18px;
}

.ig p {
  margin: 0;
  opacity: 0.72;
}
```

## 边界

- 底色不能是纯黑。内发光是「光落在底色上」，`#000` 上什么都不显示——看到的现象是「内发光没生效」，其实是没东西可照。
- `inset` 与普通阴影不能在同一条 `box-shadow` 里混着写同一组值，语义完全不同：一个向内一个向外。要叠就分条写。
- 模糊半径与扩展半径的作用不同：模糊半径让光变柔，扩展半径让光带变宽。只调前者会得到「贴边的亮线」，只调后者会得到「一整块灰」。
- 内发光对边框是**画在边框里面**的。有 `border` 时那圈边框会盖住发光的内侧，看起来发光是从边框内沿开始的。
- 多层 `inset` 阴影会逐层合成，层数多了成本上升。超过三层建议改用 `radial-gradient` 直接画。

## 备注

- 两层不同颜色（暖金 + 冷紫）叠出来的光比单色有层次，也更像有实体光源。
- 同一招把 `inset` 去掉就是外发光。外发光配 `border-radius` 能做出霓虹管的边缘光。
