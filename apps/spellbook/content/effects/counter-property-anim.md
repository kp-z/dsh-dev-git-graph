---
title: 用计数器做数字滚动
slug: counter-property-anim
category: 排版
tags: [计数器, 整数, 注册属性]
since: 2026-10
source: 机制来自 @property 的 integer 语法与 counter-reset，自行实现
when: 一个统计数字要从 0 涨到目标值，却不想为此写一段补间脚本
stage: dark
tier: core
params:
  - { name: dur, label: 涨到用时, type: range, min: 0.3, max: 4, step: 0.1, default: 1.6, unit: s }
---

## 描述

一个统计数字从 0 一路涨到四千多，抖着停在终值上，全程没有一行补间代码。

机制是 ==把一个注册成整数的变量喂给 counter-reset，让 CSS 动画直接产出整数==。`@property` 把它声明成 `<integer>` 之后，这个属性就成了可插值的数字；`counter-reset: n var(--n)` 把它当成计数器初值，`content: counter(n)` 再把这个计数器渲染成文本。动画只需要「从当前值写到目标值」，中间的整数由浏览器按帧插值并取整——动画驱动的是一个变量，数字本身是它的投影。

为什么必须是 `<integer>`：`counter()` 只接受整数，注册成 `<number>` 会得到小数而渲染不出来，注册成无类型的属性则根本不能插值，动画会在到点的一瞬间直接跳到终值。整数这个语法同时提供了两件事——可插值，以及每帧取整。这也是少数几个能把「CSS 数值」渲染成文本的入口，另一个是 `@counter-style`。

## 代码

```html
<!-- @mechanism 数字不写在 DOM 里：它由 counter() 生成，脚本与模板都不参与 -->
<p class="tally"><span class="tally-unit">次构建</span></p>
```

```css
/* @mechanism 注册成 <integer> 才有逐帧的整数中间值；无类型属性不能插值 */
@property --n {
  syntax: '<integer>';
  inherits: false;
  initial-value: 0;
}

.tally {
  /* @mechanism 注册过的整数当计数器初值，counter-reset 每帧都被重算 */
  counter-reset: n var(--n, 0);
  margin: 0;
  font: 600 46px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  /* @mechanism 等宽数字：位数不变时，每一位的宽度才是固定的 */
  font-variant-numeric: tabular-nums;
  color: #e9e4d8;
  animation: tally-run var(--dur, 1.6s) cubic-bezier(0.2, 0.9, 0.2, 1) forwards;
}

.tally::before {
  content: counter(n);
}

.tally-unit {
  margin-left: 0.5em;
  font: 400 14px/1 system-ui, sans-serif;
  color: rgb(233 228 216 / 0.6);
}

@keyframes tally-run {
  to { --n: 4820; }
}
```

## 边界

- `syntax` 必须是 `<integer>`。写成 `<number>` 会得到小数，`counter()` 渲染不出来或截断成不变的值，现象是数字停在原地。
- 未注册的自定义属性是「不可插值」的替换值，动画到点才切换一次，表现为数字直接蹦到终值。这一条不会报错，只能靠肉眼发现。
- 动画驱动的是 `counter-reset`，每帧都要重算样式并重绘文字——它跑在主线程上，不像 `transform` 能交给合成器。同时有几十个这样的计数器会明显掉帧。
- 计数器只能在同一元素或它的伪元素上消费。`inherits: false` 时值不会传下去，想在中途的子元素里读 `--n` 是读不到的。
- 它只能表达整数：小数、千分位、货币符号、单位后缀都得另想办法。`content` 里可以拼字符串，但格式化能力远不如脚本。
- 数字宽度随位数变化而跳动。等宽数字只保证「同位数的宽度一致」，解决不了 999 变成 1000 时多出一位；要么预留宽度，要么用 `ch` 定宽。
- 读屏软件与复制粘贴拿到的是生成内容，各引擎处理不一致，而且它只反映读到那一帧的值。数字类内容应当在外面用 `aria-label` 给出确定值。

## 备注

- 同一条 `--n` 可以同时喂给多个展示位置（进度条宽度、图表高度、文本），它们天然同步，因为它们读的是同一个动画变量。
- 把 `cubic-bezier` 换成带过冲的缓动，数字会在终值附近来回抖几下，比线性更像机械表。
