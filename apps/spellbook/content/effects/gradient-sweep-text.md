---
title: 渐变扫过文字
slug: gradient-sweep-text
category: 排版
tags: [渐变, 扫光, background-clip]
since: 2026-10
source: 机制来自 background-clip 与超大背景的位移，自行实现
when: 深色标题上要有一道亮光慢慢扫过去，像金属字被转动
stage: dark
tier: core
params:
  - { name: dur, label: 扫过周期, type: range, min: 1, max: 8, step: 0.2, default: 3.6, unit: s }
---

## 描述

一行暗金色的标题上，一道窄窄的亮光从左扫到右，扫过之后字恢复暗色，过一会儿再来一次。

机制是 ==把渐变做窄、把背景铺成好几倍宽，再平移背景==。文字只当窗口：`background-clip: text` 加上透明的字色，背景就成了文字的填色。要让亮光「扫过」而不是「整体变亮」，条件有两个——渐变里只有一小段是亮的（大约占整张背景的百分之六），而且背景比文字盒宽好几倍（这里是三倍）。背景一宽，那一小段亮色在任一时刻只盖住几个字，位置一变就有了方向感；只铺满百分之百时整段亮色同时可见，看起来只是文字在由暗变亮。

宽背景还把「光斑」和「文字」解耦了：光斑是背景里自带的东西，文字只是它经过的一扇窗。所以扫描的速度由背景位移决定，与文字长度无关——这也意味着元素盒子被拉得越宽，光要在空白里跑的路就越长。

## 代码

```html
<!-- @mechanism 文字只是窗口：亮光是背景渐变里的一小段，不是文字自己的颜色 -->
<h3 class="sweep">高光扫过</h3>
```

```css
.sweep {
  width: fit-content;
  margin: 0;
  font: 700 32px/1.4 system-ui, sans-serif;
  /* @mechanism 背景裁到字形上、字自己让开，背景才成了文字的填色 */
  background-image: linear-gradient(
    100deg,
    #6b6255 0%,
    #6b6255 47%,
    #f6e7c1 50%,
    #6b6255 53%,
    #6b6255 100%
  );
  /* @mechanism 铺成三倍宽：亮色一次只盖几个字，才有「扫」的方向感 */
  background-size: 300% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  animation: sweep-run var(--dur, 3.6s) linear infinite;
}

@keyframes sweep-run {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}
```

## 边界

- 背景必须比文字盒宽。只铺满 `100%` 时整段亮色同时可见，看到的是文字整体由暗变亮，方向感荡然无存。
- 亮色标必须窄。这里亮段占整张背景的百分之六（约合元素宽度的五分之一）；拉到百分之二十以上就变成「渐变字在移动」，光斑感消失。
- 元素宽度决定光的观感：`width: fit-content` 让盒子贴住文字。盒子被拉伸成整行时，光会在文字之后的空白里跑很长一段，看起来像卡住了。
- `background-clip: text`、`-webkit-` 前缀、`color: transparent` 三者缺一不可。漏了前缀或漏了透明字色，结果是一块渐变矩形盖在字上，或是一行看不到光效的实色字。
- 背景按整个元素盒铺一次，跨行的标题不会逐行重复光斑，只会在其中一行扫过。多行要好看得每行单独成元素。
- 背景默认不进打印，也不进高对比度模式：这条文字会直接消失。要兜底得给一个 `@media print` 下的实色。
- 位移只改 `background-position`，它无法上合成器，是逐帧重绘。整屏都是这种标题时开销会显出来。

## 备注

- 把亮段换成两三个不同亮度的色标，就得到「一道主光加一道余晖」，比单色标更像金属。
- 同一套几何也能用在按钮和边框上：只要把「窗口」从字形换成盒子，逻辑完全不变。
