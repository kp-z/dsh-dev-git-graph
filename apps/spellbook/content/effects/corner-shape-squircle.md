---
title: 超椭圆圆角
slug: corner-shape-squircle
category: 图形
tags: [圆角, 超椭圆, 连续曲率]
since: 2026-10
source: 机制来自 CSS Borders and Box Decorations Level 4 的 corner-shape，自行实现
when: 大圆角卡片想要连续曲率的「苹果式」圆角，而不是几何圆弧
stage: grid
tier: candidate
params:
  - { name: radius, label: 圆角半径, type: range, min: 8, max: 46, step: 1, default: 30, unit: % }
---

## 描述

两张同样尺寸、同样半径的方块并排：左边是常见的四分之一圆弧角，右边那种饱满、从边到角一路顺下去、找不到接缝的，是超椭圆。

机制是 ==corner-shape 决定圆角处补什么曲线，border-radius 只负责这个角有多大==。`border-radius` 的角是一段四分之一圆弧：圆弧与直边相接的地方，曲率从 0 突然跳到 1/r。半径小的时候看不出来，半径一大这个突变就很显眼——那正是「大圆角看起来像被剪掉一块」的来源。超椭圆（指数约 4 的那种）用一条曲率连续过渡的曲线去衔接直边，边和角之间没有可辨认的接缝，眼睛看到的就是一整块被磨圆的形状。

这两条属性的分工是这一条里最值得记住的事：`border-radius` 仍然决定角的位置和尺寸，所以布局数值一个都不用改；`corner-shape` 只替换掉补角用的那条曲线。也就是说圆角的**大小**和圆角的**形状**从同一个属性里拆开了，以前这是只能二选一的事。

半径仍然是主要的设计变量；`corner-shape` 可以逐角写（和 radius 一样是四值），也可以在 `round / squircle / bevel / notch / scoop / square` 之间混用——倒角、缺口、内凹都只是同一条属性的不同取值，不必再靠 `clip-path` 拼。想要连续控制就用 `superellipse(4)` 显式给指数，指数越大越方。有一点要动手调：同半径下 squircle 看起来比 round 更「饱满」，要做到观感等量通常得把半径调小一点。

## 代码

```html
<div class="cs">
  <div class="cs-card cs-round">圆弧</div>
  <div class="cs-card cs-squircle">超椭圆</div>
</div>
```

```css
.cs {
  display: flex;
  gap: 18px;
  font: 600 14px/1 system-ui, sans-serif;
}

.cs-card {
  display: grid;
  place-items: center;
  width: min(120px, 34vw);
  height: min(120px, 34vw);
  color: #1b1710;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: linear-gradient(150deg, rgb(255 255 255 / 0.85), rgb(180 70 47 / 0.18));
  /* @mechanism 半径仍然决定角有多大，两种角共用同一个值才比得出来 */
  border-radius: var(--radius, 30%);
}

.cs-squircle {
  /* @mechanism 只换补角用的曲线：曲率连续，边与角之间没有接缝 */
  corner-shape: squircle;
}

.cs-round {
  corner-shape: round;
}
```

## 边界

- 只在有圆角的角上起作用：`border-radius` 为 0 的角没有可塑的区域，写再大的指数也没变化。
- 它改的是**画出来的轮廓**，不改元素盒：布局尺寸、外边距、命中区域都还是矩形。所以「点不到圆角外的区域」这类需求仍然要靠别的办法。
- 元素被 `clip-path` 裁过时，可见轮廓以裁切路径为准，圆角形状会被盖掉——两者不在同一个阶段决定。
- 半径大到超过半边长时浏览器会按比例缩放各角，`squircle` 在这个状态下的观感与 `round` 差别更大（更像一块圆角方），极端数值下不要指望两者能一一换算。
- 支持面窄（Chromium 139+ 起），所以写成 candidate。不支持时整条声明被忽略，退回普通圆弧——不破版，只是没那么好看。把它当增强，别把版式结构建立在它上面。
- 它是独立属性，不是 `border-radius` 简写的一部分，两者要分别写在同一条规则里。

## 备注

- 同一套「换曲线」的思路也能用在别的地方：`superellipse()` 的指数就是那个连续可调的旋钮，从圆一路调到方，中间每一档都可用。
