---
title: 声明式锚点定位
slug: anchor-position
category: 布局
tags: [anchor-position, 提示, 浮层]
since: 2026-09
source: 机制来自 CSS Anchor Positioning 规范，自行实现
when: 提示气泡要贴住触发它的那个元素，而且放不下时要自动翻到另一边
stage: dark
tier: candidate
---

## 描述

提示气泡贴住按钮的右下角，靠边时自动翻到另一侧——定位这件事第一次不需要 JS 算坐标。

机制是 ==给触发元素起一个锚名，浮层用 anchor() 引用它的边==。`anchor(bottom)` 的含义是「那个元素的下边缘」，浮层不是在说「我在 (128, 340)」，而是在说「我的上边贴住它的下边」。位置关系变成声明式的，浏览器负责解算。

`position-try-fallbacks` 是这个机制真正的价值：溢出时自动换边，自己写要几百行。

## 代码

```html
<div class="ap-row">
  <button class="ap-btn">触发器</button>
  <div class="ap-tip">我贴住它</div>
</div>
```

```css
.ap-row {
  position: relative;
  display: flex;
  justify-content: center;
  width: min(360px, 80vw);
  height: 170px;
  padding-top: 40px;
}

.ap-btn {
  /* @mechanism 给元素起锚名，浮层就能引用它的边 */
  anchor-name: --ap-trigger;
  align-self: flex-start;
  padding: 11px 20px;
  border: 1px solid rgb(255 255 255 / 0.22);
  background: rgb(255 255 255 / 0.07);
  font: 500 14px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

.ap-tip {
  /* @mechanism 用锚点的边定位，而不是算出来的坐标 */
  position: absolute;
  position-anchor: --ap-trigger;
  top: anchor(bottom);
  left: anchor(left);
  margin-top: 10px;
  /* @mechanism 放不下时自动翻到另一侧 */
  position-try-fallbacks: flip-block;
  padding: 9px 14px;
  border: 1px solid rgb(180 70 47 / 0.55);
  background: #1b1626;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #f0ead9;
  white-space: nowrap;
}
```

## 边界

- 支持面还窄。不支持的浏览器会把 `anchor-name` 当未知属性忽略，浮层**掉回原来的定位**（这里是 `position: relative` 的行内位置）——必须给它一个合理的默认落脚点。
- `anchor(bottom)` 引用的是锚点的**边**，不是坐标或偏移量。它和 `bottom: 10px` 的语义完全不同，混起来会调不明白。
- 锚点元素被移除时引用立即失效，浮层会回到默认位置。所以默认位置要能看，别把它当成「不会发生的情况」。
- 它不改变裁剪行为：浮层若在某个 `overflow: hidden` 的祖先里，照样会被裁掉。（`popover` 走顶层，不受这个限制。）
- `position-try-fallbacks` 需要配合 `position-try-order` 或默认的空间判断才有效果；只写它、侧向空间又够的话，是看不出作用的。

## 备注

- 它和 `popover` 是天然一对：`popover` 负责顶层与关闭行为，锚点定位负责贴住触发元素。
- 多锚点（浮层同时引用两个元素的边）是规范里更进阶的用法，做「在两点之间画一条连线」这类界面才需要。
