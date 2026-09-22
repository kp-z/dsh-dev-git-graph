---
title: 两端对齐拉的是哪里
slug: justify-stretch-points
category: 排版
tags: [两端对齐, 中西混排, 可拉伸点]
since: 2026-10
source: 机制来自 CSS Text 的可拉伸点分配规则与 text-justify，自行实现
when: 同样两端对齐，中文那段被拉得松松垮垮，夹在里面的英文单词却一动不动
stage: plain
tier: candidate
---

## 描述

两段文字列宽一样、都设成两端对齐：中文那段每个字之间的空隙都被拉开了，英文那段只有词与词之间变宽。混排段落里两种拉伸同时发生，中文把余量吃掉了大半，于是中文显得松、夹在中间的英文显得正常。

机制是 ==两端对齐的余量只能从「可拉伸点」里挤，而中西文的可拉伸点根本不同==。西文的可拉伸点只有词与词之间的那个空格；中文里字与字之间本身就是断行点，引擎就在那里加空隙，所以中文两端对齐天然拉出的是字距。`text-justify` 是选择用哪一类可拉伸点的开关：`inter-word` 只拉词间，`inter-character` 允许拉字间。

有一件事必须记住：余量的大小由「这一行排得有多满」决定，与怎么写无关。所以能控制的只有三样——拉哪里（`text-justify`），要不要连最后一行也拉（`text-align-last`），以及每行排得满不满（列宽与字号）。CSS 里**没有**「空隙最多多宽」的开关；想让中文两端对齐好看，靠的是把列宽调到大多数行都能排满，而不是找一个收敛空隙的属性。

## 代码

```html
<div class="js">
  <p class="js-cjk">两端对齐把中文的字间空隙拉开，而夹在里面的 English words 之间几乎不动。</p>
  <p class="js-latin">Justified Latin text only stretches at the word spaces, so the words themselves never gain any extra letter spacing at all.</p>
</div>
```

```css
.js {
  width: min(30ch, 80vw);
  display: grid;
  gap: 10px;
}

.js p {
  margin: 0;
  font: 400 15px/1.8 system-ui, sans-serif;
  /* @mechanism 两端对齐：余量只往可拉伸点里塞，塞哪里由 text-justify 决定 */
  text-align: justify;
}

.js-cjk {
  /* @mechanism 中文的可拉伸点在字与字之间 */
  text-justify: inter-character;
}

.js-latin {
  /* @mechanism 西文只有词间空格可拉 */
  text-justify: inter-word;
}
```

## 边界

- `text-justify` 只有部分引擎实现，退化的表现是「写了但排版没变化」。注意 `text-align: justify` 本身是普遍支持的，不支持的只是这个选择开关——别拿它来判断 justify 有没有生效。
- `word-spacing` 改的是词间空隙的基础值，它**不改变**一行里可被摊开的余量总和。一行只有一个空格时，基础值调大调小，最终那个空格的宽度是同一个数——靠 `word-spacing` 治不了 justify 的大洞。
- 中文两端对齐的空隙落在字之间，标点也会被一起拉开（「，」前后变宽），读起来比左对齐更累。中文正文一般用左对齐配标点挤压；两端对齐留给栏宽固定、字数可控的标题与海报文案。
- 一行里只有两三个词时，余量集中在少数几处空格上，会被拉出很大的洞——这才是「两端对齐毁掉标题」的真实原因，与 `text-justify` 无关。
- 中西混排段落的 `lang` 会影响断行与标点规则，但**不影响**可拉伸点的选择；两者是分开的两套规则，别指望标 `lang="zh"` 就能让 justify 变得紧凑。

## 备注

- 想让中文两端对齐少花一点，最土也最有效的办法是加宽栏位或缩小字号，把每行排满——余量小了，拉出来的空隙自然小。
- 中日韩文本的标点挤压、自动空隙是另一个机制族，管的是标点与中西文交界处的间隙，与 justify 的余量分配不冲突但也不重叠。
