---
title: 标点悬挂
slug: hanging-punctuation
category: 排版
tags: [text-align, 标点, 正文]
since: 2026-09
source: 机制来自 CSS Text 的 hanging-punctuation，自行实现
when: 段落以引号开头，整行被推进去一格，左右边线不齐
stage: plain
tier: candidate
---

## 描述

段落开头的引号探出版心之外，正文的第一列仍然笔直。

机制是 ==hanging-punctuation 让标点悬挂到版心之外==。中文排版里行首的引号、括号不该把正文挤进去——传统做法就是让它探出边线。这个属性让浏览器做这件事，而不必用负 `text-indent` 去猜该挪多少。

它是「版心」与「标点」之间关系的正解。

## 代码

```html
<div class="hp">
  <p class="hp-on">「机制要说得清，出处要记得住。」这一段的首字是引号，它探出了左边线。</p>
  <p>后面这一段以正文字开头，左边线自然对齐。</p>
</div>
```

```css
.hp {
  width: min(420px, 84vw);
  padding: 20px 24px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.4);
  font: 400 15px/2 "Songti SC", "SimSun", serif;
  color: #1c1a17;
}

.hp p {
  margin: 0 0 14px;
}

.hp-on {
  /* @mechanism 行首标点挂到版心之外，正文保持齐头 */
  hanging-punctuation: first last;
}
```

## 边界

- 支持面**极窄**（基本只有 Safari）。写进库是为了把机制说清楚，实际项目要用 `@supports (hanging-punctuation: first)` 兜底，退回负 `text-indent` 方案。
- `first` 管行首、`last` 管行末、`allow-end` 是行末的宽松处理。不写就都不管，默认值不是「智能开启」。
- 它依赖浏览器知道字体的**标点压缩信息**。中文字体一般有，拉丁字体几乎没有——所以在西文里它基本不发生。
- 行首禁止标点（避头尾）是另一套规则（`line-break: strict`），与悬挂不是一回事，中排场景常常要一起配。
- 悬挂出去的标点会超出容器边界。父级有 `overflow: hidden` 时会被裁掉，看起来像标点缺了一半。

## 备注

- 用负 `text-indent` 的经典替代方案：`text-indent: -0.5em` 配 `padding-left: 0.5em`，机制不同但视觉接近。
- 悬挂的实际价值在「多列正文」里最明显——两列之间的边线齐了，整块就稳了。
