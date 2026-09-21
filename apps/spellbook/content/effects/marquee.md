---
title: 无限跑马灯
slug: marquee
category: 动效
tags: [循环, 横向滚动, 无缝]
since: 2025-09
source: 自行实现
when: 要横向滚动一排标签，并且接得上看不出接缝
stage: plain
tier: core
params:
  - { name: speed, label: 一圈用时, type: range, min: 4, max: 60, step: 1, default: 24, unit: s }
  - { name: direction, label: 方向, type: select, options: [normal, reverse], default: normal }
---

## 描述

一排标签匀速往左走，走到头无缝接上，永远不停。

机制是 ==内容复制一份，然后位移百分之五十==。两份内容首尾相接，位移到一半时第二份正好补上第一份的位置，于是循环点看不见。这里没有 JS，也不需要监听动画结束——`infinite` 自己闭环。

## 代码

```html
<div class="marquee">
  <div class="marquee-track">
    <span>咒语书</span>
    <span>前端效果库</span>
    <span>一条咒语一个效果</span>
    <span aria-hidden="true">咒语书</span>
    <span aria-hidden="true">前端效果库</span>
    <span aria-hidden="true">一条咒语一个效果</span>
  </div>
</div>
```

```css
.marquee {
  width: min(600px, 84vw);
  overflow: hidden;
  padding: 20px 0;
  border-top: 1px solid rgb(0 0 0 / 0.14);
  border-bottom: 1px solid rgb(0 0 0 / 0.14);
}

.marquee-track {
  display: flex;
  width: max-content;
  animation: marquee-slide var(--speed, 24s) linear infinite; /* @mechanism */
  animation-direction: var(--direction, normal);
}

.marquee-track span {
  /* 间距用 margin 而不是 flex 的 gap：这样「一份内容」的宽度是规整的，位移一半才严丝合缝 */
  margin-right: 52px;
  font: 500 22px/1 system-ui, sans-serif;
  white-space: nowrap;
  color: #1c1a17;
}

@keyframes marquee-slide {
  to {
    transform: translateX(-50%);
  }
}
```

## 边界

- 两份内容必须**完全等宽**。第二份只要换了文案，循环点立刻露出来——内容得是固定的一排，不能是渲染出来的不定长列表。
- 内容比容器还短时不该用它：没有可滚的余量，只会看到一段空洞的平移。
- 没有处理 `prefers-reduced-motion`，对动效敏感的用户会一直看到它在滚。

## 备注

- 复制的那份要加 `aria-hidden="true"`，否则屏幕阅读器会把同一句话读两遍。
- 必须用 `margin` 而不是 flex 的 `gap`。`gap` 只在元素之间生成间距，两份内容之间会少一个，位移一半就对不齐，接缝处会抖一下。
- 动画走的是 `transform`，在合成器上跑；别改成 `left` 或 `margin-left`，那样每一帧都要重排。
