---
title: 省略号是一个字符
slug: ellipsis-single-char
category: 排版
tags: [省略号, 标点, 截断]
since: 2026-10
source: 机制来自 Unicode 的 U+2026 与 CSS Text 的 text-overflow，自行实现
when: 三个点的省略号在字距下散开、在中文里宽度不对、在截断处还被画成另一个样子
stage: plain
tier: core
---

## 描述

同样是「三个点」，写 `...` 还是写 `…`，在排版上是两回事：一个会被字距、断行与字体替换逐点拆开，另一个始终是一个整体。

机制是 ==省略号是**一个字符**（U+2026），不是三个点==。它只有一个字形、一次推进宽度，所以 `letter-spacing` 只在它后面加一次间距、断行不可能从它中间劈开、复制出去也还是一个字符。示例里两行用同样的字距，上行的三个点各吃一次间距、下行的省略号只吃一次，宽度差得一眼就看出来。中文排版规范里省略号写两个 `…`（占两个字位），所以中文写「……」而西文只写一个 `…`；浏览器的 `text-overflow: ellipsis` 画的也是这一个字符——没有属性能让它画三个点。

用 `...` 的代价很具体：三个点各自算一个字符，字距拉开后点与点之间会散开，逐字符字体回退时还可能一个来自 A 字体、一个来自 B 字体，基线都对不齐。它唯一的好处是键盘上直接打得出来。

## 代码

```html
<div class="el">
  <p class="row"><span>三个点：</span><b class="tracked">...</b></p>
  <p class="row"><span>省略号：</span><b class="tracked">…</b></p>
  <p class="clip">这一行文字太长，浏览器在末尾画的省略号是 U+2026，而不是三个点。</p>
</div>
```

```css
.el { width: min(300px, 80vw); font: 400 15px/1.8 system-ui, sans-serif; }
.el p { margin: 0 0 8px; }

.row { display: flex; gap: 8px; align-items: baseline; }
.row span { flex: none; color: rgb(0 0 0 / 0.55); }

.tracked {
  /* @mechanism 字距加在每个「字符」后面：三个点吃三次，一个省略号只吃一次 */
  letter-spacing: 0.4em;
  font-size: 20px;
  color: #b4462f;
}

.clip {
  /* @mechanism text-overflow 是给行内盒的溢出用的，先 nowrap 再真的裁掉 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 4px 6px;
  background: rgb(180 70 47 / 0.08);
  color: rgb(0 0 0 / 0.75);
}
```

## 边界

- 裁剪的三个条件要一起给：`overflow: hidden`、`white-space: nowrap`、`text-overflow: ellipsis`。少任何一条都不会出现省略号——不换行是为了制造溢出，`hidden` 是为了给 `text-overflow` 一个「裁掉了内容」的场合。
- 多行文本没有可用的省略。`text-overflow` 只管单行；「三行之后省略」得靠 `-webkit-line-clamp` 配 `display: -webkit-box` 这类非标准组合。
- flex 或 grid 项默认的 `min-width: auto` 会让盒子跟着内容长大，于是「永远不溢出」，省略号永远不出现。要给这类项显式加 `min-width: 0`（或 `min-width: 0` 等价的逻辑写法），它才缩得进容器。
- 省略号是从行末裁掉字符再补上去的，不认标点：被裁掉的位置上正好有个句号或右括号时，它们会和文字一起消失。
- 中文的「……」是两个码位，只写一个 `…` 在字面上占一个字位，不合规范；而拿 `letter-spacing` 或 `text-indent` 去补那半个宽度都不对，那是内容层的两个字符。
- `…` 与 `...` 是两个不同的字符串：站内检索、去重、正则匹配都要同时考虑两种写法，混用时最容易漏掉其中一种。

## 备注

- 排版检错的常见一条：在源码里搜 `...` 与 `. . .`，正文里都该是 `…`。
- 同一个「一个字符 vs 多个字符」的判断也适用于破折号（`—` 是一个字符，`--` 是两个），以及中文的「——」比西文的 `—` 长一倍。
