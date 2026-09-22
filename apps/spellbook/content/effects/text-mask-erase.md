---
title: 文字软边擦除
slug: text-mask-erase
category: 排版
tags: [遮罩, 渐变色标, 注册属性]
since: 2026-10
source: 机制来自 mask-image 的渐变与 @property 注册的色标动画，自行实现
when: 一段字要被擦掉或擦出来，边缘要柔和，像雾推过去而不是一刀切
stage: plain
tier: core
params:
  - { name: soft, label: 边缘柔和, type: range, min: 0, max: 40, step: 1, default: 14, unit: % }
---

## 描述

一段文字从左边开始被擦掉，擦过的地方留下的是雾一样的过渡，不是一条直边。

机制是 ==遮罩本身是一张渐变，而动画改的是渐变里色标的位置==。遮罩用 `linear-gradient` 时边缘是软的——从实到透之间那一段就是柔边，宽度由两个色标的距离决定；裁剪（`clip-path`）则只能给出硬边，因为它描述的是几何形状而不是像素透明度。要让柔边真正推过去，动画必须作用在**色标的位置**上，而不是把整张渐变挪个位置。

这里有个不会报错的陷阱：渐变里的色标位置是个数字，而未注册的自定义属性在浏览器眼里是一串不透明的替换值，不能逐帧插值。所以 `--edge` 必须先经 `@property` 注册成 `<percentage>`，浏览器才肯在关键帧之间给它算中间值。不注册时的现象是：整段动画到点瞬间跳过去，看起来就是硬切——柔边白设了。同样地，注册时写错语法（写成 `<number>` 之类）也拿不到百分比插值。

## 代码

```html
<!-- @mechanism 擦除作用在元素自己的像素上，所以文字、图标、图片都用同一套写法 -->
<p class="erase">遮罩的软边来自渐变的色标，不是裁剪的边界。</p>
```

```css
/* @mechanism 色标位置是数字，只有注册成 <percentage> 的属性才肯逐帧插值 */
@property --edge {
  syntax: '<percentage>';
  inherits: false;
  initial-value: 0%;
}

.erase {
  width: min(430px, 86vw);
  margin: 0;
  font: 400 21px/1.8 system-ui, sans-serif;
  color: #1b1a17;
  /* @mechanism 遮罩是渐变，实到透之间那一段就是柔边；裁剪给不出这一段 */
  mask-image: linear-gradient(
    100deg,
    #000 var(--edge, 0%),
    transparent calc(var(--edge, 0%) + var(--soft, 14%))
  );
  -webkit-mask-image: linear-gradient(
    100deg,
    #000 var(--edge, 0%),
    transparent calc(var(--edge, 0%) + var(--soft, 14%))
  );
  animation: erase-run 3.2s ease-in-out infinite alternate;
}

@keyframes erase-run {
  to { --edge: 100%; }
}
```

## 边界

- 忘了 `@property` 注册，`--edge` 就是「不可插值」的替换值：动画到点直接跳到终值，现象是硬切，而且控制台一个警告都没有。这是这个做法最常见的空。
- `@property` 里 `syntax` 写错（写成 `<number>`）同样拿不到百分比插值。写错时它默默退回成离散切换，不会报错。
- 被遮掉的部分**只是看不见，仍然占位、仍然能点**。遮罩没擦到的地方出现的按钮，用户点不到；擦掉的地方残留的链接却点得着。要真的禁掉得另判命中区域。
- 遮罩需要 `-webkit-mask-image` 前缀才能覆盖旧引擎，漏了就是「什么都没擦」，文字原样显示。
- 遮罩会连同文字的抗锯齿边缘一起吃掉，字看起来比平时糊一点；裁剪的边缘干净但生硬。两者不是替代关系。
- 多行文本时遮罩按整个元素盒铺，柔边会横着切过所有行，而不是逐行擦。要逐行擦就得把每行单独包一层。
- 动画是 `alternate` 循环，只为方便观察。真实场景里擦除是一次性的，循环会让人误以为它还能恢复。

## 备注

- 把渐变换成 `radial-gradient` 并动画圆心，就得到「从某点晕开」的显影；换成 `conic-gradient` 则是扇形扫描。
- 遮罩的 `color` 值可以用 `rgb(0 0 0 / 1)` 到 `rgb(0 0 0 / 0)` 明确写透明度，比 `#000` 与 `transparent` 更清楚遮罩用的是 alpha 通道。
