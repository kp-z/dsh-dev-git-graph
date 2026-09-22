---
title: 断词靠词典，不靠宽度
slug: hyphens-soft-hyphen
category: 排版
tags: [hyphens, text-wrap, 正文]
since: 2026-10
source: 机制来自 CSS Text 的 hyphens 与 U+00AD 软连字符，配合 HTML 的 lang 属性，自行实现
when: 窄栏里的英文长词总整词掉下去，前一行右端空出一大块
stage: plain
tier: core
---

## 描述

窄栏排英文时，一个长词放不下就整词挪到下一行，前一行右端空掉一大块；开了断词之后，词会在音节处断开并补一个连字符。

机制是 ==断词位置由语言的断词词典给出，而词典是靠 `lang` 选的==。`hyphens: auto` 本身不含任何断词知识，它只是说「允许引擎去查词典」；引擎看这个元素继承到的语言标注（比如 `lang="en"`），取对应语言的断词规则，再按栏宽决定断在哪里。所以只写 `hyphens: auto` 而不给语言标注，等于什么都没发生——这是它最常见的失效方式，而且不报错、也不报控制台警告。

不想依赖词典时可以用软连字符 `&shy;`（U+00AD）：它在文本里是一个不占宽度的字符，标记「这里可以断」，只有真的断行时才显示成连字符。它和 `hyphens: manual`（`hyphens` 的默认值）天生一对——手工标出的位置比词典更懂你的术语与品牌词。两者也能并存：`hyphens: auto` 先按词典找位置，你标了 `&shy;` 的地方优先。

## 代码

```html
<!-- 有 lang：引擎去查英文词典 -->
<p class="hy" lang="en">Hyphenation needs a dictionary, and the dictionary is chosen by the lang attribute on the element.</p>

<!-- 没有 lang：hyphens: auto 就是一句空话 -->
<p class="hy">Hyphenation needs a dictionary, but this paragraph has no lang attribute at all.</p>

<!-- manual：只在 &shy; 标出的位置断 -->
<p class="hy hy-manual" lang="en">Manual breaks happen only where you say: anti&shy;dis&shy;establish&shy;ment&shy;arian&shy;ism.</p>
```

```css
.hy {
  width: 15em;
  margin: 0 0 10px;
  font: 400 15px/1.8 Georgia, system-ui, serif;
  /* @mechanism 允许查词典断词 —— 词典由元素继承的 lang 决定 */
  hyphens: auto;
  text-align: justify;
}

.hy-manual {
  /* @mechanism 关掉词典，只认内容里 &shy; 标出的断点 */
  hyphens: manual;
}
```

## 边界

- `lang` 提供的是「用哪本词典」，词典本身由引擎自带。同一个 `lang="en"`，不同浏览器、不同系统的断词位置可能不同——断词位置不能当作可精确控制的排版结果。
- `hyphens: auto` 对中文完全无效（中文没有音节连字符），中文断行靠 `line-break`。反过来，中文页面给英文段落标 `lang="en"` 才有意义；中英混排的段落按主语言标一次，别指望两套规则同时生效。
- 断词只在「整词放不下」时救命。栏太窄时会连续断行，读起来很碎；`hyphenate-limit-chars` 能限制「词至少几字母、断点前后至少留几个字母」，但支持面窄，当作增强而不是依赖。
- 软连字符是**内容**：它会被复制、被搜索、被 diff 看见，也会在不该断的地方带来一个看不见的字符。写成 `&shy;` 而不是从别处粘一个不可见字符进来，至少让源码可读。
- 词里本来就有连字符时（`state-of-the-art`），断词连字符与它长得一样，断行后读者分不清本来有没有。技术文案里慎开。
- 断词只影响**行盒**的折行，不改变任何一个字符；复制粘贴拿到的是完整单词（软连字符除外，它是真字符）。

## 备注

- `hyphenate-character` 能指定断开时用哪个字符，默认是字体给的连字符。
- 软连字符的另一个用武之地：表格窄列里的长标识符（`getUserMedia`）用 `&shy;` 指定唯一断点，比 `word-break: break-all` 精确得多。
