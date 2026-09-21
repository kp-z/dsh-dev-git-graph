---
title: 原生模态对话框
slug: dialog-modal
category: 交互
tags: [dialog, 模态, 焦点]
since: 2026-09
source: 机制来自 HTML 的 dialog 元素与 showModal()，自行实现
when: 要一个真正的模态弹窗，但不想自己写焦点陷阱与背景遮罩
stage: dark
tier: core
---

## 描述

点开按钮弹出一个对话框，背景不能再点、Tab 只在框内循环、按 Esc 自动关闭。

机制是 ==showModal() 让 dialog 进入顶层，并把页面其余部分标记为 inert==。焦点陷阱、背景不可交互、Esc 关闭这三件事都是浏览器给的。`open` 属性只是「显示」，`showModal()` 才有模态语义——这个区别是这一条的全部。

自己写模态最容易翻车的三处，浏览器都替你处理了。

## 代码

```html
<button class="dlg-btn" id="sb-dlg-open">打开对话框</button>

<dialog class="dlg" id="sb-dlg">
  <h3>原生模态</h3>
  <p>背景不可点，Tab 只在框内走，Esc 会关掉它。</p>
  <form method="dialog">
    <button class="dlg-close">知道了</button>
  </form>
</dialog>
```

```css
.dlg-btn {
  padding: 12px 22px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.12);
  font: 500 15px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

.dlg {
  /* @mechanism 顶层元素，覆盖 UA 默认的边框与内边距 */
  width: min(320px, 80vw);
  padding: 24px 26px;
  border: 1px solid rgb(180 70 47 / 0.55);
  background: #1b1626;
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.dlg::backdrop {
  background: rgb(6 4 10 / 0.72);
  backdrop-filter: blur(3px);
}

.dlg h3 {
  margin: 0 0 8px;
  font-size: 19px;
}

.dlg p {
  margin: 0 0 18px;
  opacity: 0.76;
}

.dlg-close {
  width: 100%;
  padding: 11px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.16);
  font: 500 14px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}
```

```js
const dialog = document.getElementById('sb-dlg')
const opener = document.getElementById('sb-dlg-open')
if (dialog && opener) {
  opener.addEventListener('click', () => dialog.showModal())
}
```

## 边界

- `open` 属性与 `showModal()` **不是一回事**。加 `open` 只是显示（背景仍可交互、没有焦点陷阱）；必须调 `showModal()` 才拿到模态的全部待遇。
- 背景 inert 会让页面其余部分**完全不可聚焦**，包括你自己做的滚动容器。长页面上要另外处理滚动锁定，否则用户滚不动背景。
- `<dialog>` 自带 UA 的边框、内边距与最大宽度，各浏览器不一致。要一致必须显式覆盖。
- 进出的过渡要配 `@starting-style` 与 `transition-behavior: allow-discrete`——`display` 是离散属性，默认不参与过渡。
- 关闭路径有三条：Esc、`<form method="dialog">`、调用 `close()`。要确认都覆盖到了；Esc 可以用 `cancel` 事件拦截。
- `::backdrop` 只能设颜色、背景与滤镜，做不出内边距之类的盒模型属性。

## 备注

- `<form method="dialog">` 让表单提交直接关闭对话框并带回 `returnValue`，省掉一个关闭按钮的事件处理。
- 这一条与之前的 `popover-native` 分工不同：`popover` 是非模态浮层，`dialog` 是模态。要挡住背景交互就用后者。
