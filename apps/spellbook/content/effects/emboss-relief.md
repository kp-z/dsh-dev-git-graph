---
title: 压印浮雕
slug: emboss-relief
category: 材质
tags: [浮雕, 内阴影, 光向]
since: 2026-09
source: 机制来自 CSS box-shadow 的双向 inset，自行实现
when: 按钮或面板要做成被压出来的样子，像纸上盖的钢印
stage: plain
tier: core
params:
  - { name: depth, label: 深浅, type: range, min: 1, max: 5, step: 0.5, default: 2, unit: px }
---

## 描述

一块同色的面板，四周像是从纸里压出来的，左上受光、右下背光。

机制是 ==两条方向相反的 inset 阴影，一明一暗，而且不带模糊==。左上亮、右下暗，等于假设光从左上方来——物体凸起时的受光方式就是这样。把两个方向对调，同一条规则立刻变成「凹下去」的效果。

真正决定成败的是**零模糊**。加一点点模糊半径，刻出来的边就变成了一团光晕，压印感全部消失。

## 代码

```html
<div class="er">
  <button class="er-btn">凸起</button>
  <button class="er-btn er-btn-in">凹下</button>
</div>
```

```css
.er {
  display: flex;
  gap: 16px;
}

.er-btn {
  padding: 14px 26px;
  border: 0;
  background: #e4dbca;
  font: 600 15px/1 system-ui, sans-serif;
  color: #3a3125;
  cursor: pointer;
  /* @mechanism 两条零模糊的双向 inset 阴影，定的就是光的方向 */
  box-shadow:
    inset var(--depth, 2px) var(--depth, 2px) 0 #fffdf6,
    inset calc(var(--depth, 2px) * -1) calc(var(--depth, 2px) * -1) 0 rgb(60 48 30 / 0.4);
}

/* 同样两条阴影，方向对调就变成凹下 */
.er-btn-in {
  box-shadow:
    inset calc(var(--depth, 2px) * -1) calc(var(--depth, 2px) * -1) 0 #fffdf6,
    inset var(--depth, 2px) var(--depth, 2px) 0 rgb(60 48 30 / 0.4);
  color: rgb(58 49 37 / 0.72);
}
```

## 边界

- 模糊半径必须是 **0**。加上模糊就从「刻出来的边」变成「发光」，是两种完全不同的东西。
- 光的方向要全局一致。同一页里有的左上亮、有的右下亮，整块界面会显得脏——这是压印做砸最常见的原因。
- 凸起与凹下是**同一组值的两个方向**。理解这一点就不必记两套参数：对调就是另一种。
- 亮暗别用纯白纯黑。用同色系的一档亮、一档暗更像真实压印；纯白在深色主题上尤其像划痕。
- 它靠的是「同色明暗差」，所以底色太浅或太深时对比会消失。底色与阴影色的明度差要够。

## 备注

- 压印与「描边」是两种语言：描边强调轮廓，压印强调体积。同一个按钮上不要都上。
- 把它和内发光叠起来（压印在外、发光在内）能做出「透过玻璃看到的按钮」，是很多拟物风格的基础。
