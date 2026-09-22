---
title: 数码管数字
slug: odometer-count
category: 动效
tags: [transition, transform, font-variant, 数字, 自动]
since: 2026-09
source: 自行实现
when: 计数器变化时数字要滚动着换，而不是直接跳成新值
stage: dark
tier: core
params:
  - { name: dur, label: 滚动用时, type: range, min: 0.2, max: 1.5, step: 0.1, default: 0.6, unit: s }
---

## 描述

计数器从 3 变成 4 时，那一位数字向上滚了一格，像里程表。

机制是 ==把 0 到 9 竖排成一列，用 translateY 位移到目标数字的位置==。每位数字都有一整列 0–9，容器只露出其中一格；数值一变，整列向上平移一格，中间那个滚过去的瞬间就出现了运动感。

它把「换一个字符」变成「移动一段距离」——动画因此可以插值。

## 代码

```html
<div class="od">
  <span class="od-cell">
    <span class="od-strip" id="sb-od">0 1 2 3 4 5 6 7 8 9</span>
  </span>
  <span class="od-unit">条咒语</span>
</div>
```

```css
.od {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font: 600 34px/1 system-ui, sans-serif;
  color: #f0ead9;
}

.od-cell {
  display: inline-block;
  /* @mechanism 只露出一格的高度 */
  height: 1em;
  overflow: hidden;
  vertical-align: bottom;
}

.od-strip {
  display: block;
  /* @mechanism 用位移换数字，动画因此可以插值 */
  transition: translate var(--dur, 0.6s) cubic-bezier(0.5, 0, 0.2, 1);
  /* @mechanism 等宽数字，每一位的宽度才对得上 */
  font-variant-numeric: tabular-nums;
}

.od-unit {
  font-size: 13px;
  font-weight: 400;
  color: rgb(240 234 217 / 0.6);
}
```

```js
const strip = document.getElementById('sb-od')
if (strip) {
  // 把 0-9 拆成竖排的十行
  strip.textContent = ''
  for (let i = 0; i <= 9; i += 1) {
    const row = document.createElement('span')
    row.textContent = String(i)
    row.style.display = 'block'
    row.style.height = '1em'
    strip.append(row)
  }
  // 演示可以重播，旧的定时器要先清掉，否则会越跑越多
  if (window.__sbOdometer) clearInterval(window.__sbOdometer)
  let n = 3
  let up = true
  window.__sbOdometer = setInterval(() => {
    n = up ? n + 1 : n - 1
    if (n >= 9) up = false
    if (n <= 1) up = true
    // @mechanism 位移 = 格数 × 一格高度
    strip.style.translate = '0 ' + -n + 'em'
  }, 1400)
}
```

## 边界

- 位移量必须等于**格数 × 一格高度**。用 `em` 做单位时它会跟着字号缩放，比自己算像素稳。
- 容器要 `overflow: hidden` 且高度**正好一格**。高度偏大时会露出上下两个数字的边，看起来像没对齐。
- 数字位数变化时（9 → 10）不能靠位移解决——多出的那一位需要另外一列，纯位移做不了。
- 用 `translate` 而不是 `top`：后者每帧触发布局重算。
- 必须用等宽数字（`tabular-nums`）。不同数字宽度不同时，位移的基准会偏，滚到一半会有横向抖动。
- 它只是视觉。读屏仍然按 DOM 读，所以那 10 个数字会被逐个读出来——真实的无障碍做法是给容器 `aria-hidden` 并在旁边放一个可读的值。

## 备注

- 把 `transition` 换成 `animation` 配 `steps(1)` 就是「啪」地跳一格，硬但没有惯性。
- 多位数就复制多列，每列一个 `transition-delay` 就能做出「从个位开始依次滚」的观感。
