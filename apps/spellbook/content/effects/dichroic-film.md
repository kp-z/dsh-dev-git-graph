---
title: 二向色镀膜
slug: dichroic-film
category: 材质
tags: [镀膜, 干涉色, 混合模式]
since: 2026-10
source: 机制来自亮度守恒的色相旋转矩阵配合 difference 混合，自行实现
when: 一块玻璃或金属表面要呈现成对出现的干涉色，像镀了二向色膜
stage: dark
tier: core
---

## 描述

一块深色表面，同一片区域里金黄和靛蓝成对出现，交界处颜色反转。

机制是 ==把底图按亮度守恒的色相旋转矩阵搬到另一个色相，再与原图做 difference==。二向色镀膜的颜色不是画上去的，是**薄膜干涉**的结果：不同波长的光在膜的两个面上反射后相位不同，某些波长叠加增强、某些互相抵消，于是颜色必然**成对互补**地出现。CSS 算不了干涉，但可以造出同样的结果：色相旋转得到一份副本，两份相减时，低饱和处（旋转前后几乎同色）归零变黑，高饱和处差异最大、相长得最亮。颜色因此成对出现，且边界锐利。

这里用 SVG 的 3×3 色相矩阵而不是 CSS 的 `hue-rotate()`。原因有两条：`hue-rotate()` 是各家引擎的近似实现，同一个角度在 Chrome 与 Safari 上会有可见偏差；把矩阵显式写出来，脚本才能按 `cos/sin` 算出中间值，滑杆才真的是滑杆。

这也是它和 `holographic-foil` 的分界：那个靠多层渐变**叠加**出镭射条纹，条纹是贴上去的图案；这里靠两份副本的**相消相长**算出颜色对，底图一换，颜色对跟着换。

## 代码

```html
<svg width="0" height="0" aria-hidden="true">
  <filter id="df-huerot" color-interpolation-filters="sRGB">
    <!-- @mechanism 规范里的色相旋转矩阵，三行系数各自和为 1，所以整体亮度被保住 -->
    <feColorMatrix
      type="matrix"
      values="-0.527 0.803 0.724 0 0
               0.468 0.587 -0.055 0 0
              -0.130 1.722 -0.593 0 0
               0     0     0     1 0"
    />
  </filter>
</svg>

<div class="df">
  <div class="df-base"></div>
  <div class="df-shift"></div>
</div>
```

```css
.df {
  position: relative;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  overflow: hidden;
  background: #0a0c14;
}

.df-base,
.df-shift {
  position: absolute;
  inset: 0;
  background: conic-gradient(from 210deg, #ffd479, #ff7a45, #b03cc8, #2b6cff, #22d3a8, #ffd479);
}

.df-shift {
  /* @mechanism 色相搬走一份副本再与原图做 difference：同处归零、异处拔高，颜色成对出现 */
  filter: url(#df-huerot);
  mix-blend-mode: difference;
}

.df::after {
  content: "";
  position: absolute;
  inset: 0;
  /* @mechanism 一层极淡的柔光，把相消出来的死黑拉回金属的反光感 */
  background: radial-gradient(circle at 34% 26%, rgb(255 255 255 / 0.5), rgb(255 255 255 / 0) 46%);
  mix-blend-mode: screen;
  pointer-events: none;
}
```

```js
// @mechanism 角度得自己算成矩阵：浏览器不会替你换算，滑杆若没接上这段就只是个摆设
const matrixNode = document.querySelector('#df-huerot feColorMatrix')
const LUM = [0.213, 0.715, 0.072]
// 规范里 sin 项的固定系数表，三行各自和为 0，所以只影响色相不影响亮度
const SIN = [
  [-0.213, -0.715, 0.928],
  [0.143, 0.14, -0.283],
  [-0.787, 0.715, 0.072],
]

function hueMatrix(deg) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const values = []
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      // a_ij = lum_j + cos·(δij − lum_j) + sin·SIN_ij
      values.push((LUM[j] + cos * ((i === j ? 1 : 0) - LUM[j]) + sin * SIN[i][j]).toFixed(3))
    }
    values.push(0, 0)
  }
  return values.join(' ')
}

matrixNode?.setAttribute('values', hueMatrix(140))
```

## 边界

- **相消的结果是纯黑，不是灰。**两张相同像素做 `difference` 精确等于 0。色相旋转后的副本在原图低饱和、偏暗的地方与它几乎相同，于是那些区域直接塌成黑色。在深底上这读作「镀膜的暗部」，在浅底上就是一块脏斑——这个效果几乎只适合深场。
- 底图必须有**连续变化的色相**（锥形、线性渐变都可以）。纯色底图做色相旋转后与自身差别很小，`difference` 几乎全黑，什么都看不见。
- `mix-blend-mode` 会新建层叠上下文，并与其所在层的全部内容混合。一旦 `.df` 或祖先设了 `isolation: isolate`、或它自己成了独立层，混合范围就被限制——这是混合模式「看着没生效」的头号原因。
- 色相旋转是线性代数，不是 HSL 旋转：它**守恒亮度**，所以转过去的颜色明度与直觉不符（亮黄会转成亮蓝，而不是深蓝）。想要同样鲜艳的色对，得手动压底图的明度。
- 那个矩阵不是正交变换，系数会**超出 [0,1]**（示例里就有 1.722 与 −0.593），高饱和输入会被截断。这是规范允许的近似，也让大角度旋转的色相有轻微失真——所以它是它、`hue-rotate()` 是它，两者都不要当成精确的色相工具。
- 滤镜的 `color-interpolation-filters` 必须显式写 `sRGB`。不写时默认是线性 RGB，同一个矩阵会算出明显不同的颜色。

## 备注

- 同一套「两副本相消」换成 `exclusion` 会得到更柔和的低饱和版本，像油膜浮在水面上。
- 色相旋转矩阵也能单独当换色工具用：它保住亮度，适合给照片做季节替换而不塌成灰。
