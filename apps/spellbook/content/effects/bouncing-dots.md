---
title: 会压扁的加载点
slug: bouncing-dots
category: 动效
tags: [spinner, 挤压拉伸, 关键帧]
since: 2026-10
source: 机制来自动画的挤压-拉伸原理，自行实现
when: 三个点在跳的加载指示器，要跳出"重量"，而不是像三个气球在飘
stage: plain
tier: core
params:
  - { name: dur, label: 一个起落, type: range, min: 0.4, max: 2, step: 0.1, default: 0.9, unit: s }
---

## 描述

三个圆点依次弹起又落下，落地那一下会微微压扁。

机制是 ==在落地的关键帧里同时改两个方向的缩放（纵向压扁、横向拉宽），让位移带上重量==。只做 `translateY` 的上下运动看上去像漂浮的气球，因为它缺少「接触」这件事的视觉证据：真实物体会在触地的一帧被地面顶住、向两侧铺开。**形变就是重量**——面积看上去不变、只是换了个方向，大脑就把它读成「有质量的东西被压了一下」。这是动画里最老的原理之一，但少了它的加载点一眼就能看出是「代码做的」。

还有一处必须一起做：`transform-origin: bottom`。默认原点是元素中心，压扁会以中心为轴，点看起来是「陷进地面」；原点放到底边，才是「压在地面上」。相位差用 `calc(var(--dur) / 6)` 从速度推出来，而不是写死秒数——这样改速度时三个点的间隔会跟着走，节奏不会散。

## 代码

```html
<!-- 三个点共用一套关键帧，只有相位不同 -->
<div class="bd" role="status" aria-label="加载中">
  <i></i><i></i><i></i>
</div>
```

```css
.bd {
  display: flex;
  gap: 9px;
  /* @mechanism 让点贴着容器底边起跳，"地面"就是这条线 */
  align-items: flex-end;
  height: 42px;
}

.bd i {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #b4462f;
  /* @mechanism 压扁必须以底边为原点，否则点是"陷进去"而不是"压在地上" */
  transform-origin: bottom center;
  animation: bd-hop var(--dur, 0.9s) infinite ease-in-out;
}

/* @mechanism 相位差从时长推出来：改速度时节奏不会散 */
.bd i:nth-child(2) {
  animation-delay: calc(var(--dur, 0.9s) / 6);
}

.bd i:nth-child(3) {
  animation-delay: calc(var(--dur, 0.9s) / 3);
}

@keyframes bd-hop {
  0%,
  100% {
    /* @mechanism 落地帧：纵压横拉，位移归零 */
    transform: translateY(0) scale(1.12, 0.86);
  }
  12% {
    /* @mechanism 起跳瞬间纵向拉长，看起来是被弹出去的 */
    transform: translateY(-8px) scale(0.94, 1.1);
  }
  40% {
    /* @mechanism 最高点恢复正圆：只有这一刻它是"没有形变"的 */
    transform: translateY(-24px) scale(1, 1);
  }
  68% {
    transform: translateY(-8px) scale(0.94, 1.1);
  }
}
```

## 边界

- 不写 `transform-origin: bottom`：压扁以中心为轴，点看起来是往下沉了一段，而不是被地面压扁。
- 只动 `scaleY` 不动 `scaleX`：面积会明显变小，看起来像缩水。两个方向反向变化一点，才有「体积守恒」的错觉。
- 延迟写死成 `0.15s` 之类的秒数：把 `--dur` 调快后三个点的相位差还那么大，它们会挤在一起同时起落，看起来像在抖。用 `calc(var(--dur) / 6)` 才跟着速度走。
- 正延迟会让第一轮开始前三个点一起静止等待（第一拍是同相的）。要连第一拍都错开，得用负延迟。
- 跳跃幅度和点的高度要拉开比例。幅度只有直径的两倍以内时，压扁的效果会被位移完全盖住，看起来只是左右晃。
- 无限循环的「忙」暗示：任务失败或已完成时还留着它，用户会一直等。同样需要在 `prefers-reduced-motion` 下退化成静态。

## 备注

- 挤压-拉伸可以搬到任何「有重量」的动效上：按钮按下、卡片落位、图标弹跳，规律都是位移配形变，而不是位移配缓动。
- 三个点的节奏差异也可以反过来用：全部同相会读成「在敲」，错开才读成「在等」。
