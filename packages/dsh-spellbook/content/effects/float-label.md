---
title: 浮动标签
slug: float-label
category: 交互
tags: [transition, pointer-events, 表单, 输入, 焦点]
since: 2026-09
source: 机制来自 CSS 的 :placeholder-shown，自行实现
when: 标签要在框里当占位、有内容时缩到上面去，但不想用 JS 判断空值
stage: plain
tier: core
---

## 描述

输入框空着时，标签就在框里当提示；一开始打字，标签缩到上边、文字在下面。

机制是 ==:placeholder-shown 匹配「此刻正显示着占位文字」的元素==，也就是「输入框是空的」。有了这个「是否为空」的信号，纯 CSS 就能做浮动标签——不需要监听 `input` 事件，也不需要维护一份影子状态。

光标聚焦时也浮起来（用户正要开始输入），所以选择器要同时写 `:focus` 与 `:not(:placeholder-shown)`。

## 代码

```html
<div class="fl-field">
  <input class="fl-input" id="sb-fl" placeholder=" " />
  <label class="fl-label" for="sb-fl">你的名字</label>
</div>
```

```css
.fl-field {
  position: relative;
  width: min(300px, 78vw);
}

.fl-input {
  width: 100%;
  padding: 22px 14px 8px;
  border: 1px solid rgb(60 48 30 / 0.35);
  background: rgb(255 255 255 / 0.5);
  font: 400 16px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

.fl-label {
  position: absolute;
  left: 14px;
  top: 15px;
  font: 400 15px/1 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.5);
  /* @mechanism 标签不能吃掉输入框的点击 */
  pointer-events: none;
  transition: top 0.2s ease, font-size 0.2s ease, color 0.2s ease;
}

/* @mechanism :placeholder-shown = 此刻是空的；所以浮起条件取它的反面 */
.fl-input:focus + .fl-label,
.fl-input:not(:placeholder-shown) + .fl-label {
  top: 7px;
  font-size: 12px;
  color: #b4462f;
}
```

## 边界

- 输入框**必须有非空的 `placeholder`**。写 `placeholder=" "`（一个空格）就行，但完全不给的话 `:placeholder-shown` 永远不匹配，标签不会浮动。
- 标签必须用 `+` 或 `~` 跟在输入框**后面**。CSS 只能往后选，DOM 顺序反了就选不到——`for` 属性在这里帮不上忙。
- `pointer-events: none` 不能少，否则标签浮在输入框上方时会挡住点击，用户点不进去。
- 浮起的条件要同时包含 `:focus`。只写 `:not(:placeholder-shown)` 的话，聚焦一个空框时标签不会让位。
- 浏览器自动填充时 `:placeholder-shown` 的行为各版本有过差异，需要实测——自动填好的值若没让标签浮起，会与输入的文字重叠。

## 备注

- 这套的通用价值在于：**把浏览器已知的状态接出来，而不是自己再记一份**。`value.length > 0` 这类影子状态能省就省。
- 同一机制可以做「清空按钮只在有内容时出现」：`.input:not(:placeholder-shown) ~ .clear { display: block }`。
