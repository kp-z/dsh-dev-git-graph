---
title: 用噪点打散色带
slug: dither-anti-banding
category: 材质
tags: [噪点, 色带, 渐变色深]
since: 2026-09
source: 机制来自 openColorIO 与 Dither 的经典做法，自行实现
when: 大面积渐变上出现一道道可见的同心色带
stage: dark
tier: core
params:
  - { name: amount, label: 噪点强度, type: range, min: 0, max: 20, step: 1, default: 7, unit: % }
---

## 描述

大块渐变上的那一圈圈色带不见了，过渡变成连续的一片。

机制是 ==加一层极细的随机噪点，把色阶的边界打散==。色带的成因是色深：8 位通道只有 256 级，两个相邻色阶之间的跳变在这么大的面积上会被人眼连成一条线。噪点让每个像素在边界附近各自随机偏一点，人眼就把「线」读成了「颗粒」，而颗粒是连续的。

关键在**极细、极低透明度**。看得见噪点就说明加多了。

## 代码

```html
<svg width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-dither">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
  </filter>
</svg>

<div class="dt-panel">
  <div class="dt-band"></div>
  <span class="dt-hint">这块渐变上有一层噪点，只是看不见</span>
</div>
```

```css
.dt-panel {
  position: relative;
  display: grid;
  align-content: end;
  justify-items: center;
  width: min(360px, 82vw);
  height: 210px;
  overflow: hidden;
  background: #0a0810;
  font: 400 12px/1.6 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.7);
}

.dt-band {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 90% at 30% 20%, #3b2f5e 0%, #0a0810 72%);
}

.dt-band::after {
  content: "";
  position: absolute;
  inset: 0;
  /* @mechanism 极细噪点打散色阶边界，人眼读成颗粒而非色带 */
  filter: url(#sb-dither);
  opacity: var(--amount, 7%);
  /* @mechanism overlay 让噪点只做明暗微扰，不改变整体色相 */
  mix-blend-mode: overlay;
}

.dt-hint {
  position: relative;
  margin-bottom: 14px;
  text-align: center;
}
```

## 边界

- 噪点的量必须**极低**（5%–10%）。看得见颗粒就说明加多了，那就从「治色带」变成了「脏」。
- `mix-blend-mode: overlay` 让噪点只做明暗微扰、不动色相。换成普通叠加会整体变灰。
- 它治的是**色深不足**造成的色带，不是所有色带。如果渐变本身有色标安排不当（比如两个色标挨得太近），加噪点只是把问题盖住。
- `stitchTiles="stitch"` 让滤镜平铺时接缝不露；大区域上不加它会在块的边界看到接缝。
- 它是有代价的：滤镜会创建合成层，大面积上会占显存。治色带优先考虑的是**减少渐变面积或提高色标密度**，噪点是最后一步。

## 备注

- 这个做法在视频与游戏渲染里叫 dithering，已经有几十年历史——不是 CSS 的技巧，是通用的手段。
- 它和「滤镜噪点质感」的分工：那一条要的是**看得见的材质颗粒**，这一条要的是**看不见的色阶平滑**。
