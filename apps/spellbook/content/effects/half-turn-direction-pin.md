---
title: 把方向钉死的一帧
slug: half-turn-direction-pin
category: 动效
tags: [旋转方向, 关键帧, 插值]
since: 2026-09
source: tobiasahlin/SpinKit（MIT） — sk-wander 里的 50% / 50.1% 那一对帧，改写为独立最小示例
when: 旋转角度跨过 180 度时，转的方向和你写的相反
stage: dark
tier: core
---

## 描述

一个小方块绕圈走，方向就是写的那样，没有在中途反着转。

机制是 ==在两帧中间插一个几乎相同的关键帧，把「转到一半」这个状态钉死==。原实现在 `50%` 与 `50.1%` 两处写了几乎一样的值（`-179deg` 与 `-180deg`），中间只差 1 度。

这么做是因为**插值永远走最短路径**。从 `0` 到 `-180` 正好是一半，浏览器可以选顺时针也可以选逆时针；把中段用一对极近的帧锁住，方向就唯一了。

原实现这里留了一句注释：`Make FF rotate in the right direction`。

## 代码

```html
<div class="pin-stage">
  <div class="pin-cube"></div>
</div>
```

```css
.pin-stage {
  display: grid;
  place-items: center;
  width: min(280px, 76vw);
  height: 190px;
  background: #0a0810;
}

.pin-cube {
  width: 54px;
  height: 54px;
  border-radius: 8px;
  background: linear-gradient(150deg, #7c5cff, #4a2fa8);
  animation: pin-walk 2.4s ease-in-out infinite;
}

@keyframes pin-walk {
  0% {
    transform: rotate(0deg);
  }
  /* @mechanism 50% 与 50.1% 写几乎一样的角度，把中段钉住 */
  50% {
    transform: rotate(-179deg);
  }
  /* @mechanism 这一帧只差 1 度，作用是锁死旋转方向而不是改变位置 */
  50.1% {
    transform: rotate(-180deg);
  }
  100% {
    transform: rotate(-360deg);
  }
}
```

## 边界

- 这是为**方向不确定性**打的补丁，不是视觉设计。不了解「插值走最短路径」这条规则时，根本想不到要去查这里。
- 触发条件是角度跨度**正好是 180 度或它的奇数倍**——这时两个方向一样短，浏览器只能自己挑。跨度小于 180 时方向本来就是确定的，不需要这个补丁。
- 两帧的值必须**极近**（这里是 1 度）。差得多的话就变成真的改位置了，中间的过渡会看出来。
- 它是按引擎行为调的。原注释点名 Firefox，说明不同引擎在同一处的取舍可能不同——这类写法要实测。
- 更稳的替代方案是**避免正好转 180 度**：写成 `-181deg` 或分成两段各 90 度，方向就没有歧义了。收这一条的价值在于看清问题本身。
- 它只影响中间过程，不影响首尾帧的位置。所以视觉上「结果一样、过程不同」，很隐蔽。

## 备注

- 原实现是 tobiasahlin/SpinKit（MIT） 的 `sk-wander`，作者在这里留了 `/* Make FF rotate in the right direction */`。
- 通用思路：**当两个状态之间存在多条路径，而你想指定其中一条时，就在中间补一帧**。这和「支点突变」是一条路的两个用法。
