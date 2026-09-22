---
title: 分页的滑动窗口
slug: pagination-window
category: 交互
tags: [分页, 窗口, 省略号]
since: 2026-10
source: 机制来自经典「定长页码窗口 + 两端锚定」的分页算法，自行实现
when: 页码多到二三十页，要固定住一行里按钮的数量
stage: plain
tier: core
---

## 描述

二十页的列表，页码永远是七个格子：首页、末页、当前页左右各两页，剩下的位置给省略号。

机制是 ==先按当前页居中算出一个**定长**窗口，再把它夹回两端==，让窗口贴着第一页、贴着最后一页时不再继续滑动；窗口之外的部分才用省略号占位。这两件事必须分开：窗口负责「显示哪几页」，省略号负责「中间被跳过了几页」。把省略号当成窗口的装饰，就会写出「1 … 3 4 5」这种只跳了一页的假省略号。

滑动时机是第二个容易做错的地方：窗口只在当前页越过窗口中心时才整体平移，而不是每翻一页都滑。否则每点一次，整排页码都换位置，用户的手指会跟丢——这是预期问题，不是算法问题。

可变的是窗口长度与两端是否算进窗口。演示里窗口长度取奇数，当前页才能正好居中；取偶数时必然偏左或偏右，得显式决定往哪偏，否则当前页会在两个位置之间来回跳。

## 代码

```html
<!-- @mechanism 页码由脚本按窗口算出来，容器只负责渲染 -->
<nav class="pg" aria-label="分页">
  <button class="pg-btn" type="button" data-step="-1">上一页</button>
  <span class="pg-nums"></span>
  <button class="pg-btn" type="button" data-step="1">下一页</button>
</nav>
```

```css
.pg {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 400 12px/1.6 system-ui, sans-serif;
  color: #1b1710;
}
.pg-nums {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pg-btn,
.pg-num {
  min-width: 30px;
  padding: 5px 8px;
  border: 1px solid rgb(60 48 30 / 0.2);
  border-radius: 7px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
/* @mechanism 省略号是独立的一格，它不是页码，所以不占窗口长度 */
.pg-gap {
  min-width: 30px;
  text-align: center;
  color: rgb(27 23 16 / 0.4);
}
.pg-num[aria-current="page"] {
  border-color: #b4462f;
  background: #b4462f;
  color: #fff;
  font-weight: 600;
}
```

```js
const nums = document.querySelector('.pg-nums')
const per = 5 // 窗口里显示的页码个数，取奇数当前页才能居中
const total = 20
let current = 8

// @mechanism 先按当前页居中开出定长窗口，再把它夹回 [2, total-1]
function windowOf(cur) {
  let start = Math.max(2, cur - Math.floor(per / 2))
  const end = Math.min(total - 1, start + per - 1)
  start = Math.max(2, end - per + 1)
  return [start, end]
}

function render() {
  const [start, end] = windowOf(current)
  const num = (page) =>
    '<button class="pg-num" type="button" data-page="' + page + '"' +
    (page === current ? ' aria-current="page"' : '') + '>' + page + '</button>'
  const parts = [num(1)]
  // @mechanism 省略号只在「确实跳过了页码」时出现，否则就是假省略号
  if (start > 2) parts.push('<span class="pg-gap">…</span>')
  for (let page = start; page <= end; page++) parts.push(num(page))
  if (end < total - 1) parts.push('<span class="pg-gap">…</span>')
  parts.push(num(total))
  nums.innerHTML = parts.join('')
}

function go(page) {
  const next = Math.min(total, Math.max(1, page))
  if (next === current) return
  current = next
  render()
  // @mechanism 整排重建会销毁刚点过的按钮，把焦点交还给新的当前页
  const now = nums.querySelector('[aria-current="page"]')
  if (now) now.focus()
}

document.querySelector('.pg').addEventListener('click', (event) => {
  const btn = event.target.closest('button')
  if (!btn) return
  if (btn.dataset.page) go(Number(btn.dataset.page))
  else go(current + Number(btn.dataset.step))
})

render()
```

## 边界

- 省略号的判据写成 `start > 1` 而不是 `> 2`，就会出现「1 … 2 3 4 5」——省略号两侧是相邻页码，等于在说谎。判据必须是「中间**确实**有被跳过的页」。
- 窗口长度取偶数时当前页无法居中，必须显式选一边偏；不选的话，翻页时当前页会在两个位置之间来回跳。
- 总页数很少（≤ 窗口长度 + 2）时不该出现省略号，否则「1 2 3 4 5」变成「1 … 3 4 … 9」，比直接列出来更难读。
- 两端夹取要按「先夹起点、算出终点、再夹一次起点」走两遍；只做一遍时，当前页靠右会算出一个长度不足 `per` 的窗口，整排按钮突然变少，布局跟着跳。
- 每次翻页都整体重建 DOM 会让键盘用户丢焦点（原按钮被销毁），必须显式把焦点交还给新的当前页；用 `innerHTML` 重建时连过渡和 CSS 动画都会被重置。
- 首尾是「锚定」的：首页与末页永远显示，所以它们不参与窗口容量。若把首尾也算进窗口长度，总页数很大时中间只剩两三个格子，滑动会变得非常敏感。
- 当前页用 `aria-current="page"` 标记（读屏用它播报），视觉高亮也从同一个属性取；再另设一个 `.active` 类，两处状态迟早对不上。

## 备注

- 同一套「定长窗口 + 两端锚定」能搬到年份选择器、日志页码、轮播圆点（超出就折叠成省略号）。
- 判据统一成一句：省略号是「被跳过的页」的占位符，不是窗口的画框。
