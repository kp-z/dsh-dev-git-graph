---
title: 从一个颜色里派生出透明版
slug: relative-color-alpha
category: 材质
tags: [颜色, 相对颜色, 透明]
since: 2026-10
source: 机制来自 CSS 相对颜色语法，自行实现
when: 需要「同一个色的 10% 透明版」做描边或叠层，又不想为此再定义一堆变量
stage: plain
tier: core
---

## 描述

主色是 `--brand`，需要它的 12% 透明版做描边、40% 透明版做悬停叠层。不必定义 `--brand-a12`、`--brand-a40` 两个变量，直接从 `--brand` 里取出通道、只换透明度。

机制是 ==相对颜色语法 `from`，把已有颜色当输入、把通道当变量用==。`rgb(from var(--brand) r g b / 0.12)` 读作「取 `--brand`，把它解成 r、g、b 三个通道，原样放回去，但透明度换成 0.12」。通道名是**这一色彩空间里**的通道：在 `oklch()` 里则是 `l c h`，`hsl()` 里是 `h s l`。于是「派生」有了统一的写法，不必先手算出十六进制。

它真正省下的是**一致性**：手写的两个色号在改主色时不会一起改，而相对颜色永远跟着 `--brand` 走。同一个 `--brand` 在这个页面上被换了主题色时，所有派生色自动到位。

## 代码

```html
<div class="swatch" style="--brand: oklch(0.62 0.15 255)">蓝</div>
<div class="swatch" style="--brand: oklch(0.66 0.16 40)">橙</div>
```

```css
.swatch {
  display: grid;
  place-items: center;
  width: 140px;
  height: 74px;
  margin: 10px;
  border-radius: 10px;
  /* @mechanism 从 --brand 里取通道、只换透明度，派生色永远跟着主色走 */
  background: rgb(from var(--brand) r g b / 0.14);
  /* @mechanism 同一套通道可以反复派生出不透明的版本做描边 */
  border: 1px solid rgb(from var(--brand) r g b / 0.55);
  color: rgb(from var(--brand) r g b / 1);
  font: 600 15px/1 system-ui, sans-serif;
}
```

## 边界

- 通道名必须与色彩空间匹配。写 `rgb(from var(--brand) l c h / 0.2)` 得到的不是想当然的结果——`l c h` 会被当成 r、g、b 三通道的位置值塞进去，于是得到一个完全不同的颜色，且不报错。
- 通道值可以参与 `calc()`（比如 `rgb(from var(--c) calc(r * 0.8) g b)`），但**不能**用条件判断。要「亮度低于某个值就换色」做不到，那得走 `color-mix` 或两套变量。
- 相对颜色与 `color-mix` 一样属于较新的语法，旧浏览器整条声明失效。用在 `background` 上会退回透明；用在 `border` 上会退回 `currentColor`（或初始值），**看起来像是颜色写错了**而不是「不支持」，容易误判。
- `rgb(from ...)` 里若原始色的透明度本来就不是 1，`/ 0.12` 是**覆盖**而不是相乘。想「在原透明度基础上再乘 0.5」得写 `calc(alpha * 0.5)` 并把原通道也带出来。
- 派生出来的透明色叠在什么底上就成什么色。`oklch(0.62 0.15 255)` 的 12% 透明版压在暗底上是暗蓝、压在白底上是浅蓝——同一个变量，两种观感。做设计令牌时要按「叠在什么底上」来定这个比例，而不是按「看起来多深」。
