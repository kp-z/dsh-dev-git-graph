---
title: 打开浮层时锁住背景滚动
slug: scroll-lock-compensate
category: 交互
tags: [滚动锁, 浮层, 滚动条]
since: 2026-10
source: 机制来自 overflow: hidden 与滚动条宽度的补偿，自行实现
when: 打开一个长内容的浮层，不希望背后的页面跟着滚
stage: plain
tier: core
---

## 描述

浮层打开时背后的页面停住不动，关掉之后从原来的位置接着滚。

机制是 ==把滚动容器藏起来，再把它失去的滚动条宽度补回去==。`overflow: hidden` 会让内容区变宽——宽出来的正好是滚动条那一份（桌面端只有经典滚动条才占位）——页面于是**横向跳一下**。补偿办法是在锁住的那一刻量出这个差值，把它加回 `padding-right`。

差值不能假设成「15px」：它随系统、随浏览器、随用户是否用了「始终显示滚动条」而变。可靠量法是 `window.innerWidth - document.documentElement.clientWidth`，量不到就说明滚动条是覆盖式的（macOS 默认如此），补 0 即可。

位置也要留住。用 `position: fixed` 锁是另一条路，但它会把滚动位置清零，得再记下 `scrollY` 用 `top: -Ypx` 补回来——比 `overflow: hidden` 多了两处状态，只有在浮层本身也要滚时才值得。

## 代码

```html
<button data-open>打开浮层</button>
<p style="height: 160vh">（长内容，滚起来才看得出锁没锁住）</p>

<div class="sheet" data-sheet hidden>浮层</div>
```

```css
body { font: 400 14px/1.6 system-ui, sans-serif; }

.sheet {
  position: fixed;
  inset: 30% auto auto 50%;
  translate: -50% 0;
  display: grid;
  place-items: center;
  width: 220px;
  height: 120px;
  border-radius: 8px;
  background: #1b1622;
  color: #f0ead9;
}

.sheet[hidden] { display: none; }
```

```js
const sheet = document.querySelector('[data-sheet]')

function lockScroll(lock) {
  const root = document.documentElement
  if (lock) {
    // @mechanism 量出来的才是真的：滚动条宽度随系统与浏览器设置而变，不能写死 15px
    const gap = window.innerWidth - root.clientWidth
    root.style.setProperty('--lock-gap', `${gap}px`)
    root.style.overflow = 'hidden'
    root.style.paddingRight = 'var(--lock-gap)'
  } else {
    root.style.overflow = ''
    root.style.paddingRight = ''
  }
}

document.querySelector('[data-open]').addEventListener('click', () => {
  sheet.hidden = false
  lockScroll(true)
})
sheet.addEventListener('click', () => {
  sheet.hidden = true
  lockScroll(false)
})
```

## 边界

- 差值写死成 `15px` 是最常见的做法，也是错的：Windows 上传统滚动条约 17px，浏览器开着「始终显示滚动条」时又不同；macOS 覆盖式滚动条宽度是 0，写死 15 会平白多出一条白边。**量出来的那个数**才对，而且它可能是 0。
- 把 `overflow: hidden` 加在 `body` 上而不是 `html` 上时，某些浏览器会把滚动位置重置。要保留位置就用 `html`，或者改走 `position: fixed` + `top: -scrollY` 那条路。
- 这条只锁**窗口**的滚动。浮层内部若有自己的滚动容器，它照常滚——通常这正是想要的，但若浮层内容比浮层还高且没有 `overflow: auto`，用户会看到一个滚动条都没有、内容却截断了的浮层。
- 锁住滚动不会阻止键盘翻页。焦点若还停在背后的页面上，PageDown 仍会把内容滚走（部分浏览器会在 `overflow: hidden` 时忽略，行为不一致）。真正的处置是把焦点移进浮层——那是另一件事，这条管不着。
- 反复开关时每次都 `setProperty` 覆盖同一个变量是安全的；但若在锁住状态下打开了第二个浮层、第一个先关闭并解锁，背景会提前恢复滚动。多层浮层需要计数，不是布尔。
