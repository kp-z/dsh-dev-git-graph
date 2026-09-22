---
title: 堆叠条用 flex-grow 分额
slug: stacked-bar-flex-grow
category: 图形
tags: [图表, flex, 比例]
since: 2026-10
source: 机制来自 flex-grow 的按值分配与 basis 归零，自行实现
when: 要把总量拆成几段显示占比，而且宽度要随容器自适应
stage: plain
tier: core
---

## 描述

一根横条被切成几段，每段宽度就是它在总量里的份额，容器变宽时比例不变。

机制是 ==用 flex-grow 当比例尺，basis 归零==。每段写 `flex: var(--n) 1 0`：`flex-basis: 0` 把「内容宽度」这个变量清掉（否则文字长的段会自动更宽），`flex-grow: var(--n)` 让剩余空间按数值分配。于是段宽 = 容器宽 × `--n` / 总和，**自动归一化**——不必先把数值算成百分比，也不必知道总和是多少。

换成 `width: var(--n)%` 也能画出来，但那样就得自己保证几段加起来是 100，多一段就溢出、少一段就留缝。`flex-grow` 的分母由浏览器算，改数据时不用动样式。

## 代码

```html
<div class="stack" role="img" aria-label="构成比例：甲 3 份、乙 5 份、丙 2 份">
  <span class="seg seg-a" style="--n: 3">甲</span>
  <span class="seg seg-b" style="--n: 5">乙</span>
  <span class="seg seg-c" style="--n: 2">丙</span>
</div>
```

```css
.stack {
  display: flex;
  height: 34px;
  border-radius: 4px;
  overflow: hidden;
  font: 500 12px/34px system-ui, sans-serif;
  color: #17110f;
}

.seg {
  /* @mechanism basis 归零，段宽才只由 --n 决定，不受文字长度影响 */
  flex: var(--n) 1 0;
  min-width: 0;
  text-align: center;
  white-space: nowrap;
}

.seg-a { background: #d9a441; }
.seg-b { background: #7fa88a; }
.seg-c { background: #b5705e; }
```

## 边界

- 漏掉 `flex-basis: 0`（只写 `flex-grow`）时，每段的**内容宽度**会先进场再分配剩余空间。结果是「写着一字的那段明显偏宽」——比例看着不对，但代码读起来完全没错，很容易查错方向。
- `min-width: 0` 不能省。flex 项默认 `min-width: auto`，即「不得窄于内容」。份额小的那段会为了放下文字而撑宽，把整条比例挤歪。极窄的段还会把文字挤出去——所以文字该由 `overflow: hidden` 配合，或者在窄段上直接隐藏标签。
- 段数超过二十几段时，每段都带圆角是不可能的（`border-radius` 只认首尾），得给容器 `overflow: hidden` 再由容器出圆角——这也正是上面那段 `overflow: hidden` 的作用。
- 这条只画比例，不画量级。两倍的量在两根条上看着一样长。要同时表达量级得另外给一个总量数字或一根总长不同的条。
- 读屏器读不到颜色与长度。`role="img"` + `aria-label` 把整条描述成一句话是够用的；若这些数值是页面主体，该改用表格。
