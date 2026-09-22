---
title: 自建的右键菜单
slug: context-menu-custom
category: 交互
tags: [右键菜单, 指针, 定位]
since: 2026-10
source: 机制来自 contextmenu 事件与视口翻转定位，自行实现
when: 想给一个列表或画布加右键操作项，替掉浏览器的默认菜单
stage: plain
tier: core
---

## 描述

在目标区域上右键，弹出的不是浏览器菜单，而是一张自己的操作列表，出现在指针处。

机制是 ==拦掉 contextmenu，改用指针坐标定位==。`contextmenu` 事件的 `clientX` / `clientY` 就是指针位置（键盘触发时是元素左上角），`preventDefault()` 把系统菜单挡掉，再把手写的菜单放到这个坐标上。定位用 `position: fixed` 而不是 `absolute`：`clientX` 是视口坐标，配上 `fixed` 才能直接用，用 `absolute` 就得再加一次滚动偏移。

菜单**靠近视口右/下边缘时要翻转**。这一步不是修饰：不翻转的话，在屏幕右下角右键，菜单会有一部分跑到视口外，用户看不到也点不到。判据是「左边缘 + 菜单宽度 > 视口宽」，成立就改成从指针往左展开。

## 代码

```html
<div class="stage" data-stage>在这里右键</div>
<ul class="menu" data-menu hidden>
  <li>复制</li><li>重命名</li><li>删除</li>
</ul>
```

```css
body { font: 400 14px/1.6 system-ui, sans-serif; }

.stage {
  display: grid;
  place-items: center;
  height: 120px;
  border: 1px dashed #555;
  border-radius: 6px;
  color: #8a7f70;
}

.menu {
  position: fixed;
  margin: 0;
  padding: 4px;
  list-style: none;
  border-radius: 6px;
  background: #1b1622;
  color: #f0ead9;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
}

.menu[hidden] { display: none; }
.menu li { padding: 6px 18px; border-radius: 4px; cursor: default; }
.menu li:hover { background: #2c2636; }
```

```js
const stage = document.querySelector('[data-stage]')
const menu = document.querySelector('[data-menu]')

stage.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  menu.hidden = false

  // @mechanism 先放在指针处量出尺寸，再按视口边缘翻转
  const box = menu.getBoundingClientRect()
  const x = event.clientX + box.width > innerWidth ? event.clientX - box.width : event.clientX
  const y = event.clientY + box.height > innerHeight ? event.clientY - box.height : event.clientY

  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
})

// @mechanism 用 pointerdown 而不是 click：点在菜单外的任意处都该关，包括另一个右键
document.addEventListener('pointerdown', (event) => {
  if (!menu.hidden && !menu.contains(event.target)) menu.hidden = true
})
```

## 边界

- `clientX/clientY` 与 `position: fixed` 必须配对。把 `fixed` 写成 `absolute` 时，坐标会再叠加一次页面滚动量，症状是「页面往下一滚，菜单就跑到指针下方几百像素处」——不滚动时完全正常，所以容易漏。
- 翻转前必须先让菜单可见并量出 `getBoundingClientRect()`。若在 `hidden` 状态下量，尺寸是 0，翻转永远不触发，菜单照样溢出视口。
- 键盘用户压根没有 `contextmenu` 指针事件。`Shift+F10` 或菜单键也能触发 `contextmenu`，此时 `clientX/clientY` 是 0，菜单会出现在视口左上角——要用 `event.target` 的 `getBoundingClientRect()` 兜底。
- 触屏上长按通常不派发 `contextmenu`（iOS 更倾向于自己的选择菜单）。这条在手机上基本不可用，需要另配长按手势，并且要处理长按与滚动的冲突。
- 点菜单外的关闭逻辑挂在 `document` 上，顺序上先于菜单自己的 `click`，所以点菜单项时 `pointerdown` 会先跑一次判断——用 `contains` 排除掉菜单本身，否则菜单会在点击生效前就关掉。
- 右键菜单**替代**了浏览器菜单，也就同时拿走了「在新标签页打开」「查看网页源代码」这些用户可能真的想用的项。只在你确实有自己一套操作时才拦。
