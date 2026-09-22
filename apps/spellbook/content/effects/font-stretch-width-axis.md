---
title: 字宽过渡
slug: font-stretch-width-axis
category: 排版
tags: [可变字体, 字宽, 伸展]
since: 2026-10
source: 机制来自 CSS Fonts 4 的 font-stretch 百分比与可变字体的 wdth 轴，自行实现
when: 标题要刚好占满一行，但不想用缩放把字压变形
stage: plain
tier: core
params:
  - { name: wd, label: 目标字宽, type: range, min: 62, max: 140, step: 1, default: 118, unit: % }
  - { name: dur, label: 过渡用时, type: range, min: 0.2, max: 2, step: 0.1, default: 0.6, unit: s }
---

## 描述

一行标题被放开变宽：竖笔画跟着变粗、内部空间打开，但字高一点没变。

机制是 ==font-stretch 是一个百分比，在可变字体里直接映射到 wdth 轴==。`condensed`、`expanded` 这些关键字只是百分比的别名，记不住就用百分比。它和 `transform: scaleX()` 的本质区别在于：缩放是几何变形，竖笔画按比例变细、圆角被压成椭圆；wdth 轴上的窄体与宽体是设计师重新画过的，笔画粗细不跟着等比走，所以压到 70% 仍然像一款字体，而不是一坨被挤扁的字。

排版上它解决的是「差一点点就占满」的问题：标题要么换字号（破坏与其他标题的层级）、要么加字距（松得难看）、要么缩放（变形），字宽轴是第四条路——高度与别的标题一致，只调节横向比例。示例的字宽与用时都做成参数，因为这项工作就是靠手感来回试出来的。

## 代码

```html
<h2 class="fs">SPELLBOOK</h2>
<p class="fs-note">悬停看它变宽，字高始终不变</p>
```

```css
.fs {
  margin: 0;
  font-family: system-ui, sans-serif;
  font-size: clamp(30px, 7vw, 54px);
  font-weight: 600;
  font-stretch: 100%;
  /* @mechanism 过渡的是一条真实存在的轴，不是几何缩放 */
  transition: font-stretch var(--dur, 0.6s) cubic-bezier(0.34, 1.4, 0.5, 1);
}

.fs-wrap:hover .fs,
.fs:hover {
  font-stretch: var(--wd, 118%);
}

.fs-note {
  margin: 10px 0 0;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.55);
}
```

## 边界

- 字体没有 wdth 轴时 `font-stretch` 被直接忽略：引擎不会合成字宽（与合成粗体不同），所以完全没变化、也不报错。
- 与 `font-variation-settings: "wdth" 80` 同时出现时后者赢，而且 `font-stretch` 的值会被无视——两个通道不能相加，别指望写两个就是 1.4 倍宽。
- 它只改字宽不改字高。想同时压高矮得动 `font-size` 或 `scaleY`，而一旦动了几何变换，就回到了变形而不是换字形。
- 窄体的可读性下降很快：正文低于 87.5% 明显难读，中文几乎没有多字宽字体，「压缩」通常等于换一款字或直接换字号。
- 字宽变化会改变行宽与折行位置，所以这一招和 `text-wrap: balance` 之类的算法一起用时，结果是每次过渡都在重排。

## 备注

- 中文字体里带 wdth 轴的极少；把 `font-stretch` 当「更窄的等宽替代」用在代码块上通常落空，那要用等宽字体解决。
