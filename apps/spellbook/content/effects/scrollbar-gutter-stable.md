---
title: 给滚动条预留位置
slug: scrollbar-gutter-stable
category: 布局
tags: [scrollbar, overflow, 容器]
since: 2026-10
source: 机制来自 CSS Overflow 的 scrollbar-gutter，自行实现
when: 页面从短变长时，内容因为滚动条出现而整体向左跳一下
stage: plain
tier: core
---

## 描述

内容少的页面与内容多的页面，正文的左边界在同一个位置——滚动条出现时不会把内容挤得跳一下。

机制是 ==`scrollbar-gutter: stable` 让浏览器**始终**为滚动条留出那条空间，不管此刻有没有滚动条==。滚动条出现与否取决于内容长度，而内容长度会随加载、筛选、展开而变化，所以「有没有滚动条」是一个会变的状态。留出固定空间就把这个变量消掉了：不需要滚动条时那里是一条空带，需要时滚动条正好填进去。

用 `overflow: hidden` 也能消掉跳动，但代价是内容被裁掉。`scrollbar-gutter` 是「留着位置不用」，两者不是一回事。它还有个附带效果：接上 `overflow-y: auto` 之后，滚动条的出现不再引起重排（因为宽度早就让出来了），长列表的滚动性能也会略好。

## 代码

```html
<div class="scroller">
  <p>内容一开始很短，没有滚动条。</p>
  <button onclick="this.previousElementSibling.textContent += ' 再补一段很长的文字，直到超过容器高度为止。'">加内容</button>
</div>
```

```css
.scroller {
  width: min(420px, 90%);
  height: 140px;
  padding: 14px;
  border: 1px solid #d8cfc0;
  min-height: 0;
  overflow-y: auto;
  /* @mechanism 无论有没有滚动条，这条空间都留着，内容因此不会跳 */
  scrollbar-gutter: stable;
  font: 400 14px/1.8 system-ui, sans-serif;
}
```

## 边界

- 只在**经典占位式滚动条**的系统上有可见效果。macOS 默认的覆盖式滚动条宽度是 0，`stable` 什么也不留，看起来「没生效」——这不是写错了，是那套系统本来就不占位。
- 它给**滚动容器自己**留位，不是给页面留位。页面级的跳动要把规则加在 `html` 或 `body` 上（并确认它们确实是滚动容器，而不是某个内层 div 在滚）。
- 居中的版式里单侧留位会把内容推偏半个滚动条宽。这种布局要用 `scrollbar-gutter: stable both-edges`，两侧各留一条，居中关系才保住。
- 与「打开浮层时锁滚动」配合时要小心：锁滚动通常给 `html` 加 `padding-right` 补偿滚动条宽度，而 `stable` 已经把那条空间留住了，再补一次会多出一条白边。两者只能选一个，或者把补偿量减掉已预留的部分。
- 预留的空间永远看不出内容，所以这几十像素在窄屏上就是纯损失。移动端（无占位滚动条）不受影响，但平板与桌面窄窗口会白丢一小条。
