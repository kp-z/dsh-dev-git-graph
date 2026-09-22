---
title: 按高度换版式的卡片
slug: cqh-block-size
category: 布局
tags: [container-query, grid, 卡片]
since: 2026-10
source: 机制来自 CSS Containment 的 container-type: size 与尺寸收容，自行实现
when: 组件要按「自己有多高」换版式，而不只是按宽度
stage: grid
tier: core
---

## 描述

同一张卡片，放进高槽位就变成图标在左、文字在右的横排；放进扁槽位就变成上下排。它问的不是窗口有多高，也不是自己有多宽，而是「我这一格有多高」。

机制是 ==container-type: size 才让块轴可查，代价是尺寸收容——元素高度不再由内容决定==。只写 `inline-size` 时块轴仍由内容撑开，容器的高度就是内容高度，拿它去查高度永远自洽、永远落在同一档。写 `size` 就同时对两个轴做尺寸收容：尺寸不再受后代影响，所以必须由外部给出确定高度——父级的固定高度、网格轨道、或者配 `aspect-ratio` 的宽度，否则它会塌下去。这是这个机制真正的门槛：**查询高度的前提是先交出高度**。

`cqh` 是同一前提下的单位（容器高度的 1%），和 `cqw` 一样只在对应轴、且对应轴真的被收容时才有意义。用它排字号时要记住内容变多不会把容器撑高，而是溢出。可变的是容器从哪拿到那个确定高度：显式 `block-size`、网格轨道、`aspect-ratio` 配宽度，后者最常用，因为「宽高比固定、内容自适应」正好和尺寸收容相容。

## 代码

```html
<!-- @mechanism 两个槽位高度不同，卡片的版式由它自己的高度决定 -->
<div class="slots">
  <div class="slot tall">
    <div class="card">
      <div class="face"><b>咒</b><p>高槽位：左右排</p></div>
    </div>
  </div>
  <div class="slot flat">
    <div class="card">
      <div class="face"><b>语</b><p>扁槽位：上下排</p></div>
    </div>
  </div>
</div>
```

```css
.slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: min(420px, 88vw);
}

.slot { display: grid; }              /* 槽位负责给出确定高度，卡片才有高度可查 */
.slot.tall { grid-template-rows: 190px; }
.slot.flat { grid-template-rows: 84px; }

.card {
  /* @mechanism size 收容：卡片高度不再由内容决定，块轴才可查 */
  container-type: size;
  container-name: card;
  display: grid;
  padding: 14px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #f3efe7;
  color: #1c1a17;
}

.face {
  display: grid;
  gap: 8px;
  align-content: center;
  font: 400 13px/1.5 system-ui, sans-serif;
}

.face b { font: 600 18px/1.2 system-ui, sans-serif; }
.face p { margin: 0; }

@container card (min-height: 140px) {
  /* @mechanism 判断依据是这张卡片自己的高度，不是视口、也不是宽度 */
  .face { grid-template-columns: 44px 1fr; align-items: center; }
}
```

## 边界

- 忘了给容器确定高度，尺寸收容会让卡片塌得只剩 padding：内容不再能撑高它，高度查询也永远落在同一档。这就是「加了 size 之后卡片消失了」的原因。
- 容器查不到自己。`@container` 里的规则只作用于容器的**后代**，直接给容器自身写版式无效——所以要留一层内部元素负责切换。
- `container-type: size` 隐含 layout containment，于是它同时成为后代里 `position: fixed` 的包含块：写在卡片里的浮层会被钉在卡片上，而不是视口。
- 内容比槽位高时不会被撑开，而是溢出或被裁。假设「内容多少都塞得下」去用高度查询，会在内容变多时静默出现裁切。
- 尺寸收容也让容器尺寸失去「内容驱动」的能力，如果外部没有任何一处给出高度（父级是 `auto` 的块、又没写 `aspect-ratio`），高度会变成 0 而不是一个合理值。

## 备注

- 只按宽度换版式就用 `inline-size`，它不要求确定高度、代价小得多；只有真的要按高度换版式才付 `size` 的账。
- 两个声明可以写成简写 `container: card / size`，`container-name` 让同页多个容器各自被查询。
