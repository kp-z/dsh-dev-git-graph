---
title: 渐变文字
slug: gradient-text
category: 排版
tags: [渐变, 文字, 背景裁切]
since: 2026-09
source: 机制来自 CSS background-clip，自行实现
when: 标题要一段颜色渐变，不想切图、不想用 SVG
stage: dark
tier: core
params:
  - { name: angle, label: 渐变角度, type: range, min: 0, max: 360, step: 15, default: 100, unit: deg }
---

## 描述

字面上就有颜色在流动，从一个色相过渡到另一个。

机制是 ==把背景裁到文字的形状上，再把字本身变成透明的==。背景其实是画在**文字盒子**上的一个矩形，`background-clip: text` 只让它在字形的像素里显示出来；此时字仍然是不透明的实色、会盖住背景，所以还得把 `color` 设成透明，让底下的渐变透上来。

关键在于：真正做渐变的是背景，不是文字。理解了这点，后面那些「为什么没生效」都有答案。

## 代码

```html
<h2 class="gt">咒语书</h2>
<p class="gt-sub">一条咒语一个效果</p>
```

```css
.gt {
  margin: 0;
  font: 700 54px/1.1 system-ui, sans-serif;
  letter-spacing: -0.02em;
  /* @mechanism 渐变画在背景上 */
  background-image: linear-gradient(
    var(--angle, 100deg),
    #ff9a5a 0%,
    #f43f5e 38%,
    #7c5cff 72%,
    #14b8a6 100%
  );
  /* @mechanism 把背景裁到字形里 */
  background-clip: text;
  -webkit-background-clip: text;
  /* @mechanism 文字本身必须透明，否则实色盖住背景 */
  color: transparent;
}

.gt-sub {
  margin: 10px 0 0;
  font: 400 14px/1.6 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.6);
}
```

## 边界

- **`color: transparent` 不能少。**少了它，文字的不透明色会盖在渐变上，看到的是纯色字——这是最常见的「渐变没生效」。
- 背景是画在文字**盒子**上的矩形，不是字形上。`line-height` 留的空白会一起被渐变覆盖，所以行高很大时字看起来偏淡：渐变被拉到了空处。
- 打印时几乎打不出来。文字是透明的、颜色来自背景图，而打印机默认不印背景。要出印刷稿得在 `@media print` 里还给文字一个实色。
- 别叠 `text-shadow`：阴影基于文字盒子绘制，会整块染色，把渐变糊掉。要发光得用 `filter: drop-shadow()`。

## 备注

- `background-clip: text` 现在各引擎都认，但 `-webkit-` 前缀那一行仍要留着照顾旧版 Safari。
- 渐变角度做成参数很划算：同一段文字，换个角度气质就完全不同。
