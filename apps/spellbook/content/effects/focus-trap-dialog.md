---
title: 让焦点困在浮层里
slug: focus-trap-dialog
category: 交互
tags: [focus, 弹窗, 浮层, 键盘, 焦点]
since: 2026-10
source: 机制来自 focusin 事件与文档位置判断，自行实现
when: 打开一个模态浮层之后，按 Tab 不该跑到背后的页面上
stage: plain
tier: core
---

## 描述

模态浮层打开后，Tab 键在层内的可聚焦元素之间循环，永远不跑到背后的页面上。

机制是 ==监听 focusin，把越界的焦点拽回来==。不必自己数「按了几次 Tab」：`focusin` 在任何元素获得焦点时都会冒泡到 document，只要判断 `document.activeElement` 是否还在浮层内，不在就按方向塞回首尾两端。这样连鼠标点击、脚本 `focus()`、读屏器的跳转也一并管住了——这些都不触发 `keydown`。

方向是必要的：焦点落在浮层**之前**的元素上说明在往回走，该送到末尾；落在**之后**则送到开头。只做「首尾循环」而不看方向，Shift+Tab 会把人送到对面，看着像跳了一下。

## 代码

```html
<button class="open" data-open>打开面板</button>

<div class="sheet" data-sheet hidden>
  <p>按 Tab 试试，焦点出不去。</p>
  <button>确定</button>
  <button>取消</button>
</div>
```

```css
body { font: 400 14px/1.6 system-ui, sans-serif; }

.sheet {
  position: fixed;
  inset: 50% auto auto 50%;
  translate: -50% -50%;
  display: grid;
  gap: 10px;
  width: 240px;
  padding: 16px;
  border: 1px solid #555;
  border-radius: 6px;
  background: #1b1622;
  color: #f0ead9;
}

.sheet[hidden] { display: none; }
```

```js
const sheet = document.querySelector('[data-sheet]')
const focusables = () => [
  ...sheet.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  ),
]

document.addEventListener('focusin', (event) => {
  if (sheet.hidden || sheet.contains(event.target)) return
  const items = focusables()
  if (!items.length) return

  // @mechanism 看焦点落在浮层之前还是之后，决定送回哪一端 —— 只看首尾会把方向丢掉
  const before = event.target.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_PRECEDING
  items[before ? items.length - 1 : 0].focus()
})

document.querySelector('[data-open]').addEventListener('click', () => {
  sheet.hidden = false
  focusables()[0].focus()
})
```

## 边界

- `compareDocumentPosition` 的返回值是**位掩码**，必须与 `Node.DOCUMENT_POSITION_PRECEDING` 做按位与，不能写相等判断。写 `===` 会恒为 `false`，于是焦点永远送回开头，Shift+Tab 静默失效。
- 只守 `keydown` 里的 Tab 是漏的：鼠标点背后、脚本调 `focus()`、读屏器「跳到下一个区域」都不经过 `keydown`。`focusin` 才是唯一的关口——它是**冒泡**的，`focus` 不冒泡，所以这个判断必须挂在 `focusin` 上。
- 浮层内一个可聚焦元素都没有时，`items[...]` 是 `undefined`，`.focus()` 会抛错。要么挡掉空列表，要么给浮层本身加 `tabindex="-1"` 当兜底。
- 这条只**困住**焦点，不会让背景变哑：读屏器的虚拟光标仍能读到后面的文字。要让背景真正退出无障碍树得另用 `inert`——两者是不同的机制，不能互相替代。
- 浮层关闭后没把焦点还给触发它的按钮，键盘用户就被丢回了页面开头。原生 `<dialog>` 会替你补这一步，手写的浮层必须自己补。
