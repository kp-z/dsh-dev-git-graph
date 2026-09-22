---
title: 荧光笔高亮
slug: highlight-marker
category: 排版
tags: [gradient, 正文, 色彩]
since: 2026-09
source: 机制来自 CSS 多重色标背景，自行实现
when: 一句话要像被荧光笔划过，但又不想盖住整个字
stage: plain
tier: core
params:
  - { name: cover, label: 覆盖高度, type: range, min: 30, max: 90, step: 5, default: 55, unit: % }
---

## 描述

文字下半截有一道颜色，像真的被人用荧光笔从字腰划过——上半截还是纸。

机制是 ==在一个渐变里把两个色标写在同一个位置==，得到一个硬边，把高亮限制在某个高度以下。`transparent` 到 `--cover` 这一段是透明的，从这里开始立刻上色。真正的荧光笔不会盖住整个字，那道「只覆盖下半截」的边就是全部效果所在。

用一整块纯色背景就做不出这个——那是「选中」，不是「划过」。

## 代码

```html
<p class="hl">机制不是一句话能说清的，但<span class="hl-mark">这句话值得被划出来</span>，因为它是整段的重点。</p>
```

```css
.hl {
  width: min(460px, 84vw);
  margin: 0;
  font: 400 16px/2 system-ui, sans-serif;
  color: #1c1a17;
}

.hl-mark {
  /* @mechanism 两个色标写在同一位置 = 硬边，高亮只到字腰 */
  background-image: linear-gradient(
    to top,
    rgb(217 164 65 / 0.72) var(--cover, 55%),
    transparent var(--cover, 55%)
  );
  background-repeat: no-repeat;
  padding: 0 3px;
}
```

## 边界

- 两个色标必须写在**同一个位置**才有硬边。差一点点就变成渐变，看起来是晕染开的一团，不是划出来的一道。
- 背景是画在文字盒子上的矩形，**跨行时每行各画一次**。多行文本的高亮会在行末断开、下一行重头开始，还会露出半截行距的空白。
- 它的高度是相对整个行盒算的，所以 `line-height` 越大，高亮离字越远——调 `--cover` 只能改比例，改不了基准。
- 深色主题下要调亮高亮色并降低透明度，否则像一块脏印子；浅色纸上则要压暗一点才有笔感。
- `background-size` 过渡会触发重绘。要让它「划过来」，元素多时改用伪元素的 `transform: scaleX`。

## 备注

- 给高亮两端加一点内边距（`padding: 0 3px`），看起来像笔尖有厚度，比严丝合缝更像手写。
- 同一招换个色就变成「铅笔底纹」或「马克笔重涂」，颜色透明度在 0.5–0.75 之间最像笔。
