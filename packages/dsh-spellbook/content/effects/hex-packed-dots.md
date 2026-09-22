---
title: 六方密排点阵
slug: hex-packed-dots
category: 图形
tags: [radial-gradient, background-size, 图案, 几何]
since: 2026-10
source: 机制来自三角晶格（六方密排）的几何与背景层的整格偏移，自行实现
when: 点阵要铺满一片区域，又不想让点排成规规矩矩的方阵
stage: grid
tier: core
params:
  - { name: cell, label: 点间距, type: range, min: 14, max: 40, step: 2, default: 24, unit: px }
  - { name: dot, label: 点半径, type: range, min: 1, max: 5, step: 0.5, default: 3, unit: px }
---

## 描述

一片点阵，但点不是正方排列的——每个点周围有六个等距的邻居。

机制是 ==两层完全相同的点图，第二层在 x 与 y 方向各错开半格，并且把瓦片的高取成格宽的 √3 倍==。错半格只是把两套点错开，还不足以让邻居等距：把两层点合成一个点集之后，横向邻距是格宽 w，而斜向邻距是 `√(w² + h²) / 2`。要这两个数相等，得让 h = √3·w。其实这就是「一排一错位」的蜂窝排布——错半格是手法，√3 才是条件，缺了它得到的是菱形错位而不是六方密排。

两层仍各是一张可平铺的最小图块，所以这条咒语真正的成本只有两个数：格宽和点半径。两条 `background-size` 一模一样，只是 `background-position` 差半格，改格宽时两个表达式一起走。要做出「局部密、局部疏」的呼吸感，得改点半径的色标而不是这两层。

## 代码

```html
<!-- @mechanism 点阵在两层背景上，盒子内不需要内容 -->
<div class="hexdots"></div>
```

```css
.hexdots {
  width: min(320px, 78vw);
  height: 170px;
  background-color: #0d0a14;
  /* @mechanism 两层是同一张点图：圆心都在瓦片正中，点就不会被瓦片边裁掉 */
  background-image:
    radial-gradient(circle at 50% 50%, #d9a441 0 var(--dot, 3px), rgb(13 10 20 / 0) var(--dot, 3px)),
    radial-gradient(circle at 50% 50%, #d9a441 0 var(--dot, 3px), rgb(13 10 20 / 0) var(--dot, 3px));
  /* @mechanism 瓦片高 = 格宽 × √3，错半格后六个邻居的距离才都等于格宽 */
  background-size: var(--cell, 24px) calc(var(--cell, 24px) * 1.732);
  /* @mechanism 第二层偏移写成 calc，跟着格宽一起走；写死 px 就把格宽绑死了 */
  background-position: 0 0, calc(var(--cell, 24px) / 2) calc(var(--cell, 24px) * 0.866);
}
```

## 边界

- 高宽比必须是 √3 ≈ 1.732。写成 1 或 2（也就是「正方形瓦片错半格」）得到的是方形错位点阵：横排点距相等，斜向邻居更近，看起来是菱形不是蜂窝。
- 点半径超过格宽的一半时相邻点会连起来，六边形的负空间消失，整块变成一片糊状；那时它已经不是点阵而是「重叠圆」图案了。
- 半格偏移必须跟着格宽走。把偏移写成固定的 px，只要把滑杆拖动超过一个格宽，两层点就会从「错半格」漂到「几乎重合／几乎并排」，图案会突变。
- 两层颜色不同时你会看到两套点交错——颜色把两个子晶格分开了，但几何上它们仍是同一个三角度晶格。想让两套点看起来一样，写同一个颜色。
- 点半径只有几个设备像素时抗锯齿会把它软化，视觉上比声明的稍大一点；半径取 1px 在 2× 屏上几乎看不见。
- 平铺从元素左上角起算，所以元素高不是 √3 格宽的整数倍时，最下面会留半行孔洞。想消除得让 `background-size` 与元素尺寸挂钩，或接受这一点。

## 备注

- 把两层点的半径错开半个像素、颜色调成深浅两档，就能做出「点有立体感」的织物感底纹。
- 同一套错半格的思路放到方块或短线上，就是砖墙（running bond）——条件同样不是「错半格」，而是错半格之后行距该取多少。
