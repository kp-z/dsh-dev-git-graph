---
title: 粘贴只要纯文本
slug: paste-plain-text
category: 交互
tags: [focus, 正文, 输入, 键盘]
since: 2026-10
source: 机制来自 Clipboard API 的 clipboardData 与 execCommand('insertText')，自行实现
when: 富文本输入框里粘进来的内容带着别处的字号、颜色和行内样式，把版面弄乱
stage: plain
tier: core
---

## 描述

从一个排过版的网页里复制一段字，粘进编辑区，落下来的是干净的文字：没有原网页的字体、颜色、链接和背景。

机制是 ==剪贴板里同时放着 text/html 与 text/plain 两份内容，直接取后者就完成了一次天然的去格式==。不需要正则清洗 HTML，也不必枚举白名单标签——浏览器已经替你把同一段内容准备成两种形态了，选纯文本那份即可。「去格式」这件事的正确解法从来不是事后清洗，而是从一开始就不去解析那份 HTML。

真正需要自己动手的是「怎么插进去」。`preventDefault()` 之后如果直接改 `innerHTML` 或往 `value` 里拼字符串，会毁掉两样东西：浏览器的撤销栈（用户按 Ctrl+Z 撤不回来），以及光标位置（插入点跑到末尾）。机制是 ==用 execCommand('insertText') 让浏览器按「用户输入了一段文字」来处理==，撤销、光标、输入法状态都由它自己维护。

这个 API 名字很难看，也已经标记为过时，但在「保留撤销栈地插入文本」这件事上，至今没有等价的替代品。取舍清楚地写在边界里。

## 代码

```html
<!-- @mechanism contenteditable 是个没有 value 的输入控件，粘贴行为必须自己接管 -->
<div class="pt" contenteditable="true" role="textbox" aria-multiline="true" aria-label="正文"></div>
<p class="pt-note">从别处复制一段带格式的文字粘进来，格式会被丢掉。</p>
<button class="pt-demo" type="button">模拟一次带格式的粘贴</button>
```

```css
.pt {
  width: min(360px, 84vw);
  min-height: 92px;
  padding: 12px 14px;
  border: 1px solid rgb(60 48 30 / 0.35);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.55);
  font: 400 15px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

/* @mechanism contenteditable 没有 placeholder 属性，空状态提示只能靠 :empty */
.pt:empty::before {
  content: "在这里粘贴试试";
  color: rgb(28 26 23 / 0.4);
}

.pt:focus-visible {
  outline: 2px solid #b4462f;
  outline-offset: 2px;
}

.pt-note,
.pt-demo {
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.65);
}

.pt-demo {
  margin-top: 6px;
  padding: 6px 12px;
  border: 1px solid rgb(60 48 30 / 0.3);
  border-radius: 6px;
  background: rgb(255 255 255 / 0.6);
  cursor: pointer;
}
```

```js
const box = document.querySelector('.pt')

box.addEventListener('paste', (e) => {
  // @mechanism 剪贴板里有 html 也有 plain，取后者就不必清洗任何标签
  const text = e.clipboardData.getData('text/plain')
  if (!text) return
  e.preventDefault()
  // @mechanism 用 insertText 插入才能进撤销栈；直接改 innerHTML 会毁掉 Ctrl+Z 与光标
  document.execCommand('insertText', false, text)
})

// 只为能在预览里看见效果：手动造一次带格式的粘贴事件
document.querySelector('.pt-demo').addEventListener('click', () => {
  const data = new DataTransfer()
  data.setData('text/html', '<b style="color:#c00">加粗的红字</b><span style="font-size:26px">大字号</span>')
  data.setData('text/plain', '加粗的红字 大字号')
  box.focus()
  box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
})
```

## 边界

- `execCommand` 已被标记为废弃。它仍然可用，但规范上随时可能被移除；如果哪天它消失了，退路是用 `InputEvent` + `beforeinput` 自己接管插入，代价是要自己实现撤销栈——远比现在这套复杂。
- `:empty` 的判定非常严格：元素里连一个空白字符都不能有。HTML 写成多行缩进（标签之间有换行和空格）就不匹配，提示文字直接不出现。
- 只取 `text/plain` 会让用户从同一页面里复制自己的富文本也失去格式。要做「保留部分格式」就得改读 `text/html` 并做白名单清洗，那是另一件事，别指望顺手兼顾。
- 粘贴图片或文件时 `text/plain` 可能是空的，这里直接 `return` 而**没有** `preventDefault`，让浏览器按默认行为处理；顺序反了的话，图片粘贴会被静默吞掉。
- 合成 `ClipboardEvent` 只是为了让预览可见。真实粘贴事件里的 `clipboardData` 是浏览器给予的只读对象，不能回写。

## 备注

- 「两份表示里选一份，而不是解析后再清洗」是个反复出现的好模式：`paste` 有 html/plain 两份，`drop` 有 files/items 两份，选对那一份就省掉一整轮解析。
- 想把粘贴内容压成单行（比如只允许标题），取 `text/plain` 之后再 `.replace(/\s+/g, ' ')` 即可，插入方式不变。
