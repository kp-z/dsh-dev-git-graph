---
title: 避免末行只剩一个字
slug: text-wrap-pretty
category: 排版
tags: [换行, 段落, 孤字]
since: 2026-09
source: 机制来自 CSS Text 的 text-wrap 取值，自行实现
when: 段落最后一行总是掉下来一个词，看着难受
stage: plain
tier: candidate
---

## 描述

段落最后一行不会只剩一个词孤零零地挂着。

机制是 ==text-wrap: pretty 让浏览器在换行时避开末行孤字这类难看结果==。它和 `balance` 目标不同：`balance` 求**每行长度尽量相等**（适合标题，行数少），`pretty` **只优化末行**（适合正文，代价低得多）。

同一族属性、两种取向：短的用 `balance`，长的用 `pretty`。

## 代码

```html
<div class="tw">
  <p class="tw-wrap">这是一段用来观察末行的文字，它的长度被刻意安排成容易在最后掉下一个词的样子，好让你看清差别。</p>
  <p class="tw-wrap tw-pretty">这是一段用来观察末行的文字，它的长度被刻意安排成容易在最后掉下一个词的样子，好让你看清差别。</p>
</div>
```

```css
.tw {
  width: min(420px, 84vw);
  padding: 20px 22px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.4);
  font: 400 15px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.tw p {
  margin: 0 0 16px;
  text-wrap: wrap;
}

.tw-pretty {
  /* @mechanism 只优化末行，代价比 balance 低 */
  text-wrap: pretty;
  color: #b4462f;
}
```

## 边界

- `balance` 求各行等长、`pretty` 只治末行。**用错类别会得到奇怪的断行**——标题用 `pretty` 不会变整齐，正文用 `balance` 会被它的行数上限截断。
- `balance` 有行数上限（通常在 6 行左右），超过就退回普通换行。这也是它只适合标题的原因。
- `pretty` 仍会评估整个段落，只是范围比 `balance` 小。极长段落里依然会带来额外的布局计算。
- 支持面较新。不支持时退回默认换行——不破版，只是孤字还在。
- 它是为**词间有空格的文字**设计的。中文没有空格，断行点更密，这个属性的优化效果远不如西文明显。

## 备注

- 把它放在 `body` 上做全局默认是安全的——不支持就忽略，支持就自动变好。
- 标题上仍应显式用 `text-wrap: balance`，两者职责不同，别指望一个属性包办。
