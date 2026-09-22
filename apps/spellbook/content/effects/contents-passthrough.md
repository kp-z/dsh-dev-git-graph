---
title: 拆掉多余的包裹层
slug: contents-passthrough
category: 布局
tags: [grid, 卡片, 容器]
since: 2026-10
source: 机制来自 CSS Display 规范的 display: contents，自行实现
when: 组件外那层 div 只是为了挂类名，却把子元素挡在了父级网格之外
stage: grid
tier: core
---

## 描述

三张卡片要各自落进父级网格的三列，但中间隔着一层组件包裹 div——按默认行为，那层 div 会变成**一个**网格项，三张卡片全挤在它的第一格里。

机制是 ==display: contents 让元素自身的盒子消失，子元素直接参与父级的布局==。网格项的身份按盒子算，不按 DOM 层级算：包裹层不产生盒子，它的子元素自然就成了父级网格的直接参与者。不改 DOM、也不用把类名一个个搬到子元素上——这正是它比「把包裹层删掉」更好的地方，类名与事件绑定都留在原处。

## 代码

```html
<div class="cp">
  <div class="cp-item"><span>一</span></div>
  <div class="cp-item"><span>二</span></div>
  <div class="cp-item"><span>三</span></div>
</div>
```

```css
.cp {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  width: min(460px, 88vw);
}

.cp-item {
  /* @mechanism 包裹层的盒子消失，它的子元素被提升为父级网格的项 */
  display: contents;
}

.cp-item > span {
  /* @mechanism 盒子没了，所以间距与样式只能挂在真正上场的那一层上 */
  display: grid;
  place-items: center;
  min-height: 76px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.46);
  font: 500 14px/1 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
}

.cp-item > span.is-picked {
  background: #efe9dd;
  border-color: #b4462f;
}
```

```js
// @mechanism 包裹层仍在 DOM 里，事件与选择器都按原层级写
for (const cell of document.querySelectorAll('.cp-item > span')) {
  cell.addEventListener('click', () => cell.classList.toggle('is-picked'))
}
```

## 边界

- 盒子消失是**彻底**的：包裹层上的 `background`、`border`、`padding`、`margin`、`gap`、`width` 全部失效。最常见的事故是「我给包裹层设的内边距不见了」——想留白得让子元素自己承担。
- 只对**非替换元素**有效。放在 `img`、`input`、`video` 这类替换元素上，盒子不会消失，元素照常渲染，这条声明等于白写。
- 无障碍上历史包袱很重：旧 Chrome 与旧 Safari 会把这个元素连同它的语义一起从可访问性树里删掉，`button`、`ul`、`nav` 的语义直接丢失，读屏读不到。多数引擎已修，但它至今是最典型的翻车点——只把它用在**没有语义**的纯 div 包裹层上。
- 它不产生轨道。想让子元素对齐到父级的**列**（共享列宽），那是 `subgrid` 干的事；`display: contents` 只是把子元素交还给父级已有的轨道。
- `::before` / `::after` 也会被当成子元素一起提升。包裹层上的装饰性伪元素会突然变成网格里的一格，位置很可能出乎意料。
- 包裹层如果带 `id` 并被 `aria-labelledby` 之类引用，语义链会断——引用还在，被指向的元素已经不在树里。

## 备注

- 判断该不该用，问一句「这层 div 除了挂类名还做别的事吗」。只要它还承担背景、间距、圆角中的任何一项，就不能用。
- 与 `subgrid` 的分工很清楚：包裹层只是挡路时用 `contents`，需要包裹层与父级**共享轨道尺寸**时用 `subgrid`。
