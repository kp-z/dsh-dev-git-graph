---
title: 长阴影
slug: long-shadow
category: 图形
tags: [box-shadow, 阴影, 图标, 标题]
since: 2026-09
source: 机制来自 CSS 多层同向偏移的 box-shadow，自行实现
when: 图标或标题要一条斜向拉长的实心投影，像等距视角
stage: photo
tier: core
---

## 描述

一块色块往斜下方拖出一条实心的长影，边缘是硬的，像等距游戏里的投影。

机制是 ==很多层 box-shadow，每层比上一层多偏 1px==。单层阴影只能给一块模糊的暗面；把偏移量逐像素递增、并把模糊设成 0、颜色设成实色，几十层叠起来就拼成了一条连续的斜向带。

它不是「一个很长的阴影」，是很多个阴影首尾相接。

## 代码

```html
<div class="ls-wrap">
  <div class="ls-box">咒</div>
</div>
```

```css
.ls-wrap {
  display: grid;
  place-items: center;
  width: min(320px, 78vw);
  height: 210px;
  background: #efe9dd;
}

.ls-box {
  display: grid;
  place-items: center;
  width: 86px;
  height: 86px;
  background: #b4462f;
  font: 700 30px/1 Georgia, serif;
  color: #f7f1e6;
  /* @mechanism 每层多偏 1px、模糊为 0，首尾相接拼成长影 */
  box-shadow:
    1px 1px 0 #8d3524,
    2px 2px 0 #8d3524,
    3px 3px 0 #8d3524,
    4px 4px 0 #8d3524,
    5px 5px 0 #8d3524,
    6px 6px 0 #8d3524,
    7px 7px 0 #8d3524,
    8px 8px 0 #8d3524,
    9px 9px 0 #8d3524,
    10px 10px 0 #8d3524,
    11px 11px 0 #8d3524,
    12px 12px 0 #8d3524,
    13px 13px 0 #8d3524,
    14px 14px 0 #8d3524,
    15px 15px 0 #8d3524,
    16px 16px 0 #8d3524,
    17px 17px 0 #8d3524,
    18px 18px 0 #8d3524,
    19px 19px 0 #8d3524,
    20px 20px 0 #8d3524,
    21px 21px 0 #8d3524,
    22px 22px 0 #8d3524,
    23px 23px 0 #8d3524,
    24px 24px 0 #8d3524;
}
```

## 边界

- 每层偏移必须**递增 1px**。步长大于 1 会在层与层之间露出缝隙，看起来是「虚线」。
- 模糊半径必须是 0、颜色必须完全不透明。任何一层带上模糊，长影的硬边就断了。
- 层数等于长度。24 层意味着 24 个阴影，每帧都要合成——静态元素没事，一旦让它动起来就会很吃力。
- 它是**同向等距**的，所以只有一条直线方向。想要阴影跟着曲线走（那种「飘带」感），得用 `clip-path` 或 SVG。
- 长影会画出元素盒子之外，父级有 `overflow: hidden` 时会被裁掉，看起来像阴影被切断。
- 深色主题上要改暗色为亮色（或者干脆反相），否则长影和背景糊在一起。
- **投影长度做不成 CSS 变量。**长度就等于阴影的**层数**，而 CSS 没有循环——层数只能手写或用预处理器生成。所以这一条没有滑杆。这是第三类「参数够不到」：前两类是 SVG 滤镜属性、和无法插值的无类型变量。

## 备注

- 用 CSS 预处理器或 `@property` 打表可以生成这几十层，手写只为演示清楚它的构造。
- 斜向用 `1px 2px` 这样的比例就能改投影角度，不必都是 45 度。
- 真正想让它可调，该把颜色或方向做成变量（那两样是能传进 `box-shadow` 的），而不是长度。
