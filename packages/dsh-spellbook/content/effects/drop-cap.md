---
title: 首字下沉
slug: drop-cap
category: 排版
tags: [first-letter, line-height, 正文]
since: 2026-09
source: 机制来自 CSS Pseudo-Elements 的 ::first-letter，自行实现
when: 正文开头要一个大写的首字母，像旧书那样压住前三行
stage: plain
tier: core
params:
  - { name: size, label: 首字倍率, type: range, min: 2, max: 5, step: 0.2, default: 3.4, unit: em }
---

## 描述

段落的第一个字突然变大，占住左边三行的位置，后面的文字绕它排。

机制是 ==::first-letter 配 float: left==。`::first-letter` 能选到第一个字（包括它前面的标点），把字号放大之后它还是个行内元素、会把行撑高；再加 `float: left` 让它脱离行流变成块级，后面的文字就会绕着它排。

真正难的不是这几个属性，是把首字的基线与第一行的基线对齐——那全靠 `line-height` 与 `margin` 手调。

## 代码

```html
<p class="dc">咒语书要收的是那些一句话说不清的效果。一句话能说清的，不值得占一条。这里放一段够长的正文，好看清首字是怎么压住前三行的。</p>
```

```css
.dc {
  width: min(460px, 84vw);
  margin: 0;
  font: 400 15px/1.85 system-ui, sans-serif;
  color: #1c1a17;
  text-align: justify;
}

/* @mechanism 放大的首字再加 float，脱离行流让后续文字环绕 */
.dc::first-letter {
  float: left;
  font-size: var(--size, 3.4em);
  font-weight: 700;
  line-height: 0.82;
  margin: 0.06em 0.1em 0 0;
  color: #b4462f;
}
```

## 边界

- `line-height` 与 `margin` 必须手调。默认值下首字会与首行基线错开，这是这个效果最容易翻车的地方——换字体、换字号都要重调一次。
- `::first-letter` 只对**块级**元素生效。写在 `display: inline` 的元素上完全不匹配，也不报错。
- 它选的是「第一个字符」，**包括前置标点**。中文段落以引号开头时，下沉的会是那个引号而不是第一个字。
- 更省事的 `initial-letter: 3` 语法简洁得多，但支持面还窄（Safari 与较新版 Chrome 可用）。稳妥做法是把它写在 `@supports` 里，让 `float` 方案兜底。
- 首字放大后行高会撑开，`text-align: justify` 下会出现一处明显的疏密突变，视觉上要接受或改回左对齐。

## 备注

- 中文语境里「首字」通常也想下沉两个字。那更适合用两个字符的容器或 `::first-line` 配合，`::first-letter` 只能拿一个。
- 下沉字用朱批红而不加粗到极黑，更接近旧书的味道——过重的字会把整页压偏。
