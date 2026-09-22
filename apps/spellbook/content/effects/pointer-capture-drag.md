---
title: 拖拽时把指针抓住
slug: pointer-capture-drag
category: 交互
tags: [setPointerCapture, 滑杆, 拖拽, 指针]
since: 2026-10
source: 机制来自 Pointer Events 的 setPointerCapture，自行实现
when: 做一个滑块或拖拽把手，希望指针移出元素后拖动仍然跟着走
stage: grid
tier: core
---

## 描述

按住一个把手往两边拖，指针即使滑出了把手、甚至滑出整个面板，拖动依然跟着走，松手才结束。

机制是 ==按下时把指针捕获给这个元素==：`el.setPointerCapture(event.pointerId)`。捕获之后，该指针的所有后续 `pointermove` / `pointerup` 都会**直接派发给这个元素**，不管指针此刻在谁的头上。于是不必再往 `window` 上挂 `mousemove`、也不必在 `pointerup` 时小心地摘掉监听——事件流被约束在一条线上。

位置要算成相对量：记下按下时的起始坐标与起始值，之后每次移动都算 `起始值 + (当前坐标 - 起始坐标)`，而不是把指针的绝对坐标直接当值用。相对量让「在把手中间按下」与「在把手边缘按下」手感一致；用绝对坐标时，一按下去值就跳到指针所在处。

## 代码

```html
<div class="track" data-track>
  <div class="knob" data-knob style="--x: 40%"></div>
</div>
```

```css
.track {
  position: relative;
  width: min(280px, 88%);
  height: 8px;
  border-radius: 4px;
  background: #2c2636;
}

.knob {
  position: absolute;
  top: 50%;
  left: var(--x);
  width: 26px;
  height: 26px;
  translate: -50% -50%;
  border-radius: 50%;
  background: #d9a441;
  touch-action: none;
}
```

```js
const track = document.querySelector('[data-track]')
const knob = document.querySelector('[data-knob]')

knob.addEventListener('pointerdown', (event) => {
  // @mechanism 捕获之后指针移出元素也照样收到事件，不必往 window 上挂监听
  knob.setPointerCapture(event.pointerId)
  const box = track.getBoundingClientRect()
  const startX = event.clientX
  const startRatio = parseFloat(getComputedStyle(knob).left) / box.width

  const move = (e) => {
    // @mechanism 用位移量而不是指针的绝对坐标，按在把手哪一处手感都一样
    const ratio = startRatio + (e.clientX - startX) / box.width
    knob.style.setProperty('--x', `${Math.min(1, Math.max(0, ratio)) * 100}%`)
  }

  const up = () => {
    knob.removeEventListener('pointermove', move)
    knob.removeEventListener('pointerup', up)
  }

  knob.addEventListener('pointermove', move)
  knob.addEventListener('pointerup', up)
})
```

## 边界

- 少了 `touch-action: none`，触屏上拖动会先被浏览器当成滚动手势，`pointermove` 走到一半就被 `pointercancel` 打断。现象是「手机上拖一下就断」——而桌面端完全正常，很难查。
- 必须在 `pointerup` 里摘掉 `pointermove` 监听。捕获会在指针抬起时自动释放，但你自己加的监听不会——留在元素上的监听会累积，第二次拖动时旧闭包里的 `startRatio` 还在生效，表现是拖动幅度翻倍。
- `parseFloat(getComputedStyle(knob).left)` 拿到的是**像素值**（`left` 已被解析），所以除以 `box.width` 才得到比例。若 `left` 写的是 `auto` 或在未布局时读取，拿到的是 `NaN`，后面全变成 `NaN%`，元素会静默跳回默认位置。
- 拖动过程中读取 `getBoundingClientRect()` 会强制一次布局。上面只在按下时读一次，是对的；放进 `move` 里则每帧布局一次。
- 捕获到元素上之后，`pointerup` 也会派发给它——但前提是元素还在文档里。若在拖动中把元素移出 DOM（比如列表重排把它换掉），捕获随元素一起消失，指针抬起的事件就没人接了。
