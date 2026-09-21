---
title: 滑动关闭
slug: swipe-dismiss
category: 交互
tags: [滑动, 阈值, 归位]
since: 2026-09
source: 自行实现
when: 一条消息要能滑动划掉，松手时没划够就弹回去
stage: dark
tier: candidate
---

## 描述

一条通知跟着手指往右移，松手时划得够远就滑出去，不够就弹回来。

机制是 ==把指针的位移写进 translate，松手时看位移是否超过阈值决定两种归宿==。关键是这两种归宿要用**不同的过渡**：拖动过程中不能有过渡（否则跟手会滞涩），松手后要有过渡（才能弹回去或滑出去）。

拖动与归位是两种状态，一套 `transition` 不能同时满足。

## 代码

```html
<div class="sw-wrap">
  <div class="sw" id="sb-sw">
    <b>滑动这条</b>
    <span>划得够远就关掉</span>
  </div>
</div>
```

```css
.sw-wrap {
  position: relative;
  width: min(320px, 80vw);
  overflow: hidden;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #1b1626;
}

.sw {
  display: grid;
  gap: 3px;
  padding: 16px 18px;
  background: #241d33;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
  /* @mechanism 归位时要有过渡（弹回 / 滑出） */
  transition: translate 0.28s cubic-bezier(0.3, 0.8, 0.3, 1), opacity 0.28s;
  touch-action: pan-y;
  cursor: grab;
}

.sw b {
  font-size: 15px;
}

/* @mechanism 拖动过程中关掉过渡，否则跟手会滞涩 */
.sw.is-dragging {
  transition: none;
  cursor: grabbing;
}

.sw.is-gone {
  translate: 100% 0;
  opacity: 0;
}
```

```js
const card = document.getElementById('sb-sw')
if (card) {
  let startX = 0
  let startY = 0
  let dx = 0
  let dragging = false

  card.addEventListener('pointerdown', (event) => {
    startX = event.clientX
    startY = event.clientY
    dx = 0
    dragging = true
  })

  card.addEventListener('pointermove', (event) => {
    if (!dragging) return
    const mx = event.clientX - startX
    const my = event.clientY - startY
    // @mechanism 先判断主方向：纵向的滑动该让给列表滚动
    if (Math.abs(my) > Math.abs(mx) && dx === 0) {
      dragging = false
      return
    }
    dx = Math.max(0, mx)
    card.classList.add('is-dragging')
    card.style.translate = dx + 'px 0'
  })

  const release = () => {
    if (!dragging) return
    dragging = false
    card.classList.remove('is-dragging')
    card.style.translate = ''
    // @mechanism 超过阈值就滑出去，否则弹回原位
    if (dx > card.offsetWidth * 0.4) {
      card.classList.add('is-gone')
    }
  }

  card.addEventListener('pointerup', release)
  // @mechanism 系统打断（来电等）也要归位，否则卡片会卡在中间
  card.addEventListener('pointercancel', release)
}
```

## 边界

- 要先判断**主方向**（比较水平与垂直位移）。纵向滑动应当让给列表滚动，否则横向划一下就把卡片带走了。
- 拖动过程中要关掉 `transition`，松手后再打开。全程带着过渡会让跟手「拖不动」——这是最影响手感的一处。
- 必须处理 `pointercancel`（系统打断、来电、手势被接管）。漏掉时卡片会永久停在中间位置。
- 阈值一般取元素宽度的 30%–40%，或者一个固定的滑动速度。纯位移阈值对「轻轻快甩」不敏感，真实的滑动面板还要看速度。
- 划出去之后元素**还在 DOM 里**（只是移出了可视区）。要从列表移除或标记状态，否则它仍占位、仍可被 Tab 聚焦。
- 触屏上系统自带的边缘返回手势会与它冲突。靠近屏幕左右边缘的滑动可能被系统截获，容器两侧要留出安全距离。
- `touch-action: pan-y` 告诉浏览器这一块只允许纵向平移，横向留给脚本——少了它，拖动常与页面滚动打架。

## 备注

- 把阈值比较换成速度（位移 / 时间）能做出「快甩即关」，那是更接近原生手感的一层。
- 同一套结构双向可用：`Math.max` 换成取绝对值就能左右都能划。
