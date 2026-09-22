---
title: 锥形渐变的饼图
slug: conic-pie-chart
category: 图形
tags: [conic-gradient, mask, 图表, 几何]
since: 2026-09
source: 机制来自 conic-gradient 的硬色标，自行实现
when: 要一个饼图，但不想引入图表库
stage: dark
tier: core
params:
  - { name: from, label: 起始角度, type: range, min: 0, max: 360, step: 15, default: 0, unit: deg }
---

## 描述

一个四段饼图，每段的边界是锐利的，没有过渡色带。

机制是 ==conic-gradient 的色标放在同一个位置就得到硬边界==。`color 25%` 之后紧接 `color2 25%`，中间没有可插值的空间，于是 25% 处直接换色——这就是「一块」的边缘。

扇形不需要额外的元素，一段渐变就是一张饼。

## 代码

```html
<div class="cp">
  <div class="cp-donut"></div>
  <ul class="cp-legend">
    <li><i style="background:#b4462f"></i>布局</li>
    <li><i style="background:#d9a441"></i>动效</li>
    <li><i style="background:#7c5cff"></i>排版</li>
    <li><i style="background:#14b8a6"></i>材质</li>
  </ul>
</div>
```

```css
.cp {
  display: flex;
  align-items: center;
  gap: 20px;
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.cp-donut {
  width: 150px;
  height: 150px;
  border-radius: 50%;
  /* @mechanism 两个色标同位置 = 硬边界，没有过渡 */
  background: conic-gradient(
    from var(--from, 0deg),
    #b4462f 0 25%,
    #d9a441 25% 50%,
    #7c5cff 50% 75%,
    #14b8a6 75% 100%
  );
  /* @mechanism 中间挖空成甜甜圈 */
  -webkit-mask: radial-gradient(circle, transparent 0 42%, #000 42%);
  mask: radial-gradient(circle, transparent 0 42%, #000 42%);
}

.cp-legend {
  margin: 0;
  padding: 0;
  list-style: none;
}

.cp-legend li {
  display: flex;
  align-items: center;
  gap: 7px;
}

.cp-legend i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
```

## 边界

- 硬色标必须**同位置**：`color 0 25%, color2 25% 50%`。写成 `color 0 25%, color2 26%` 会露出一圈渐变，看着像脏边。
- 它是**绘制**，不承载数据语义。读屏用户拿不到任何信息——必须配一份等价的列表或表格，图例不只是装饰。
- 每一段的角度要在 CSS 里**硬算**（25% = 90deg）。数据一变就得重算，所以真实场景通常由 JS 生成这段渐变。
- 它不能随数据变化做动画——除非用 `@property` 把角度注册成 `<angle>` 再动。硬色标的位置本身不可插值。
- 扇形边缘会有锯齿。要平滑得靠提高分辨率或加一层极窄的同色过渡，而不是靠浏览器抗锯齿。
- 甜甜圈用 `mask` 挖空，所以圆心是**真的空**（能透出下面的背景）。需要实心圆心时改用 `radial-gradient` 叠在锥形渐变上。

## 备注

- 把它和「锥形环」对比：那一条用的是渐变当装饰，这一条用的是硬色标当数据边界，机制同源、目的不同。
- 整圆的 360 度换成 270 度（右侧留缺口）就是仪表盘，也是同一段渐变。
