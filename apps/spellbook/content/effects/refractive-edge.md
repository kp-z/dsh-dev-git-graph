---
title: 折射边缘
slug: refractive-edge
category: 材质
tags: [折射, 置换, SVG 滤镜]
since: 2026-10
source: 机制来自 SVG feTurbulence 与 feDisplacementMap，自行实现
when: 玻璃边缘要真的把背后的画面推歪一下，而不只是描一条亮边
stage: photo
tier: candidate
params:
  - { name: bend, label: 折射强度, type: range, min: 1, max: 30, step: 1, default: 12 }
---

## 描述

玻璃板的边沿不是一圈亮线，而是一道把底下的画面整体推歪的带子：越靠近边缘推得越厉害，中间恢复原样，像真的有一层厚度在折射。

机制是 ==用 SVG feDisplacementMap 生成折射，再把这张图当作 backdrop-filter 的 url 贴上去==。位移图（displacement map）逐像素读一张图的颜色通道来决定「这个像素该从哪儿取色」——R 通道管横移、G 通道管纵移。所以只要喂给它一张边缘处梯度陡、中间平缓的图，底下被取样的画面就会在边缘被拉开。这和 `blur` 是两件事：模糊是「邻域平均」，位移是「取错位置」，后者才会让图案错位、变形。

图可以用 `feTurbulence` 现场生成，也可以在别处画好再引用：关键是那张图的红绿分量在边缘要有足够大的梯度，梯度越陡，同一张图推得越远。中间的图必须是平的中灰（128），那对应「不位移」。

## 代码

```html
<!-- @mechanism 一张离屏 SVG：噪声 + 置换，产出的就是那张「哪儿推、推多远」的位移图 -->
<svg class="refract-defs" aria-hidden="true">
  <filter id="sb-refract-edge">
    <feTurbulence
      type="fractalNoise"
      baseFrequency="0.012 0.02"
      numOctaves="2"
      seed="7"
      result="noise"
    />
    <feGaussianBlur in="noise" stdDeviation="5" result="soft" />
    <feDisplacementMap
      in="SourceGraphic"
      in2="soft"
      scale="12"
      xChannelSelector="R"
      yChannelSelector="G"
    />
  </filter>
</svg>

<div class="refract-pane">折射边缘</div>
```

```css
/* 这张图平时是隐藏的，只作为「位移量图」被 backdrop-filter 引用 */
.refract-defs {
  position: absolute;
  width: 0;
  height: 0;
}

.refract-pane {
  /* @mechanism 引用 SVG 置换滤镜：边缘处取样点被推开，背后画面就弯了 */
  backdrop-filter: url(#sb-refract-edge) blur(0.5px);
  --bend: 12;
  background: rgb(255 255 255 / 0.07);
  border: 1px solid rgb(255 255 255 / 0.34);
  border-radius: 16px;
  padding: 22px 26px;
  font: 600 18px/1.3 system-ui, sans-serif;
  color: #fff;
}
```

```js
// @mechanism SVG 滤镜的 scale 是数值属性，CSS 变量进不去 url()，只能由脚本读出来再回填
const filter = document.getElementById('sb-refract-edge')
const pane = document.querySelector('.refract-pane')
if (filter && pane) {
  const bend = getComputedStyle(pane).getPropertyValue('--bend').trim() || '12'
  filter.querySelector('feDisplacementMap').setAttribute('scale', bend)
}
```

## 边界

- 这是本库里支持面最窄的一条。`backdrop-filter: url(#id)` 目前只在 Safari 与 Firefox 里可用；Chromium 会整条声明失效，回退成一块普通半透明矩形。
- `scale` 是 SVG 滤镜的数值属性，**不能**靠 `var(--bend)` 自动流进 `url(#id)`。示例里是脚本用 `getComputedStyle` 读回变量再 `setAttribute` 的——多这一步，滑杆才真的会动。
- 位移量天生依面板尺寸而变。同一个 `scale`，小卡片上刚好，铺满屏就是撕裂感。
- `feTurbulence` 的 `numOctaves` 一调高就变成砂纸。折射要的是低频的扭曲，不是高频的噪声，`baseFrequency` 保持在 0.01 量级。
- 滤镜的边界会被裁到元素自身：靠边的像素样本取自面板外，容易在四角出现拉伸。给面板留一点 `padding` 或改用更小的 `scale`。

## 备注

- 想让边缘强度完全可控，就把「位移图」换成一张自己画的径向渐变（边缘黑、中心中灰），比调噪声可预测得多。
- 同一张位移图也能用在 `filter: url()` 上做「整块内容晃动」，原理完全一样。
