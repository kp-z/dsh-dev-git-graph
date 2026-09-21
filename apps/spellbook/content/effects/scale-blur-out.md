---
title: 化开一样消失
slug: scale-blur-out
category: 动效
tags: [退场, 模糊, 缩放]
since: 2026-09
source: miniMAC/magic（MIT） — puffOut，改写为独立最小示例
when: 元素消失时要有「化掉」的质感，而不是单纯淡出
stage: dark
tier: core
params:
  - { name: to, label: 放大到, type: range, min: 1.2, max: 3, step: 0.1, default: 2, unit: × }
---

## 描述

一块色块在原位放大、同时糊掉、同时淡掉，像化开的水汽。

机制是 ==三个「消失信号」一起给：缩放、模糊、透明度==。单纯改透明度在视觉上很单薄——观众看到的是「颜色变浅了」。加上放大，元素显得在**靠近**；加上模糊，显得在**散开**。三个一起，才有「化掉」的材质感。

退场动画的弱点通常是只动透明度；补上另外两个是成本最低的改善。

## 代码

```html
<div class="puff-stage">
  <div class="puff"></div>
</div>
```

```css
.puff-stage {
  display: grid;
  place-items: center;
  width: min(300px, 78vw);
  height: 200px;
  background: #0a0810;
  overflow: hidden;
}

.puff {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  background: radial-gradient(circle at 36% 32%, #ff9a5a, #b4462f 72%);
  animation: puff-out 2.6s cubic-bezier(0.4, 0, 0.6, 1) infinite alternate;
}

@keyframes puff-out {
  from {
    opacity: 1;
    transform: scale(1);
    filter: blur(0);
  }
  to {
    /* @mechanism 缩放 + 模糊 + 透明度三件事一起给，才有「化开」感 */
    opacity: 0;
    transform: scale(var(--to, 2));
    filter: blur(9px);
  }
}
```

## 边界

- 三个属性一起动画是**最贵的一种**：`filter: blur()` 每帧都要重算整个元素的像素，`opacity` 与 `transform` 反而便宜。掉帧通常就是模糊带来的。
- 缩放与模糊要**协调**。放大到 3 倍还只糊 2px，看着像「变透明」；放大 1.2 倍就糊 10px，看着像「失焦的照片」。两者要同步加剧。
- 放大时会**超出容器**。母版通常要 `overflow: hidden`，否则它会盖住旁边的元素。
- 用 `transform: scale()` 而不是 `width`/`height`：后者每帧触发布局重算，而且会把内容也重排一遍。
- 它适合小元素或装饰块。有大段文字的元素上不要用它——文字在放大与模糊中完全不可读。
- 这是纯装饰动画，必须能被 `prefers-reduced-motion` 关掉；关掉之后元素应当直接以终态出现。

## 备注

- 原实现是 miniMAC/magic（MIT） 的 `puffOut`（反着播就是 `puffIn` 的入场）。
- 把模糊去掉只留缩放与透明度，就从「化开」变成「冲过来」——三者中最影响气质的是模糊。
