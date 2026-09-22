---
title: 小型大写
slug: small-caps-variant
category: 排版
tags: [大小写, 字形替换, 标签]
since: 2026-10
source: 机制来自 CSS Fonts 4 的 font-variant-caps 与 OpenType 的 smcp 特性，自行实现
when: 标签、面包屑想要全大写的派头，又不能真的喊出来
stage: plain
tier: core
---

## 描述

一行标签看起来是大写，但字母高度只到小写字母那么高，笔画粗细和正文一致。

机制是 ==font-variant-caps 去字体里要另一套专门画过的小型大写字形==。用 `text-transform: uppercase` 配 `font-size: 0.8em` 也能把字变小，但那是把大写轮廓等比缩小：笔画跟着变细，行里立刻就「缺分量」，而且大写字母的间距是按大尺寸配的，缩小后显松。字体自带的小型大写字形是单独设计的——笔画粗细对齐 x-height，间距按小尺寸重配。所以这个属性的成败完全取决于字体里有没有 smcp 特性。

`small-caps` 只把原本小写的字母换掉，本来就大写的字母保持原大；`all-small-caps` 连大写字母也换成小尺寸的，整行高度才齐。示例里第二行故意用「缩小大写」的合成做法，方便对照。

用 `font-synthesis: none` 配合，可以把这个属性的成败变成可见的：真的小型大写照常出现，没有特性的字体干脆渲染成原样大写，而不是糊一层合成字形。

## 代码

```html
<nav class="sc">
  <span class="sc-item">Collected Works</span>
  <span class="sc-item sc-fake">Collected Works</span>
</nav>
```

```css
.sc {
  display: grid;
  gap: 12px;
  font-family: Georgia, "Times New Roman", serif;
}

.sc-item {
  font-size: 20px;
  letter-spacing: 0.08em;
  /* @mechanism 请求字体里另一套画过的小型大写字形 */
  font-variant-caps: all-small-caps;
}

.sc-fake {
  /* @mechanism 对照：把大写轮廓等比缩小，笔画跟着变细、间距变松 */
  text-transform: uppercase;
  font-size: 15.6px;
}

/* @mechanism 关掉合成，小型大写要么是真的、要么就直接是大写 */
.sc-nosynth .sc-item {
  font-synthesis: none;
}
```

```js
const nav = document.querySelector('.sc')
nav?.addEventListener('click', () => {
  // 真假小型大写一对比就看出来了：合成的那行会明显偏细
  nav.classList.toggle('sc-nosynth')
})
```

## 边界

- 字体没有 smcp 时浏览器会合成：拿大写字母缩放顶上，现象不是「没效果」而是效果难看——合成的小型大写比真字形细，混排时同一行里粗细不一致。
- `font-synthesis: none`（更细的口子是 `font-synthesis-small-caps`）能让缺特性的字体不合成，失败变得干净可查；后者支持更晚，现象是设了没用。
- CJK 没有大小写概念，属性对中文完全无效。中英混排时只有拉丁部分换字形，中英基线看起来会不齐（小型大写矮于大写、高于 x-height）。
- `petite-caps` / `unicase` / `titling-caps` 依赖 pcap / unic / titl 这些别的特性，正文字体大多一个都没有，请求它们通常静默回退，甚至落到 small-caps 的合成上。

## 备注

- 同一套「CSS 只是开关、字形在字体里」的逻辑适用于 `font-variant-numeric`、`font-variant-ligatures`、`font-variant-east-asian`：开关写错顶多没效果，字形不会凭空出现。
