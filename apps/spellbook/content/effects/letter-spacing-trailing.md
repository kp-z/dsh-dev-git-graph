---
title: 字距加在最后一个字后面
slug: letter-spacing-trailing
category: 排版
tags: [字距, 居中, 宽度]
since: 2026-10
source: 机制来自 CSS Text 的 letter-spacing 作用于每个字符的推进宽度，自行实现
when: 标题加了字距之后怎么看都偏左，居中也不居中
stage: plain
tier: core
params:
  - { name: track, label: 字距, type: range, min: 0, max: 0.4, step: 0.02, default: 0.16, unit: em }
---

## 描述

标题拉开一点字距就有了气质，但总有点不对：居中的标题看着偏左，贴边的文本右边凭空多出一小块空。

机制是 ==`letter-spacing` 加的是**每个字符**的推进宽度，包括行内最后一个字符==。字符后面那一次间距跟着末字一起参与该行宽度计算，于是「文字宽度」比肉眼看到的字面宽了整整一个字距：居中时视觉重心往左偏半个字距，靠右对齐时右边空出一格，图标或标点跟在文字后面时被推开一段。补偿办法是把多出来的那一次间距减回去——给元素一个等于字距的负 `margin-inline-end`，字面宽度就回到与字距无关的真实宽度。示例里字后面那个小方块就是证据：没补偿时它被推开一个字距，补偿后紧贴末字。

值本身是设计选择：`0.1em` 上下是「正文里读得出来但不刺眼」的量，`0.25em` 以上只适合全大写、短标签、拉丁字母极少的场景。用 `em` 而不是 `px`，是因为字距要跟着字号走——标题在小屏下降一档字号时，用 `px` 写的字距会突然显得过分松散。

## 代码

```html
<div class="ls">
  <p class="ls-bad"><b>字距没补偿</b><i></i></p>
  <p class="ls-good"><b>字距已补偿</b><i></i></p>
</div>
```

```css
.ls { width: min(320px, 80vw); display: grid; gap: 8px; }

.ls p {
  margin: 0;
  padding: 6px 10px;
  border: 1px solid rgb(0 0 0 / 0.18);
  font: 400 15px/1.6 system-ui, sans-serif;
}

.ls b {
  /* @mechanism 字距推进每个字符的宽度，末字后面那一次也照样算进去 */
  letter-spacing: var(--track, 0.16em);
}

.ls i {
  display: inline-block;
  width: 0.5em;
  height: 0.9em;
  vertical-align: -0.1em;
  background: #b4462f;
}

.ls-good b {
  /* @mechanism 减掉末字后面多出来的那一次字距，字面宽度才对得上 */
  margin-inline-end: calc(-1 * var(--track, 0.16em));
}
```

## 边界

- 字距一非零，浏览器通常不再应用字距调整（kerning），连字也往往一并关掉：`fi` 会散成两个字形的正是这一条。想要字距又要连字，只能二选一——这是规范允许的取舍，不是渲染 bug。
- 补偿值必须与字距用同一个来源。把 `0.16em` 抄成两处、改一处忘一处，现象是「只偏一点点」，比完全不补偿更难发现——示例里两侧都读同一个 `var(--track)`。
- 负的 `letter-spacing` 会把字形挤到互相重叠，`-0.02em` 已经算很重的压缩；要收紧字距先看看字体本身有没有 `condensed` 一类的宽度轴。
- 两端对齐的段落里，行末那一次字距也计入该行宽度，会让行提前一丁点折行。正文字距一般留在默认值，字距是标题与短标签的玩具。
- `letter-spacing` 是逐字符的，它不区分字与标点：标点前后的字距会显得比字与字之间更空，中文标点的挤压是另一套机制。

## 备注

- 全大写短标签、按钮文案、`<small>` 说明文字是字距的三个经典用武之地。
- 图标字体或内联图标跟在文字后面时，也会被末字距推开一点点；同一个负边距能一起修好。
