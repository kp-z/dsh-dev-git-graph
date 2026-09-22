---
title: 高光漏光
slug: filter-bloom-highlight
category: 图形
tags: [svg-filter, blur, blend-mode, 发光, 光晕]
since: 2026-10
source: 机制来自实时渲染里的 bloom 管线（阈值、模糊、叠加），自行实现
when: 亮部要往外溢出一层光，而暗部必须一点都不能被照亮
stage: dark
tier: core
---

## 描述

亮的地方自己往外溢出一层光，暗的地方原样不动——不是给元素加了一圈发光，而是亮部漏了出来。

机制是 ==先把亮度截断成只剩高光，再大面积模糊，最后用 screen 叠回原图==。截断由 `feFuncR/G/B` 的 `type="linear"` 完成：`slope="3" intercept="-1.4"` 的意思是「输出 = 3 × 输入 − 1.4，负数截为 0」，于是比 0.47 暗的像素一律变成黑，模糊之后它们什么都加不上。

顺序不能换，这是整条链子的承重墙。先模糊再叠回，等于把整张图糊了一层、暗部被一起提亮，那是普通的 glow；先截断，模糊的输入里就只剩高光，溢出来的光也只可能来自高光。所以 bloom 的形状信息取自**图像自己的高光**，这才让它看起来像光学现象而不是图层样式。`screen` 是加法式的叠加，暗部加 0 还是暗部，最后一步不会把前面那份克制浪费掉。

## 代码

```html
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-bloom" x="-30%" y="-30%" width="160%" height="160%"
          color-interpolation-filters="sRGB">
    <!-- @mechanism 截断成只剩高光：负值被截为 0，暗部在这条链上直接消失 -->
    <feComponentTransfer in="SourceGraphic" result="highlights">
      <feFuncR type="linear" slope="3" intercept="-1.4" />
      <feFuncG type="linear" slope="3" intercept="-1.4" />
      <feFuncB type="linear" slope="3" intercept="-1.4" />
    </feComponentTransfer>
    <!-- @mechanism 糊的是「只剩高光」的那一版，所以光晕只从亮处长出来 -->
    <feGaussianBlur in="highlights" stdDeviation="12" result="halo" />
    <!-- @mechanism screen 是加法式叠加，暗部加 0 还是暗部 -->
    <feBlend in="SourceGraphic" in2="halo" mode="screen" />
  </filter>
</svg>

<div class="neon">
  <strong>只让亮的地方漏光</strong>
  <span>暗部一个像素都不会被提亮</span>
</div>
```

```css
.neon {
  /* @mechanism 光晕会溢出元素盒，滤镜区域不外扩就会被切平 */
  padding: 44px 36px;
  filter: url(#sb-bloom);
  background: #07080c;
  display: grid;
  gap: 10px;
  color: #ffd9a0;
  font: 800 30px/1.25 system-ui, sans-serif;
}

.neon span {
  color: #4a5a6a;
  font: 500 15px/1.5 system-ui, sans-serif;
}
```

## 边界

- `slope` 与 `intercept` 一起决定阈值（截断点 = −intercept ÷ slope）。这里 1.4 ÷ 3 ≈ 0.47，也就是「比中灰暗的都不发光」。阈值定低了就是整张图糊上一层白雾，定高了只剩纯白像素发光——看起来像滤镜没生效。
- `feComponentTransfer` 的输出会被截断到 [0, 1]，负值不会绕回，这正是它能当阈值用的原因；反过来，如果指望它保留高动态范围的值就会失真。
- 不写 `color-interpolation-filters="sRGB"` 时，阈值落在 linearRGB 的亮度上。同一组数字选出来的像素完全不同，现象是「滑杆怎么调都不对」。
- 模糊半径 12 的光晕在元素边缘会被切掉，滤镜区域必须跟着外扩（这里 ±30%），否则溢光看起来像被一个看不见的框夹住。
- 已经很亮的区域在 `screen` 下会迅速逼近纯白，颜色信息被冲掉。要保住色调就减小半径或降低阈值，而不是继续加层。

## 备注

- 想要更硬的加法，把 `feBlend` 换成 `feComposite operator="arithmetic" k2="1" k3="1"`——那就是纯加减，更容易过曝。
- 阈值那一层就是「按亮度提取」的通用工具：换成负的 slope 就是提暗部，用它做夜景的提亮比提 `brightness()` 有选择性得多。
