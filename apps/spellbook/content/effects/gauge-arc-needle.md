---
title: 仪表盘的弧与指针
slug: gauge-arc-needle
category: 图形
tags: [conic-gradient, custom-property, mask, 图表, 数字]
since: 2026-10
source: 机制来自 conic-gradient 的硬色标与 CSS 变量的角度换算，自行实现
when: 要显示一个 0–100 的量，但想要的是「仪表」而不是「进度条」
stage: dark
tier: core
---

## 描述

半圆仪表：外圈一道刻度弧，中间一根指针，量的变化只表现为指针转过的角度与弧上填充的长度。

机制是 ==角度只算一次，弧与指针同取一个变量==。指针的旋转写 `rotate(calc(var(--v) * 1.8deg - 90deg))`（满量程 180°），弧用 `conic-gradient` 的硬色标对写 `from -90deg, 金 0 calc(var(--v) * 1.8deg), 底 0`。两处读同一个 `--v`，因此不可能对不上——若分别维护「指针角度」与「填充百分比」两个值，迟早会有一处改了 1.8、另一处还是 3.6。

从整圆里取出**半圆环**要两步：`mask: radial-gradient(...)` 挖掉内圈得到环，再让容器的 `aspect-ratio: 2 / 1` 把下半截裁掉。注意 `conic-gradient` 从 12 点方向起算，而仪表要从 9 点方向起算，所以起始角是 `-90deg` 而不是 `0deg`。

## 代码

```html
<div class="gauge" style="--v: 72">
  <div class="gauge-arc"></div>
  <div class="gauge-needle"></div>
  <span class="gauge-read">72</span>
</div>
```

```css
.gauge {
  position: relative;
  width: 220px;
  aspect-ratio: 2 / 1;
  overflow: hidden;
  display: grid;
  place-items: end center;
  background: #14101a;
}

.gauge-arc {
  position: absolute;
  inset: 0 0 -100% 0;
  border-radius: 50%;
  /* @mechanism 起始角 -90deg 把 0 点从 12 点搬到 9 点；两边色标相接即成硬边 */
  background: conic-gradient(from -90deg, #d9a441 0 calc(var(--v) * 1.8deg), #2b2434 0);
  /* @mechanism 挖掉内圈，扇形才成为环 */
  mask: radial-gradient(farthest-side, transparent 62%, #000 63%);
}

.gauge-needle {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 2px;
  height: 84%;
  background: #f0ead9;
  transform-origin: bottom center;
  /* @mechanism 指针与弧读同一个 --v，所以不会对不上 */
  rotate: calc(var(--v) * 1.8deg - 90deg);
}

.gauge-read {
  position: relative;
  padding-bottom: 14px;
  font: 600 20px/1 var(--font-note, system-ui);
  color: #f0ead9;
}
```

## 边界

- 指针的 `transform-origin` 必须是 `bottom center`，且它和弧的圆心要对齐。弧是 `inset: 0 0 -100% 0`（下半截伸出被裁掉的区域），圆心在容器底边中点——所以指针也要贴 `bottom: 0`。改任一处而没改另一处，指针就会绕着弧外的一个点转。
- `conic-gradient` 的硬色标靠两个色标位置相接（`calc(...)` 与紧邻的 `0`）实现。中间误加一个逗号距离就会变成渐变过渡，「已填充」与「未填充」之间会出现一段模糊，看着像没渲染完。
- 超过满量程的值不会被自动夹住：`--v: 120` 会让弧绕回去盖住起点，指针也转过头。`--v` 是数字，`clamp()` 在这层用不了，得在写入时就夹。
- 触屏与键盘用户看不到任何可拖动的把手，这条只能**读**。要可调就得另外给一个 `<input type="range">`，别指望在这张图上做拖拽。
