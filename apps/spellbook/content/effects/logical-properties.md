---
title: 按书写方向写样式
slug: logical-properties
category: 布局
tags: [logical-property, writing-mode, bidi, 正文]
since: 2026-09
source: 机制来自 CSS Logical Properties，自行实现
when: 同一套样式要同时支持从左到右、从右到左和竖排
stage: plain
tier: core
---

## 描述

同一段 CSS，在阿拉伯语环境下整个布局自动镜像，一行都不用改。

机制是 ==逻辑属性用「块向 / 行内」代替「上下左右」==。`margin-inline-start` 的含义是「行内方向的起点」——在横排从左到右时是左边，从右到左时是右边，竖排时是上边。物理属性（`margin-left`）描述的是屏幕上的方位，逻辑属性描述的是**书写流里的位置**。

把方向交给书写模式，而不是写死在样式里。

## 代码

```html
<div class="lp">
  <div class="lp-row">
    <span class="lp-bullet"></span>
    <span>这一段用的是逻辑属性</span>
  </div>
  <div class="lp-row">
    <span class="lp-bullet"></span>
    <span>改一下 writing-mode 或 dir 它就镜像</span>
  </div>
</div>
```

```css
.lp {
  width: min(340px, 82vw);
  padding: 20px 22px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.42);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.lp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  /* @mechanism 内边距加在「行内起点」而不是「左边」 */
  padding-inline-start: 12px;
  /* @mechanism 加在「块向终点」，不是「底边」 */
  padding-block-end: 10px;
  border-inline-start: 3px solid #b4462f;
}

.lp-bullet {
  inline-size: 8px;
  block-size: 8px;
  border-radius: 50%;
  background: #b4462f;
}
```

## 边界

- 它不是「多写几个方向的样式」，而是**换了一套坐标**。理解成「不写死左右」只是表面——真正的收益是竖排与 RTL 都不用改样式。
- 逻辑属性与物理属性混用时**后声明的赢**，与书写模式无关。旧代码里残留的 `margin-left` 会悄悄覆盖新的 `margin-inline-start`。
- `inset-inline-start` 对应 `left`（横排 LTR 下）。用它做绝对定位比 `left` 可靠，但要求父级的书写模式是对的。
- 并非所有属性都有逻辑版本（比如 `background-position` 就没有）。缺的地方只能靠 `:dir()` 或分开写。
- 老浏览器上不认逻辑属性时会**完全忽略**该声明。迁移期间要么两套都写，要么确认目标环境支持。
- `writing-mode` 改成竖排时逻辑属性的行为会变（行内方向变成从上到下），这是特性不是 bug，但要实际验证一遍。

## 备注

- 它和「竖排文字」是同一套坐标体系的两端：一个负责排版，一个负责布局。
- `inline-size` / `block-size` 是 `width` / `height` 的逻辑版本，配合竖排时特别直观。
