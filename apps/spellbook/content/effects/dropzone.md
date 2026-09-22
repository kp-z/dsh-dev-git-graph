---
title: 文件拖放区
slug: dropzone
category: 交互
tags: [表单, 拖放, DataTransfer]
since: 2026-10
source: 机制来自 HTML 拖放 API 的 dragenter 计数与 DataTransfer，自行实现
when: 上传框要能整块接住拖进来的文件，且高亮状态不能因为鼠标划过子元素就闪
stage: plain
tier: core
---

## 描述

一块虚线框，文件拖到上面时整块变色；松手后下面列出文件名与大小。

真正的难点不是接住文件，是那个「高亮」状态。直觉写法是 `dragenter` 加类、`dragleave` 去类，但在真实页面上状态会疯狂闪烁：鼠标从容器移到容器内的文字上时，浏览器先给文字发 `dragenter`、再给容器发一个 `dragleave`——容器明明还没被离开。于是「我还在里面」这件事必须有独立的记录。

机制是 ==dragenter 与 dragleave 各记一次数，只有计数归零才认为真的离开了整块区域==。进出子元素的事件成对出现，计数相互抵消；只有跨过容器边界时净值才会变。用「当前鼠标在哪个元素上」之类的判断替代不了它，因为拖动过程中鼠标事件的 target 会被反复重算。

另外两条是硬性的：`dragover` 里必须 `preventDefault()`，否则浏览器认定这里不是投放目标，`drop` 永远不会触发；而文件内容出于安全只在 `drop` 那一刻可读，`dragover` 期间只能看到 `dataTransfer.items` 里的类型，读不到名字和内容。

## 代码

```html
<!-- @mechanism 高亮的判定交给容器，里面的文字节点不参与状态 -->
<div class="dz">
  <p class="dz-hint">把文件拖到这里，或 <button class="dz-pick" type="button">选择文件</button></p>
  <input class="dz-file" type="file" multiple hidden />
  <ul class="dz-list"></ul>
</div>
```

```css
.dz {
  width: min(360px, 84vw);
  padding: 24px 18px;
  border: 1.5px dashed rgb(60 48 30 / 0.35);
  border-radius: 12px;
  background: rgb(255 255 255 / 0.45);
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
  text-align: center;
  transition: border-color 0.15s, background-color 0.15s;
}

/* @mechanism 高亮只由计数归零与否决定，与鼠标此刻压着哪个子元素无关 */
.dz.is-over {
  border-color: #b4462f;
  background: rgb(180 70 47 / 0.08);
}

.dz-hint {
  margin: 0;
}

.dz-pick {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: #b4462f;
  text-decoration: underline;
  cursor: pointer;
}

.dz-list {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: rgb(28 26 23 / 0.7);
}
```

```js
const zone = document.querySelector('.dz')
const list = document.querySelector('.dz-list')
const picker = document.querySelector('.dz-file')
let depth = 0

// @mechanism 进子元素会先触发父级的 dragleave，只能靠计数抵消，不能直接翻转
zone.addEventListener('dragenter', (e) => {
  e.preventDefault()
  depth++
  zone.classList.add('is-over')
})

zone.addEventListener('dragleave', () => {
  depth--
  if (depth <= 0) {
    depth = 0
    zone.classList.remove('is-over')
  }
})

// @mechanism 不阻止默认行为，浏览器就不认这里是投放目标，drop 永远不来
zone.addEventListener('dragover', (e) => e.preventDefault())

function show(files) {
  list.replaceChildren(
    ...[...files].map((file) => {
      const li = document.createElement('li')
      li.textContent = `${file.name} · ${Math.round(file.size / 1024)} KB`
      return li
    }),
  )
}

zone.addEventListener('drop', (e) => {
  e.preventDefault()
  depth = 0
  zone.classList.remove('is-over')
  // @mechanism 文件列表只在 drop 这一刻可读，dragover 期间出于安全拿不到
  show(e.dataTransfer.files)
})

document.querySelector('.dz-pick').addEventListener('click', () => picker.click())
picker.addEventListener('change', () => show(picker.files))
```

## 边界

- 拖着文件直接甩出浏览器窗口时，最后一个 `dragleave` 可能不会送达，计数就卡在 1 上，高亮一直不灭。稳妥做法是在 `window` 的 `dragend` 与 `drop` 上无条件把计数清零。
- 另一种免计数的做法是给子元素 `pointer-events: none`，让事件只命中容器本身。代价是子元素里的按钮再也点不动——所以上面那个「选择文件」按钮不能这么处理。
- 计数法要求 `dragenter` 与 `dragleave` 严格成对。如果中途用 `display: none` 隐藏了容器，或者动态替换了子树，配对会被打破，计数就再也回不到零。
- `dataTransfer.files` 是只读列表，而且拖动 `drop` 之后其中的引用会随事件对象失效。想留着文件后面再上传，要立刻取出或用 `files` 之外的途径。
- 用户拖进来的可能是文件夹或快捷方式，`size` 会是 0 或极小值。按大小做的任何判断都可能被这类条目骗到。

## 备注

- 计数法本质上是在处理「一个状态被多个子事件反复改写」这一类问题，凡是浏览器会为子元素重复派发的事件（`dragleave`、`mouseout`、`mouseenter` 与 `mouseleave` 的差异）都适用同一套解法。
- 同一块区域加个 `paste` 监听就能接住截图粘贴，机制一样：`clipboardData.files`。
