---
title: 中文标点的挤压
slug: cjk-punctuation-compress
category: 排版
tags: [font-variant, 标点, 正文]
since: 2026-10
source: 机制来自 OpenType 的 halt / palt 特性与 CSS Text 4 的 text-spacing-trim，自行实现
when: 一行中文里连续出现《「（等多个标点，中间空出一大片空白
stage: plain
tier: candidate
params:
  - { name: track, label: 字距, type: range, min: -0.2, max: 0, step: 0.01, default: -0.12, unit: em }
---

## 描述

连续几个标点之间的空白被收掉了，标点贴合在一起，整行看起来更紧。

机制是 ==全角标点周围那半格空白是字形的一部分，只能在字形层面收掉（halt / palt）==。它不是 margin，也不是字距：全角标点的字形本身就画成了「标点居中、两侧各留半格」的形状，所以调容器 padding 或 `letter-spacing` 只会让标点整体挪位，那条内置的空白纹丝不动。字体的 `halt`（半角宽度）与 `palt`（比例宽度）特性提供没有内置空白的标点字形，换掉才有挤压。

分辨「该用哪一招」的分界线就在这里：问空白画在哪里。画在字形里，就只能换字形；画在盒子上（字距、外边距、内边距），才轮到 CSS 属性。中文标点属于前者，这也是为什么整本书都在用字距调标点却调不好。

`text-spacing-trim` 是规范后来给的高层入口：什么时候该挤（行首、连续标点、标点与行末）交给引擎判断，但它同样只是去请求字体的这些特性。示例把三行并排：原样、halt、以及用负字距硬压——第三行是为了看清「压紧」和「挤掉内置空白」是两件不同的事。

## 代码

```html
<!-- @mechanism 三行文字一模一样，差别只在标点字形自带的空白怎么处理 -->
<p class="cp">他说：「这样。」（原文，标点各占一格）</p>
<p class="cp cp-half">他说：「这样。」（halt，内置空白被换掉）</p>
<p class="cp cp-track">他说：「这样。」（负字距，整体压紧）</p>
```

```css
.cp {
  margin: 0 0 14px;
  font-size: 24px;
  color: #1c1a17;
  font-family: "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC",
    sans-serif;
}

.cp-half {
  /* @mechanism 请求字体里那套不带内置空白的标点字形 */
  font-feature-settings: "halt" 1;
}

.cp-track {
  /* @mechanism 字距只挪位置：标点之间的空白画在字形里，压不掉 */
  letter-spacing: var(--track, -0.12em);
}
```

## 边界

- 字体没有 halt / palt 特性时完全无效。思源黑体、Noto Sans CJK 有；很多免费字体没有，且引擎不会合成，表现就是「设了没反应」。
- `text-spacing-trim` 支持面窄，各引擎对「何时该挤」的默认策略也不同，退化时完全不挤压——不破版，但效果没了。
- 挤压会改变文本的左边界：行首标点被压掉半格后，整段的视觉左边距看起来变小了，和容器的 padding 打架，往往要用 `text-indent` 补回来。
- 不同标点内置的空白量并不相同（括号通常比逗号宽），一刀切会让括号贴得过紧，「」和《》的处理也各有差异。
- 和 `letter-spacing` 混用时会出现「挤压一次、又拉开一次」的抵消，调完必须整行看，不能只看两个标点。

## 备注

- 判断标点该不该挤，看的是「它旁边是标点还是文字」：标点相邻时才该收，标点与文字之间那半格是有用的呼吸。
