---
title: 用 inert 关掉抽屉外面
slug: drawer-inert-lock
category: 交互
tags: [抽屉, inert, 焦点]
since: 2026-10
source: 机制来自 HTML 的 inert 属性与 CSS scrollbar-gutter，自行实现
when: 侧边抽屉打开后，键盘和读屏都不该再走到抽屉后面的页面上
stage: dark
tier: candidate
---

## 描述

抽屉滑出来，后面的页面压暗；此时按 Tab，焦点在抽屉里绕，走不到后面那张列表上。

机制是 ==打开时给页面主体加 inert，让整棵子树从焦点顺序、点击命中和无障碍树里一起消失==。手写焦点陷阱要在 keydown 里拦 Tab、枚举所有可聚焦元素、还要处理动态插入的新节点；`inert` 一个属性就把这三件事做完了，而且是浏览器自己在维护。它还顺带堵住两条手写陷阱最常漏的路：鼠标点击穿透，和读屏虚拟光标穿透。

要清掉的副作用有两处，都跟滚动有关。inert 不阻止滚轮，页面照样会在抽屉背后滚下去，所以溢出还得自己锁；锁溢出又会让滚动条消失、整页右移一格，所以根元素要留 `scrollbar-gutter: stable` 把位置先占住。打开时把焦点送进抽屉、关闭时还给触发按钮，这两步 inert 也不管——它只负责「到不了」，不负责「去哪」。

## 代码

```html
<!-- @mechanism inert 的目标是「抽屉之外的那一层」，开与关都只动这一个属性 -->
<div class="dw">
  <main class="dw-page" id="sb-page">
    <button class="dw-open" type="button">打开抽屉</button>
    <p>抽屉开着时这一层是 inert 的：点不中，Tab 也进不来。</p>
  </main>
  <div class="dw-scrim"></div>
  <aside class="dw-panel" id="sb-panel" inert>
    <a href="#">概览</a>
    <a href="#">机制</a>
    <a href="#">边界</a>
    <button class="dw-close" type="button">收起</button>
  </aside>
</div>
```

```css
/* @mechanism 先把滚动条的位置占住，锁溢出时才不会整页右移一格 */
html {
  scrollbar-gutter: stable;
}
.dw {
  position: relative;
  width: min(420px, 88vw);
  height: 220px;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 12px;
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #efe9dd;
}
.dw-page {
  position: relative;
  z-index: 1;
  padding: 18px;
}
.dw-page p {
  max-width: 26ch;
  margin: 10px 0 0;
  opacity: 0.7;
}
.dw-open,
.dw-close {
  padding: 7px 14px;
  border: 1px solid rgb(180 70 47 / 0.7);
  border-radius: 8px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
/* @mechanism 抽屉只移出视口，不 display:none —— 过渡期间它仍在无障碍树里，所以退出交互得靠 inert */
.dw-panel {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 3;
  display: grid;
  align-content: start;
  gap: 12px;
  width: 64%;
  padding: 22px;
  background: #1b1626;
  box-shadow: 0 18px 44px rgb(0 0 0 / 0.55);
  transform: translateX(-102%);
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
.dw-panel a {
  color: #efe9dd;
  text-decoration: none;
}
.dw-scrim {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: rgb(8 6 12 / 0.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.28s;
}
.dw.is-open .dw-panel {
  transform: none;
}
.dw.is-open .dw-scrim {
  opacity: 1;
  pointer-events: auto;
}
```

```js
const root = document.querySelector('.dw')
const page = document.getElementById('sb-page')
const panel = document.getElementById('sb-panel')
const trigger = document.querySelector('.dw-open')

function setOpen(open) {
  root.classList.toggle('is-open', open)
  // @mechanism 一行取代手写焦点陷阱：抽屉外面整层 inert，Tab、点击、读屏都到不了
  page.inert = open
  panel.inert = !open
  // inert 拦不住滚轮，溢出还得自己锁
  document.documentElement.style.overflow = open ? 'hidden' : ''
  // 焦点去向 inert 不管：开的时候送进去，关的时候还回来
  if (open) panel.querySelector('a').focus()
  else trigger.focus()
}

trigger.addEventListener('click', () => setOpen(true))
document.querySelector('.dw-close').addEventListener('click', () => setOpen(false))
document.querySelector('.dw-scrim').addEventListener('click', () => setOpen(false))
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && root.classList.contains('is-open')) setOpen(false)
})
```

## 边界

- `inert` 忘在关闭时撤掉，整页就永久失效：点不中、Tab 进不来、读屏读不到，而且**不报任何错**。这是这套最典型的 bug，因为症状只出现在交互上，截图看不出来。
- inert 作用的是**整棵子树**：给抽屉与页面共同的祖先设 inert，抽屉自己也一起废掉。目标必须精确到「另一侧」。
- inert 不阻止滚动，也不影响浏览器自身的 UI（页内查找、地址栏）。滚动锁要另外写，而 `overflow: hidden` 在 iOS Safari 上锁不住橡皮筋——业界的替代做法是把 body 改成 `position: fixed` 并记住 scrollTop，代价是关闭时要手动还原位置，滚动锚点也会丢。
- `inert` 与 `aria-hidden` 不等价：后者只是对读屏隐藏，元素照样能点、能 Tab 进去；要「关掉」就用 inert。
- 焦点归还这一步很容易静默失败：关闭时如果触发按钮已经不在 DOM 里、或者本身位于被 inert 的区域，`focus()` 什么都不做，焦点掉回 body，用户下一次 Tab 从页首开始。
- 用 `transform` 移出视口而不是 `display: none`，是为了保住进出动画；代价是**动画那几百毫秒里抽屉仍可被 Tab 命中**，所以这套比「直接 display 切换」更依赖 inert。
- Esc 关闭要自己监听：`inert` 不管键盘，`<dialog>` / `popover` 那种免费行为这里没有。
