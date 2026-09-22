---
title: 行尾的空格挂不挂起
slug: white-space-break-spaces
category: 排版
tags: [text-wrap, 代码, 正文]
since: 2026-10
source: 机制来自 CSS Text 的 white-space: break-spaces 与行尾空白挂起规则，自行实现
when: 代码块或预排文本里有一长串空格，在窄容器里溢出、或者对不齐
stage: plain
tier: core
---

## 描述

同一段保留了空格的文本放进窄盒子：一串空格从盒子右边「挂」出去，盒子不换行也不变高；换成 `break-spaces` 之后，同一串空格老实占位，并在盒子里折行。

机制是 ==`pre-wrap` 把行尾的空格挂起——它们不占行宽、也不形成断点；`break-spaces` 让每个空格都真的占一格，并且可以在任意一个空格处断行==。挂起是排版上的老规矩：手工折行留下的尾随空格不该影响行宽，也不该把行挤到下一行。代价是当一串空格正好落在行末时，它们会溢出容器的边线。`break-spaces` 放弃挂起，用「空格也参与宽度计算」换来不溢出。

这一条对代码块、diff、以及用空格对齐的文本尤其重要：那里的空格是内容的一部分，不是排版噪声，溢出会把整个布局挤歪。代价是长空格串会占掉整行，看起来像凭空多出几个空行。

## 代码

```html
<div class="ws">
  <p class="hang"><span>pre-wrap</span>A&#32;&#32;&#32;&#32;&#32;&#32;&#32;&#32;&#32;&#32;&#32;&#32;B</p>
  <p class="keep"><span>break-spaces</span>A&#32;&#32;&#32;&#32;&#32;&#32;&#32;&#32;&#32;&#32;&#32;&#32;B</p>
</div>
```

```css
.ws { width: min(340px, 82vw); font: 400 14px/1.7 ui-monospace, Menlo, monospace; }

.ws p {
  /* @mechanism 保留空格：这里的空格是内容，不是排版噪声 */
  white-space: pre-wrap;
  /* @mechanism 盒子刻意窄到放不下这一串空格，差别才显形 */
  width: 7ch;
  margin: 0 0 10px;
  padding: 6px 8px;
  border: 1px solid rgb(0 0 0 / 0.3);
  background: rgb(0 0 0 / 0.03);
}

.ws span { display: block; font: 400 12px/1.6 system-ui, sans-serif; color: rgb(0 0 0 / 0.55); }

.keep {
  /* @mechanism 每个空格都占位、都能在空格处断行，于是空格串被折行而不是挂出去 */
  white-space: break-spaces;
  border-color: rgb(180 70 47 / 0.7);
}
```

## 边界

- 两者的差别只在**行末**的空格上：不在行末时，两个值都不会把连续空格折叠成一个。所以别在整段文字里找差别，要让空格正好落在折行处——示例的盒子刻意只有 7 个字符宽就是为了这个。
- 这一族里每个值的取舍不同：`normal` 折叠空格也折叠换行，`nowrap` 折叠但不换行，`pre` 都保留但绝不换行，`pre-wrap` 都保留且会自然折行，`pre-line` 只保留换行、折叠空格。空格算不算内容，决定你该选哪一个。
- 制表符的宽度不属于这一族：它由 `tab-size` 决定（`tab-size: 4` 把 Tab 当 4 个空格宽），而 `tab-size` 只在保留空白的值下才有意义——`normal` 里 Tab 早被折叠成一个空格了。
- 挂起的空格仍然在 DOM 里、也仍然可以被选中与复制。「看不见」只是行盒层面的说法，它不会凭空消失。
- 父级设了 `overflow: hidden` 时，挂出去的那串空格会被裁掉，看起来就像「空格不见了」，比让它折行更难查——一旦裁掉，你就失去了判断它在哪一层被吃掉的线索。

## 备注

- 展示型代码块想要「长行折行且空格不错位」，`white-space: break-spaces` 比 `pre-wrap` 稳。
- 复制带空格的文本时，挂起的空格与占位的空格复制结果一样；差别只在渲染。
