---
title: 换个支点继续转
slug: origin-hop-in
category: 动效
tags: [变换原点, 滚入, 关键帧]
since: 2026-09
source: miniMAC/magic（MIT） — foolishIn，改写为独立最小示例
when: 元素要「翻滚着」跳进来，而不是平滑地滑进来
stage: dark
tier: core
---

## 描述

一块方牌翻滚着跳进来，像骰子落地——每一下都在换支点。

机制是 ==在关键帧中途改变 transform-origin，元素会「换一个支点继续转」==。原实现是：从中心旋转 → 原点换到左下 → 再换到右下，同时缩放从 0 长到 1。支点一换，旋转的弧线也跟着换，于是有了「滚」的感觉。

**支点突变会让运动折一下**——平时这是「卡顿」，用对了就是「翻滚」。

## 代码

```html
<div class="hop-stage">
  <div class="hop-tile">骰</div>
</div>
```

```css
.hop-stage {
  display: grid;
  place-items: center;
  width: min(300px, 78vw);
  height: 210px;
  background: #0a0810;
  overflow: hidden;
}

.hop-tile {
  display: grid;
  place-items: center;
  width: 110px;
  height: 110px;
  background: linear-gradient(150deg, #7c5cff, #4a2fa8);
  font: 700 30px/1 Georgia, serif;
  color: #f6f2ff;
  animation: origin-hop 2.6s ease-in-out infinite alternate;
}

@keyframes origin-hop {
  0% {
    opacity: 0;
    /* @mechanism 从中心的支点开始转 */
    transform-origin: 50% 50%;
    transform: scale(0) rotate(360deg);
  }
  35% {
    opacity: 1;
    /* @mechanism 支点换到左下角，旋转的弧线随之改变 */
    transform-origin: 0% 100%;
    transform: scale(0.6) rotate(0deg);
  }
  70% {
    opacity: 1;
    /* @mechanism 再换到右下角，于是看起来在「滚」 */
    transform-origin: 100% 100%;
    transform: scale(0.85) rotate(0deg);
  }
  100% {
    opacity: 1;
    transform-origin: 100% 100%;
    transform: scale(1) rotate(0deg);
  }
}
```

## 边界

- `transform-origin` 在关键帧之间**是突变而非插值**的（它不是一个可平滑过渡的连续量）。这正是「折一下」的来源——想要翻滚就靠它，不想要就会显得抖。
- 支点只能在**关键帧**里改，且每个关键帧都要写全。漏写的那一帧会退回元素基础规则上的原点值，运动轨迹会突然跳掉。
- 它是把「本会显得卡顿的东西」变成效果，所以对参数很敏感。支点换得太频繁会变成纯粹的抖动。
- 同时缩放与旋转会让元素短暂**超出容器**。母版要 `overflow: hidden`，否则会盖到别处。
- 这一条不太适合正文类内容。翻滚的文字完全无法阅读，它属于装饰性的入场。
- 细节多、参数敏感，通常不如一个干净的 `cubic-bezier` 好维护。收它的价值在于**看清「支点」也是一个可动画的维度**。

## 备注

- 原实现是 miniMAC/magic（MIT） 的 `foolishIn`（这一条保留了它的三段式支点变化）。
- 把三段的原点保持不动，同一个关键帧结构就变成普通的「缩放淡入」——差别全在原点。
