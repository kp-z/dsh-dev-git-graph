---
title: 按住拖动来横向滚动
slug: drag-to-scroll
category: 交互
tags: [拖拽, 滚动, 指针捕获]
since: 2026-09
source: 自行实现
when: 一排卡片要能按住拖，而不是只能滚轮或滚动条
stage: grid
tier: candidate
---

## 描述

按住卡片条往左右拖，内容跟着手指走——像触屏那样，但用的是鼠标。

机制是 ==把指针的横向位移映射到 scrollLeft，并用 setPointerCapture 把指针锁住==。`setPointerCapture` 是这套能不能成立的关键：没有它，指针一旦移出元素，`pointermove` 就收不到，拖动会中途断掉。

滚动本身仍是原生滚动，脚本只是换了一个输入方式。

## 代码

```html
<div class="ds" id="sb-ds">
  <div class="ds-card">一</div>
  <div class="ds-card">二</div>
  <div class="ds-card">三</div>
  <div class="ds-card">四</div>
  <div class="ds-card">五</div>
  <div class="ds-card">六</div>
</div>
```

```css
.ds {
  display: flex;
  gap: 10px;
  width: min(380px, 84vw);
  overflow-x: auto;
  padding-bottom: 10px;
  cursor: grab;
  /* @mechanism 拖动时会选中文字，必须关掉 */
  user-select: none;
}

.ds.is-dragging {
  cursor: grabbing;
  /* @mechanism 拖动期间关掉平滑滚动，否则会和手动改 scrollLeft 打架 */
  scroll-behavior: auto;
}

.ds-card {
  flex: 0 0 110px;
  display: grid;
  place-items: center;
  height: 130px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.5);
  font: 600 20px/1 system-ui, sans-serif;
  color: #1c1a17;
  /* @mechanism 阻止浏览器自己的图片/文本拖拽 */
  -webkit-user-drag: none;
}
```

```js
const rail = document.getElementById('sb-ds')
if (rail) {
  let dragging = false
  let startX = 0
  let startScroll = 0

  rail.addEventListener('pointerdown', (event) => {
    // 只处理鼠标：触屏已有更好的原生惯性滚动
    if (event.pointerType !== 'mouse') return
    dragging = true
    startX = event.clientX
    startScroll = rail.scrollLeft
    rail.classList.add('is-dragging')
    // 关键：锁住指针，移出元素后仍然收得到 pointermove
    rail.setPointerCapture(event.pointerId)
  })

  rail.addEventListener('pointermove', (event) => {
    if (!dragging) return
    event.preventDefault()
    rail.scrollLeft = startScroll - (event.clientX - startX)
  })

  const stop = (event) => {
    if (!dragging) return
    dragging = false
    rail.classList.remove('is-dragging')
    if (rail.hasPointerCapture(event.pointerId)) {
      rail.releasePointerCapture(event.pointerId)
    }
  }

  rail.addEventListener('pointerup', stop)
  rail.addEventListener('pointercancel', stop)
}
```

## 边界

- **必须 `setPointerCapture`。**没有它，指针一移出元素就收不到 `pointermove`，拖动会突然断掉——这是这套实现最容易漏的一步。
- 要关掉文本选择与原生拖拽（`user-select: none`、`-webkit-user-drag: none`），否则拖两下就选中一片文字或把卡片拖成幽灵图。
- 容器若有 `scroll-behavior: smooth`，会和手动改 `scrollLeft` 打架。拖动期间要临时关掉。
- 只给鼠标用（`pointerType === 'mouse'`）。触屏已有原生惯性滚动，自己实现只会更差——没有惯性、没有回弹。
- 它是**滚动增强**，不是替代。滚动条、滚轮、键盘方向键都必须继续可用——只把 `pointerdown` 挂上，不要 `preventDefault` 掉别的输入。
- 拖动中若内容动态变化（懒加载插入卡片），`scrollLeft` 的基准会跳，需要在插入前后补偿。

## 备注

- 加一个「拖动时给容器加类」的做法，既改了光标也顺手关掉了平滑滚动，一处改动两个作用。
- 放开后想有惯性，需要自己算速度并逐帧衰减——那是十几行的额外逻辑，多数场景不值得。
