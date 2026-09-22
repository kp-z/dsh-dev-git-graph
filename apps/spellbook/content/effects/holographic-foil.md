---
title: 全息贴纸
slug: holographic-foil
category: 材质
tags: [repeating-gradient, blend-mode, 全息, 虹彩]
since: 2026-09
source: 自行实现
when: 一块表面要有镭射贴纸那种随角度变的彩色
stage: dark
tier: core
params:
  - { name: angle, label: 条纹角度, type: range, min: 0, max: 180, step: 15, default: 115, unit: deg }
---

## 描述

一块表面上有几道斜向的彩色条纹在互相叠加，颜色因位置而不同。

机制是 ==多层线性渐变 + 非普通的混合模式==。单层渐变只是一条可预测的色带；把两三层不同角度、不同周期的渐变叠加，并用 `screen` 或 `overlay` 混合，重叠处的颜色就会互相改变——这才是「镭射」的观感来源。

颜色不是被设计出来的，是**叠出来的**。

## 代码

```html
<div class="hf">
  <span>全息</span>
</div>
```

```css
.hf {
  position: relative;
  display: grid;
  place-items: center;
  width: min(280px, 78vw);
  height: 170px;
  border-radius: 4px;
  overflow: hidden;
  background: #16121f;
  font: 700 16px/1 system-ui, sans-serif;
  color: rgb(255 255 255 / 0.9);
}

.hf::before,
.hf::after {
  content: "";
  position: absolute;
  inset: -20%;
  /* @mechanism 条纹角度与周期不同，重叠处才互相改变颜色 */
  background: repeating-linear-gradient(
    var(--angle, 115deg),
    rgb(255 90 150 / 0.5) 0 6px,
    rgb(120 220 255 / 0.5) 6px 13px,
    rgb(200 255 140 / 0.5) 13px 19px,
    transparent 19px 34px
  );
}

.hf::after {
  /* @mechanism 第二层换个角度并错开周期，叠加出不可预测的颜色 */
  background: repeating-linear-gradient(
    calc(var(--angle, 115deg) * -0.6),
    rgb(255 220 120 / 0.42) 0 9px,
    rgb(180 130 255 / 0.42) 9px 17px,
    transparent 17px 41px
  );
  mix-blend-mode: screen;
  opacity: 0.72;
}
```

## 边界

- 两层条纹的**角度与周期都要不同**。角度一样时叠加只是把颜色加深，没有镭射感。
- 混合模式决定了观感。`screen` 偏亮（像发光贴纸），`overlay` 保留底色的明暗（像烫印）。选错方向会得到一块脏色。
- 透明度要压住。两层都按原色叠加会过曝成一片白，镭射的感觉全部丢失。
- 这种效果**以不同的屏幕渲染会有明显差异**（尤其广色域屏），设计稿上的颜色不能当作精确目标。
- 它看起来是「花」的，压在上面的文字必须有足够对比度——通常要加深色底或加描边。

## 备注

- 真正的镭射随视角变化，CSS 只能给一个固定的角度。要能动就得靠指针位置写进变量（那是「跟着指针的光晕」那条的路子）。
- 同一机制换成两种金属色就是「双色烫印」，换成同色系就是「绸缎」。
