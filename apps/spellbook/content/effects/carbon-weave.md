---
title: 碳纤维编织
slug: carbon-weave
category: 材质
tags: [repeating-gradient, background-size, 纹理, 图案, 容器]
since: 2026-09
source: 机制来自 CSS repeating-linear-gradient 的交叉叠加，自行实现
when: 面板要一层细密的技术感底纹，不能太平
stage: dark
tier: core
params:
  - { name: cell, label: 花纹大小, type: range, min: 4, max: 24, step: 1, default: 10, unit: px }
---

## 描述

一片深色底纹，细看是一格亮一格暗的斜向编织。

机制是 ==两组方向相反、相位错开的 repeating-linear-gradient 叠加==。单一一组斜线只是「条纹」；两组 ±45° 交叉、并且一组的色标加白、另一组加黑，交叉处才会形成一格亮一格暗的格纹，看出编织的经纬。

`background-size` 决定花纹多大，`repeating-linear-gradient` 里的长度决定线多宽——两个自由度是分开的，不用互相迁就。

## 代码

```html
<div class="cw">
  <b>编织底</b>
</div>
```

```css
.cw {
  display: grid;
  place-items: center;
  width: min(340px, 78vw);
  height: 170px;
  background-color: #16161a;
  /* @mechanism 两组反向斜线交叉，一格加白一格加黑才有编织感 */
  background-image:
    repeating-linear-gradient(45deg, rgb(255 255 255 / 0.055) 0 2px, transparent 2px 6px),
    repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.4) 0 2px, transparent 2px 6px);
  /* @mechanism background-size 管花纹大小，与线宽无关 */
  background-size: var(--cell, 10px) var(--cell, 10px);
  font: 500 17px/1 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.86);
}
```

## 边界

- 只有一组斜线时是**条纹**，不是编织。必须两组交叉。
- 两组的周期要一致。周期不同时交叉点会随位置漂移，看到的是乱纹而不是规整格纹。
- 亮暗色标要一正一反：一组加白、一组加黑。两组都加白只会平平地叠出一片灰。
- 线宽低于 1px 时在普通屏上会因取整变成一片灰。想要极细的纹，改用 SVG 的 `pattern` 更可控。
- 它是一张纯平铺图，没有方向光——所以看起来「平」。要立体感得再叠一层 `linear-gradient` 做整体明暗。

## 备注

- 同一套结构把角度从 ±45° 换成 0°/90° 就是「帆布」，换成 ±60° 是「斜纹布」，机制完全一样。
- 底色（`background-color`）单独写，改深浅的时候不会碰坏纹理。
