---
title: 复制之后给个准话
slug: copy-feedback-inline
category: 交互
tags: [transition, 按钮, 提示, 点击]
since: 2026-10
source: 机制来自 Clipboard API 的 Promise 与一次性复位计时器，自行实现
when: 页面上有个「复制」按钮，用户按下去要知道到底成没成
stage: plain
tier: core
---

## 描述

点一下复制按钮，按钮上的字先变成「已复制」，过一秒再变回来。要是复制失败，说的是「复制失败」，而不是假装成功。

机制是 ==等 Promise 的结果，而不是假设它成功==。`navigator.clipboard.writeText()` 返回 Promise：在非安全上下文、在跨源 iframe 没有权限、或用户拒绝时它都会 **reject**。把文案直接改成「已复制」而不接 `.catch`，用户拿到的是一个说谎的界面——他以为复制到了，粘贴时什么都没有，而且没有任何线索。

复位计时器要能被打断。连点两次时，第一次那个 1 秒的定时器还在跑，会在第二次刚显示「已复制」没多久就把它擦掉。所以每次先 `clearTimeout` 上一个，再排新的——这样「最后一次操作后经过 1 秒」才复位，而不是「第一次操作后」。

## 代码

```html
<button class="copy" data-copy>复制</button>
```

```css
.copy {
  min-width: 96px;
  padding: 8px 18px;
  border: 1px solid #4a4239;
  border-radius: 999px;
  background: #1b1622;
  color: #f0ead9;
  font: 500 13px/1 system-ui, sans-serif;
  cursor: pointer;
  /* @mechanism 固定最小宽度，文案变化时按钮不会抽动 */
  transition: border-color 0.2s;
}

.copy[data-state='ok'] { border-color: #7fa88a; }
.copy[data-state='bad'] { border-color: #b5705e; }
```

```js
const button = document.querySelector('[data-copy]')
let timer = 0

button.addEventListener('click', async () => {
  const label = { ok: '已复制', bad: '复制失败' }
  try {
    // @mechanism 必须等它 resolve —— 它会 reject，不是必然会成功
    await navigator.clipboard.writeText('要复制的内容')
    button.dataset.state = 'ok'
    button.textContent = label.ok
  } catch {
    button.dataset.state = 'bad'
    button.textContent = label.bad
  }
  // @mechanism 先清掉上一个计时器：连点时复位时间从「最后一次」起算
  clearTimeout(timer)
  timer = setTimeout(() => {
    button.dataset.state = ''
    button.textContent = '复制'
  }, 1000)
})
```

## 边界

- `navigator.clipboard` 在**非安全上下文**（`http://` 且非 localhost）下是 `undefined`，直接调 `.writeText` 会抛 `TypeError`。要写成 `navigator.clipboard?.writeText(...)` 并用 `await` 包在 `try` 里，否则整段脚本在这里就断了，按钮此后永久失灵。
- 写剪贴板必须在**用户手势**的调用栈里发起。若先 `await` 了一个别的异步操作再写，手势已经过期，浏览器会 reject——报的还是权限错误，看着像权限问题，其实是时序。
- 按钮宽度不固定时，「已复制」比「复制」宽，按钮会横向抽动一下。`min-width` 是修复手法；更好的做法是文字位置不变、只换颜色，因为宽度变化会把旁边的按钮也推走。
- 页面刚加载就自动复制、或复制大段文本时，部分浏览器会额外弹一次权限提示。这不是这条能绕开的，属于浏览器的隐私策略。
- 秒数别调长。1 秒级的反馈刚好能被看见又不挡路；改成 3 秒后用户会盯着一个已经完成的按钮等它复原。
