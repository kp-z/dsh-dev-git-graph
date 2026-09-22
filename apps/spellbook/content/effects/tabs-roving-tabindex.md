---
title: 复合控件的移动焦点
slug: tabs-roving-tabindex
category: 交互
tags: [键盘, tabindex, 焦点模型]
since: 2026-10
source: 机制来自 WAI-ARIA 作者实践里的 roving tabindex 焦点模型，自行实现
when: 一排标签、菜单或工具按钮挨在一起，Tab 键不该在其中逐项停留
stage: plain
tier: core
---

## 描述

按 Tab 键，这一排标签只停一次；落进来之后，由左右方向键在组内移动。

机制是 ==整组同时只有一个元素带 tabindex="0"，其余全为 -1，方向键把这个 0 搬走==。`tabindex="-1"` 不是「不能聚焦」，而是「不在 Tab 顺序里、但仍可被脚本聚焦」——所以焦点能停在组内任何一项，而整组在 Tab 顺序上只占一格。这就是 WAI-ARIA 对复合控件规定的模型：Tab 进组、方向键组内移动、Tab 出组。

选中与聚焦是两件事。这里做的是「自动激活」：方向键一动就选中，切换成本为零，适合面板只是几段文字的情况；如果面板里是重内容（图、表、异步数据），应该改成手动激活——聚焦归聚焦，按回车才切换，免得用户连按几下方向键时触发一串加载。

可变的是循环与方向。首尾是否绕回、RTL 下左右键要反过来、竖排要换成上下键并声明 `aria-orientation`。真正会咬人的是禁用项：`disabled` 的元素不可聚焦，而取模运算会把焦点送回它，所以跳过必须自己写。

## 代码

```html
<!-- @mechanism 只有当前项带 tabindex="0"，其余为 -1，Tab 键整组只停一次 -->
<div class="rv" role="tablist" aria-label="示例标签">
  <button class="rv-tab" role="tab" id="sb-rt1" aria-controls="sb-rp1" aria-selected="true" tabindex="0">是什么</button>
  <button class="rv-tab" role="tab" id="sb-rt2" aria-controls="sb-rp2" aria-selected="false" tabindex="-1">靠什么</button>
  <button class="rv-tab" role="tab" id="sb-rt3" aria-controls="sb-rp3" aria-selected="false" tabindex="-1">什么会坏</button>
</div>
<div class="rv-panels">
  <div class="rv-pane" role="tabpanel" id="sb-rp1" aria-labelledby="sb-rt1">状态只有一处：这排按钮。</div>
  <div class="rv-pane" role="tabpanel" id="sb-rp2" aria-labelledby="sb-rt2">方向键搬运的是 tabindex。</div>
  <div class="rv-pane" role="tabpanel" id="sb-rp3" aria-labelledby="sb-rt3">忘记设回 0，整组就进不去了。</div>
</div>
```

```css
.rv,
.rv-panels {
  width: min(380px, 86vw);
  font: 400 13px/1.7 system-ui, sans-serif;
}
.rv {
  display: flex;
  gap: 4px;
}
.rv-tab {
  flex: 1;
  padding: 7px 10px;
  border: 0;
  border-bottom: 2px solid rgb(60 48 30 / 0.18);
  background: none;
  font: inherit;
  color: rgb(27 23 16 / 0.55);
  cursor: pointer;
}
/* @mechanism 选中态来自 aria-selected，键盘位置来自 tabindex，两个概念分开表达 */
.rv-tab[aria-selected="true"] {
  color: #b4462f;
  border-bottom-color: #b4462f;
  font-weight: 600;
}
.rv-tab:focus-visible {
  outline: 2px solid #b4462f;
  outline-offset: -3px;
}
.rv-panels {
  margin-top: 10px;
  color: #1b1710;
}
.rv-pane {
  display: none;
  min-height: 54px;
}
.rv-pane.is-on {
  display: block;
}
```

```js
const tabs = Array.from(document.querySelectorAll('.rv-tab'))
const panes = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')))

function activate(index, moveFocus) {
  tabs.forEach((tab, i) => {
    const on = i === index
    tab.setAttribute('aria-selected', String(on))
    // @mechanism 把组内唯一那个 tabindex="0" 搬过去，其余降为 -1
    tab.tabIndex = on ? 0 : -1
    if (panes[i]) panes[i].classList.toggle('is-on', on)
  })
  if (moveFocus) tabs[index].focus()
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => activate(i, false))
  tab.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    // @mechanism 首尾绕回，避免在边界上出现「按了没反应」
    activate((i + step + tabs.length) % tabs.length, true)
  })
})

activate(0, false)
```

## 边界

- 忘记把选中项设回 `tabindex="0"`，整组都是 -1：Tab 键再也进不来，焦点凭空少一档，而且没有任何报错。这是这套模型最常见的致命 bug。
- 禁用项只加 `disabled` 时，它不可聚焦，但取模绕回会把焦点送回它，表现为「按方向键有时没反应」；跳过逻辑得自己写，不能让浏览器兜。
- Tab 顺序里这一组只占一格，意味着组内被跳过的项用 Tab 够不到——这是设计而不是缺陷，但要求组内不能有「必须被单独 Tab 到」的控件。
- 面板内容若在点击后才挂载，必须先把面板插入 DOM 再 `focus()`；对不存在的节点调 `focus()` 是静默失败，焦点掉回 body。
- 面板若可聚焦（含链接），按 ARIA 建议给面板 `tabindex="0"`，让键盘用户从标签直接进内容；不给的话面板里的第一个链接会成为落点，方向键语义会含混。
- RTL 语言里 `ArrowRight` 的「下一项」要反过来；垂直排列用上下键并声明 `aria-orientation="vertical"`，否则读屏会按水平组播报。
- 用 `aria-selected` 而同时另设一个 `.is-active` 类，迟早对不上：无障碍树说一套、样式说另一套。

## 备注

- 同一模型适用于工具栏、分段控件、菜单、树、二维网格（方向键改成两轴移动）、单选卡片组。
- 自动激活 vs 手动激活是取舍：切换零成本时用前者，切换要付网络代价时用后者。
