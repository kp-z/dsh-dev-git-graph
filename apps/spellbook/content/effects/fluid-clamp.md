---
title: 流式字号
slug: fluid-clamp
category: 排版
tags: [custom-property, 标题, 正文]
since: 2026-09
source: 机制来自 CSS clamp() 函数，自行实现
when: 标题要随屏幕连续变大变小，而不是在断点处跳一下
stage: plain
tier: core
params:
  - { name: min, label: 最小字号, type: range, min: 14, max: 40, step: 1, default: 22, unit: px }
  - { name: max, label: 最大字号, type: range, min: 32, max: 110, step: 2, default: 68, unit: px }
---

## 描述

字号跟着窗口宽度连续长，到上下限就停住，中间没有任何断点。

机制是 ==clamp(下限, 视口相对值, 上限)==。中间项必须是一个随视口变化的量（`vw`、`vi`、`cqi` 都行），它决定变化的速度；两端的常量只在越界时兜底。三个值缺一不可：去掉 `vw` 项就退化成固定字号，去掉上下限就会在大屏上失控。

## 代码

```html
<p class="fl">咒语书</p>
```

```css
.fl {
  margin: 0;
  /* @mechanism 中间项是视口相对值，决定变化速度 */
  font-size: clamp(var(--min, 22px), 4.6vw + 0.4rem, var(--max, 68px));
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: #1c1a17;
}
```

## 边界

- 中间项写成固定值（`clamp(22px, 40px, 68px)`）就完全失去意义了——它永远是 40px，看起来「没生效」。
- 中间项一开始就超过上限时，字号立刻封顶、曲线是平的，会让人以为 `vw` 系数写小了。用两三条不同窗口宽度实测才知道真实曲线。
- 用 `vw` 时移动端地址栏伸缩会改变视口宽度，字号跟着跳。要稳就换成 `cqi` 配容器查询——那样它跟的是容器而不是窗口。
- 两条曲线的拐点（比如 `4vw + 1rem`）写不好会出现「小屏变大屏反而字号减小」的倒挂，改系数时要按实际尺寸算一遍。

## 备注

- `rem` 与 `vw` 混用是为了尊重用户的根字号设置：纯 `vw` 会无视无障碍放大的需求。
- 给标题用 `line-height: 1.05`、`letter-spacing` 收一点负值，大字号下才不会显得松散——字号越大，默认行距和字距越显得空。
