---
title: 给指针留出穿越时间
slug: hover-intent-delay
category: 交互
tags: [transition, 悬停, 浮层, 指针]
since: 2026-09
source: 机制来自 CSS transition-delay 的分状态声明，自行实现
when: 触发区和面板之间有一道缝，鼠标穿过去时面板总会先消失
stage: grid
tier: core
params:
  - { name: grace, label: 穿越时间, type: range, min: 0.1, max: 0.6, step: 0.05, default: 0.25, unit: s }
---

## 描述

鼠标从按钮移向面板，中间跨过一道空隙，面板稳稳地开着；移开之后才缓缓收起。

机制是 ==transition-delay 可以在两个状态里分别声明==。展开时不给延迟——操作跟着手走；收起时给一个延迟——这就给了指针从触发区穿到面板上的时间。中间那段空隙不再导致面板提前消失。

难点在于延迟要写在**收起状态**（基础规则）上，而不是展开状态上。

## 代码

```html
<div class="hi">
  <div class="hi-trigger">悬停这里</div>
  <div class="hi-panel">
    <b>面板</b>
    <span>指针可以穿过缝隙过来</span>
  </div>
</div>
```

```css
.hi {
  width: min(280px, 76vw);
  font: 400 13px/1.6 system-ui, sans-serif;
}

.hi-trigger {
  padding: 12px 16px;
  border: 1px solid rgb(60 48 30 / 0.32);
  background: rgb(255 255 255 / 0.5);
  color: #1c1a17;
  cursor: default;
}

.hi-panel {
  margin-top: 10px;
  padding: 14px 16px;
  border: 1px solid rgb(180 70 47 / 0.5);
  background: #1b1626;
  color: #f0ead9;
  opacity: 0;
  visibility: hidden;
  /* @mechanism 收起时延迟——留给指针穿越缝隙的时间 */
  transition: opacity 0.2s ease, visibility 0.2s ease;
  transition-delay: var(--grace, 0.25s);
}

.hi-panel b {
  display: block;
  margin-bottom: 3px;
}

.hi-panel span {
  opacity: 0.72;
}

.hi:hover .hi-panel,
.hi:focus-within .hi-panel {
  opacity: 1;
  visibility: visible;
  /* @mechanism 展开时零延迟，操作跟手 */
  transition-delay: 0s;
}
```

## 边界

- 延迟必须写在**收起状态**（基础规则）上，展开状态里再覆盖成 `0s`。写反了会得到「展开很慢、收起很急」——与想要的正好相反。
- `visibility` 要参与过渡。它会延迟到过渡结束才切换，这样面板在淡出的过程中仍可交互；用 `display: none` 完全不行（离散属性，会立刻消失）。
- 延迟不能太长。超过 300ms 就显得迟钝，用户会以为界面卡住；太短又穿不过空隙。200–300ms 是个稳妥区间。
- 这是鼠标专属技巧。触屏没有 hover，整段要包在 `@media (hover: hover)` 里。
- 收起有延迟意味着「确实要关掉」也慢了一点。面板里若有关键操作，延迟要调小，或者让它只在指针移开时延迟、键盘 Esc 立即关闭。
- 用 `:focus-within` 一起写能让键盘用户也打开面板，否则这个面板对键盘完全不可达。

## 备注

- 同一招也能治「悬停时图标闪动」：给状态变化加一点点延迟，抖动就被吸收掉了。
- 这个「延迟的方向不同」是过渡状态机的本质属性，值得记住——凡是需要「进入快、离开慢」的地方都是同一套写法。
