---
title: 长按触发
slug: long-press-action
category: 交互
tags: [setPointerCapture, transition, 按钮, 长按, 定时]
since: 2026-09
source: 自行实现
when: 按住不放才能执行的操作，比如删除或拖动前的确认
stage: dark
tier: core
params:
  - { name: hold, label: 按住时长, type: range, min: 0.3, max: 1.5, step: 0.1, default: 0.6, unit: s }
---

## 描述

按住不放，一条进度慢慢填满；填满的瞬间动作才执行。松手太早就取消。

机制是 ==pointerdown 起一个定时器，pointerup / pointercancel / pointerleave 上清掉它==。这四个事件缺一不可——少任何一个都会出现「手指滑走了它照样触发」。进度条用的是同一个时长，所以用户能看见还要按多久。

**必须有进度反馈**，否则长按就是靠猜。

## 代码

```html
<button class="lp" id="sb-lp">
  <span class="lp-fill"></span>
  <span class="lp-text">按住不放</span>
</button>
<p class="lp-out" id="sb-lp-out">还没触发</p>
```

```css
.lp {
  position: relative;
  overflow: hidden;
  padding: 14px 26px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.12);
  font: 500 14px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
  /* @mechanism 长按会触发系统的选择与呼出菜单，必须关掉 */
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
}

.lp-fill {
  position: absolute;
  inset: 0;
  transform-origin: left;
  transform: scaleX(0);
  background: rgb(180 70 47 / 0.5);
  pointer-events: none;
}

/* @mechanism 进度用同一个时长，用户能看见还要按多久 */
.lp.is-holding .lp-fill {
  transition: transform var(--hold, 0.6s) linear;
  transform: scaleX(1);
}

.lp-text {
  position: relative;
}

.lp-out {
  margin: 12px 0 0;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.6);
}
```

```js
const pad = document.getElementById('sb-lp')
const out = document.getElementById('sb-lp-out')
if (pad && out) {
  const HOLD = 600
  let timer = null
  let fired = false

  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pad.classList.remove('is-holding')
  }

  pad.addEventListener('pointerdown', (event) => {
    fired = false
    pad.classList.add('is-holding')
    timer = setTimeout(() => {
      fired = true
      out.textContent = '已触发'
      pad.classList.remove('is-holding')
      timer = null
    }, HOLD)
    pad.setPointerCapture(event.pointerId)
  })

  // @mechanism 四种情况都要清定时器，少一个就会「滑走了还触发」
  pad.addEventListener('pointerup', () => {
    if (!fired) out.textContent = '松手太早，已取消'
    clear()
  })
  pad.addEventListener('pointercancel', clear)
  pad.addEventListener('pointerleave', clear)
  pad.addEventListener('contextmenu', (event) => event.preventDefault())
}
```

## 边界

- 要清定时器的情况有**四种**：`pointerup`、`pointercancel`、`pointerleave`、以及滚动开始。少任何一个都会出现「手指滑走了照样触发」。
- 触发之后要**抑制随后的 click**，否则动作会执行两次（长按 + 松手时的点击）。用 `fired` 标记或 `preventDefault` 都行。
- 时长通常取 500–600ms。低于 300ms 与普通点击难以区分，高于 800ms 会让人以为没反应。
- 触屏上长按会触发系统的文本选择与上下文菜单，必须 `user-select: none` 与 `-webkit-touch-callout: none`，还要挡 `contextmenu`。
- **键盘用户用不了长按。**必须有等价的键盘路径（按 Enter 直接执行），否则这个功能对一部分人是不可达的。
- `setPointerCapture` 保证指针移出元素后仍收得到事件，这是「滑走了也不误触发」能成立的前提之一。

## 备注

- 进度指示是长按可用性的核心：没有它，用户不知道是「没反应」还是「按得不够久」。
- 同一套结构加一个位移阈值就变成「拖动排序」——长按先激活，再跟手移动。
