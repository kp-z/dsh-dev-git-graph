---
title: 纯 CSS 重复图案
slug: repeating-pattern
category: 图形
tags: [repeating-gradient, 图案, 几何, 容器]
since: 2026-09
source: 机制来自 repeating-linear-gradient 的色标周期，自行实现
when: 背景要有斜纹或格纹，但不想引入图片
stage: grid
tier: core
params:
  - { name: size, label: 周期, type: range, min: 4, max: 40, step: 2, default: 14, unit: px }
---

## 描述

一片斜纹，密度可调，全是算出来的，没有一张图片。

机制是 ==repeating-linear-gradient 的色标总长超过 100% 时会被按周期重复==。写 `0 6px, color 6px 12px` 时周期就是 12px——浏览器沿着渐变轴每 12px 重复一遍。把两条周期和角度都相同的斜纹交叉叠起来，就是格纹。

图案不是图，只是一段可以算的数。

## 代码

```html
<div class="rp"></div>
```

```css
.rp {
  width: min(300px, 78vw);
  height: 180px;
  /* @mechanism 色标总长就是周期，超过就重复 */
  background-image:
    repeating-linear-gradient(
      45deg,
      rgb(180 70 47 / 0.5) 0 calc(var(--size, 14px) / 2),
      transparent calc(var(--size, 14px) / 2) var(--size, 14px)
    ),
    repeating-linear-gradient(
      -45deg,
      rgb(217 164 65 / 0.34) 0 calc(var(--size, 14px) / 2),
      transparent calc(var(--size, 14px) / 2) var(--size, 14px)
    ),
    linear-gradient(160deg, #1d1730, #0d0a14);
  border: 1px solid rgb(60 48 30 / 0.3);
}
```

## 边界

- 周期由**最后一组色标的终点**决定。写 `color 0 8px, transparent 8px 16px` 周期是 16px；漏掉终点时周期会变成渐变默认的全长。
- **角度会改变视觉条宽**。`45deg` 的斜纹，看上去的条宽要乘以 cos45，比声明的长度窄约 30%——所以调出的密度总比预期密，要用参数补偿。
- 两条交叉斜纹的角度必须**互为相反数**（45 与 -45），周期也必须相同，否则交界处会错位成锯齿。
- `background-size` 与渐变自身的周期会**叠加**。做图案时通常让 `background-size` 等于渐变周期（或干脆不设），两个周期不一致时的结果很难预测。
- 深色主题上对比度要压得很低。图案一旦比内容显眼，整块就变得很吵。
- 它每帧都要重绘。静态没问题，一旦给带图案的元素加动画，代价比纯色高不少。

## 备注

- 把两层换成同一个角度、不同周期，就得到「宽窄相间的条纹」；换成 `repeating-radial-gradient` 就是同心圆纹。
- 点阵用 `radial-gradient` 配 `background-size` 更简单——那是「尺寸重复」而不是「色标重复」，是另一条路。
