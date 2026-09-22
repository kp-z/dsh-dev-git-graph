---
title: 阈值泛光
slug: bloom-threshold-pass
category: 材质
tags: [filter, blur, blend-mode, 发光]
since: 2026-10
source: 机制来自实时渲染里 bloom 的阈值提取加模糊再加回，用 CSS filter 链复现，自行实现
when: 深色界面上有一块很亮的元素，想让光从它边缘溢出去
stage: dark
tier: core
params:
  - { name: thr, label: 阈值, type: range, min: 2, max: 40, step: 1, default: 22 }
  - { name: size, label: 溢出半径, type: range, min: 2, max: 40, step: 1, default: 14, unit: px }
---

## 描述

深底上一条亮色的横条，光从它边缘溢出来糊掉周围一圈；同一个画面里那条灰暗的条却一点都不发光。

机制是 ==先用 contrast 把亮部推到纯白、暗部压到纯黑，再 blur 扩散，最后 screen 叠回原图==。泛光的关键从来不是「模糊」，而是「只让阈值以上的部分溢出」。直接模糊整张图会把暗部一起拖亮，画面立刻发灰；`contrast()` 在这里的角色是阈值门——它以中灰为轴把两侧拉开，没亮到一定程度的一律变成 0，模糊它们等于没模糊。所以顺序必须是先切阈值再模糊，反过来就只是一层柔光滤镜。示例里那条灰条正是用来验证这道门的：它在叠加层里被压成纯黑，screen 上去等于什么都没加。

可变的是阈值 `--thr`（越小越像雾天，越大只有最亮的芯会发光）和溢出半径 `--size`。示例把两步放在同一条 filter 链上，实际项目里更常见的是把阈值层单独做成一个伪元素，好让它和原图分开调。

## 代码

```html
<div class="bloom">
  <p>亮条溢出，灰条不动</p>
</div>
```

```css
.bloom {
  --bright: linear-gradient(#fff3cf, #fff3cf) 50% 34% / 58% 20px no-repeat;
  --dim: linear-gradient(#39415a, #39415a) 50% 70% / 74% 10px no-repeat;
  position: relative;
  display: grid;
  place-items: center;
  width: min(380px, 84vw);
  height: 190px;
  background: var(--bright), var(--dim), #07080c;
  color: #ccd3e3;
  font: 400 13px/1.6 system-ui, sans-serif;
  isolation: isolate;
}

/* @mechanism 把同一张底图再取一遍，阈值砍掉暗部之后才模糊，最后 screen 叠回 */
.bloom::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--bright), var(--dim);
  filter: contrast(var(--thr, 22)) blur(var(--size, 14px));
  mix-blend-mode: screen;
  pointer-events: none;
}

.bloom p {
  position: relative;
  z-index: 1;
}
```

## 边界

- 阈值以中灰为轴。底色若是深灰而不是接近黑，它会被 contrast 拉成一块亮灰，模糊后整片泛白——现象是「背景雾掉了」，也就是说泛光只在真正的深底上成立。
- `mix-blend-mode` 需要隔离的堆叠上下文，`isolation: isolate` 是显式做法。缺了它，叠加层会和祖先的背景混，甚至混到页面之外。
- 模糊是各向同性的圆核，溢出的形状永远接近圆。想要细长的光晕得额外做一次方向性缩放，单靠 `blur()` 得不到。
- 亮部本身已经接近纯白，叠加只会更白一点，所以这条效果的上限靠半径撑、不靠亮度。
- `filter` 会创建包含块，元素内部的 `position: fixed` 会失效。这一层只放装饰内容。
- 阈值层把 8 位色深的中间调全部砍掉，灰阶过渡会出现台阶；大面积渐变上要配一层噪点（见 dither-anti-banding）。

## 备注

- 同一套「切阈值 → 模糊 → 叠回」换成 SVG 的 `feComponentTransfer` 加 `feGaussianBlur`，就能作用在任意形状上，不受盒模型限制，阶跃边界也更干净。
