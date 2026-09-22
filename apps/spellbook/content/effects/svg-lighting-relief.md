---
title: 给纹理打一盏光
slug: svg-lighting-relief
category: 材质
tags: [svg-filter, feLighting, feTurbulence, 浮雕, 纹理]
since: 2026-10
source: 机制来自 SVG 滤镜规范的 feDiffuseLighting 与 feSpecularLighting 及光源元素，自行实现
when: 一块纹理想有「光从那一边打过来」的立体感，但不想画高光图片
stage: dark
tier: core
---

## 描述

一块粗糙的纹理，光从左上方掠过来：凸起处亮、凹陷处暗，中间还有一条很窄的高光带。它不是画出来的，也不是照片，是算出来的——同一片噪声，换一个光源方向就换一副样子。

机制是 ==feDiffuseLighting 与 feSpecularLighting 把输入的 alpha 通道当高度图，按光源方向逐像素算出受光==。滤镜链上别的原语都在对颜色做算术（模糊、位移、颜色矩阵、卷积），只有光照原语会**造出方向感**：它把输入图当一张地形，每个像素的高度取 alpha 值，相邻像素的高度差决定这一点的法线朝向，法线再与光源方向做运算，得到明暗。这里最常踩的坑也在这句话里——取的是 **alpha 通道**，不是亮度。喂进去一张全不透明的图（普通照片、纯色块）等于给出一片平地，算出来只有均匀的亮度，什么都看不出来。所以这条链子的固定顺序是「先造高度图，再打光」：`feTurbulence` 顺手把 alpha 也填成噪声，于是它天生就能当高度图用。

漫反射与镜面反射是两个分开的原语，分别对应材质的两种行为：前者给哑光面的受光，宽而柔；后者只算高光，`specularExponent` 决定它多窄多亮。两者可以共用同一张高度图、用各自的光源，最后叠起来，得到的就是「哑光面上有一条亮带」这种最常见的材质观感。分开写的好处是它们的旋钮互不干扰——想调高光不必连带把整体明暗一起改。

光源类型是第一个要定的选择：`feDistantLight` 是平行光，方向处处一致（像太阳），只给方位角与高度角；`fePointLight` 是点光，有位置和距离（像灯泡），高光会聚在一点并随位置移动。然后是起伏与两种反射的强度（`surfaceScale`、`diffuseConstant`、`specularConstant`），以及受光处的颜色（`lighting-color`）——注意输出本身只是明暗，底图的颜色并不参与。最后还要决定这层光照怎么和画面结合：`feComposite` 相加是「高光叠加在哑光上」，用 `feMerge` 是硬贴，套进遮罩就只作用在局部。

## 代码

```html
<svg class="lit-defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-lit" x="0" y="0" width="100%" height="100%"
          color-interpolation-filters="sRGB">
    <!-- @mechanism 噪声连 alpha 一起填，所以它可以直接当高度图 -->
    <feTurbulence type="fractalNoise" baseFrequency="0.014 0.032" numOctaves="3"
                  seed="7" result="bump" />
    <!-- @mechanism 平行光算哑光面的受光：方向处处一致，像太阳 -->
    <feDiffuseLighting in="bump" surfaceScale="4" diffuseConstant="1"
                       lighting-color="#cbbfa8" result="matte">
      <feDistantLight azimuth="235" elevation="42" />
    </feDiffuseLighting>
    <!-- @mechanism 镜面反射另算一层：点光的高光会聚在一点，指数决定它多窄 -->
    <feSpecularLighting in="bump" surfaceScale="6" specularConstant="0.9"
                        specularExponent="24" lighting-color="#ffffff" result="shine">
      <fePointLight x="120" y="40" z="140" />
    </feSpecularLighting>
    <!-- @mechanism 相加：k2 保留哑光底，k3 把高光叠上去 -->
    <feComposite in="matte" in2="shine" operator="arithmetic"
                 k1="0" k2="1" k3="1" k4="0" />
  </filter>
</svg>

<figure class="lit">
  <div class="lit-frame"><div class="lit-plate"></div></div>
  <figcaption>同一片噪声，按方位 235° 的平行光加一盏点光算出的表面</figcaption>
</figure>
```

```css
.lit {
  display: grid;
  justify-items: center;
  gap: 10px;
  width: min(330px, 84vw);
  margin: 0;
  font: 400 13.5px/1.6 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.75);
  text-align: center;
}

.lit-frame {
  width: 100%;
  height: 200px;
  /* @mechanism 圆角只能由外层裁：滤镜会把元素自己的渲染整块换掉 */
  overflow: hidden;
  border-radius: 16px;
  box-shadow: 0 18px 40px rgb(0 0 0 / 0.45);
}

.lit-plate {
  width: 100%;
  height: 100%;
  /* @mechanism 这块纹理没有背景色：每一个像素都由滤镜链算出来 */
  filter: url(#sb-lit);
}
```

## 边界

- 高度图取的是输入的 **alpha 通道**，不是亮度。全不透明的输入等于零起伏，结果是「打了光但一片平」——这个现象几乎总是这个原因。
- 光照原语的输出是**不透明**的：alpha 被填满，颜色由 `lighting-color` 给出。所以它天然是一层覆盖，想只作用在某处必须配 `feComposite` 或遮罩。
- 滤镜原语默认在 linearRGB 里计算（`color-interpolation-filters` 的初值不是 sRGB），明暗对比与手算的期望不同。要所见即所得就在 `<filter>` 上写 `color-interpolation-filters="sRGB"`——这是 SVG 滤镜里「颜色不对」的头号来源。
- 这条链子没有引用 `SourceGraphic`，输出完全由噪声与光照生成：元素自己的背景、圆角、文字都不会出现在结果里，会被整块换掉。想保留文字就得用 `feMerge` 叠回来，或者把滤镜挂在一个空元素上（示例就是这样做的）。
- 逐像素的光照是滤镜里最贵的一类。区域大、又要动 `baseFrequency` 或光源位置时开销明显，通常限制在小面积上。
- 它和 `feConvolveMatrix` 的浮雕不是一回事：卷积核给的是固定方向的边缘检测，光的方向写死在权重里；光照原语的高光与暗部随光源参数连续变化，所以才能「换一个方向打光」。
- 光照是静态计算，不会因为页面滚动而重新打光——想让它跟着鼠标动，得用脚本改光源元素的坐标，那是另一条路。

## 备注

- 同一套高度图思路换个输入就是别的材质：把文字模糊后喂进去得到浮雕字，把一段透明度渐变当高度图就得到斜面。
- `feSpecularLighting` 单独用、不叠漫反射，就是一层「只有高光」的薄膜，适合做屏幕反光。
