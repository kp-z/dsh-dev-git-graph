---
title: 着重号挂在字上
slug: text-emphasis-marks
category: 排版
tags: [着重号, 标点, 中日排印]
since: 2026-10
source: 机制来自 CSS Text Decoration 的 text-emphasis，自行实现
when: 中文正文里要标出重点字词，用的是那种一个字一个点的着重号
stage: plain
tier: core
---

## 描述

中文排版里标重点的方式是给每个字加一个点——不是加粗、不是斜体，而是在字的上方逐字挂一个标记。

机制是 ==`text-emphasis` 把标记挂在「每个字符」上，而不是给整段加一条线或一种样式==。`text-emphasis-style: dot` 会让每个字符各得一个点，并按文字流自动跟随断行与换行位置。所以它不需要你在文本里插圆点、不需要包 `span`、也不需要担心点与字对不齐——那些手写的做法一改字号就会错位，而着重号是由字体度量算出来的。

这跟 `text-decoration` 是同一族但不同机制：下划线是**一条贯穿的线**（可以 `skip-ink`，但本质是线），着重号是**逐字符的标记**。所以着重号能只作用于被标记的那几个字而不影响整行，下划线不行。

## 代码

```html
<p class="zh">这句话里只有<em class="dot">这几个字</em>是重点，着重号要跟着字走、随断行换位置。</p>
```

```css
.zh {
  max-width: 22em;
  font: 400 18px/1.9 "Songti SC", "Noto Serif CJK SC", serif;
  color: #26201b;
}

.dot {
  font-style: normal;
  /* @mechanism 逐字符挂点，位置随文字流算，不必手工插标点 */
  text-emphasis: dot;
  /* @mechanism 默认在字的上方、居右；中文着重号习惯在上方，这里显式写清 */
  text-emphasis-position: over right;
  text-emphasis-color: #b5705e;
}
```

## 边界

- 着重号**不占行高**。它画在行框之内、字面之外的位置，行距紧的时候会与上一行相碰。要让出空间得自己加 `line-height`，CSS 没有让着重号撑开行距的开关。
- `text-emphasis-position` 的默认值是 `over right`（上方、居右）。日文横排习惯也是上方，但**竖排**时会变成左侧——自动改不了，竖排场景要显式写 `left`。
- 着重号的**大小不可调**。CSS 里没有 `text-emphasis-size` 这个属性（写了会静默失效，像是没生效而不像写错了）。它的大小由字体度量决定，只能整体缩放 `font-size`，而那会连字一起改。想要可控大小的点，只能手写标记或伪元素。
- 标点与空格不标。一串着重号穿过逗号时会看起来断了一下，这是对的（标点不承载重点），但有人会以为是渲染错误。
- 它不会把字变成斜体或加粗，读屏器也读不出「这几个字是重点」——`<em>` 的语义来自标签本身，`text-emphasis` 只是视觉。反过来，只写 `text-emphasis` 而用 `<span>` 的话，既没语义也没视觉之外的信息。
- 不是所有中文字体都带着重号的度量，缺字体时浏览器会自己画一个点，大小与位置与字体给的略有差异。同一段文字在不同设备上着重号的粗细会不一样。
