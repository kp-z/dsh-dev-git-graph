---
title: 不确定进度条
slug: indeterminate-bar
category: 动效
tags: [进度条, 循环, 合成器]
since: 2026-10
source: 机制来自 Material Design 线性不确定进度的几何做法，自行实现
when: 任务在跑但不知道还要多久，要让进度条一直有动静，又不报一个假百分比
stage: plain
tier: core
params:
  - { name: dur, label: 跑一趟用时, type: range, min: 0.6, max: 4, step: 0.1, default: 1.6, unit: s }
---

## 描述

一条色带在轨道里跑过去，看着像在用力，但从头到尾没有任何一刻填满轨道。

机制是 ==色带比轨道窄，位移的量远大于两者之差==。如果色带宽度就是轨道宽度，不管怎么移动，总有一瞬间它铺满整条轨道——那一帧看起来就是「100%」，紧接着又归零，用户会读成「完成了又重来」。把色带缩到轨道的一小段（比如 38%），再让它从自身左侧完全退出去、从右侧完全退出再回来，中间就永远不存在「铺满」的那一帧。**「不知道还剩多少」这件事，是被几何本身表达出来的**，不需要额外写文案。

位移用 `transform` 而不是 `left` 或 `width`。轨道上的色带每帧都在动，改 `left`/`width` 会让浏览器每帧重算布局；`transform` 由合成器接管，代价几乎为零。缓动也不是随手选的：`cubic-bezier` 让两端慢、中间快，色带才像在「用力找」，`linear` 会变成一根匀速传送带。

## 代码

```html
<!-- 不确定态不给 aria-valuenow：百分比本来就不知道，给了就是编的 -->
<div class="ib" id="sb-ib" role="progressbar" aria-label="正在加载">
  <i class="ib-band"></i>
</div>
```

```css
.ib {
  position: relative;
  width: min(320px, 78vw);
  height: 6px;
  /* @mechanism 超出轨道的部分必须裁掉，色带才有"进得来、出得去" */
  overflow: hidden;
  border-radius: 999px;
  background: rgb(60 48 30 / 0.16);
}

.ib-band {
  position: absolute;
  inset: 0 auto 0 0;
  /* @mechanism 色带比轨道窄——这是"永远不铺满"的几何前提 */
  width: 38%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, #b4462f 45%, #d9a441);
  animation: ib-run var(--dur, 1.6s) cubic-bezier(0.65, 0, 0.35, 1) infinite;
}

@keyframes ib-run {
  from {
    transform: translateX(-100%);
  }
  /* @mechanism 位移按色带自身宽度算：300% 才够它整条退到轨道右边外面 */
  to {
    transform: translateX(300%);
  }
}
```

## 边界

- 忘记 `overflow: hidden`：色带在轨道外面照样看得见，现象是「一道色条在条子外面飘」。
- 色带宽度调到接近 100%：某一帧会铺满轨道，于是又变回「假进度」——用户会看到它「完成」好多次。这就是宽度不能写成 100% 的原因。
- 位移量小于 `(100% - 色带宽度) / 色带宽度` 时，色带还没退出去就回头了，看起来像在轨道中间来回蹭。38% 宽对应至少要 163% 的位移。
- 用 `left`/`width` 代替 `transform` 不会破版，但每帧触发布局，长列表页面里会明显掉帧。
- 不确定态却写了 `aria-valuenow`：读屏会念出一个你自己都不知道的数字。不确定就该把这个属性省掉。
- 没有 `prefers-reduced-motion` 分支。位移动效是最该关的一类，正式项目里应退化成低频的透明度呼吸。

## 备注

- 同一套几何（窄块 + 超量位移）就是「扫描 / 探测中」，可以搬到搜索高亮、雷达扫掠上。
- 把轨道做成满宽、色带做成极窄的一线，它就从一个「进度条」变成了「扫描头」，用途完全不同。
