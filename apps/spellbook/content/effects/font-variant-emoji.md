---
title: 同一个字符，彩色还是单色
slug: font-variant-emoji
category: 排版
tags: [字形选择, 变体, 符号]
since: 2026-10
source: 机制来自 CSS Fonts 4 的 font-variant-emoji 与 Unicode 的变体选择符，自行实现
when: 正文里的 ❤ 或 ☺ 变成彩色表情，把一段沉稳的文字搅得很花
stage: plain
tier: candidate
---

## 描述

同一个码位 `❤`，可以画成一颗彩色的表情，也可以画成与正文同色的单色字形——决定这件事的是一个变体开关，不是换字体。

机制是 ==同一个码位在 emoji 字体与文字字体里各有一套字形，`font-variant-emoji` 指定引擎取哪一套==。字符本身没有变，变的是字形选择：`text` 强制单色（等价于在字符后面跟一个 U+FE0E 变体选择符），`emoji` 强制彩色（等价于 U+FE0F），`unicode` 交回给 Unicode 的默认表现与选择符决定。所以它和 `font-family` 是两件事——换成另一套正文字体未必能让符号变单色，因为彩色字形来自系统 emoji 字体，那是另一条独立的选字路径。

对排版来说这很实用：正文、标题、编号里的符号希望跟着文字颜色走（单色），而按钮、卡片、状态里的图标希望彩色。用 `text` 统一压住，比在每个字符后面手写 U+FE0F 干净——选择符是内容的一部分，会被复制、被检索、被 diff 看见，而 `font-variant-emoji` 只是样式。

## 代码

```html
<div class="em">
  <p class="mono">单色：❤ ★ ☺ ✈ ⚙</p>
  <p class="color">彩色：❤ ★ ☺ ✈ ⚙</p>
  <p class="meta">★ 没有彩色字形，两行都一样</p>
</div>
```

```css
.em {
  width: min(320px, 80vw);
  font: 400 16px/2.1 system-ui, sans-serif;
  color: #3b3226;
}

.em p { margin: 0 0 6px; }

.mono {
  /* @mechanism 强制取文字字体那一套字形，与正文同色 */
  font-variant-emoji: text;
}

.color {
  /* @mechanism 强制取彩色字形 —— 等价于在字符后跟一个 U+FE0F */
  font-variant-emoji: emoji;
}

.meta {
  font-size: 12px;
  color: rgb(0 0 0 / 0.55);
}
```

## 边界

- 支持面还窄：不支持的引擎会整条忽略，现象是「写了跟没写一样」。判断方法很实在——同一个字符加不加 U+FE0F 有明显差别，而写上这个属性毫无变化，那就是引擎没实现。
- 不是每个符号都有彩色版本。`★`（U+2605）就没有 emoji 字形，`font-variant-emoji: emoji` 对它无效；`❤`、`⚙`、`✈` 这类有彩色版本的才有两种表现。所以「这一行的符号全都变彩色了」通常做不到，混排里会留几个单色的。
- 变体选择符与这个属性是同一个开关的两条路：一个在内容里，一个在样式里。内容里已经有 U+FE0F 时，再写 `font-variant-emoji: text` 未必压得回去——各引擎的取舍不完全一致。要稳，就只留一处。
- emoji 字体的度量与正文不同：彩色字形按方框绘制，混排时常常把行高顶开一点。用 `line-height` 给足空间，别让一个符号决定整段行距。
- 复制、检索与读屏拿到的是同一个字符，两种表现对语义毫无影响——它纯粹是字形层的事，也因此不会被无障碍工具感知。

## 备注

- `font-variant-emoji: text` 是让「正文里的符号不那么吵」最省事的一条：不动内容、不动字体。
- 如果某种表现必须到处都一致（复制到聊天窗口、导出进图片），那就该把变体选择符写进内容——样式跟着页面走，内容跟着字符走。
