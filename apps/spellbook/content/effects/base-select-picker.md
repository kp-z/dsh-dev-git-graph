---
title: 可定制的原生下拉
slug: base-select-picker
category: 交互
tags: [select, 弹层, 表单]
since: 2026-10
source: 机制来自 HTML 的可定制 select 与 CSS ::picker(select)，自行实现
when: 下拉选项里要放图标和说明文字，但不想用 div 假造一个 select
stage: plain
tier: candidate
---

## 描述

下拉展开是一个圆角弹层，每个选项左边一枚彩色圆点、中间名称、右边一句备注；键盘上下选择、按首字母跳转、表单提交全都还是原生的。

机制是 ==appearance: base-select 把 select 的按钮与弹层交还给 CSS，弹层从此是 ::picker(select) 这个伪元素==。以前 `<select>` 弹出的那部分由浏览器内部绘制，CSS 碰不到，所以「选项里有图标」只能放弃原生控件去用 `div` 假造——代价是键盘导航、屏幕阅读器、表单语义、移动端原生选择器全部要自己重写，而且永远差一点。`base-select` 保留全部原生行为，只把绘制交出来：`option` 里的内容按原样渲染（可以放任意 HTML），弹层与箭头分别通过 `::picker(select)` 和 `::picker-icon` 定制。

这条咒语的空白在于「行为与外观解耦」：浏览器继续负责那个状态机（哪一项被选中、弹层开没开、焦点在哪），你只负责它长什么样。由此还多出一条纪律——**别自己去维护选中态**。`option:checked`、`::checkmark`、打开时的 `:open` 都由浏览器算好，脚本里再存一份索引只会两边打架。

弹层的边框、圆角、阴影、进出动画都是旋钮（它是顶层元素，`transition-behavior: allow-discrete` 那套在这里正好用得上）；选项内部可以 `display: flex`，于是图标、名称、备注能排成一行；箭头可以用 `::picker-icon` 换成自己的符号并随 `:open` 旋转。示例刻意不去改「按钮上显示什么」——那部分浏览器默认就会把选中项的内容镜像过来，多改一处就多一处要同步。

## 代码

```html
<div class="bs">
  <label class="bs-label" for="bs-pick">项目</label>
  <select class="bs-select" id="bs-pick">
    <option value="a">
      <span class="bs-dot bs-a"></span>
      <span class="bs-name">月桂叶</span>
      <span class="bs-note">常备</span>
    </option>
    <option value="b">
      <span class="bs-dot bs-b"></span>
      <span class="bs-name">白松香</span>
      <span class="bs-note">少量</span>
    </option>
    <option value="c">
      <span class="bs-dot bs-c"></span>
      <span class="bs-name">鸢尾根</span>
      <span class="bs-note">缺货</span>
    </option>
  </select>
</div>
```

```css
.bs {
  display: grid;
  gap: 8px;
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1b1710;
}

/* @mechanism 按钮这一半交还绘制权；单独成条，未知伪元素不会连累它 */
.bs-select {
  appearance: base-select;
  width: min(280px, 80vw);
  padding: 10px 14px;
  border: 1px solid rgb(60 48 30 / 0.3);
  border-radius: 12px;
  background: rgb(255 255 255 / 0.72);
  font: inherit;
  color: inherit;
}

/* @mechanism 弹层这一半也是 ::picker(select)：分离成独立规则，写错也只影响它自己 */
.bs-select::picker(select) {
  appearance: base-select;
  margin-top: 8px;
  padding: 6px;
  border: 1px solid rgb(60 48 30 / 0.22);
  border-radius: 14px;
  background: #fdfaf4;
  box-shadow: 0 18px 40px rgb(60 48 30 / 0.22);
}

/* @mechanism 选项里的 HTML 按原样渲染，所以这里能排成一行 */
.bs-select option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 9px;
}

.bs-select option:checked {
  background: rgb(180 70 47 / 0.12);
}

/* @mechanism 选中标记由浏览器给，不要自己画一个 */
.bs-select option::checkmark {
  content: '✓';
  color: #b4462f;
}

.bs-select::picker-icon {
  transition: rotate 0.25s ease;
}

.bs-select:open::picker-icon {
  rotate: 180deg;
}

.bs-dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.bs-a { background: #b4462f; }
.bs-b { background: #1f7a6f; }
.bs-c { background: #4c5fd5; }

.bs-note {
  margin-left: auto;
  font-size: 12.5px;
  opacity: 0.6;
}
```

## 边界

- `appearance: base-select` 要在 `select` 和 `::picker(select)` 上各写一次（示例里拆成两条规则，就是为了让未知伪元素只毁掉它自己那条）。只给 `select` 写时按钮变了、弹层还是浏览器默认的样子，看起来像半成品。
- 未知伪元素会让**整条规则**失效，所以在同一条选择器列表里混写 `select, select::picker(select)` 很危险：旧引擎上第一半也会跟着被丢掉。
- `option` 里能放 HTML，但语义没变：它仍然是「一个可选中的项」，不是任意容器。选项里塞按钮、链接、输入框会破坏「选项只有一个选中状态」这个前提。
- 弹层在顶层（top layer），祖先的 `overflow: hidden` 和 `z-index` 都管不到它；想让它跟着页面滚动走，靠的是它自带的锚定行为，而不是把它放进某个定位容器。
- 键盘的「按首字母跳转」依赖选项的**文本**。图标和文字要并存，别把信息只放在圆点或图标上——那既是给机器的损失，也是给色觉障碍用户的损失。
- 支持面窄（目前主要是 Chromium 系在实现），写 candidate。不支持时 `appearance: base-select` 被忽略，退回普通原生下拉，选项里的 HTML 退化成一行纯文本——可接受的降级，但别把关键信息只放进那行被吃掉的结构里。

## 备注

- 同一套「原生状态机 + CSS 绘制权」的模式也在 `::details-content`、`popover` 上出现：凡是浏览器管状态的地方，都在慢慢把绘制交出来。
