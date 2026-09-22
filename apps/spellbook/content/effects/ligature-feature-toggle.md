---
title: 连字的开关
slug: ligature-feature-toggle
category: 排版
tags: [连字, OpenType, 字距]
since: 2026-10
source: 机制来自 CSS Fonts 4 的 font-variant-ligatures 与 OpenType 的 liga / dlig 特性，自行实现
when: 正文里的 fi 要合并成一个字，但编号、代码、可复制文本里必须逐字分开
stage: plain
tier: core
params:
  - { name: track, label: 字距, type: range, min: 0, max: 6, step: 0.5, default: 0, unit: px }
---

## 描述

`office` 里的 ffi 变成一个自己带轮廓的合体字；关掉它，三个字母各自站开。

机制是 ==连字把多个字符替换成一个字形，所以它是字形的合并，不是字距的调整==。这也是它为什么会影响别的东西：合并后的字形是一个整体（字形簇），光标移动、选区、折行都以它为单位；而 `letter-spacing` 一旦不为 0，引擎必须在每个字符之间插入空隙，连字也就无从合并——多数引擎在这种情况下直接关掉常用连字。这就是「加了字距，连字就消失了」的原因。

`font-variant-ligatures: none` 关的是常用连字（liga / clig），`discretionary-ligatures` 打开的是 dlig——那是展示体里 st、ct 这类花体合字，正文字体基本没有，请求了也毫无变化。示例把字距做成滑杆，就是为了让「字距一离零、连字立刻断」这条边界可以被亲手验证。

连字的取舍在于可读性：fi 的合并让 f 的上勾不再撞 i 的点，正文更顺；但编号、代码、序列号里合并会让人读错字符，那时的正确答案是关掉。

## 代码

```html
<p class="lg lg-on">office fluff — 连字打开</p>
<p class="lg lg-off">office fluff — 连字关闭</p>
<p class="lg lg-track">office fluff — 字距不为零</p>
```

```css
.lg {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 26px;
  margin: 0 0 10px;
  color: #1c1a17;
}

.lg-off {
  /* @mechanism 关掉 liga / clig，字形各自独立 */
  font-variant-ligatures: none;
}

.lg-track {
  /* @mechanism 字符之间要插空隙，连字就没有合并的余地 */
  letter-spacing: var(--track, 0px);
}

.lg-on {
  /* @mechanism dlig 只有展示体才有，请求它是安全的空操作 */
  font-variant-ligatures: common-ligatures discretionary-ligatures;
}
```

## 边界

- `letter-spacing` 不为 0 时常用连字会被引擎关闭，现象是加字距之后 ffi 分开了。这不是 bug，是「空隙往哪加」的必然结果。
- 连字随文本语言变化：同一段字在 `lang="en"` 与 `lang="tr"` 下可能得到不同字形（土耳其语的 i 要区分带点与不带点）。`lang` 是排版的真实输入，不只是无障碍标签。
- `dlig` 默认关闭且极少有字体提供，请求它在正文里通常完全没变化——不要用它来判断代码有没有生效。
- 关掉连字会让字距看起来更紧：连字的负空间补偿没了。逐字分开后往往要补一点 `letter-spacing` 才不挤。

## 备注

- 同一套开关机制还能拿到 `font-feature-settings: "ss01" 1` 这类字体自定义的替换集：值写 1 开、0 关，其余特性名要去字体文档里查。
