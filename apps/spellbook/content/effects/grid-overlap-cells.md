---
title: 刻意让元素重叠
slug: grid-overlap-cells
category: 布局
tags: [grid, 图片, 卡片, 徽章]
since: 2026-10
source: 机制来自 CSS Grid 允许同一单元被多个元素占据，自行实现
when: 文字要压在图上、徽标要骑在卡片角上，但不想用绝对定位去算坐标
stage: grid
tier: core
---

## 描述

一段文字压在色块上，两者占据同一个格位，文字在上面。而这块区域仍然参与整页的布局流——上下还有别的元素，重叠的那对不会脱出文档流。

机制是 ==同一个网格单元可以被多个元素同时占据，重叠时按绘制顺序层叠==。绝对定位是把元素从流里拿出来、再用坐标摆回去；网格重叠相反：两个元素都在流里，只是被指到同一个格位，于是它们自动同宽同高，父容器的高度也照常由它们撑开。

因为同格，尺寸天然一致——盖在上面的那层永远与底下那层一样大，不需要写 `inset: 0`，也不会因为父容器变了而错位。

## 代码

```html
<div class="go">
  <div class="go-media">图</div>
  <p class="go-caption">压在图上的一行说明</p>
  <div class="go-badge">NEW</div>
</div>
```

```css
.go {
  display: grid;
  /* @mechanism 只定义一套轨道；两个子项都放进同一个单元 */
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 180px);
  width: min(420px, 86vw);
}

.go-media {
  /* @mechanism 第 1 行第 1 列，是这块区域的底 */
  grid-area: 1 / 1;
  background: #d9cfba;
  display: grid;
  place-items: center;
  font: 500 15px/1 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.5);
}

.go-caption {
  /* @mechanism 与底图同占 1/1，于是自动同宽同高，落点自己贴底 */
  grid-area: 1 / 1;
  align-self: end;
  margin: 0;
  padding: 12px 14px;
  background: linear-gradient(transparent, rgb(20 18 15 / 0.72));
  color: #f6f2e9;
  font: 500 14px/1.5 system-ui, sans-serif;
}

.go-badge {
  /* @mechanism 徽标骑在右上角，仍在流内，父容器高度不受影响 */
  grid-area: 1 / 1;
  align-self: start;
  justify-self: end;
  margin: 10px;
  padding: 3px 9px;
  border-radius: 999px;
  background: #b4462f;
  color: #fff;
  font: 600 11px/1.6 system-ui, sans-serif;
}
```

## 边界

- **绘制顺序就是源码顺序。**后来者盖在上面，`z-index` 对同层元素一般不必要；但如果父级建立了自己的层叠上下文（`transform`、`opacity` 小于 1 等），`z-index` 会失效，得在更外层调。
- 重叠的元素**仍然参与点击命中**。上面那层如果是不透明的全尺寸块，底下那层的按钮永远点不到——交互元素重叠时必须显式让步（`pointer-events: none` 或分层）。
- 同格元素尺寸一致是自动的，但**位置**不一致：默认都居中拉伸。想让说明贴底必须写 `align-self`，忘了写就会看到文字浮在正中间。
- 父容器的高度由这一格决定，而格高被 `minmax(0, 180px)` 钉死了——上面那层文案超出 180px 时会溢出格位，不是把格撑高。长文案要改成 `auto` 行高或加 `overflow`。
- 重叠区域的无障碍顺序仍是 DOM 顺序，与视觉的上下关系可能相反。读屏读到的「说明」可能出现得比它压着的图更早。

## 备注

- 同一招可以叠三层以上（底图 / 渐变蒙版 / 文字），比嵌套绝对定位少一层 DOM。
- 重叠不需要父级 `position: relative`——那是绝对定位思路的残留。网格重叠靠的是「同一个格位」，与包含块无关。
