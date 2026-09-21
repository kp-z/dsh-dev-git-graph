---
title: 原生顶层弹层
slug: popover-native
category: 交互
tags: [popover, 弹层, 顶层]
since: 2026-09
source: 机制来自 HTML 规范的 popover 属性，自行实现
when: 要一个浮层，但不想处理 z-index、焦点陷阱与点外关闭
stage: dark
tier: candidate
---

## 描述

点按钮弹出一块浮层，点外面或按 Esc 自动关掉——三个属性，零 JS。

机制是 ==popover 属性把元素送进浏览器的「顶层」==。顶层是渲染顺序上独立的一层：它不受任何祖先的 `overflow: hidden` 或 `transform` 裁剪，也不需要 `z-index: 9999` 去压别人。点外关闭、Esc 关闭、焦点归还按钮，都是浏览器给的行为。

## 代码

```html
<button class="po-btn" popovertarget="po-panel">打开浮层</button>

<div id="po-panel" class="po" popover>
  <b>我在顶层</b>
  <p>点外面或按 Esc 会关掉，不用写 JS。</p>
</div>
```

```css
.po-btn {
  padding: 11px 20px;
  border: 1px solid rgb(255 255 255 / 0.24);
  background: rgb(255 255 255 / 0.06);
  font: 500 15px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

.po {
  /* @mechanism 顶层元素：不受祖先裁剪，不需要 z-index */
  width: min(300px, 78vw);
  padding: 18px 20px;
  border: 1px solid rgb(180 70 47 / 0.6);
  background: #1b1626;
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.po b {
  display: block;
  margin-bottom: 6px;
  font-size: 16px;
}

.po p {
  margin: 0;
  opacity: 0.74;
}
```

## 边界

- `popovertarget` 与 `popover` 要配对，靠 `id` 关联。id 写错时**完全没反应**，不报错、不警告，是最常见的坑。
- **旧浏览器不支持时，被标了 `popover` 的元素会直接显示在普通流里**（属性不生效就等于没写），整块内容摊在页面上破坏版面。上线要配 `@supports selector(:popover-open)` 兜底。
- 它进的是浏览器顶层，所以祖先的 `overflow: hidden`、`transform`、`contain` 都管不到它。这既是优点也是意外——它不再受你的布局约束。
- 默认位置是屏幕中间的固定套路，不是跟着按钮。要贴着触发元素就得用 CSS 锚点定位（anchor positioning）或自己测坐标。
- 它是 `display: none` 与 `display: block` 的离散切换，所以默认没有过渡；加动画要配 `transition-behavior: allow-discrete` 与 `@starting-style`。

## 备注

- `popover="manual"` 会去掉点外关闭，适合做常驻面板；默认值 `auto` 才有那套自动关闭行为。
- 同一时间只有一个 `auto` 的 popover 是打开的，打开新的会自动关掉旧的——省掉了手写「点击别处关闭同类浮层」的逻辑。
