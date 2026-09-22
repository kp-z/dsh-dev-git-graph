---
title: 会跑的波浪下划线
slug: underline-wavy-scroll
category: 排版
tags: [下划线, 波浪, 背景平铺]
since: 2026-10
source: 机制来自可平铺背景图样的位移，自行实现
when: 链接要一条会流动的波浪线，像手写标注一样不安分
stage: plain
tier: core
params:
  - { name: speed, label: 一个周期, type: range, min: 0.3, max: 4, step: 0.1, default: 1.2, unit: s }
---

## 描述

链接底下一条红色的波浪线，一直缓缓向右流动，像刚被划上去的。

机制是 ==波浪不能用 text-decoration，得用一张可平铺的背景图加平移==。`text-decoration-style: wavy` 确实画得出波浪，但它不可动画——可以过渡的只有颜色和粗细，波浪的相位没有暴露出来。所以波浪要自己画：一条 SVG 波浪做成背景图，横向平铺，再连续平移 `background-position-x`。用 SVG 而不是位图，是为了在任何缩放和 DPR 下都保持那条一点四像素的细线锋利。

让循环看不出接缝的，是「平铺」这件事本身：图样一个个周期首尾相接，位移正好走完一个周期时，画面与初始状态逐像素相同。所以位移距离必须**正好等于图样宽度**（这里 12px），多一像素少一像素都会在接缝处跳一下——速度越慢越刺眼。

## 代码

```html
<!-- @mechanism 波浪是一个自带周期的图样：能平铺，才有资格谈「无限流动」 -->
<p class="wavy">这条波浪是背景图，不是 text-decoration。</p>
```

```css
.wavy {
  width: fit-content;
  margin: 0;
  padding-bottom: 0.34em;
  font: 400 18px/1.9 system-ui, sans-serif;
  color: #1b1a17;
  /* @mechanism 图样宽度同时决定背景尺寸与位移距离，抽成一个变量就不会脱钩 */
  --tile: 12px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='6'%3E%3Cpath d='M0 3q3-3 6 0t6 0' fill='none' stroke='%23b4462f' stroke-width='1.4'/%3E%3C/svg%3E");
  background-repeat: repeat-x;
  background-position: 0 100%;
  background-size: var(--tile, 12px) 6px;
  /* @mechanism 位移刚好等于图样宽度：走完一个周期画面与初始完全相同，接缝看不见 */
  animation: wavy-run var(--speed, 1.2s) linear infinite;
}

@keyframes wavy-run {
  from { background-position-x: 0; }
  to { background-position-x: var(--tile, 12px); }
}
```

## 边界

- `text-decoration-style: wavy` 画得出波浪但不可动画：样式那一段没有中间态，波浪的相位也无处可调。想让它动就只能自己画。反过来说，自己画之后就没有了 `text-decoration-skip-ink` 那套避让规则，字的下伸部会被波浪穿过去。
- 背景是按元素盒铺一次的图样。`<p>` 跨行时只有整个盒子底边有一条波浪，而不是每行一条；行内元素则会在每一行各起一段，且行末断开、下行从头开始。想逐行都干净，只能让它保持单行。
- 位移距离必须正好等于图样宽度。示例把它抽成一个变量、同时喂给 `background-size` 与关键帧，就是为了不让两处常量脱钩——两者不一致时接缝会在慢速下明显跳动。
- 背景位置的百分比是按元素底边算的，不是按基线。行高变化时波浪不跟着字走，会离字越来越远；`padding-bottom` 是唯一的调节手段。
- 打印时背景默认被丢弃，整条下划线消失，链接就只剩颜色可辨。想要它在纸上存在，得换成真正的 `text-decoration`。
- 图样宽度小于一个汉字的宽度时，波浪的周期比字还密，看起来像锯齿而不是波浪；中文标题下要把 `width` 与 `background-size` 一起放大。
- 平铺的背景在浏览器缩放时会落到非整数像素上，那条细线会一段深一段浅——不是代码错了，是抗锯齿的结果。

## 备注

- 把图样换成点线、虚线或两端加粗的马克笔痕，机制完全不变：都是「可平铺的周期图样在位移」。
- 同一招可以给 `border-image` 用：`border-image-repeat: repeat` 配一个波浪图样，就能得到四周都会流动的边框。
