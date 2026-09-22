---
title: 单选组撑起的标签页
slug: tabs-radio-css
category: 交互
tags: [has-selector, 标签页, 点击, 切换]
since: 2026-10
source: 机制来自 CSS :checked 伪类与通用兄弟选择器的组合，自行实现
when: 标签页只是切换几块静态内容，不想为「哪个亮着」再维护一份 JS 状态
stage: plain
tier: core
---

## 描述

三个标签、三块面板，点谁亮谁，一行 JS 都没有。

机制是 ==把「当前选中哪一页」存成一组同名 radio 的 :checked，再用兄弟选择器把这份状态分发出去==。radio 天生只有一个能被选中——互斥本来就是浏览器实现的；`:checked` 又天生能被 CSS 读到。所以只要让 radio 与标签、面板处在同一条兄弟链上，`#t2:checked ~ .pane-2` 就等于「第二页被选中时，露出第二块面板」。状态没有被复制到任何地方，DOM 本身就是那份状态。

面板用 `display` 硬切，因为这里的关系是「一个 radio 管一个标签加一块面板」，规则数随页数线性增长。顺带拿到的好处是键盘：radio 组的方向键切换、整组 Tab 只停一次，都是浏览器白送的。

## 代码

```html
<!-- @mechanism radio 与标签、面板同处一条兄弟链，:checked 才能用 ~ 把状态分发到它们身上 -->
<div class="tabs">
  <input class="tabs-input" type="radio" name="sb-tabs" id="sb-t1" checked />
  <input class="tabs-input" type="radio" name="sb-tabs" id="sb-t2" />
  <input class="tabs-input" type="radio" name="sb-tabs" id="sb-t3" />

  <div class="tabs-bar">
    <label class="tabs-tab" for="sb-t1">是什么</label>
    <label class="tabs-tab" for="sb-t2">靠什么</label>
    <label class="tabs-tab" for="sb-t3">什么会坏</label>
  </div>

  <div class="tabs-body">
    <p class="tabs-pane">三块内容轮流露出，谁亮由 radio 决定。</p>
    <p class="tabs-pane">状态存在 radio 上，不在 JS 变量里。</p>
    <p class="tabs-pane">面板是硬切，没有过渡。</p>
  </div>
</div>
```

```css
.tabs {
  width: min(340px, 86vw);
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #1b1710;
}
/* @mechanism radio 不参与视觉，只作为状态载体留在 DOM 里 */
.tabs-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.tabs-bar {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid rgb(60 48 30 / 0.18);
}
.tabs-tab {
  padding: 8px 12px;
  border-bottom: 2px solid transparent;
  color: rgb(27 23 16 / 0.5);
  cursor: pointer;
}
.tabs-pane {
  display: none;
  min-height: 62px;
  margin: 0;
  padding: 14px 2px;
}
/* @mechanism 「当前是谁」只由 :checked 决定，标签与面板共用这一个来源 */
#sb-t1:checked ~ .tabs-bar [for="sb-t1"],
#sb-t2:checked ~ .tabs-bar [for="sb-t2"],
#sb-t3:checked ~ .tabs-bar [for="sb-t3"] {
  color: #b4462f;
  border-bottom-color: #b4462f;
}
#sb-t1:checked ~ .tabs-body .tabs-pane:nth-child(1),
#sb-t2:checked ~ .tabs-body .tabs-pane:nth-child(2),
#sb-t3:checked ~ .tabs-body .tabs-pane:nth-child(3) {
  display: block;
}
/* 视觉隐藏的 radio 仍可聚焦，所以焦点环要画到它对应的标签上 */
#sb-t1:focus-visible ~ .tabs-bar [for="sb-t1"],
#sb-t2:focus-visible ~ .tabs-bar [for="sb-t2"],
#sb-t3:focus-visible ~ .tabs-bar [for="sb-t3"] {
  outline: 2px solid #b4462f;
  outline-offset: -3px;
}
```

## 边界

- 硬切：`display: none → block` 没有中间态，面板不会淡入。要过渡就得把面板叠进同一格（grid 叠放或绝对定位），改用 opacity 或 `allow-discrete`；但那样未选中的面板仍在布局里，还得再给它们 `visibility` 或 `inert`，成本会超过这套方案本身的价值。
- 语义不对：读屏会把这一组念成「单选按钮组」而不是 tablist，标签与面板之间的 `aria-controls` 也无处安放。要可访问性优先，用 roving tabindex 那套。
- 视觉隐藏必须用 `opacity`/裁剪，不能 `display: none` —— 后者让 radio 无法聚焦，键盘直接失效（看得到标签、按不出来）。
- 规则数随页数线性增长，八页就是十六条选择器；而且 `:nth-child(2)` 依赖面板顺序与 radio 序号一一对应，中间插一个别的元素就整排错位。
- radio 是表单控件：这套放进 `<form>` 后，重置表单、序列化提交都会把「当前在第几页」一起带上。不想被带走就换 checkbox 加 `:has()`，或者把 `name` 取成不会出现在表单里的名字。
- 同名的 radio 会被浏览器归成**同一组**，所以两个不同的标签页组件必须用不同的 `name`，否则会互相抢选中态（现象是点 A 组，B 组也跟着变）。

## 备注

- 用 `:has()` 可以把上面六条压成一条：`.tabs:has(#sb-t1:checked) .tabs-tab:nth-child(1)`，代价是把顺序也交给选择器算。
- 同一招能搬去做分段控件、开关组、CSS-only 的列表筛选。
