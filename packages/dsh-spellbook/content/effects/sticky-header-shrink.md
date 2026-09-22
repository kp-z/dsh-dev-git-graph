---
title: 滚动时收缩的表头
slug: sticky-header-shrink
category: 布局
tags: [sticky, scroll-driven, 页头, 滚动]
since: 2026-09
source: 机制来自 position: sticky 与 scroll-driven animations 的组合，自行实现
when: 大表头滚上去之后要缩成一条细条，但不想监听滚动写 JS
stage: dark
tier: candidate
---

## 描述

页面顶上一个大表头，往下滚它就缩成一条窄条并粘在顶部。

机制分两件事：==`position: sticky` 负责粘住，`animation-timeline: scroll()` 负责让它随滚动量收缩==。前者让元素在滚动到边界时留在原位，后者把「滚了多少」变成一个可以驱动动画的进度值。两者合起来就是「粘住并变形」。

以前这套要写滚动监听，现在两行声明。

## 代码

```html
<div class="sk-scroll">
  <header class="sk-head">咒语书</header>
  <p class="sk-body">往下滚，表头会缩起来。再往上滚回去，它又展开。</p>
  <p class="sk-body">这里是一段用来制造滚动空间的内容。</p>
  <p class="sk-body">继续往下。</p>
  <p class="sk-body">到底了。</p>
</div>
```

```css
.sk-scroll {
  width: min(380px, 82vw);
  height: 230px;
  overflow-y: auto;
  background: #0d0a14;
  font: 400 13px/1.8 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.74);
}

.sk-head {
  display: grid;
  place-items: center;
  height: 74px;
  /* @mechanism sticky 负责粘住 */
  position: sticky;
  top: 0;
  z-index: 1;
  background: linear-gradient(150deg, #241d33, #120f1c);
  font: 700 19px/1 system-ui, sans-serif;
  color: #f0ead9;
  border-bottom: 1px solid rgb(180 70 47 / 0.5);
  /* @mechanism 滚动量驱动收缩，不需要 JS */
  animation: sk-shrink linear both;
  animation-timeline: scroll(nearest);
  animation-range: 0 90px;
}

.sk-body {
  margin: 0;
  padding: 16px 18px;
  border-bottom: 1px solid rgb(255 255 255 / 0.06);
}

@keyframes sk-shrink {
  to {
    height: 46px;
    font-size: 15px;
    letter-spacing: 0.08em;
  }
}
```

## 边界

- `position: sticky` 需要一个**滚动的祖先**才会生效。祖先没有滚动条（或 `overflow: visible`）时它就是个普通元素，看起来「完全没生效」。
- `sticky` 会被祖先的 `overflow: hidden` 打断——这一条极常见，因为清理溢出的样式常被随手加上。
- `animation-timeline: scroll(nearest)` 里的 `nearest` 指最近的滚动容器。写成 `root` 就参照整个文档，嵌在页面里的示例会失效。
- `animation-range: 0 90px` 表示「滚动 0 到 90px 之间完成动画」。单位也可以写百分比，但用在滚动距离上时长度更直观。
- `sticky` 与动画同时改 `height` 会引起重排。表头这类小元素可以接受，但别把它用到整屏元素上。
- 滚动驱动的支持面还不宽。不支持时 `animation-timeline` 被忽略，动画会**按时间播一遍**——要配 `@supports` 兜底，否则表头会自己收缩一次。

## 备注

- 把 `height` 换成 `padding` 与 `font-size` 的组合，可以得到更自然的收缩（内容也跟着变小而不是被压扁）。
- 同一机制可以做「滚动到顶部时才出现的返回按钮」「滚过半屏才浮现的工具栏」。
