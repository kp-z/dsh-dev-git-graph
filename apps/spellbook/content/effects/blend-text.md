---
title: 与背景反相的文字
slug: blend-text
category: 排版
tags: [混合模式, 对比, 文字]
since: 2026-09
source: 机制来自 CSS Compositing 的 mix-blend-mode，自行实现
when: 文字要压在明暗不定的图上，而且不管底下是什么颜色都看得清
stage: photo
tier: candidate
---

## 描述

白字压在浅色上也看得见，压在深色上也看得见——因为它的颜色会跟着底下的明暗反过来。

机制是 ==mix-blend-mode: difference==。混合模式把文字的颜色与底下像素逐通道相减：压在白底上得到反相的黑，压在黑底上得到白。于是同一段文字跨越明暗边界时，每一处都自动取到对比度最高的那个颜色。

这是纯 CSS 里唯一不需要知道背景是什么、也能保证可读性的办法。

## 代码

```html
<div class="bt-wrap">
  <span class="bt-text">咒语书 SPELLBOOK</span>
</div>
```

```css
.bt-wrap {
  display: grid;
  place-items: center;
  width: min(420px, 80vw);
  height: 200px;
  background: linear-gradient(115deg, #f4efe4 0%, #f4efe4 48%, #14101c 52%, #14101c 100%);
}

.bt-text {
  font: 800 30px/1 system-ui, sans-serif;
  letter-spacing: 0.04em;
  color: #f4efe4;
  /* @mechanism difference 让每一处都取到对比度最高的一侧 */
  mix-blend-mode: difference;
}
```

## 边界

- `mix-blend-mode` 只在**同一个层叠上下文**里混合。父级一旦有 `isolation: isolate`、`transform`、`opacity` 小于 1 或 `filter`，混合范围就被切开，结果会和你预期的不一样——这是最常见的「突然不混了」。
- `difference` 在**中灰（约 #808080）**上几乎不变色。文字压在过去恰好是中灰的区域会直接「消失」，这是数学上的必然，不是渲染问题。
- 不支持混合模式的旧环境会退化成「纯色文字压在图上」，可能完全看不清。所以底图要选明暗对比大的，别指望它在任意图上都好用。
- 它和 `filter` 同时用的时候结果依赖应用顺序，调起来会很别扭。要发光就换成 `drop-shadow` 并单独测。

## 备注

- `difference` 做「反相」，`exclusion` 更柔和（对比没那么硬），`overlay` 则保留底图明暗只做染色。
- 同一招用在纯色块上会得到严格的互补色，做双色海报的标题很省事。
