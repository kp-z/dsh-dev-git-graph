---
title: 上标不撑开行距
slug: superscript-line-box
category: 排版
tags: [上下标, 行盒, 脚注]
since: 2026-10
source: 机制来自 CSS Inline Layout 的行盒高度计算与 CSS Fonts 4 的 font-variant-position，自行实现
when: 正文里插一个脚注序号或商标上标，那一行的行距就被顶开一截
stage: plain
tier: core
---

## 描述

正文里插一个脚注序号，那一行的行距会明显比别的行松——上标像是把整行「撑」高了一截，而且怎么调 `line-height` 都压不平。

机制是 ==`vertical-align` 的位移会参与行盒高度计算==。`<sup>` 的默认样式恰好就是 `vertical-align: super`，它把这个行内盒整体往上抬；行盒必须把抬起后的位置也包进去，于是行高被撑开。要修的不是「抬多少」，而是**换一种不参与布局的位移方式**：先用 `vertical-align: baseline` 把浏览器给的默认样式撤掉，再用 `position: relative` 配 `top` 把字抬上去。相对位移只改变绘制位置，不进行盒高度计算，所以行距不会再被它牵动。

抬多少、缩多少是两个独立的手感选择：`top: -0.45em` 让记号落在字肩上方而不碰到上一行，`font-size: 0.68em` 让它小到不抢视线。两者都写在 `em` 上，换字号时比例自动跟着走。真正「应该」的做法是让字体自己给上下标字形——`font-variant-position: super` 取的是字体里的 `sups` 字形，位置与大小全由字体设计者定；只是它支持面还窄，退化的表现是字形完全不变，读者看到的是一个和正文一模一样的字。

## 代码

```html
<p class="note">
  行盒是被上标撑开的<sup class="fn">1</sup>，与字距无关。
  编号位数变了也一样<sup class="fn">12</sup>，宽度另外处理。
</p>
```

```css
.note {
  max-width: 30em;
  font: 400 15px/1.75 system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
}

.fn {
  /* @mechanism 先撤掉 UA 给的 vertical-align: super —— 正是它把行盒抬高 */
  vertical-align: baseline;
  /* @mechanism 相对位移只改绘制位置，不参与行盒高度计算 */
  position: relative;
  top: -0.45em;
  font-size: 0.68em;
  color: #b4462f;
}
```

```css
/* 引擎真的支持上下标字形时，这才是正解：位置与大小由字体给，不必自己调 */
@supports (font-variant-position: super) {
  .fn {
    /* @mechanism 换成字体自带的 sups 字形，此时不该再叠 font-size 与位移 */
    position: static;
    top: auto;
    font-size: inherit;
    font-variant-position: super;
  }
}
```

## 边界

- `<sup>` 的默认样式有两件事：`vertical-align: super` 和 `font-size: smaller`。只改字号不改位移，行距照样被撑开——这是最容易被漏掉的一半。
- 撑开的高度取决于字体度量里的上标偏移量，所以同一份 CSS 在不同字体、不同字号下「被顶开多少」并不相同，写死一个 `line-height` 压不住它。
- `position: relative` 的位移不改变布局，代价是它**不会**把字挤开：`top` 给得太大时上标会压到上一行的字上，那是重叠，不是行距问题。
- `font-variant-position: super` 要求字体真的有 `sups` 字形。没有时它回退到 `normal`，字形与位置跟正文完全一样（连字号都不缩），看起来像整条属性失效；配套的 `@supports` 查的是引擎能不能解析，不等于字体里有这个特性。
- 上下标只是视觉：复制、搜索、读屏拿到的都是普通数字字符。脚注序号该用 `<sup>`（语义在那儿），不要靠 CSS 把一个普通 `span` 抬起来。

## 备注

- 「用相对位移代替参与布局的位移」是同一招：徽标角标、消息计数气泡、`™` 这类记号都能照搬。
- 脚注区的编号列要用 `tabular-nums`，否则 1 与 12 的宽度不同，整列对不齐。
