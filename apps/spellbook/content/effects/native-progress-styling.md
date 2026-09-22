---
title: 给原生进度条上色
slug: native-progress-styling
category: 动效
tags: [进度条, 原生元素, 伪元素]
since: 2026-10
source: 机制来自 HTML 规范中 progress 元素的影子伪元素，自行实现
when: 需要一条真进度条，但不想自己画 div，也不想丢掉现成的语义与无障碍
stage: plain
tier: core
---

## 描述

一条渐变色进度条，滚动条式的系统外观被完全换掉；把 `value` 拿掉，它自己就变成不确定态。

机制是 ==progress 的槽与填充是两个影子伪元素，分别上色==。`<progress>` 内部不是一个你可以直接选中的结构，它的外观由成对的伪元素描述：WebKit 系是 `::-webkit-progress-bar`（槽）与 `::-webkit-progress-value`（填充），Firefox 是 `::-moz-progress-bar`。两家名字不同、不能合并成一条规则，必须各写一遍。换来的好处是语义白拿：`role="progressbar"`、`aria-valuenow`、`min/max/value` 的映射都不用手写，而且**它天生就有「不确定态」**——只要没有 `value` 属性，元素就进入 `:indeterminate`，可以用这个伪类单独给它一套样式。

样式上最容易漏的是 `appearance: none`。不写它，移动端 Safari 会继续用自己的外观，你设的高度、背景、圆角全部不生效，现象是「桌面端好好的，手机上变成一根细蓝条」。

## 代码

```html
<label class="np">
  正在上传
  <progress id="sb-np" max="100" value="42"></progress>
</label>
<button class="np-toggle" id="sb-np-toggle" type="button">切换不确定态</button>
```

```css
.np {
  display: grid;
  gap: 10px;
  font: 400 14px/1.6 system-ui, sans-serif;
}

.np progress {
  width: min(320px, 78vw);
  height: 9px;
  border: none;
  border-radius: 999px;
  /* @mechanism 槽就是元素自己的背景，不需要再挑伪元素 */
  background: rgb(60 48 30 / 0.16);
  /* @mechanism 让填充跟着父级的圆角走，只能靠裁切 */
  overflow: hidden;
  /* @mechanism 不写这行，移动端 Safari 会盖掉上面所有样式 */
  appearance: none;
}

.np progress::-webkit-progress-bar {
  background: transparent;
}

/* @mechanism WebKit 系的填充是 ::-webkit-progress-value */
.np progress::-webkit-progress-value {
  background: linear-gradient(90deg, #d9a441, #b4462f);
}

/* @mechanism Firefox 是另一套伪元素，两家必须各写一遍 */
.np progress::-moz-progress-bar {
  background: linear-gradient(90deg, #d9a441, #b4462f);
}
```

```js
const bar = document.getElementById('sb-np')

document.getElementById('sb-np-toggle').addEventListener('click', () => {
  // @mechanism 去掉 value 属性，元素就进入 :indeterminate —— 语义和外观一起变
  if (bar.hasAttribute('value')) bar.removeAttribute('value')
  else bar.value = 42
})
```

## 边界

- 两家引擎的伪元素名字不同且无法合并。只写 WebKit 那套，Firefox 上会退回系统默认外观——颜色没生效但元素还在，很容易以为「样式写对了」。
- 去掉 `value` 要用 `removeAttribute`。把它设成 `null` 或空串，在部分引擎上会被当成 0，现象是「本该不确定的条显示成一根空条」。
- `overflow: hidden` 是让填充跟随圆角的唯一办法（伪元素不吃父级的圆角）。少了它，填充会溢出成直角，看起来像「圆角没做干净」。
- `appearance: none` 不能省，尤其移动端；省了以后你设的 `height`、`background`、`border-radius` 会被系统外观整体替换。
- 不确定态的位移动画得自己写。给 `::-webkit-progress-value` 挂 `animation` 各家行为不一致，别指望原生 `<progress>` 自带好看的循环动画。
- 只画色条不写文本：进度没有文字时，读屏只报百分比。关键任务上应另配可见的数值或状态文字。

## 备注

- `<meter>` 的伪元素写法几乎一样，但语义是三段量级（低 / 优 / 高），别拿它当进度条用。
- 只在真的有值时写 `value`。不确定时留空，比编一个数字诚实——这正好和原生元素的默认行为一致。
