---
title: 括号在 RTL 里会自己翻过来
slug: bidi-auto-mirroring
category: 排版
tags: [bidi, 标点, 正文]
since: 2026-10
source: 机制来自 Unicode 双向算法的镜像规则（UAX #9 L4）与 CSS Writing Modes 的 direction / unicode-bidi，自行实现
when: 页面要支持阿拉伯语或希伯来语，可括号在阿语行里看着是反的
stage: plain
tier: core
---

## 描述

同一行文字换到从右往左的方向里，`(` 会自动长成 `)`、`[` 变成 `]`——你没有换字符，字符还是那一个。

机制是 ==括号类字符带「镜像」属性，双向算法在 RTL 层级里取它的镜像字形==。这是 Unicode 双向算法在做的事：当某个字符被解析成 RTL 方向，且它的镜像属性为真，渲染时就画成翻转后的形状。所以正确做法不是把括号换成「反的」那个码位——那会把内容和显示绑死——而是把方向标对：用 HTML 的 `dir` 属性（内容层，会跟着文本一起被复制、序列化），或者 CSS 的 `direction`（样式层，只管渲染）。

混排时还要防「串行」：一段拉丁文或一串数字夹在 RTL 段落里，会被双向算法按强弱等级重新排队，标点可能落到错的一边。用 `unicode-bidi: isolate` 把那一段包成一个独立的方向单元，它的内部顺序就与外层互不影响——这是给用户名、代码、型号这类外来片段的标准做法。

## 代码

```html
<div class="bidi">
  <p dir="rtl">מסמך (טיוטה) [נספח]</p>
  <p dir="rtl"><b class="forced">a (b) [c] &lt;d&gt;</b></p>
  <p dir="rtl">版本 2026 (候选) <code class="iso">v1.2.3</code></p>
</div>
```

```css
.bidi { width: min(340px, 80vw); font: 400 15px/1.9 system-ui, sans-serif; }
.bidi p { margin: 0 0 6px; }
.bidi code { font-family: ui-monospace, Menlo, monospace; }

.forced {
  /* @mechanism 把这段 ASCII 强制按 RTL 层级排，镜像才会发生在没有阿语字符的地方 */
  unicode-bidi: bidi-override;
}

.iso {
  /* @mechanism 隔离成独立方向单元：内部顺序不再与外层互相排队 */
  unicode-bidi: isolate;
  color: #b4462f;
}
```

## 边界

- 镜像只发生在**解析方向为 RTL** 的字符上。一长串纯 ASCII 放在 RTL 段落里时，双向算法把它判成一段 LTR 行程，里面的括号仍然朝原方向——所以「靠右对齐」不等于 RTL，也不会有任何镜像。这是最常见的误判：以为 `text-align: right` 就是阿语模式。
- 不要为了显示而改用「反括号」码位。内容层一旦写反，复制到别的编辑器、被检索索引、被读屏朗读时都会错——那是把渲染问题写进了数据。
- `direction: rtl` 会一起改掉默认对齐、`start`/`end` 的指向，以及 flex 与 grid 的行内轴起点。改完方向几乎总要重看一遍布局，它从不是「只翻文字」。
- `dir="auto"` 让引擎按第一段强方向字符猜方向，适合用户生成内容；猜错的表现是整段方向反了，所以显示时得留出重排的余地。
- 数字串本身不会被反转（它是 LTR 行程），但与它相邻的括号、逗号属于中性字符，会跟着周围的方向走。
- 这一套是**文本级**的：机器上没装阿拉伯字体、显示成豆腐块时，括号照样被镜像。正好可以用它来判断问题出在方向还是字体——括号翻了，说明方向对了，剩下的是字体缺失。

## 备注

- `<bdo dir="rtl">` 可以只给一小段强制方向；`<bdi>` 是自带隔离语义的元素，用户生成的名字、ID 放进去最省心。
- 同一段外来文本被复制到支持双向排版的编辑器里时，方向信息（`dir`）比样式更管用，因为它是内容的一部分。
