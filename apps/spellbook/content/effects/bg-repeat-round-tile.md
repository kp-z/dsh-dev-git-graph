---
title: 整格平铺的两种排法
slug: bg-repeat-round-tile
category: 图形
tags: [平铺, 取整, 缝隙]
since: 2026-10
source: 机制来自 CSS Backgrounds 3 的 background-repeat: round 与 space，自行实现
when: 图案的图块除不尽元素尺寸，右侧／下方拖着一条被切掉的半格
stage: grid
tier: candidate
---

## 描述

同一个点阵排三遍：第一遍右边拖着半格，另外两遍都不拖——差别只有一个关键字。

机制是 ==`background-repeat: round` 让浏览器把图块重新缩放到两个方向各自刚好整除，`space` 则保住图块的原始尺寸、把余量摊成瓦片之间的空隙==。两者都在解决同一件事：平铺的周期与元素尺寸通常互质，`repeat` 必然在边缘留下一条被切开的半格。`round` 的办法是改图块尺寸（图案略微变大变小），`space` 的办法是改间距（图案大小不变，缝隙变宽）。选哪个取决于这个图案经不经得起变形。

`round` 的代价就藏在「两个方向各自取整」这句话里：x 与 y 的缩放比一般不同，圆点会被拉成椭圆，方块会被拉成长方形。所以元素的两个方向除不尽的程度差得越多，变形越明显——元素高宽比越极端，这个坑越大。`space` 没有这个毛病，但它把 `background-size` 的语义从「图案的间距」偷偷换成了「图案本身多大」，间距另算，这一点常被忽略。

## 代码

```html
<!-- @mechanism 三个盒子只差一个 background-repeat 值，并排放在一起才看得出差别 -->
<div class="tile-set">
  <div class="tile tile--repeat"><span>repeat</span></div>
  <div class="tile tile--round"><span>round</span></div>
  <div class="tile tile--space"><span>space</span></div>
</div>
```

```css
.tile-set {
  display: grid;
  gap: 10px;
}

.tile {
  display: grid;
  align-items: center;
  width: min(300px, 78vw);
  height: 78px;
  padding-left: 12px;
  background-color: #0d0a14;
  /* @mechanism 图块 20.5px 与 300×78 两个方向都除不尽，问题才暴露得出来 */
  background-image: radial-gradient(circle at 50% 50%, #d9a441 0 4px, rgb(13 10 20 / 0) 4px);
  background-size: 20.5px 20.5px;
  font: 400 12px/1.6 system-ui, sans-serif;
  color: #f0ead9;
}

.tile--repeat {
  background-repeat: repeat;
}

/* @mechanism round 让图块在两个方向各自缩放到整除，右边不再有半格（代价是形状被改） */
.tile--round {
  background-repeat: round;
}

/* @mechanism space 保住图块尺寸，把余量摊成瓦片之间的空隙 */
.tile--space {
  background-repeat: space;
}
```

## 边界

- `round` 的两个缩放比通常不同：圆点变椭圆、正方变长方。图案里有正圆、正方、十字这类形状时这是最常见的翻车点，宁愿用 `space`。
- `space` 之后 `background-size` 只管「图块多大」，「图案的间距」变成另一个由剩余空间算出来的量。把它当周期用（比如计算相位）会算错。
- 这两个关键字要写在**两值语法**里：`round space`、`repeat round`、`space no-repeat`。它们不能和 `repeat-x`、`repeat-y` 混用——后者是单值关键字，后面再接一个值整条声明就无效，退回初始值 `repeat`。
- `round` 的取整基于定位区域（默认 padding box）。元素尺寸随窗口变化时，图块的尺寸会跟着微调，图案会「呼吸」；如果图案里有需要与内容对齐的东西（比如刻度的线），这条就不能用。
- 较老的浏览器不认这两个关键字，整条声明失效→退回 `repeat`。不报错、不破版，只是白调了，所以提交前最好在目标浏览器上看一眼。
- 元素尺寸正好是图块的整数倍时，三者渲染完全一样，看不出区别——这本身就是判断「到底有没有余数」的办法。

## 备注

- 与其让浏览器缩放，不如用 JS 在尺寸变化时把周期吸附成「元素宽 ÷ 向下取整」的值（写进一个 CSS 变量），这样只改一个数、图案不变形。
- 同一个思路用在边框上就是 `border-image-repeat` 的 `round`／`space`——但它管的是边框图的分段方式，和背景不是一套机制。
