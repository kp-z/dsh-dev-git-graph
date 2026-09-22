---
title: 用遮罩画的下拉箭头
slug: select-custom-arrow
category: 交互
tags: [表单, 下拉框, mask]
since: 2026-10
source: 机制来自 CSS mask 属性与内联 SVG，自行实现
when: 下拉框要换掉原生箭头，又不想为了它外挂一张图片或一个图标字体
stage: plain
tier: core
---

## 描述

下拉框右侧换成自己画的小箭头，线条粗细可控，且颜色自动跟着文字走。

机制是 ==mask 把图形当成镂空模板，真正涂上去的是元素的 background，于是箭头颜色可以由 currentColor 决定==。用 `background-image` 塞一张 SVG 也能出箭头，但那张图里的颜色是写死的：文字在白底上是深色、在深色模式里该变浅，图片却不会跟着变，只能准备两份、再用媒体查询切。`mask` 绕开了这个问题——图形只提供形状，颜色来自 `background-color: currentColor`，与文字同源。

`<select>` 本身不适合承载这个箭头，因为它的伪元素在各引擎上支持不一（和 `input` 一样属于替换元素）。所以箭头画在一个包裹层的 `::after` 上：包裹层留出右侧内边距，箭头绝对定位压在留白处，并设 `pointer-events: none` 把点击还给下拉框。

形状本身要选得克制。箭头是高频出现的界面符号，线宽、圆头、尺寸随便变都会显得廉价；把它做成一个和文字同色的 `mask` 图，还顺手解决了「箭头比文字颜色深一档」这个常见的视觉噪音。

## 代码

```html
<!-- @mechanism select 只管数据，箭头由包裹层的伪元素画，互不干扰 -->
<label class="sel-wrap">
  <select class="sel">
    <option>按添加时间</option>
    <option>按名称</option>
    <option>按热度</option>
  </select>
</label>
```

```css
.sel-wrap {
  position: relative;
  display: inline-grid;
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.sel {
  /* @mechanism 关掉原生箭头，右侧留出给自绘箭头的空位 */
  appearance: none;
  padding: 9px 40px 9px 13px;
  border: 1px solid rgb(60 48 30 / 0.35);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.6);
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.sel-wrap::after {
  content: "";
  position: absolute;
  right: 14px;
  top: 50%;
  width: 11px;
  height: 7px;
  translate: 0 -50%;
  /* @mechanism 图形只当镂空模板，涂色交给 background */
  background-color: currentColor;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 11 7'%3E%3Cpath d='M1 1l4.5 4.5L10 1' fill='none' stroke='%23000' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
  /* @mechanism 点击必须穿过箭头落到 select 上 */
  pointer-events: none;
}

.sel:focus-visible {
  outline: 2px solid #b4462f;
  outline-offset: 2px;
}
```

## 边界

- 不支持 `mask` 的老引擎上箭头会整块消失（`background-color` 还在，被裁成不透明方块）。要用 `-webkit-mask` 前缀兜住较旧的 Safari，否则那里会显示成一个色块而不是箭头。
- 箭头必须让点击穿过去。漏掉 `pointer-events: none` 时，点在箭头位置不会展开下拉——而箭头恰好是用户最想点的位置。
- 右侧内边距与箭头的 `right` 是绑定的两个数：加了内边距却没挪箭头，箭头会压到文字上；反过来则会留出一段莫名的空白。
- 原生下拉**弹出后的列表**是操作系统画的，CSS 管不到。能不能给选项加样式、能改到什么程度，各平台差别很大——所以别把设计稿里的自定义选项列表当成能实现的需求。
- `appearance: none` 一并去掉了原生箭头带来的垂直对齐补偿。文字会略微上移，通常要用内边距把它压回来。

## 备注

- 想连深色模式一起覆盖，什么都不用改：箭头读的是 `currentColor`，父级文字颜色一变，它自动跟上。这是 `mask` 相对图片方案最实际的收益。
- 同一个 `mask` 手法可以用来把任何单色图标做成「跟随文字颜色」，包括复选框里的勾与单选钮里的点。
