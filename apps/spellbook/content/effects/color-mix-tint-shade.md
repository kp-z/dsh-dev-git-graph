---
title: 主色调洗出深浅
slug: color-mix-tint-shade
category: 材质
tags: [color-mix, oklch, 色彩]
since: 2026-10
source: 机制来自 color-mix 的百分比插值，自行实现
when: 界面里有一堆「同一个主色的浅底、深边、悬停态」，希望改主色时它们一起改
stage: plain
tier: core
---

## 描述

一套按钮的底色、悬停态、边框、以及列表的斑马纹，都是同一个主色「洗」出来的深浅。把主色换掉，这四个颜色一起跟着变。

机制是 ==把主色与白/黑按比例混，浅与深都由主色派生==。写成 `color-mix(in oklab, var(--brand) 12%, white)` 时，深浅不是四个手挑的色号，而是同一个变量加一个比例。手挑四个色号的问题不在写起来麻烦，而在**改主色时它们不会一起动**——总有一个会漏，界面上于是出现一块不属于新主色的颜色。

混白得到 tint、混黑得到 shade，这与「提高亮度 / 降低亮度」不是一回事：混白会同时**降低彩度**（更淡更灰），这正是浅底色该有的样子；如果只提亮度不提灰度，浅底会鲜得刺眼。用 `in oklab` 是让这条插值走在感知均匀的空间里，混出来的中间色不脏。

## 代码

```html
<button class="btn">主按钮</button>
<div class="panel">派生出来的浅底</div>
<div class="stripe">斑马纹也是主色派的</div>
```

```css
:root {
  --brand: oklch(0.62 0.15 255);
}

body {
  --tint-weak: color-mix(in oklab, var(--brand) 8%, white);
  --tint-mid: color-mix(in oklab, var(--brand) 16%, white);
  --shade-edge: color-mix(in oklab, var(--brand) 70%, black);
  font: 400 14px/1.6 system-ui, sans-serif;
}

.btn {
  padding: 9px 20px;
  border: 0;
  border-radius: 999px;
  /* @mechanism 底色与悬停色都派生自主色，换主色时两个一起换 */
  background: var(--brand);
  color: white;
  cursor: pointer;
}

.btn:hover { background: var(--shade-edge); }

.panel {
  margin-top: 12px;
  padding: 16px;
  border-radius: 8px;
  background: var(--tint-weak);
  border: 1px solid var(--tint-mid);
}

.stripe { padding: 8px 16px; background: var(--tint-mid); }
```

## 边界

- `color-mix` 的百分比是**第一个**颜色的占比，剩下的归第二个。写 `color-mix(in oklab, white 12%, var(--brand))` 得到的是「一点点白 + 一大堆主色」，与想当然的顺序相反——而且不报错，只是颜色不对。
- 去掉 `in oklab`（或用 `in srgb`）时，主色与白/黑混出来的浅色会偏灰偏脏，尤其是蓝紫一带。差别细微但整屏都受影响，容易被当成「设计稿本来就这样」。
- 混黑不等于「变暗的同色」：黑色把彩度也一起带走，深色端会比预期更浊。想要「底色变深但仍是同一个色相」，混一个更暗的同色相颜色比混纯黑更准。
- 派生变量写在 `body` 上而不是 `:root` 上时，改 `--brand` 需要写到同一个元素才生效；写在 `:root` 与 `body` 混用会让覆盖关系变得难以预料。
- `color-mix` 的结果是**计算值**，不能作为 `@media` 或容器查询的条件，也不能在 `@supports` 里判断它算出了什么。它只能被当成颜色用。
- 在超旧浏览器上 `color-mix` 整条声明失效，`background` 会退回「没有背景」。要么给一层兜底色，要么用 `@supports` 分开写。
