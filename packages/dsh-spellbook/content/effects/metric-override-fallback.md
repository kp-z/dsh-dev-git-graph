---
title: 回退字体的度量伪装
slug: metric-override-fallback
category: 排版
tags: [font-face, line-height, 正文]
since: 2026-10
source: 机制来自 CSS Fonts 5 的 @font-face 度量描述符，next/font 的 adjustFontFallback 用同一招（MIT），自行实现
when: 自定义字体到位前后行高不一样，整页内容在加载完成时往下跳一次
stage: grid
tier: core
params:
  - { name: sizeAdj, label: 替身大小, type: range, min: 90, max: 130, step: 0.5, default: 106, unit: % }
---

## 描述

三段一模一样的文字，用同一个系统替身字体渲染。其中一段在主字体到达时会让页面跳动，另一段不会——差别全在行盒高度上。

机制是 ==用 @font-face 的度量描述符把替身字体的 ascent / descent / line-gap 改成主字体的值，让两套字体的行盒高一致==。文字加载前后之所以会跳，是因为行盒高度由字体自带的度量决定：替身的 ascent+descent 与主字体不同，行盒就不同，一段几十行下来差 2% 就是几十像素的位移。度量覆盖不做任何视觉润色，它只是让替身**报出主字体的骨架尺寸**。

`size-adjust` 修的是另一件事：它缩放字面大小（x-height、字宽），让「换字体时文字看起来一大一小」不那么突兀。两个描述符经常一起用，但它们管的不是同一个量——行高靠 override，观感大小靠 size-adjust。示例里把三行的高度用脚本量出来，是为了让这个纯几何的事实变成可读的数字。

## 代码

```html
<!-- @mechanism 三段文字完全相同，唯一的变量是替身字体声明的度量 -->
<div class="mo">
  <p class="mo-row mo-real" data-name="主字体">The quick brown fox jumps over the lazy dog. 咒语书</p>
  <p class="mo-row mo-plain" data-name="裸替身">The quick brown fox jumps over the lazy dog. 咒语书</p>
  <p class="mo-row mo-fixed" data-name="伪装后">The quick brown fox jumps over the lazy dog. 咒语书</p>
</div>
<p class="mo-read" id="sb-mo"></p>
```

```css
@font-face {
  font-family: "SB-Real";
  src: local("Georgia"), local("Times New Roman");
  font-weight: 400;
}

@font-face {
  font-family: "SB-Plain";
  src: local("Arial"), local("Helvetica");
  font-weight: 400;
}

/* @mechanism 让替身报出主字体的骨架尺寸，行盒高度才会与主字体相等 */
@font-face {
  font-family: "SB-Fixed";
  src: local("Arial"), local("Helvetica");
  font-weight: 400;
  ascent-override: 91.7%;
  descent-override: 21.9%;
  line-gap-override: 0%;
  size-adjust: var(--sizeAdj, 106%);
}

.mo-row {
  width: min(430px, 84vw);
  margin: 0 0 12px;
  font-size: 18px;
  /* @mechanism 行高交给度量算，覆盖才有意义 */
  line-height: normal;
}

.mo-real {
  font-family: "SB-Real", Georgia, serif;
}
.mo-plain {
  font-family: "SB-Plain", Arial, sans-serif;
}
.mo-fixed {
  font-family: "SB-Fixed", Arial, sans-serif;
}
.mo-read {
  font: 400 13px/1.6 ui-monospace, monospace;
  color: rgb(28 26 23 / 0.6);
}
```

```js
// @mechanism 行盒高度是度量的直接产物，量一次高度就能验证替身有没有对齐
const rows = [...document.querySelectorAll('.mo-row')]
const out = document.getElementById('sb-mo')
if (rows.length && out) {
  out.textContent = rows
    .map((row) => `${row.dataset.name} ${row.getBoundingClientRect().height.toFixed(1)}px`)
    .join('  |  ')
}
```

## 边界

- 这些描述符只影响行盒计算，不改字形轮廓。x-height 的差异只能靠 `size-adjust` 近似，永远对不齐——它能消除跳动，不能消除「看起来不一样」。
- 主字体的度量必须是真实数值（读它的 hhea / OS/2 表，或用 FontFace API 量）。示例里的 91.7% / 21.9% 是 Georgia 的近似值，随手填会让首屏文字与加载后文字的基线错开，变成另一种抖动。
- 行盒高度由 `ascent-override + descent-override + line-gap-override` 一起决定：只覆盖前两个、漏掉 line-gap，高度仍会差一截。
- 只对 `@font-face` 生效。直接用 `font-family: Arial` 的系统字体没法覆盖度量——要覆盖就得先用 `src: local()` 把它包成一个 `@font-face`。
- 覆盖的值写错不会报错，只会让文字贴顶或行距过松，所以改完必须量一遍高度。

## 备注

- 同一招也是「用系统字体冒充网页字体」的办法：先用 `local()` 找一个形状最接近的替身，再把度量调平，首屏几乎看不出换过字体。
