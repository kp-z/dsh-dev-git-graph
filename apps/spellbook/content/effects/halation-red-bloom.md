---
title: 胶片光晕的偏色
slug: halation-red-bloom
category: 材质
tags: [胶片, 光晕, 色偏]
since: 2026-10
source: 机制来自胶片 halation 的成因，红光在片基里二次散射，自行实现
when: 一张夜景要有胶片味，亮处周围带着一圈红
stage: dark
tier: core
params:
  - { name: far, label: 红晕半径, type: range, min: 8, max: 60, step: 2, default: 30, unit: px }
---

## 描述

夜景里那扇亮窗的周围洇出一圈红，越往外越淡；红晕比白晕铺得远得多，亮部的芯子却还是白的。

机制是 ==同一块亮部叠两遍，近的一层保持原色，远的一层放大半径并染红==。这是 halation 与普通泛光的分界：光在乳剂层里曝光之后，红光还会穿透到片基背面、反射回来、再散射着出射一次，等于多走了一段路，而蓝绿光在这一趟里被吸收掉了。所以胶片上的辉光不是「亮部整体变模糊」，而是亮部额外获得一圈偏红、半径更大的副本。拆成两层正好对应这两段路：近层暖白、小半径，远层深红、大半径，两层都走加光混合。

如果只用一层染色模糊，红和白会一起糊掉，看着像镜头脏了；两层分开，白只留在芯子上、红只出现在外缘，才像胶片。可变的是 `--far`（红晕半径）与红色的浓度。示例里近层半径约为远层的三分之一，接近常见 35mm 负片的表现；红晕再浓一点就会滑向廉价滤镜。

## 代码

```html
<figure class="halation"><i></i></figure>
```

```css
.halation {
  position: relative;
  display: grid;
  place-items: center;
  width: min(420px, 86vw);
  height: 240px;
  background: #06070b;
  isolation: isolate;
}

/* 亮窗本体 */
.halation i {
  width: 76px;
  height: 52px;
  background: #fff6e4;
}

.halation::before,
.halation::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 76px;
  height: 52px;
  translate: -50% -50%;
  mix-blend-mode: plus-lighter;
  pointer-events: none;
}

/* @mechanism 远层放大半径并染红，对应红光在片基里多走的那一段 */
.halation::after {
  background: rgb(255 46 32 / 0.5);
  filter: blur(var(--far, 30px));
  scale: 1.18;
}

/* @mechanism 近层小半径、保持原色，亮部的芯子才不会被染红 */
.halation::before {
  background: rgb(255 232 190 / 0.55);
  filter: blur(9px);
}
```

## 边界

- `plus-lighter` 是通道直接相加，两层重叠的中央会顶到纯白并且丢不回细节。亮部本身已经很亮时，要把两层的 alpha 都降下来，别指望它自己收敛。
- 不支持 `plus-lighter` 的浏览器会退回普通混合，现象是那圈红变成一块盖在画面上的红色矩形、边界生硬。它不报错，只是难看。
- 两层的尺寸都写死在 CSS 里，亮部换了比例就得两边一起改。实际项目里应该由一个自定义属性同时驱动元素与伪元素的尺寸。
- `blur` 半径是固定值，画面缩放时红晕不会等比缩放，会显得「糊得不对」。响应式场景下半径要跟着尺寸走。
- 深红叠在深色底上会往暗处渗，看着比预期更宽。纯黑底上最干净，带一点环境光的底最容易翻车。

## 备注

- 同一招把远层换成偏蓝紫，得到的是「冷调胶片」，很多夜景调色就是这么做的，只是方向相反。
- 红晕也能用两层 `drop-shadow()` 实现，但每一层的颜色和半径都必须挤在一个函数里，调起来不如伪元素直观。
