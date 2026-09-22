---
title: 轨道之间分剩余空间
slug: content-distribution-leftover
category: 布局
tags: [对齐, justify-content, 剩余空间]
since: 2026-10
source: 机制来自 CSS Box Alignment 规范的 content-distribution（justify-content / align-content），自行实现
when: 网格的轨道加起来没有铺满容器，想让整组轨道居中或散开分布
stage: grid
tier: core
---

## 描述

三个 64px 的轨道放进一个 340px 的容器，多出来的空间全堆在右边；加上 `justify-content: space-between` 之后，它们才散开到两端与中间。

机制是 ==justify-content 与 align-content 分配的是「轨道排完之后剩下的空间」，作用在轨道组这一层==。它跟 `justify-items` / `align-items` 不是一回事：后者管的是**每个格子内部**内容怎么摆，前者管的是**轨道与轨道之间、轨道与容器边缘之间**的余量。写错层不会报错，只是看起来"没生效"，这是这条机制最常见的误诊。

另一个没生效的原因更隐蔽：**余量为零**。轨道里只要有 `1fr`，或者容器尺寸由内容决定，可用空间在轨道排完时就被吸干净了，`center`、`space-between`、`start` 的结果完全一样——"属性没反应"其实是"没有东西可分"。

所以要让分布看得出效果，两件事得同时成立：轨道有确定的尺寸上限（固定值，或被 `minmax` 封顶），容器有明确的宽度。

## 代码

```html
<!-- @mechanism 两个容器的轨道尺寸完全相同，只换 content 层的对齐方式 -->
<div class="row row-between">
  <span>一</span>
  <span>二</span>
  <span>三</span>
</div>

<div class="row row-center">
  <span>一</span>
  <span>二</span>
  <span>三</span>
</div>
```

```css
.row {
  display: grid;
  /* @mechanism 轨道写死尺寸，容器才有剩余空间；换成 1fr 就一点不剩 */
  grid-template-columns: repeat(3, 64px);
  /* @mechanism justify-content 分的是轨道之间的余量，不是格子内部的对齐 */
  justify-content: space-between;
  width: min(340px, 84vw);
  height: 56px;
  margin: 0 0 12px;
  padding: 6px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.5);
  font: 400 12px/1.3 system-ui, sans-serif;
  color: #1c1a17;
}

.row > span {
  /* @mechanism 格子内部的对齐是另一层：items 管这里，content 管不到 */
  display: grid;
  place-items: center;
  background: rgb(60 48 30 / 0.08);
}

.row-center {
  /* @mechanism 同一组轨道换成居中：整组轨道一起挪，轨道间距不变 */
  justify-content: center;
}
```

## 边界

- `justify-content` / `align-content` 只管**轨道之间**，格子内部由 `justify-items` / `align-items` 管。写错层不报错，现象就是「写了没反应」。记法：content 管轨道，items 管内容。
- 余量为零时几种取值结果一致：轨道含 `1fr`、或容器宽度由内容撑出（`width: max-content`）时，没有余量可分配，`start` 与 `center` 长得一模一样。
- 弹性轨道会先吃掉剩余空间。想保留分配权就得给轨道封顶——固定值，或者 `minmax(80px, 120px)` 这样带上限，超出上限的部分才会交给 content-distribution。
- `align-content` 要效果，容器必须有确定的块向尺寸。容器高度由内容决定时行轨道已经把高度用完了，`align-content` 无从分配。
- `place-content` 是这两个属性的简写（`place-content: center` 同时设两个方向），注意它是 **content 层**，不要和 `place-items` 混——后者是 items 层，作用在格子内部。
- 余量分配与 `margin: auto` 不冲突，但各管一层：`margin: auto` 吃的是**格子内部**的余量，`justify-content` 吃的是**格子之外**的余量，两者同时写时各自生效。

## 备注

- 三种"散开"的区别：`space-between` 两端贴边，`space-around` 两端留白是中间间距的一半，`space-evenly` 所有间距（含两端）完全相等。视觉上 `space-evenly` 最"居中感"。
- 同一族属性在 flex 换行容器上也有 `align-content` 管行与行之间的余量；单行 flex 容器没有行间余量可分，写了也看不出效果。
