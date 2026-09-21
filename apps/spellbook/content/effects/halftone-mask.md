---
title: 半调网点渐隐
slug: halftone-mask
category: 图形
tags: [半调, 遮罩, 网点]
since: 2026-09
source: 机制来自 CSS mask-image，自行实现
when: 点阵要往下逐渐消失，像漫画里从实到虚的网点
stage: plain
tier: candidate
params:
  - { name: cell, label: 网点间距, type: range, min: 6, max: 24, step: 1, default: 10, unit: px }
---

## 描述

整齐的圆点从上到下越来越淡，最后化进背景里。

机制是 ==点阵本身完全均匀，用 mask 的渐变控制哪一段显示==。点的大小和间距是不变的——渐隐是靠遮罩的透明度做出来的。这也解释了为什么它比「越往下点越小」的做法省事：点阵只需要一个可平铺的图块，渐变交给遮罩，两者互不干扰。

## 代码

```html
<div class="ht"></div>
```

```css
.ht {
  width: min(320px, 78vw);
  height: 190px;
  /* @mechanism 均匀的点阵，一个图块平铺 */
  background-image: radial-gradient(circle, #b4462f 36%, transparent 37%);
  background-size: var(--cell, 10px) var(--cell, 10px);
  /* @mechanism 渐隐完全由遮罩负责，点阵本身不变 */
  -webkit-mask-image: linear-gradient(180deg, #000 0%, rgb(0 0 0 / 0.35) 62%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 0%, rgb(0 0 0 / 0.35) 62%, transparent 100%);
}
```

## 边界

- `mask` 的透明区是**彻底不显示**，不是变淡。所以渐隐效果靠的是渐变里的 alpha 值，`transparent` 与 `rgb(0 0 0 / 0.35)` 这两档要按实际观感调。
- 需要 `-webkit-mask-image` 前缀照顾旧版 Safari，两行都要写。
- 点阵间距（`background-size`）与遮罩的过渡区间要对上：过渡太窄会看到「上面一整块点、下面一刀切」。
- `mask` 会创建新的层叠上下文，并可能触发额外的合成层。大面积使用时留意一下性能。
- 点很小时 anti-aliasing 会让它偏灰；`36%` 这个色标位置是点径与格子的比例，调它会同时改变点的实心度。

## 备注

- 遮罩的方向换成任意角度就是斜向渐隐，改 `linear-gradient` 的角度即可，点阵完全不用动。
- 同一招也能给图片做「从实到虚」的过渡，把 `background-image` 换成 `url()` 就行。
