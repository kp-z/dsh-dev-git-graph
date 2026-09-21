---
title: 换字体不改视觉大小
slug: font-size-adjust
category: 排版
tags: [字体, x 高度, 回退]
since: 2026-09
source: 机制来自 CSS Fonts 的 font-size-adjust，自行实现
when: 回退字体一加载，整页文字看起来忽然变大或变小
stage: plain
tier: candidate
---

## 描述

两种字体并排，字号属性一样，看起来也一样大。

机制是 ==font-size-adjust 按「x 高度占字号的比例」校正实际渲染尺寸==。不同字体的 x 高度差异很大：同样 16px，有的看起来明显更大。这个属性让浏览器把渲染尺寸校正到给定的比例，于是**换字体时视觉尺寸不跳**。

它调的是渲染尺寸，不是 `font-size` 的值——从计算样式里看不出变化。

## 代码

```html
<div class="fa">
  <p class="fa-a">Aa 未校正的字体</p>
  <p class="fa-b">Aa 校正之后</p>
</div>
```

```css
.fa {
  width: min(380px, 82vw);
  padding: 22px 24px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.42);
  color: #1c1a17;
}

.fa p {
  margin: 0 0 10px;
  font: 400 28px/1.3 Georgia, "Times New Roman", serif;
}

.fa-a {
  font-size-adjust: none;
}

.fa-b {
  /* @mechanism 按 x 高度比例校正渲染尺寸，换字体视觉大小不跳 */
  font-size-adjust: 0.52;
  color: #b4462f;
}
```

## 边界

- 它调的是**渲染尺寸**，`font-size` 的计算值完全不变。用「计算样式里字号没变」来判断它有没有生效是错的。
- 值填的是**目标 x 高度比例**（如 0.52），不是字号。填错会让文字整体偏大或偏小，而且不易察觉是这个属性造成的。
- 字体本身没有 x 高度度量信息时无效。系统自带的等宽字体或某些极端字体可能缺这项数据。
- 渲染尺寸变了，**行高表现也跟着变**。视觉上文字变大时行距会显得更紧，要一并检查。
- 支持面有限（Firefox 支持最好）。不支持时退回正常渲染——不会破版，只是字体回退时的尺寸跳变还在。
- 它是为「字体回退」设计的，不是做缩放的工具。想做响应式缩放应当用 `clamp()` 改字号。

## 备注

- 它的第二个用途是给 `font-family` 列表里差异很大的字体做视觉统一，比如中文回退到系统字体时。
- 配 `size-adjust`（`@font-face` 描述符）可以做到更精细的字形缩放，但那是字体级而不是元素级的设置。
