---
title: 刻度尺与标签对齐
slug: axis-ticks-alignment
category: 图形
tags: [坐标轴, 重复渐变, 对齐]
since: 2026-10
source: 机制来自 repeating-linear-gradient 画刻度与两端标签的半格偏移，自行实现
when: 图表底下要一排刻度线配一排数字，而且两者必须严格对齐
stage: plain
tier: core
---

## 描述

一条横轴，上面按等距排着刻度线，下面标着数字，每条刻度正对着一个数字的**中心**。

这里有两个机制。第一个是 ==用一条重复渐变画完所有刻度，不必生成几十个元素==：`repeating-linear-gradient(to right, 色 0 1px, transparent 1px 20px)` 一条背景就是等距刻度线，间距写在 `transparent` 的跨度里。改间距只改一个数字，也不用担心元素数量随数据变化。

第二个是 ==两端各外推半个标签宽，让标签中心落在刻度上==。容器用 `justify-content: space-between` 摆标签时，第一个标签的**左边缘**贴着轴的开头，而它的**中心**在右边半个标签宽处——于是标签整体相对刻度偏右。补偿办法是给标签行 `margin: 0 -1.5em`（负的外半个标签宽），让两端各溢出半个标签，第一个标签的中心才落回轴的起点。

## 代码

```html
<div class="axis">
  <div class="axis-ticks"></div>
  <div class="axis-labels">
    <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
  </div>
</div>
```

```css
.axis {
  width: min(420px, 90%);
  font: 400 11px/1 system-ui, sans-serif;
  color: #8a7f70;
}

.axis-ticks {
  height: 6px;
  /* @mechanism 一条重复渐变画完全部刻度，间距写在 transparent 的跨度里 */
  background: repeating-linear-gradient(
    to right,
    #6b6157 0 1px,
    transparent 1px 25%
  );
}

.axis-labels {
  display: flex;
  justify-content: space-between;
  /* @mechanism 两端外推半个标签宽，标签中心才落在两端刻度上 */
  margin: 0 -1.5em;
}

.axis-labels span {
  width: 3em;
  text-align: center;
}
```

## 边界

- 负外边距那 `-1.5em` 与标签的 `width: 3em` 是一对，改一个必须改另一个。写成固定 `px` 而字号由父级继承时，任何一处字号变化都会让对齐偏掉，而且**偏得很小**，容易当成「眼睛看错了」。
- `repeating-linear-gradient` 的最后一格会被容器宽度裁断：`25%` 的间距在宽度不能被 4 整除时会留一条半个刻度的残迹。间距用百分比时尤其明显，用 `px` 则稳定，但就不再随容器自适应了——这是这对取舍的真实代价。
- 刻度与标签是**两套独立的布局**（一个渐变、一个 flex），它们能对上只是因为数学凑巧一致。数据驱动的刻度（比如最大值不是整百）需要把两边的刻度位置算在同一处，此时留一条 CSS-only 的路子会开始出错。
- 标签用 `width: 3em` 而非 `flex: 1`，是为了让「标签中心」有确定位置。改成 `flex: 1` 后 `text-align: center` 仍能居中，但两端溢出量就不再是恒定的半个标签宽，负外边距失去依据。
- 刻度线是 1px 的渐变实线。在 dpr 为 1 的屏上，`25%` 落在小数像素时会出现某条刻度比别的浅——这是抗锯齿，不是渐变写错了。
