---
title: 验证码格子
slug: otp-auto-advance
category: 交互
tags: [表单, 验证码, 粘贴]
since: 2026-10
source: 机制来自 HTML 的 autocomplete="one-time-code" 与剪贴板事件，自行实现
when: 六位验证码要一个格子一位，且用户从短信里整串复制过来时不能被卡在第一个格子
stage: plain
tier: core
---

## 描述

六个小方框，输入一位自动跳到下一个；粘贴一整串验证码时，六位会被自动分配到六个格子里。

它看起来只是「六个 `maxlength="1"` 的输入框加个焦点跳转」，但真正决定可用性的是几条边界路径。

机制是 ==粘贴必须自己接管，因为 maxlength 会先把整串截成一位==。浏览器在把剪贴板内容写进输入框时就会应用 `maxlength`，等事件到达脚本手上时，第一个格子里只剩第一个字符，剩下的五位已经丢了——所以必须在 `paste` 上 `preventDefault()`，从 `clipboardData` 里取原始字符串再自己分配。同理，`Backspace` 在空格子上要回退到前一格并删掉它，否则用户连续删到中途就再也退不回去。

还有一条不是脚本能解决的：机制是 ==autocomplete="one-time-code" 让系统短信填充找到这组格子==。iOS 与 Android 会把刚收到的验证码直接铺到这里，桌面浏览器基本无感。它和 `inputmode="numeric"` 是搭档——后者只负责唤起数字键盘，不负责校验，用户照样能敲进字母。

把输入框的视觉做成方形格子，再用 `:focus` 让它亮一下，用户就知道自己填到第几位了。整个控件的可发现性几乎全靠这个焦点反馈。

## 代码

```html
<!-- @mechanism autocomplete 与 inputmode 是给系统看的声明，视觉格子只是表象 -->
<div class="otp" role="group" aria-label="六位验证码">
  <input class="otp-cell" inputmode="numeric" autocomplete="one-time-code" maxlength="1" aria-label="第 1 位" />
  <input class="otp-cell" inputmode="numeric" maxlength="1" aria-label="第 2 位" />
  <input class="otp-cell" inputmode="numeric" maxlength="1" aria-label="第 3 位" />
  <input class="otp-cell" inputmode="numeric" maxlength="1" aria-label="第 4 位" />
  <input class="otp-cell" inputmode="numeric" maxlength="1" aria-label="第 5 位" />
  <input class="otp-cell" inputmode="numeric" maxlength="1" aria-label="第 6 位" />
</div>
```

```css
.otp {
  display: flex;
  gap: 8px;
}

.otp-cell {
  width: 42px;
  height: 50px;
  padding: 0;
  border: 1px solid rgb(60 48 30 / 0.35);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.55);
  font: 500 21px/1 system-ui, sans-serif;
  color: #1c1a17;
  text-align: center;
}

/* @mechanism 焦点所在的那一格要明显亮起来，用户才知道自己填到第几位 */
.otp-cell:focus {
  border-color: #b4462f;
  background: #fffdf8;
  outline: 2px solid rgb(180 70 47 / 0.35);
  outline-offset: 1px;
}
```

```js
const cells = [...document.querySelectorAll('.otp-cell')]

function focusAt(index) {
  // @mechanism 焦点索引必须夹在范围内，否则会跑到页面里别的控件上去
  cells[Math.max(0, Math.min(cells.length - 1, index))].focus()
}

function fill(start, digits) {
  digits.split('').forEach((digit, offset) => {
    const cell = cells[start + offset]
    if (cell) cell.value = digit
  })
  focusAt(start + digits.length)
}

cells.forEach((cell, index) => {
  cell.addEventListener('input', () => {
    // @mechanism 只留数字，非数字的输入直接丢弃
    const digits = cell.value.replace(/\D/g, '')
    if (digits.length > 1) return fill(index, digits)
    if (digits) focusAt(index + 1)
  })

  cell.addEventListener('keydown', (e) => {
    // @mechanism 空格子上的退格要回退并删掉前一位，否则删到中途就退不回去了
    if (e.key === 'Backspace' && !cell.value && index > 0) {
      e.preventDefault()
      cells[index - 1].value = ''
      focusAt(index - 1)
    }
    if (e.key === 'ArrowLeft') focusAt(index - 1)
    if (e.key === 'ArrowRight') focusAt(index + 1)
  })

  cell.addEventListener('paste', (e) => {
    // @mechanism 不拦下粘贴，maxlength 会先把整串截成一位，剩下的直接丢
    e.preventDefault()
    fill(index, e.clipboardData.getData('text').replace(/\D/g, ''))
  })
})
```

## 边界

- `maxlength="1"` 与「整串粘贴」是直接冲突的：浏览器先截断，脚本后收到事件。所以粘贴处理只能前置拦截，靠读 `value` 是救不回来的。
- 输入法组合期间会连发 `input` 事件，中间态的值可能为空或含非数字。这里的 `\D` 过滤会把正在拼的字删掉，用户会觉得「打不进去」——中文输入法下尤其明显。
- `autocomplete="one-time-code"` 是给移动端系统填充用的，桌面端写了也不会有任何变化，别指望它能在浏览器里弹出验证码。
- 六个独立输入框在无障碍层里是六个零散控件，读屏器会一个个念。这里靠容器上的 `role="group"` 与 `aria-label` 给它们一个共同的名字；只写 `aria-label` 在 `input` 上、不给容器分组的话，用户听不出这是同一个验证码。
- 浏览器记住的自动填充可能把整个号码填进第一格，此时 `input` 事件里拿到的是长串——上面 `digits.length > 1` 那条分支就是为它准备的，删掉它移动端填充就会失效。

## 备注

- 「先接管事件、再从原始数据源分配」和拖放区、纯文本粘贴是同一种思路：一旦让浏览器先按默认行为处理，信息就已经丢了。
- 想省掉整套脚本可以用单个 `input` 配 `letter-spacing` 与等宽字体做出格子的观感，代价是没法逐格高亮，也就失去了「填到第几位」的反馈。
