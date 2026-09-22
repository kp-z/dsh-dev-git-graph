---
title: 渐变画的虚线边
slug: gradient-dashed-edge
category: 图形
tags: [虚线, 边框, 背景瓦片]
since: 2026-10
source: 机制来自 CSS 多重背景把四条边拆成四块瓦片，自行实现
when: 要一圈虚线，但 border-style: dashed 的段长和间隙不可控、角上还对不齐
stage: plain
tier: core
---

## 描述

一圈虚线边框，段长、间隙、线宽全部可调，四个角上恰好各落一段线。

机制是 ==把四条边拆成四块瓦片，各自沿自己的方向重复，每块瓦片是「一段线 + 一段空」==。横向两条用 `linear-gradient(90deg, …)` 做一段 9px 的线、再用 `background-size` 把它缩成 15px×2px 的瓦片，`repeat-x` 就铺成一条虚线；纵向两条同理换成 180°。段长与间隙不再是浏览器替你定的常数，而是两个可以单独改的数值——这正是 `border-style: dashed` 做不到的事。

四角能对齐是相位算出来的：每块瓦片的起点都落在盒子的左上角（`0 0`、`0 100%`、`100% 0`），而线段总是从瓦片的 0 处开始，所以每条边在左上角一侧都以线段起步，四个角上纵横两条线正好交成直角。这也是为什么不能只画一条横贯整块的重复渐变再裁成边框：那样相位是连续漂的，角上不会刚好落在段的接缝上。

## 代码

```html
<!-- @mechanism 虚线是四条背景层，盒子本身没有 border -->
<div class="dash"><p>虚线边框由四条背景瓦片拼出来，段长与间隙都能单独改。</p></div>
```

```css
.dash {
  width: min(320px, 78vw);
  /* @mechanism 背景铺满整个盒子，所以要留 padding 把内容从虚线上让开 */
  padding: 20px 22px;
  background-color: #1b1626;
  /* @mechanism 每块瓦片是「一段线 + 一段空」：两条横向、两条纵向，各管一条边 */
  background-image:
    linear-gradient(90deg, #d9a441 0 9px, rgb(27 22 38 / 0) 9px),
    linear-gradient(90deg, #d9a441 0 9px, rgb(27 22 38 / 0) 9px),
    linear-gradient(180deg, #d9a441 0 9px, rgb(27 22 38 / 0) 9px),
    linear-gradient(180deg, #d9a441 0 9px, rgb(27 22 38 / 0) 9px);
  background-size:
    15px 2px,
    15px 2px,
    2px 15px,
    2px 15px;
  /* @mechanism 四块瓦片的相位都从盒子的左上角起算，所以每个角上刚好落一段线 */
  background-position:
    0 0,
    0 100%,
    0 0,
    100% 0;
  background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
  font: 400 14px/1.8 system-ui, sans-serif;
  color: #f0ead9;
}
```

## 边界

- 背景默认铺满整个 box，没有 padding 时内容会压在虚线上。这里必须靠 padding 让位，因为线不占布局空间（不像 `border`）。
- `background-position: 100% 0` 靠的百分比是「盒子宽 − 瓦片宽」，所以元素被 flex 分出半像素宽时，右边那条 2px 的线会被抗锯齿摊成半透明，看上去比左边淡。
- `border-radius` 会把背景一起裁掉，虚线在圆角处被斜切、不会跟着弯。圆角虚线得用 SVG 的 `stroke-dasharray`，或者用 `mask` 描边。
- 段长与间隙改一个，整条边的相位就变了。想让某条边的中点对齐某个位置，得单独改这条边的 `background-position` 相位。
- 四层里任何一层的 `background-size` 写错，只有那一条边会变形或消失，很容易漏看；先把四层写成一模一样的四个数再逐个改。
- 它只画在盒子的外沿，做不出 `border` 那种「占布局、把邻居推开」的效果。要占位就得同时写一个透明的 `border` 撑开空间。

## 备注

- 段长与间隙成正比缩放才能保持观感；两者都写死，元素变宽时段数会剧烈变化。
- 同一套瓦片换成径向渐变（`radial-gradient` 画点），就是「点线边框」；换成半圆就是「花边」。
- 只想给某一条边加虚线，就用一层瓦片；四层是「四条边都要」时的写法。
