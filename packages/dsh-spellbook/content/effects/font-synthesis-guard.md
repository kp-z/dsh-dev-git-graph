---
title: 拒绝伪合成
slug: font-synthesis-guard
category: 排版
tags: [font-face, font-weight, 正文]
since: 2026-10
source: 机制来自 CSS Fonts 4 的 font-synthesis 与 @font-face 的声明范围，自行实现
when: 项目只带了一个字重，浏览器自己给它加了「假粗体」，字宽被撑开、对齐全乱
stage: plain
tier: core
---

## 描述

同一段文字的两个版本：一边的粗体是引擎算出来的（笔画发糊、字被撑宽），另一边保持原样不动。

机制是 ==font-synthesis 控制引擎在缺字重时的算法合成==。合成加粗的常见做法是把字形轮廓描粗（或叠加几次带偏移的副本），它改变的不只是笔画粗细，还有**字形的宽度**——于是整行字距、折行位置、居中对齐全部跟着变；合成斜体则是把正体统一做一次倾斜，圆角被拉成椭圆、衬线露出破绽，在 macOS 上还会看到倾斜角度和真斜体不一致。关掉合成不会给你一个粗体，它只是让「缺字重」这件事以本来面目出现。

要演示它得先制造一个缺档：`@font-face` 只声明 `font-weight: 400`，于是请求 700 斜体时无论字体里本来有没有，这个家族都只有一份 400 正体可用——引擎只剩两条路：自己合成，或者（关掉合成后）原样渲染。用 `local()` 指一个系统字体是让示例在你机器上跑起来的最省办法。

## 代码

```html
<!-- @mechanism 两行的 b 语义相同，差别只在引擎有没有被允许合成 -->
<p class="sy sy-auto">允许合成：<b>SERIES 07</b> — 被描粗并倾斜</p>
<p class="sy sy-none">拒绝合成：<b>SERIES 07</b> — 只有真字形</p>
```

```css
/* @mechanism 只声明 400 正体，家族里就没了别的档，缺档必须被处理 */
@font-face {
  font-family: "SB-Single";
  src: local("Times New Roman"), local("Liberation Serif"), local("Times");
  font-weight: 400;
  font-style: normal;
}

.sy {
  font-family: "SB-Single", Georgia, serif;
  font-size: 20px;
  margin: 0 0 14px;
  color: #1c1a17;
}

.sy b {
  font-weight: 700;
  font-style: italic;
}

/* @mechanism 默认允许合成：描粗与倾斜都由引擎算出来，字宽因此变化 */
.sy-auto b {
  font-synthesis: weight style;
}

/* @mechanism 关掉合成：没有真粗体时字就保持细的，失败是看得见的 */
.sy-none b {
  font-synthesis: none;
}
```

## 边界

- 它只关合成、不提供字形：真没有粗体时字就是细的。现象是「好像没生效」，其实这正是它该有的样子。
- 示例里那个 `local()` 的 `@font-face` 是制造缺档的手段：一旦本机匹配不到这个字体，整段文字会退回家族里的下一个字体（可能带真粗体），此时两行的差别完全消失——看上去像 `font-synthesis` 失效。
- `font-synthesis` 只管字重、斜体、小型大写三类合成；字符缺失时「回退到别的字体」不受它控制，那是另一套逻辑。
- `font-synthesis-small-caps` 这类细分长属性支持更晚，现象是设了没用；用总开关会把小型大写也一起关掉，可能不是你要的。
- 别把可变字体的字重当合成：那是真实轴上的字形，`font-synthesis: none` 对它无影响。

## 备注

- 交付 UI 组件库时值得显式写上：`font-synthesis: none` 让「我们只带了 400 和 700」这件事在页面上立刻暴露，而不是被引擎悄悄修补成两种都不像的字。
