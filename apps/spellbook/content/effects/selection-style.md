---
title: 自定义选中色
slug: selection-style
category: 交互
tags: [first-letter, 色彩, 正文, 拖拽]
since: 2026-09
source: 机制来自 CSS Pseudo-Elements 的 ::selection，自行实现
when: 选中文字时的那片高亮要用品牌色，而不是系统默认的蓝
stage: plain
tier: core
---

## 描述

用鼠标划过的文字是一层铜红，而不是系统的蓝。

机制是 ==::selection 是唯一能给「用户选中的文字」上样式的伪元素==。它由浏览器在选中期间临时绘制成一层覆盖，所以能改的属性非常有限——基本只有颜色类。这也解释了为什么 `padding`、`border` 之类的写法毫无反应。

它不需要任何标记或类名，作用范围就是被选中的那一段。

## 代码

```html
<p class="sl">用鼠标划过这句话看看。选中的颜色是自己定的，不是系统的蓝。也可以只选中其中一个词。</p>
```

```css
.sl {
  width: min(420px, 84vw);
  margin: 0;
  font: 400 16px/1.9 system-ui, sans-serif;
  color: #1c1a17;
}

/* @mechanism 选中高亮由浏览器临时绘制，只有颜色类属性生效 */
::selection {
  background: #b4462f;
  color: #fdf6ec;
}

/* 旧版 Firefox 仍需要前缀 */
::-moz-selection {
  background: #b4462f;
  color: #fdf6ec;
}
```

## 边界

- 它不是普通伪元素：**只有少数属性生效**（背景色、文字色、`text-shadow` 等）。`padding`、`border`、`font-size`、`margin` 一律无效，而且不报错。
- 选中色的**对比度**要够。品牌色常常太亮或太暗，直接当底色会让文字读不清——要按 `color` 调整明度。
- 设了它之后，系统级的选择色（以及用户为高对比模式设的色）会被完全覆盖。这是要意识到的取舍。
- 深色与浅色主题应当各写一套。一套色值很难同时满足两种背景下的对比度要求。
- 规则写在全局会影响所有文本，包括输入框里的选中文字。想只对某块生效就要限定作用范围。

## 备注

- 这是成本极低、辨识度很高的一处品牌细节——用户每次选中文字都会看到它。
- 把它和链接、按钮的悬停色放在同一套色板上，整体才会像一套东西。
