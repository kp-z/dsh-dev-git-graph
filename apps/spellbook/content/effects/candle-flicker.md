---
title: 烛光的两个频率
slug: candle-flicker
category: 材质
tags: [烛光, 频率叠加, 图层]
since: 2026-10
source: 机制来自烛焰抖动是低频摆动与高频燃烧噪声的叠加，自行实现
when: 一团暖光要「活着」，但单条 animation 看起来像呼吸灯
stage: dark
tier: core
params:
  - { name: sway, label: 摆动幅度, type: range, min: 0, max: 20, step: 1, default: 8, unit: px }
---

## 描述

黑暗里一团暖光在慢慢摇，同时还在快速地细碎抖动——像火苗，不像呼吸灯。

机制是 ==两个频率必须落在两个元素上，才会相乘而不是互相覆盖==。烛焰的抖动其实是两件事叠在一起：火苗整体的低频摇摆（每秒两三次、幅度大）和燃烧的高频噪声（每秒十几次、幅度小）。在 CSS 里，同一个元素上写两条 `animation`，如果都动 `opacity` 或都动 `transform`，后一条会把前一条覆盖掉，因为同一个属性只有一个值；就算动的属性不同，两条时间函数也是各自独立的，不会自动叠成一个新频率。所以要把低频放在外层、高频放在它的伪元素上：父子的 `transform` 与 `opacity` 会按矩阵乘积与乘法复合，这才是真正的波形叠加。

可变的是低频周期与 `--sway`（摇摆幅度），以及高频抖动的幅度。低频偏慢会显得温柔、偏快会显得紧张。示例没有做 `prefers-reduced-motion` 的退路——正式项目里应该只关掉高频那一层、保留缓慢的摆动，因为完全静止的烛光反而更假。

## 代码

```html
<div class="candle">
  <i></i>
  <p>烛光</p>
</div>
```

```css
.candle {
  position: relative;
  display: grid;
  place-items: center;
  width: min(420px, 86vw);
  height: 240px;
  background: #07050a;
  color: #8a7a63;
  font: 400 13px/1.6 system-ui, sans-serif;
}

/* 低频：火苗整体的摇摆 */
.candle i {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 190px;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgb(255 214 140 / 0.5),
    rgb(255 150 60 / 0.12) 46%,
    rgb(255 140 50 / 0)
  );
  /* @mechanism 低频放父元素、高频放子元素，两级复合才是叠加的波形 */
  animation: sway 2.3s ease-in-out infinite alternate;
}

/* @mechanism 高频只管自己的 opacity，与父级的 transform 相乘而不是互相覆盖 */
.candle i::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: inherit;
  animation: burn 0.11s steps(2, jump-none) infinite alternate;
}

.candle p {
  position: relative;
  translate: 0 78px;
}

@keyframes sway {
  from { transform: translateX(calc(var(--sway, 8px) * -1)) scale(0.94) }
  to { transform: translateX(var(--sway, 8px)) scale(1.06) }
}

@keyframes burn {
  from { opacity: 0.86 }
  to { opacity: 1 }
}
```

## 边界

- `steps(2, jump-none)` 只有两个离散值，看着是硬跳。想要更细腻的噪声要加中间帧，或者干脆让高频层改用 CSS 之外的随机源。
- 两个元素的动画各自 `infinite`，周期不成整数比时不会有可见的共同节奏——这正是要的；一旦把周期凑成整数倍，整个东西就开始「打拍子」，立刻变机械。
- `background: inherit` 让伪元素拿到父级那张径向渐变，但它同时继承了背景的位置与尺寸规则。父元素一旦改用 `background-size`，两层就会错位。
- 高频层改的是 `opacity`，在带渐变与圆角的元素上会触发重绘而不是纯合成。同屏几十个烛光时这是可观的代价。
- 随机感是「看起来随机」，实际上每 2.3 秒精确重复一次，凝视久了还是能看出循环。
- 摇摆幅度 `--sway` 受元素自身尺寸限制，给得比半径还大时，光团会明显脱开容器中央，看着像在飘而不是在烧。

## 备注

- 「两个频率分两层」是所有有机抖动的通用配方：水面的波、屏幕的呼吸光、飘动的旗，都是低频承载大位移、高频承载小扰动。
- 想更真就再加第三层，做极低频的整体亮度漂移（十几秒一次），三层以上人眼就分辨不出周期了。
