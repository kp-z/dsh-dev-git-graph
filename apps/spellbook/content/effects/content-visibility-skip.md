---
title: 跳过屏幕外的渲染
slug: content-visibility-skip
category: 布局
tags: [content-visibility, 列表, 滚动]
since: 2026-09
source: 机制来自 CSS Containment 的 content-visibility，自行实现
when: 页面很长，滚动时明显发涩，但内容是静态的
stage: plain
tier: candidate
params:
  - { name: est, label: 预估高度, type: range, min: 40, max: 400, step: 20, default: 180, unit: px }
---

## 描述

一长列条目，屏幕外的那些浏览器压根不去渲染，滚动因此变顺。

机制是 ==content-visibility: auto 让浏览器跳过元素内部在视口之外时的渲染工作==。它不只是「延迟加载」——布局、绘制、样式计算全都可以跳过。代价是浏览器需要事先知道这块大概多高，否则滚动条会随着你滚动而不断变长变短。

`contain-intrinsic-size` 就是给它那个预估高度用的。

## 代码

```html
<div class="cv">
  <section class="cv-item"><b>第一块</b><p>屏幕外的块不会被渲染。</p></section>
  <section class="cv-item"><b>第二块</b><p>滚动时才会真正画出来。</p></section>
  <section class="cv-item"><b>第三块</b><p>跳过的包括布局与绘制。</p></section>
  <section class="cv-item"><b>第四块</b><p>内容越多收益越大。</p></section>
</div>
```

```css
.cv {
  width: min(360px, 82vw);
  height: 220px;
  overflow-y: auto;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.34);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.cv-item {
  padding: 16px 18px;
  border-bottom: 1px solid rgb(60 48 30 / 0.16);
  /* @mechanism 视口之外时跳过这块内部的渲染 */
  content-visibility: auto;
  /* @mechanism 给它一个预估高度，否则滚动条会一直跳 */
  contain-intrinsic-size: auto var(--est, 180px);
}

.cv-item b {
  display: block;
  margin-bottom: 4px;
  font-size: 15px;
}

.cv-item p {
  margin: 0;
  opacity: 0.7;
}
```

## 边界

- **必须配 `contain-intrinsic-size`。**没有它时浏览器按 0 或内容的实际尺寸算，滚动条会在滚动过程中不断变化——这个现象比性能问题更让人难受。
- 写 `auto <长度>` 那个 `auto` 有实际作用：它让浏览器在渲染过一次之后**记住真实高度**，之后就用真值而不是预估值。
- 跳过渲染意味着**元素在视口外时无法被测量**。`getBoundingClientRect()`、`offsetHeight` 之类的读法会拿到预估值，依赖精确尺寸的脚本（滚动锚定、虚拟列表）会算错。
- 在元素上查找并聚焦的浏览器行为（页内锚点跳转、Ctrl+F 的查找）会**先强制渲染**那一块，可能有一次可感知的卡顿。
- 它不适合内容会随时变化的小组件。频繁进出视口反而会带来反复的计算开销。
- 支持面还不算宽。不支持时就是普通渲染——不会有功能问题，只是没有性能收益。

## 备注

- 收益和「块内复杂度」成正比，和块的数量也成正比。纯文本的块收益很小，带图表或大量 DOM 的块收益很大。
- 同一族的 `contain: layout paint` 能手动指定要隔离的部分，但它不会自动跳过屏幕外的渲染。
