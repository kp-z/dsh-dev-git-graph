---
title: 数字与单位之间的那条窄缝
slug: number-unit-space
category: 排版
tags: [text-wrap, letter-spacing, 数字, 标点]
since: 2026-10
source: 机制来自 Unicode 的 U+202F 窄不换行空格与 UAX #14 的断行类，自行实现
when: 写「20 kWh」「86 mm」时，希望数字与单位不断开、又不要普通空格那么宽
stage: plain
tier: core
---

## 描述

数字与单位之间该有一条窄缝——比普通空格窄，而且**不允许断行**：`20` 与 `kWh` 永远在同一行上。

机制是 ==间距的宽度与可断性是两个独立维度，Unicode 把它们分给了不同的空格字符==。U+2009 窄空格是「窄但可断」，U+202F 窄不换行空格是「窄且不断」。所以「数字 + 单位」要的是 U+202F：`20&#8239;kWh`。普通空格（U+0020）比它宽，而且本身就是一个断行点——窄栏里最常见的现象是数字留在行末、单位掉到下一行，读者得回头去对。示例把两个盒子刻意做窄到放不下「20 kWh」：普通空格那格乖乖折成两行，U+202F 那格断不开，只能溢出边线。

CSS 层只能帮上一半：给单位降一点字号、加一点字距，让它看起来与数字并成一个整体，这属于样式；而「这里该不该断」必须在内容层就定好。所以这条缝是内容与样式分工的典型例子——宽度可以调，可断性不行。

## 代码

```html
<div class="nu">
  <figure>
    <figcaption>普通空格</figcaption>
    <p>20 kWh</p>
  </figure>
  <figure>
    <figcaption>U+202F</figcaption>
    <p>20&#8239;kWh</p>
  </figure>
  <figure>
    <figcaption>再降单位字号</figcaption>
    <p>20&#8239;<i class="unit">kWh</i></p>
  </figure>
</div>
```

```css
.nu { display: flex; gap: 14px; font: 400 14px/1.6 ui-monospace, Menlo, monospace; }
.nu figure { margin: 0; }
.nu figcaption { margin-bottom: 4px; font: 400 12px/1.6 system-ui, sans-serif; color: rgb(0 0 0 / 0.55); }

.nu p {
  /* @mechanism 盒子刻意窄到放不下「20 kWh」：普通空格处会断，U+202F 处不会 */
  width: 5ch;
  margin: 0;
  padding: 4px 6px;
  border: 1px solid rgb(0 0 0 / 0.3);
  background: rgb(180 70 47 / 0.06);
}

.unit {
  /* @mechanism 字号差是样式层的事，它不产生断行点 */
  font-style: normal;
  font-size: 0.88em;
  letter-spacing: 0.01em;
}
```

## 边界

- 这条缝是**内容**，CSS 改不动：没有任何属性能把普通空格变成不换行的窄空格。`white-space: nowrap` 只能整段禁断，代价是所有换行点一起没了。
- 用 `margin` 也能做出不换行的窄缝（它不产生断行点），但边距不进文本：复制、检索、导出纯文本时数字与单位会黏成 `20kWh`。这是内容层做法与样式层做法最实际的分野。
- `letter-spacing` 与 `word-spacing` 都管不到这条缝：前者加在字符之间，后者只作用于词分隔符（U+0020、U+00A0、U+3000），U+202F 不在那份名单里，所以它调不动。
- 空格字符会被复制。`20&#8239;kWh` 粘到不认识 U+202F 的老编辑器里可能显示成问号或一个宽空格，跨系统交换文本时要有心理准备。
- 中文与数字之间那条缝是另一个话题：它属于标点挤压与中西文自动空隙的机制族，宽度约定也不同（约四分之一个字宽），不要拿 U+202F 去冒充。

## 备注

- 三个空格字符刚好是「宽窄 × 可断」两维的组合：U+2009 窄而可断，U+00A0 全宽而不断，U+202F 又窄又不断；数字之间对齐还另有 U+2007 数字空格（也是不断的）。
- 表格里若要在数字与单位之间严格对齐，更稳的做法是把数字与单位拆成两列——那是布局层的事，比在字符里塞空格可靠。
