---
title: 给网格线起名字
slug: grid-named-lines
category: 布局
tags: [网格线, 命名, 可读性]
since: 2026-10
source: 机制来自 CSS Grid 规范的方括号线名语法，自行实现
when: 布局有多层宽度（正文栏、插图栏、通栏），不想靠数第几条线来放置
stage: grid
tier: core
---

## 描述

一块版式里同时有「正文宽度」「插图宽度」「整屏宽度」三种尺度，元素按语义落到对应边界上，而不是按「第 2 条线到第 5 条线」。

机制是 ==在方括号里给网格线起名，然后按名字而不是序号定位==。`[content-start]` 这类名字写在轨道定义里，紧挨着它要标记的那条线；放置时写 `grid-column: content`，浏览器就去查这个名字。序号是可以数的，但数错了不报错——改名改的是一处定义，而序号散在每个元素上。

名字还能**同一个名字贴在多条线上**（`repeat` 里带名字就是如此），于是 `grid-column: content 2 / content 3` 这种写法可以指向「第 2 个叫 content 的区间」。

## 代码

```html
<div class="nl">
  <p>正文落在中间那一栏。宽度是名字说了算，不是数出来的线号。</p>
  <figure class="nl-figure">插图往右伸到插图栏</figure>
  <p>再一段正文。同一套线名，三种宽度。</p>
  <blockquote>引用也走正文栏，靠对齐而不是靠加 margin 来区分。</blockquote>
</div>
```

```css
.nl {
  display: grid;
  /* @mechanism 方括号里的名字贴在线上，放置时按名字查而不是按序号数 */
  grid-template-columns:
    [full-start] 1fr
    [content-start] min(52ch, 100% - 4rem)
    [content-end] 1fr
    [full-end];
  width: min(640px, 90vw);
  font: 400 15px/1.8 system-ui, sans-serif;
  color: #1c1a17;
}

/* @mechanism 默认全部落在正文栏 */
.nl > * {
  grid-column: content;
  margin: 0 0 12px;
}

.nl-figure {
  /* @mechanism 一条线名加数字，就是「第 1 个 content 到第 2 个 content」 */
  grid-column: content / full-end;
  padding: 18px 20px;
  background: #efe9dd;
  border-left: 3px solid #b4462f;
  font-weight: 600;
}
```

## 边界

- 名字是**字符串匹配**。名字里有一个字母写错，`grid-column: contnet` 不会报错，该项会退回自动放置——现象是「它跑到最后一行去了」，而不是「它没对齐」。
- 名字里的空格决定线的身份：`[content-start]` 是一条名叫 `content-start` 的线，`[content start]` 是两条名叫 `content` 和 `start` 的线。两者都合法，但含义完全不同，这是最容易写错的地方。
- 同一条线上可以贴多个名字（`[content-end] [full-end]`），常用来表达「这一侧结束了两件事」。但别把 `-start` 与 `-end` 混贴在同一条线上，读起来会自相矛盾。
- 同名线在多条轨道上出现时，`grid-column: content` 默认取**第一条**。想取第二条必须带上计数（`content 2`），否则永远落在第一条线上。
- 它只在已经定义好轨道的前提下有用。只有一个 `1fr` 的单列网格上起名字，是纯装饰。

## 备注

- 与 `grid-template-areas` 的分工：区域名表达「这块在哪」，线名表达「这条边界在哪」。有多个元素共享同一条边界时用线名，一块块拼图用区域名。
- 名字用 `-start` / `-end` 后缀是有意义的——浏览器会据此推导出 `grid-column: content` 的隐式跨法（从 `content-start` 到 `content-end`）。
