---
title: 描边空心字
slug: text-stroke-outline
category: 排版
tags: [描边, 文字, 空心]
since: 2026-09
source: 机制来自 CSS Text Decoration 与 -webkit-text-stroke，自行实现
when: 标题要只有轮廓、中间透空，像版画或霓虹管
stage: dark
tier: core
params:
  - { name: stroke, label: 描边粗细, type: range, min: 0.5, max: 4, step: 0.5, default: 1.5, unit: px }
---

## 描述

字只剩下轮廓线，中间的填充是空的，能透出背后的东西。

机制是 ==-webkit-text-stroke 给字形描一圈边，再把 color 设成透明==。描边是**居中**的：一半在字形轮廓里侧、一半在外侧。所以描边越粗，字形的实际笔画被吃掉得越多——细字重上尤其明显，粗到一定程度字会糊成一团。

想让填充压在描边上面（更接近版画的层次），加 `paint-order: stroke fill`。

## 代码

```html
<h2 class="tso">咒语书</h2>
<p class="tso-fill">一半描边，一半填充</p>
```

```css
.tso {
  margin: 0;
  font: 800 56px/1.1 system-ui, sans-serif;
  letter-spacing: 0.02em;
  /* @mechanism 描边是居中画的，一半吃掉字形内部 */
  -webkit-text-stroke: var(--stroke, 1.5px) #d9a441;
  color: transparent;
}

.tso-fill {
  margin: 14px 0 0;
  font: 800 40px/1.1 system-ui, sans-serif;
  -webkit-text-stroke: var(--stroke, 1.5px) #d9a441;
  /* @mechanism 填充压在描边上，做出层次 */
  paint-order: stroke fill;
  color: #b4462f;
}
```

## 边界

- 描边是**居中**的，不是向外扩。同一粗细在细字重上会把笔画吃掉一半，看起来像字变瘦了——这不是渲染问题。
- 描边宽度用 `px` 时，字号一改比例就变了；用 `em` 才能让描边随字号缩放。标题与正文共用一套样式时必须注意。
- `text-stroke` 这个标准属性至今没有落地，实际能用的仍是 `-webkit-text-stroke`。要写前缀，否则不生效。
- `paint-order` 对 `text-stroke` 的效果各引擎不完全一致：它原本是为 SVG 文字设计的，用在 HTML 文字上属于「能用但别依赖」。
- 描边很细时边缘会有灰边（抗锯齿的半透明像素）。深底浅字时尤其明显，想干净就只用整数像素宽度。

## 备注

- 空心字在深色底上最出效果——浅色描边有霓虹感，浅色底上则像没印实。
- 同一招配 `background-clip: text` 就能做出「描边 + 内有渐变填充」的组合，比纯空心更有质感。
