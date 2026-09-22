---
title: 只给数字换一套字体
slug: unicode-range-swap
category: 排版
tags: [unicode-range, font-face, 数字, 正文]
since: 2026-10
source: 机制来自 CSS Fonts 的 @font-face unicode-range 与逐字符字体回退，自行实现
when: 只想让数字换成旧式数字或等宽数字，又不想给每个数字包一层 span
stage: plain
tier: core
---

## 描述

正文用一套字体，数字却来自另一套：同一行里的数字是老式的、高低不一的，其余文字纹丝不动。

机制是 ==`unicode-range` 让一个 `@font-face` 只负责指定的码位，而字体选择是逐字符进行的==。浏览器为每个字符挑第一个「有它」的字体，`unicode-range` 就是在说「这个家族只管 U+0030–U+0039」。于是数字走另一条字体、字母标点走原来那条，HTML 里一个 `span` 都不用加。顺带它还省流量：带 `unicode-range` 的子集字体，引擎只下载页面真正用到的那几段码位。

于是「换数字」从 HTML 层挪到了 CSS 层：不是每个数字包一层 `<span class="num">`，而是定义一个新家族、把数字的码位划给它。示例用 `local()` 指系统字体，所以不需要任何网络请求；真实项目里换成自托管的子集字体，机制完全一样。

## 代码

```html
<div class="ur">
  <p id="sb-ur-text" class="figures">订单 4815，金额 1260.75 元，共 3 件。</p>
  <button id="sb-ur">换成系统数字</button>
</div>
```

```css
/* @mechanism 这个家族只认数字码位，其它字符一概不管 */
@font-face {
  font-family: "sb-figures";
  src: local("Georgia"), local("Times New Roman"), local("Songti SC");
  unicode-range: U+0030-0039;
}

.ur { width: min(320px, 80vw); font: 400 15px/1.9 system-ui, sans-serif; }

.figures {
  /* @mechanism 字体逐字符选：数字命中 sb-figures，其余落到下一顺位 */
  font-family: "sb-figures", system-ui, sans-serif;
}

/* @mechanism 撤掉这个家族，数字就回到原来的回退链上 */
.figures.off { font-family: system-ui, sans-serif; }
```

```js
const text = document.getElementById('sb-ur-text')
const button = document.getElementById('sb-ur')
button?.addEventListener('click', () => {
  // @mechanism 只切一个类名，正文里从来没有把数字包起来过
  text?.classList.toggle('off')
})
```

## 边界

- `unicode-range` 是**筛选**，不是保证。它说「这个家族管这些码位」，至于这些码位最终用哪套字形，还得看那个字体里有没有——`local()` 的字体一个都不在时，整个家族失效，数字会静默落回回退链，不报错也不提示。
- 老引擎不认识 `unicode-range` 时是**忽略这一行**，而不是忽略整条 `@font-face`：家族不再被限制，于是整段文字都换成了那个字体。现象是「只该换数字，结果全都变了」。
- 一行里的字来自不同字体时，字面高度与笔画粗细可能对不齐。数字换字体通常看不出来，换成 x-height 差别大的字体时，混排行会明显高低不齐。
- 别用 `unicode-range` 去划分中西文（`U+4E00-9FFF` 那一类）：那是成千上万个码位，而且标点、全角符号散落在多个区段里，划不准也容易漏。它适合「数字」「某几个特殊符号」这种明确而稀疏的目标。
- 引入自定义家族就多了一条回退链：家族里没有的字符不会自动去找「同名字体的其它码位」，而是按 `font-family` 列表继续往下走。列表末尾总要有一个人人都有的兜底字体。

## 备注

- 同一招也用来只换某个符号：把 `→`、`№`、货币符号这些系统字体里长得难看的字形，从项目自带的字体里取。
- 反向用法是「排除」：某段码位不划给自托管字体，它就自动落到系统字体的字形上——中文标点与全角符号很吃这一套。
