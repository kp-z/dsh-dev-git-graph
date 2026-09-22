---
title: 把悬停效果关在指针设备里
slug: hover-only-device
category: 交互
tags: [transition, transform, 悬停, 指针, 卡片]
since: 2026-09
source: 机制来自 Media Queries Level 4 的 hover / pointer 特性，自行实现
when: 卡片悬浮要浮起来，但手机上点一下不能一直粘在浮起状态
stage: grid
tier: core
params:
  - { name: lift, label: 浮起高度, type: range, min: 0, max: 24, step: 2, default: 10, unit: px }
---

## 描述

指针移上去卡片轻轻抬起，移开落回；触屏上点它则完全不会浮起来。

机制是 ==用 @media (hover: hover) and (pointer: fine) 把整段悬停样式包起来==。触屏没有「悬停」这个状态，`:hover` 在触摸后会**粘住**——点一下卡片就浮着不起来，直到你点别处。包上这道闸门，触屏设备压根不会读到这段规则。

## 代码

```html
<div class="hv">
  <article class="hv-card"><b>一</b><span>指针移上去</span></article>
  <article class="hv-card"><b>二</b><span>它会抬起来</span></article>
  <article class="hv-card"><b>三</b><span>移开落回</span></article>
</div>
```

```css
.hv {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  width: min(520px, 84vw);
}

.hv-card {
  display: grid;
  place-items: center;
  gap: 4px;
  height: 150px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #efe9dd;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
  /* 过渡写在基础状态上，不是写在 :hover 里，否则移开时没有回程动画 */
  transition: transform 0.28s ease, box-shadow 0.28s ease;
}

.hv-card b {
  font: 600 24px/1 system-ui, sans-serif;
}

/* @mechanism 整段悬停样式关在「真有指针」的设备里 */
@media (hover: hover) and (pointer: fine) {
  .hv-card:hover {
    transform: translateY(calc(var(--lift, 10px) * -1));
    box-shadow: 0 16px 30px rgb(40 30 14 / 0.22);
  }
}
```

## 边界

- 触屏上的 `:hover` 不会自己消失，它会**粘住**。不加这道闸门，手机上点一下按钮就一直保持悬停态，看起来像卡死了。
- `(hover: hover)` 问的是**主**输入设备。带触屏的笔记本主设备仍是鼠标，所以仍然匹配——这道闸门不是万能的，真正的触屏检测很麻烦。
- `hover` 与 `pointer` 要一起判断：只判一个会漏掉「能悬停但精度低」或「不能悬停但精度高」的组合。
- 反过来也要注意：不要把关键信息藏在悬停里。触屏永远看不到它，等于这些内容在手机上不存在。
- 过渡必须写在基础状态上。写在 `:hover` 里面的话，移开时用的是基础状态的过渡（没写就是没有），回程会瞬间跳回去。

## 备注

- 浮起用 `transform` 而不是改 `margin-top`：前者在合成器上跑，后者每帧都要重排，一屏卡片同时动时差别很大。
- 阴影也要跟着动。只动位置不动阴影，看起来像贴纸被平移；两者同步变化才有「离开桌面」的感觉。
