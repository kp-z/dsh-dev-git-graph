---
title: 拉丝金属
slug: brushed-metal
category: 材质
tags: [repeating-gradient, gradient, 金属, 纹理, 按钮]
since: 2026-10
source: 机制来自 repeating-linear-gradient 的细密纹路配合方向性渐变遮罩，自行实现
when: 按钮或面板要做成拉丝铝那种有方向感的哑光金属
stage: dark
tier: core
params:
  - { name: grain, label: 纹理密度, type: range, min: 1, max: 6, step: 0.5, default: 2, unit: px }
  - { name: angle, label: 光源角度, type: range, min: 0, max: 180, step: 15, default: 105, unit: deg }
---

## 描述

一块铝板，表面有平行的细纹，光线扫过时纹路成片地亮起来又暗下去。

机制是 ==重复线性渐变给出高频细纹，再用一层跨纹路方向的柔光去调制它==。拉丝面的反光是**各向异性**的：细纹沿一个方向排布，垂直于纹路的光源会被整片纹路一起反射、形成一条宽阔的亮带；平行于纹路的光源则被纹路之间的缝隙切碎，几乎不反光。所以这里必须有两层——细纹负责「拉丝」的质感，柔光负责「光从哪个方向来」。

少了柔光那层，细纹只是均匀的花纹，像一块印刷的贴纸；少了细纹那层，柔光就退化成平滑的渐变。两层同时在场，才有金属那种「纹路在跟着光转向」的错觉。

`grain` 控制的是纹理密度，不是亮度。真拉丝的纹距在亚像素到一两个像素之间，密到接近噪声才像机器打磨过；调大之后纹路会变成肉眼可数的条纹，立刻成了塑料格栅。

## 代码

```html
<div class="bm" role="img" aria-label="拉丝金属面板"></div>
```

```css
.bm {
  width: 280px;
  height: 170px;
  border-radius: 10px;
  /* @mechanism 高频细纹负责质感，跨方向的柔光负责各向异性反光，两层缺一不可 */
  background:
    linear-gradient(
      var(--angle, 105deg),
      rgb(255 255 255 / 0.16) 0%,
      rgb(255 255 255 / 0.02) 34%,
      rgb(255 255 255 / 0.34) 52%,
      rgb(0 0 0 / 0.22) 70%,
      rgb(255 255 255 / 0.1) 100%
    ),
    repeating-linear-gradient(
      90deg,
      #6d747c 0px,
      #8b939c var(--grain, 2px),
      #5b6169 calc(var(--grain, 2px) * 2)
    );
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.35),
    inset 0 -1px 0 rgb(0 0 0 / 0.4),
    0 8px 22px rgb(0 0 0 / 0.45);
}
```

```js
// @mechanism 只改光源角度这一个变量，观察亮带整片平移——这正是各向异性反光的判据
const panel = document.querySelector('.bm')
panel?.addEventListener('pointermove', (event) => {
  const rect = panel.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  panel.style.setProperty('--angle', `${60 + x * 90}deg`)
})
```

## 边界

- **方向必须交叉。**细纹是 90deg（竖纹），柔光默认 105deg——只差 15 度，就是「斜着扫上去」的观感。如果两者角度一致，两层的明暗会沿着纹路走，看起来只是一条普通渐变，拉丝感消失。
- 细纹靠 `repeating-linear-gradient` 的像素级周期。在 DPR 为 1 的屏幕上 1px 的极细纹会闪（摩尔纹），`grain` 小于 1.5 时要留意；这也是为什么默认值取 2px 而不是 1px。
- 柔光里那几段 `rgb(... / 0.x)` 的白黑叠加决定了金属的「哑」还是「亮」。全用纯白会变成铬（那是另一种表面），全用灰会变成磨砂塑料。
- 缩放容器会整体缩放背景纹理，纹距跟着变——拉丝密度是绝对的物理尺度，不该随元素尺寸变，需要时用 `background-size` 固定。
- 它不是镜子。真实的拉丝面只会把光源拉成一条模糊的亮带，不会成像；所以代码里没有 `backdrop-filter`，也绝不该加反射贴图。

## 备注

- 同一套结构换成铜的色值（`#8a5a34` / `#c98f5a`）就是拉丝铜，机制一字不改。
- 想让它真的转起来，把 `--angle` 注册成 `<angle>` 后做无限动画即可，代价是每帧重绘整个背景层。
