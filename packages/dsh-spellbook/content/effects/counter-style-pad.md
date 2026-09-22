---
title: 给编号补零或换一套数字
slug: counter-style-pad
category: 排版
tags: [counter-style, font-variant, 列表, 数字]
since: 2026-10
source: 机制来自 CSS Counter Styles 的 @counter-style 与 pad 描述符，自行实现
when: 章节号、版本号、清单编号要固定位数，或者想换成中文数字编号
stage: plain
tier: core
---

## 描述

列表的编号是 `01`、`02`、`03`——两位数对齐，跳到十位也不会突然多占一格。

机制是 ==列表编号不是文本，而是一套「计数器样式」算法，`@counter-style` 把这套算法交给你==。`system` 决定怎么把整数变成符号串，`symbols` 给出符号表，`pad` 补到指定位数，`suffix` 决定编号后面跟什么。`pad: 2 "0"` 的读法是「不足两位的，前面补 0」：1 变 01，12 还是 12，位数超出时原样输出、绝不截断。

为什么不用脚本或手写字符串：编号跟着列表项的数量走，删掉中间一项时手写的 01、02 会串位；而计数器样式的编号是**生成的**，增删都由引擎重算。同一个机制还能顺手把编号换成中文数字（`system: additive` 配汉字符号）、循环的 `◆ ◆◆`（`system: cyclic`），而不必动 HTML 一个字符。

排版上多出来的一个好处是：编号的字形也归 CSS 管。给标记挂上 `tabular-nums`，等宽数字会让所有位数相同的编号宽度一致，`padding-left` 留出的那个缩进才不会随编号跳动。

## 代码

```html
<ol class="chapters">
  <li>入口与初始化</li>
  <li>渲染管线</li>
  <li>索引与存储</li>
</ol>
<button id="sb-chapter-add">再加一章</button>
```

```css
@counter-style chapter {
  /* @mechanism 从 decimal 扩展：只改补零与后缀，十进制算法照旧继承 */
  system: extends decimal;
  /* @mechanism pad 把编号补到两位 —— 位数超出时不会截断 */
  pad: 2 "0";
  suffix: "　";
}

.chapters {
  list-style-type: chapter;
  padding-left: 3.4em;
  font: 400 15px/1.9 system-ui, sans-serif;
  /* @mechanism 等宽数字：让 09 与 10 的宽度一致，缩进才不会跳 */
  font-variant-numeric: tabular-nums;
}

.chapters li::marker {
  /* @mechanism 标记的样式由 ::marker 控制，编号文本本身是生成的 */
  color: #b4462f;
  font-weight: 600;
}
```

```js
const list = document.querySelector('.chapters')
document.getElementById('sb-chapter-add')?.addEventListener('click', () => {
  // @mechanism 新项的编号由计数器样式现算，不必手工维护任何字符串
  const item = document.createElement('li')
  item.textContent = '再补一章'
  list?.append(item)
})
```

## 边界

- `pad` 只补位数，不能截断：编号到 100 时照样占三位，列宽跟着变。要固定列宽就得按最长的位数预留缩进，否则 99 变 100 那一下正文缩进会跳一格。
- `@counter-style` 里描述符拼错或取值非法时，整套样式失效，列表静默退回默认的 `decimal`——现象是「补零没了」，而不是报错。
- `system: extends decimal` 与 `system: numeric` 的区别：前者继承现成的十进制算法（含范围、负数与 fallback 行为），后者要求你自己给符号表，漏了描述符就落到兜底。
- `list-style: none` 会连 `::marker` 一起干掉，此时编号只能写在 `content` 里，`pad` 与 `suffix` 的活要自己补，位数对齐也要另外做。
- 编号与正文之间的间隔由 `suffix` 决定（默认是 `.`），`list-style-position: inside` 则会让长编号跟着正文一起折行，缩进不再整齐。
- `<ol start="9">` 改的是计数器起点而不是显示字符串，所以它照样会经过 `pad`：从 9 数起的第一项显示 `09`。

## 备注

- 同一套机制可以给编号加固定前缀（`prefix: "第 "`）、换中文数字（`system: additive` 配 `additive-symbols: 1000 "千", 100 "百", 10 "十", 1 "一"`），或者做循环的 `◆ ◆◆`（`system: cyclic`）。
- `pad` 的补位字符不一定是 `0`：空白或 `·` 都可以，效果是把编号补成一个定宽的小字段。
