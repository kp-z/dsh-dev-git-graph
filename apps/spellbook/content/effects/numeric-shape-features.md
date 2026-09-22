---
title: 分数与斜杠零
slug: numeric-shape-features
category: 排版
tags: [font-variant, 数字, 正文]
since: 2026-10
source: 机制来自 CSS Fonts 4 的 font-variant-numeric 与 OpenType 的 frac / zero 特性，自行实现
when: 配方里要写 1/2、机器编号里的 0 必须和字母 O 分得开
stage: plain
tier: core
---

## 描述

`1/2` 三个字符变成一个真正的分数：数字缩成上标与下标，斜线贯穿整行高度；编号里的 0 中间多了一道斜杠。

机制是 ==font-variant-numeric 是字形替换的开关，被替换的是一段「数字 + 斜杠 + 数字」的字符序列==，不是某个元素、也不是某个类。`diagonal-fractions` 请求 frac 特性，字体把整段序列换成一个连字式的分数形状；`slashed-zero` 只换 0 这一个字形。因为它是替换而不是排版计算，复制出去的文本仍然是 `1/2`，字符一个没变。

关键区别在这里：这个属性不改变字符、不改变字距算法，只是让字体画出另一套已经存在的字形。所以它不产生「效果」，只在字体**有**那套字形时产生效果——这与 `text-transform` 那类由引擎改字符的做法完全不同。

`ordinal` 是同一机制的另一种：字体为 `1st` / `2a` 这类序数准备了抬高的小写字母。示例把三行并排，是为了让「有特性」和「没特性」的差别一眼可见。

## 代码

```html
<!-- @mechanism 三行的字符一字不差，区别只在字体特性开关 -->
<p class="nm num-frac">面粉 1/2 杯，糖 3/4 杯</p>
<p class="nm num-zero">编号 SN-10024 / SN-1OO24</p>
<p class="nm num-ord">第 1st 名与第 2nd 名</p>
```

```css
.nm {
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 22px;
  margin: 0 0 10px;
  color: #1c1a17;
}

.num-frac {
  /* @mechanism 请求 frac 特性：把「数字/数字」整段换成预先画好的分数形 */
  font-variant-numeric: diagonal-fractions;
}

.num-zero {
  /* @mechanism 只换 0 这一个字形，字母 O 不受影响 */
  font-variant-numeric: slashed-zero;
}

.num-ord {
  /* @mechanism ordn 特性：抬高的小写字母，同样由字体提供 */
  font-variant-numeric: ordinal;
}
```

## 边界

- 分数只认紧挨着的序列：写成 `1 / 2`（斜杠两侧有空格）或者斜杠两侧不是数字（如 `A/B`）就不会替换。这一条经常被当成「属性失效」。
- 字体没有 frac / zero 特性时完全无变化，引擎不会合成——和合成粗体不同，这里没有兜底。
- 替换后一个分数是一个整体字形簇：光标移动、选区高亮会以整个分数为单位跳动，而不是逐个字符。
- 同一个数字上叠两个特性时（例如同时要 `tabular-nums` 与 `diagonal-fractions`），谁赢由字体里特性的应用顺序决定，CSS 管不着。要精确控制只能用 `font-feature-settings` 把特性名一个个写出来，而且得接受它覆盖前者的副作用。

## 备注

- 医疗、工程、金融界面里 `slashed-zero` 是刚需：`O` 与 `0` 分不清的代价是看错单号。
- 同一逻辑的 CJK 版本是 `font-variant-east-asian`，用来请求全角/半角与 JIS 变体字形。
