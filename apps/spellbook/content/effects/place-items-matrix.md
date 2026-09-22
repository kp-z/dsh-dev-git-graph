---
title: 对齐矩阵
slug: place-items-matrix
category: 布局
tags: [对齐, place-items, 网格]
since: 2026-10
source: 机制来自 CSS Box Alignment 规范的 place-* 简写族，自行实现
when: 网格里每个格子都要居中，但有个别格子要贴到别的角
stage: grid
tier: core
---

## 描述

网格里所有内容都居中，只有一个角标贴着右上角、一个备注贴着左下角。不必给每个元素单独写一对 `align`/`justify`。

机制是 ==place-items 是 align-items 与 justify-items 的简写，而 place-self 在单个元素上覆盖它==。`place-items` 在容器上定下默认对齐；元素上的 `place-self` 优先级更高，只改自己。这两级的关系就是「全局默认 + 局部例外」——矩阵的一格偏离，不需要动其余每一格。

简写里的顺序是有讲究的：第一个值是 `align`（块向），第二个是 `justify`（行向）。只写一个值时，两边都用它。

## 代码

```html
<div class="pm">
  <div class="pm-cell">居中</div>
  <div class="pm-cell">也是居中</div>
  <div class="pm-cell pm-corner">右上</div>
  <div class="pm-cell">居中</div>
  <div class="pm-cell pm-note">左下</div>
  <div class="pm-cell">居中</div>
</div>
```

```css
.pm {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, 76px);
  /* @mechanism 容器上的 place-items 同时设了 align-items 与 justify-items */
  place-items: center;
  gap: 8px;
  width: min(440px, 88vw);
}

.pm-cell {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 0.44);
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 500 13px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

.pm-corner {
  /* @mechanism place-self 在单个元素上覆盖容器默认值，两级生效 */
  place-self: start end;
  background: #efe9dd;
  font-size: 11px;
}

.pm-note {
  /* @mechanism 只写一个值时块向与行向都用它 */
  place-self: end start;
  font-size: 11px;
  opacity: 0.7;
}
```

## 边界

- 容器上的 `place-items` 只在元素**没有**写 `place-self` 时生效。两个都写时不冲突也不报错，元素自己的赢——排查「为什么这个格子没居中」要先去看元素上有没有 `place-self`。
- 这里元素是 `width: 100%; height: 100%`，所以居中看不出来。对齐只在元素**小于**格位时才有视觉意义——想让对齐可见，元素的尺寸得是内容尺寸（去掉 `100%`）。这是它最常见的「设了没反应」。
- `place-items: center` 与 `place-content: center` 是两件事：前者对齐**元素在格位内**，后者对齐**整组轨道在容器内**。放在只有一块格位的容器上，只有后者会让内容居中——写混了很难看出差别。
- 简写会重置两个分量。先写 `justify-items: end` 再写 `place-items: center`，前一句就被覆盖了——简写不是「补充」，是整体赋值。
- 对齐的值 `start` / `end` 受 `direction` 与书写模式影响。`end` 在 RTL 里是左边——想要绝对方向得用 `left` / `right`，但那不支持 `place-*` 简写。

## 备注

- 单个元素需要对齐时不必给容器加 `place-items`；直接在那一个元素上写 `place-self` 更省，也更好读。
- `place-items: center` 是「内容在格子里居中」最省的写法，比 `display: flex; align-items: center; justify-content: center` 短一半，且不引入匿名 flex 项。
