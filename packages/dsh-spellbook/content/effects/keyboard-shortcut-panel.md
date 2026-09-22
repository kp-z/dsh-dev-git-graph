---
title: 快捷键面板
slug: keyboard-shortcut-panel
category: 交互
tags: [focus, 键盘, 浮层, 输入]
since: 2026-10
source: 机制来自 keydown 与可编辑元素的判定，自行实现
when: 应用有一堆快捷键，按 ? 就能查一遍
stage: plain
tier: core
---

## 描述

按 `?` 弹出一张快捷键表，按 Esc 关掉。但在输入框里打字时，这个键必须老老实实是一个问号。

机制是 ==在判断按键之前，先判断焦点在不在可编辑的地方==。`document` 上的 `keydown` 收得到全局的每一次按键，包括用户正在搜索框里敲字的那一次。所以处理函数的第一件事不是比对按键，而是看 `event.target` 是不是 `<input>`、`<textarea>`、`<select>` 或有 `contenteditable` 的元素——是就立刻返回。

这一层判断是这类全局快捷键的**必要**组成，不是优化。少了它，搜「?」这个字符时会弹面板、打开下拉框时按空格会触发「播放」、在任何输入框里打字都可能命中单字母快捷键。而这些现象只在「有输入框的页面上」出现，很难在只有快捷键的演示里发现。

## 代码

```html
<input placeholder="在这里打字：? 应该只是一个问号">
<div class="panel" data-panel hidden>
  <b>快捷键</b>
  <ul><li><kbd>?</kbd> 打开这张表</li><li><kbd>Esc</kbd> 关闭</li></ul>
</div>
```

```css
body { font: 400 14px/1.6 system-ui, sans-serif; }

.panel {
  margin-top: 12px;
  width: 240px;
  padding: 12px 16px;
  border-radius: 6px;
  background: #1b1622;
  color: #f0ead9;
}

.panel[hidden] { display: none; }
kbd { padding: 1px 5px; border: 1px solid #6b6157; border-radius: 3px; }
```

```js
const panel = document.querySelector('[data-panel]')

// @mechanism 焦点在可编辑元素里就放行 —— 少了这一步，打字会命中全局快捷键
const isTyping = (el) =>
  el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)

document.addEventListener('keydown', (event) => {
  if (isTyping(event.target)) return

  if (event.key === '?') {
    panel.hidden = false
    event.preventDefault()
  }
  if (event.key === 'Escape') panel.hidden = true
})
```

## 边界

- 判定写成 `event.target.tagName === 'INPUT'` 是不够的：`contenteditable` 的 `div` 不是 `INPUT`，富文本编辑器里打字会照样触发快捷键。用 `isContentEditable` 才盖得住。
- 打开面板后没有把焦点移进去，Esc 的判断仍依赖 `document`，这是能用的；但读屏器不会知道多了一块内容。要让浮层可被读出得同时用 `popover` 或 `aria-expanded` 交代状态——快捷键本身不是无障碍方案。
- `?` 在不同键盘布局上是不同的物理键。用 `event.key` 比 `event.code` 更贴近「用户想输入什么」，但在中文输入法激活时 `keydown` 可能是 `Process`，此时快捷键不响应——这不是 bug，输入法在接管键盘。
- 这条只处理打开与关闭。真正的快捷键系统需要「按住不放只触发一次」「组合键」「与浏览器自带快捷键冲突时的取舍」，那些不是靠加 `if` 能解决的，得有一套注册与仲裁。
- `preventDefault()` 会在非输入场景下阻止浏览器把 `?` 当成「快速查找」的触发键（Firefox）。反过来，若在输入框里也调了它，用户就打不出问号了——这正是那个提前返回要挡住的事。
