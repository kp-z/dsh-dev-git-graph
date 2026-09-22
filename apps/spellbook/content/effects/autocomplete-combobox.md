---
title: 自动补全下拉
slug: autocomplete-combobox
category: 交互
tags: [focus, 输入, 表单, 键盘]
since: 2026-10
source: 机制来自 WAI-ARIA 的 combobox 模式与 aria-activedescendant，自行实现
when: 输入框要边打边给候选，且上下键选择时不能打断打字
stage: plain
tier: core
---

## 描述

输入框下面弹出一列匹配的候选，按上下键高亮，回车填入，Esc 关掉。

最容易写错的是「高亮」怎么实现。直觉是给每个候选项加 `tabindex`，上下键时把焦点 `focus()` 过去——但焦点一离开输入框，输入法上下文和键盘输入就断了，用户按一下方向键后再打字，光标已经不在原来的位置。焦点在列表里来回跳，还会让读屏器把它当成一组独立的可聚焦控件。

机制是 ==焦点始终留在输入框，用 aria-activedescendant 指向当前高亮的那一项==。这个属性相当于对辅助技术说「活动的还是我，但我要代表第 3 项发声」。视觉高亮照旧用 `aria-selected` 驱动 CSS，键盘焦点从未移动过，输入流也就不会断。

键盘上还有两个必须处理的细节：上下键要 `preventDefault()`，否则光标会跳到文字开头或结尾；`Esc` 应该收起列表而不是清空输入。列表用绝对定位盖在内容之上，不占文档流，否则每打一个字下面的东西都会抖一下。

匹配用不着模糊算法，演示里就是子串包含——真正值得记住的是焦点归属，而不是匹配策略。

## 代码

```html
<!-- @mechanism 输入框是 combobox，候选是一组 option，两者用 aria-controls 关联 -->
<div class="ac">
  <input
    class="ac-input"
    role="combobox"
    aria-expanded="false"
    aria-controls="ac-list"
    aria-autocomplete="list"
    autocomplete="off"
    placeholder="试试 wrap 或 grid"
  />
  <ul class="ac-list" id="ac-list" role="listbox" hidden></ul>
</div>
```

```css
.ac {
  position: relative;
  width: min(320px, 84vw);
  font: 400 15px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

.ac-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.35);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.55);
  font: inherit;
  color: inherit;
}

.ac-list {
  /* @mechanism 绝对定位盖住下方内容，避免每敲一个字页面就抖一下 */
  position: absolute;
  inset: calc(100% + 4px) 0 auto;
  max-height: 168px;
  overflow: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  border: 1px solid rgb(60 48 30 / 0.25);
  border-radius: 8px;
  background: #fffdf8;
  box-shadow: 0 8px 20px rgb(28 26 23 / 0.14);
}

/* @mechanism 高亮由 aria-selected 驱动，键盘焦点从未离开输入框 */
.ac-opt[aria-selected="true"] {
  background: rgb(180 70 47 / 0.12);
  color: #b4462f;
}
```

```js
const POOL = ['grid-template-columns', 'aspect-ratio', 'container-type', 'field-sizing', 'scroll-snap-type', 'text-wrap-balance']
const input = document.querySelector('.ac-input')
const list = document.querySelector('.ac-list')
let active = -1

function render(items) {
  list.replaceChildren(
    ...items.map((text, i) => {
      const li = document.createElement('li')
      li.className = 'ac-opt'
      li.id = `ac-opt-${i}`
      li.setAttribute('role', 'option')
      li.textContent = text
      return li
    }),
  )
  list.hidden = items.length === 0
  input.setAttribute('aria-expanded', String(items.length > 0))
  active = -1
  input.removeAttribute('aria-activedescendant')
}

function highlight(step) {
  const opts = [...list.children]
  if (!opts.length) return
  active = (active + step + opts.length) % opts.length
  opts.forEach((opt, i) => opt.setAttribute('aria-selected', String(i === active)))
  // @mechanism 移动的是"当前活动项"而不是键盘焦点，输入法上下文因此不被打断
  input.setAttribute('aria-activedescendant', opts[active].id)
  opts[active].scrollIntoView({ block: 'nearest' })
}

input.addEventListener('input', () => {
  const q = input.value.trim()
  render(q ? POOL.filter((name) => name.includes(q)) : [])
})

input.addEventListener('keydown', (e) => {
  // @mechanism 上下键不阻止默认，光标会跳到文字首尾，等于把用户打字位置弄丢
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    highlight(e.key === 'ArrowDown' ? 1 : -1)
  } else if (e.key === 'Enter' && active >= 0) {
    input.value = list.children[active].textContent
    render([])
  } else if (e.key === 'Escape') {
    render([])
  }
})

render([])
```

## 边界

- 用 `input` 事件而不是 `keydown` 来过滤是必须的：`keydown` 触发时 `value` 还是按下之前的内容，用它匹配永远慢一个字符。输入法拼字期间 `input` 也会触发，但值可能还没确定。
- 候选列表必须能滚动且限制高度。候选一多，绝对定位的面板会盖住整个页面下半部分，而滚动条常和 `ArrowUp` / `ArrowDown` 的按键处理抢同一件事。
- `aria-activedescendant` 指向的 id 必须真实存在且**可见**。列表收起时忘了清掉它，读屏器会指向一个不存在的节点，报出奇怪的播报。
- 高亮项的 `scrollIntoView({ block: 'nearest' })` 不写的话，用键盘走到列表下方看不见的项时，不会自动滚进来——用户以为自己按坏了。
- 用 `role="combobox"` 就必须同时给 `aria-expanded` 与 `aria-controls`，三件套缺一个，读屏器对它的解读就会退化成一个普通文本框。

## 备注

- 「焦点不动、只改 activedescendant」是列表类交互的通用答案：这一套同样适用命令面板、@ 提及、树形选择器。
- 如果候选是固定且不依赖输入的，直接用原生 `<datalist>` 能省掉全部脚本，代价是样式完全不可控。
