---
title: auto 与 fr 混用的轨道
slug: grid-track-sizing-mix
category: 布局
tags: [grid, 按钮, 容器]
since: 2026-10
source: 机制来自 CSS Grid 规范的轨道尺寸算法（flex 轨道与 auto 轨道协同），自行实现
when: 工具栏按内容宽自适应，剩下的空间全归主区，且主区要能缩到不溢出
stage: grid
tier: core
---

## 描述

左侧工具栏的宽度由里面的按钮决定，右侧主区把剩下的宽度全吃掉；窗口收窄时主区先缩，工具栏不动。而主区里的长内容不会把整行顶出横向滚动。

机制是 ==auto 轨道先按内容算，fr 轨道分剩下的空间，而 fr 的隐含最小值会挡住缩小==。`auto` 表示「先给内容它要的，有剩余再说」；`fr` 分配的是扣掉 `auto` 轨道之后的剩余。两者是先后关系，不是并列关系——所以 `auto` 轨道的宽度会随着内容变化而**挤动** `fr` 轨道。

这里的坑在 `fr` 的隐含最小值：`1fr` 其实等于 `minmax(auto, 1fr)`，那个 `auto` 会让它不小于自己的 `min-content`。长英文单词或长 URL 撑住不肯缩，整行就溢出了。写成 `minmax(0, 1fr)` 才真的能缩到零。

## 代码

```html
<div class="tm">
  <div class="tm-bar">
    <button>新建</button>
    <button>较长按钮</button>
  </div>
  <div class="tm-main">
    <p>主区吃掉剩余宽度。收窄窗口时先缩的是它，左侧工具栏保持内容宽度不变。</p>
  </div>
</div>
```

```css
.tm {
  display: grid;
  /* @mechanism auto 先按内容定宽，fr 分的是减去它之后的剩余 */
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  width: min(520px, 60vw);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.tm-bar {
  display: grid;
  gap: 6px;
  align-content: start;
}

.tm-bar button {
  padding: 6px 12px;
  border: 1px solid rgb(60 48 30 / 0.35);
  background: rgb(255 255 255 / 0.5);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.tm-main {
  /* @mechanism 主区自己也要能缩：min-width 会把 fr 的下限顶回去 */
  min-width: 0;
  padding: 12px 14px;
  background: #efe9dd;
  overflow-wrap: anywhere;
}

.tm-main p {
  margin: 0;
}
```

## 边界

- `1fr` 不等于「可以缩到 0」。它的隐含最小值是 `min-content`，长单词会把轨道顶宽、撑出横向滚动。这是「网格为什么突然溢出」最常见的原因，改 `minmax(0, 1fr)` 或给子项加 `min-width: 0`。
- 只加 `min-width: 0` 在**子项**上、不写 `minmax(0, 1fr)` 也能治，但两者治的位置不同：前者放开子项自身的最小宽度，后者放开轨道的最小宽度。子项是嵌套网格时，两层都要放。
- `auto` 轨道会被内容宽度牵着走。工具栏里放一个长按钮，主区就被挤窄——这是设计选择而不是 bug，但要知道「工具栏宽度不受控」意味着主区宽度也不受控。要钉死就写固定长度。
- `auto` 与 `max-content` 在多行内容时不同：`auto` 可以被挤压换行，`max-content` 不会。工具栏希望换行时用 `auto`，希望永远不换行时用 `max-content`（并接受溢出）。
- `fr` 之间的分配是**按比例分剩余**，不是「各占一份总宽」。已经两列时再加一个 `2fr`，它拿走的是剩余的三分之二，而不是总宽的三分之二。

## 备注

- 排查横向溢出的顺序：先看是不是 `1fr` 缺 `minmax(0, …)`，再看子项有没有 `min-width` 或长不可断内容。
- 这条与 `grid-intrinsic-columns` 是同一套算法的两面：那边讲用内容尺寸**定**轨道，这边讲内容尺寸与 `fr` 接力时的**下限**问题。
