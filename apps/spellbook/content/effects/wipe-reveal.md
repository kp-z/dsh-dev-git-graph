---
title: 擦拭揭示
slug: wipe-reveal
category: 图形
tags: [clip-path, keyframes, 图片, 入场]
since: 2026-09
source: 机制来自 CSS clip-path 的 inset()，自行实现
when: 内容要像被一块抹布擦出来，而不是整体淡入
stage: photo
tier: core
params:
  - { name: dur, label: 擦完用时, type: range, min: 0.4, max: 4, step: 0.2, default: 1.6, unit: s }
---

## 描述

画面从左边被一条硬边推着揭示出来。

机制是 ==clip-path: inset() 的四条边各自可以动，把左边的内缩量从 100% 推到 0 就是单向擦拭==。`inset(top right bottom left)` 里的百分比是「从那条边往内缩多少」。它和 `mask` 的差别是**边界是硬的**——没有渐变过渡，就是一刀切过去。

硬边抹过去，比淡入更利落。

## 代码

```html
<div class="wr"></div>
```

```css
.wr {
  width: min(320px, 80vw);
  height: 190px;
  background: linear-gradient(135deg, #7c5cff, #14b8a6 55%, #d9a441);
  /* @mechanism 只动左边那一条内缩量 = 单向擦拭 */
  clip-path: inset(0 100% 0 0);
  animation: wr-wipe var(--dur, 1.6s) cubic-bezier(0.65, 0, 0.35, 1) infinite alternate;
}

@keyframes wr-wipe {
  to {
    clip-path: inset(0 0 0 0);
  }
}
```

## 边界

- `inset()` 的四个值是**上、右、下、左**（顺时针），不是常见的上右下左写法顺序。写错第几位就动错了方向。
- **被裁掉的部分不可点击**——`clip-path` 会影响命中测试。这与 `mask` 正好相反，遮罩隐藏的区域仍然可点。
- 它不改变布局：元素仍然占原来的空间，被裁掉的部分只是不画。
- 祖先的 `overflow: hidden` 会与它**叠加**裁剪，出现「擦到一半就不见了」。
- 每一帧都在重绘裁剪区域，代价低于动画 `filter`、高于 `transform`。大元素上会掉帧，能用 `transform` 平移来伪装的场合就别用它。
- 想要柔和的揭示（边缘渐隐）得用 `mask`，`clip-path` 做不到软边——两者常一起用，硬的负责结构、软的负责质感。

## 备注

- 改成 `inset(0 0 0 100%)` 就是从右边擦过来，换一条边就是一个新方向。
- 配 `steps()` 缓动还能做「百叶窗」式分段揭示——本质是让硬边一格一格跳。
