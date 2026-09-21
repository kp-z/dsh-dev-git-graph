---
title: 点阵底纹
slug: dot-matrix
category: 图形
tags: [点阵, 纹理, 径向渐变]
since: 2026-09
source: 机制来自 CSS 径向渐变平铺，自行实现
when: 要一层规整的点阵把空地填住，但不想用图片
stage: grid
tier: core
params:
  - { name: gap, label: 点距, type: range, min: 8, max: 40, step: 2, default: 16, unit: px }
---

## 描述

一层等距的小圆点铺满整块，像制图纸或漫画的网点底。

机制是 ==画一个圆点，然后用 background-size 平铺它==。`radial-gradient` 给出的是一张「一个点 + 周围透明」的最小图块，`background-size` 把它复制成整面墙。改间距只动这一个值，改点的大小只动色标——两层信息各管各的，不用重画。

`background-size` 比点直径大出多少，就是留白多少。

## 代码

```html
<div class="dm">
  <b>点阵底</b>
  <p>一个点，平铺成一面。</p>
</div>
```

```css
.dm {
  width: min(360px, 80vw);
  padding: 26px;
  /* @mechanism 画一个点，再用 background-size 平铺 */
  background-image: radial-gradient(
    circle,
    rgb(60 48 30 / 0.42) 1.6px,
    transparent 1.7px
  );
  background-size: var(--gap, 16px) var(--gap, 16px);
  background-position: center;
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.dm b {
  display: block;
  margin-bottom: 6px;
  font-size: 18px;
}

.dm p {
  margin: 0;
  opacity: 0.68;
}
```

## 边界

- 两个色标要差一点点（`1.6px` → `1.7px`）。写同一个值会得到锯齿边缘，因为抗锯齿需要至少一个像素的过渡带。
- `background-size` 至少要有点直径的两倍，否则点会连成一片、看不出是点阵。
- 平铺默认从左上角起算，容器边缘会出现**半个点**。加 `background-position: center` 让它从中心起算，两端对称切半，看起来整齐得多。
- 点很小时在高 dpi 屏上会偏灰。这不是显示错误，是抗锯齿把 1–2 像素的点摊开了；要更实就把点做大或加深颜色。

## 备注

- 把 `circle` 换成 `ellipse` 或加角度就能做斜向点阵，同一招换形不换结构。
- 两点间距与点径的比例控制在 5:1 左右最像制图纸；越小越密，最后会变成一块灰。
