---
title: 渐变描边
slug: conic-border
category: 图形
tags: [conic-gradient, background-clip, 金属, 卡片]
since: 2026-09
source: 机制来自 CSS background-clip 的双层裁切，自行实现
when: 卡片要一圈彩色描边，但 border 只能给单色
stage: dark
tier: core
params:
  - { name: width, label: 描边宽度, type: range, min: 1, max: 12, step: 1, default: 3, unit: px }
---

## 描述

卡片四周一圈从红到金再到紫的渐变边，像镶了道金属。

机制是 ==两层背景 + 两种裁切范围==。第一层是一块实色，裁到 `padding-box`（只在内容区显示），用来盖住中间；第二层是渐变，裁到 `border-box`（一直铺到边框外沿）。中间被实色挡住，于是渐变只在边框那圈露出来。

`border: Npx solid transparent` 是前提——透明边框占着位置但不画颜色，正好把那一圈让给背景。

## 代码

```html
<div class="cb">
  <b>镶边卡片</b>
  <p>渐变只露在边框那一圈。</p>
</div>
```

```css
.cb {
  width: min(320px, 78vw);
  padding: 22px 24px;
  /* @mechanism 透明边框占住那一圈，让给背景去画 */
  border: var(--width, 3px) solid transparent;
  border-radius: 4px;
  /* @mechanism 双层背景：内层盖内容区，外层铺到边框外沿 */
  background:
    linear-gradient(#1b1626, #1b1626) padding-box,
    conic-gradient(from 140deg, #b4462f, #d9a441, #7c5cff, #14b8a6, #b4462f) border-box;
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.cb b {
  display: block;
  margin-bottom: 6px;
  font-size: 17px;
}

.cb p {
  margin: 0;
  opacity: 0.72;
}
```

## 边界

- `border-style` 必须是 `solid` 且颜色为 `transparent`。写成实色，第二层背景就被盖住，看到的还是单色边。
- 内层那块实色是必需的，所以**内容区没法做到真正透明**。想让卡片透出页面背景，这个技巧就用不了，得换成 `mask` 方案。
- 两层的顺序与 `background-clip` 的值要一一对应：写在前面的层画在上面。顺序写反，看到的是被渐变整块糊住的卡片。
- 圆角处部分浏览器会有细缝或锯齿，因为两层裁切的圆角是分别算的。加 `border-radius` 时把描边调粗一点更容易看出。
- 它和 `box-shadow` 叠加时阴影会从**元素盒子**外侧算起，与视觉上的描边外沿差了一个边框宽，看起来像阴影浮着。

## 备注

- 把内层从实色改成半透明色，就能得到「描边清晰、内容半透」的效果——但页面底色会透上来，颜色会变。
- `conic-gradient` 做描边比 `linear-gradient` 更好看：角上的明暗过渡更像金属倒角。
