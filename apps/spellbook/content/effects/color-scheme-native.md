---
title: 让浏览器自己画的东西也变暗
slug: color-scheme-native
category: 材质
tags: [color-scheme, light-dark, 表单, 输入]
since: 2026-10
source: 机制来自 CSS Color Adjustment 的 color-scheme 属性，自行实现
when: 页面已经是暗色了，但滚动条、下拉框、日期选择器还是白的
stage: dark
tier: core
---

## 描述

页面背景是暗的，可滚动条、下拉框的弹层、日期选择器、以及文本框的自动填充底色仍然是白的——那些部分根本不是你的 CSS 画的，是浏览器画的。

机制是 ==`color-scheme` 切换的是「浏览器自己那套默认渲染」，不是你的样式==。写了 `color-scheme: dark` 之后，浏览器会用它自己的暗色主题去画滚动条、`<select>` 的弹出层、`<input type="date">` 的日历、以及自动填充的背景；同时把 `prefers-color-scheme` 的解析结果也顺着改为 `dark`，于是你在媒体查询里写的那一套与原生控件就一致了。

它**不会**改变你自己设的背景色——`body` 的 `background` 仍然要自己写。这条属性管的是「你画不到的地方」，两边要各自交代清楚，否则会出现「页面是暗的，但滚动条是亮的」这种半吊子状态。

## 代码

```html
<meta name="color-scheme" content="dark light">

<div class="pane">
  <input type="date">
  <select><option>下拉框的弹层也归浏览器画</option></select>
  <input type="text" placeholder="自动填充的底色也归浏览器画">
</div>
```

```css
:root {
  /* @mechanism 声明两套都支持：暗色优先，但亮色下原生控件也会正确取亮色 */
  color-scheme: dark light;
}

body {
  /* @mechanism color-scheme 不管页面自己的底色，这一行不能省 */
  background: #14101a;
  color: #f0ead9;
  font: 400 14px/1.6 system-ui, sans-serif;
}

.pane { display: grid; gap: 8px; width: 260px; padding: 16px; }
```

## 边界

- `<meta name="color-scheme">` 与 `color-scheme` 属性不是同一件事的两处写法，而是**时序**上的分工：`<meta>` 在 HTML 解析早期生效，避免首屏那一下白闪；CSS 里的那条在样式表就绪后才生效。只写 CSS 而不写 `<meta>`，暗色页面加载瞬间会闪一帧白。
- 写了 `color-scheme: dark` 却把 `body` 背景留空，得到的是「浏览器默认的暗色背景」而不是你的暗色——它和你的设计色往往不是同一个黑，页面上会出现两块拼接的黑。
- `color-scheme: light dark` 表示「两套都支持，按用户偏好挑」，不是「同时应用」。想让页面跟随系统走，还得在 `prefers-color-scheme` 里写你自己的颜色变量。
- 滚动条只在**覆盖式**滚动条的系统上才明显变化（macOS 默认不常驻）。Windows 上写不写 `color-scheme`，滚动条颜色差别很大——这是这条属性最容易被当成「没用」的原因。
- 第三方嵌入的内容（`<iframe>`、第三方日期组件）不受这条影响，它们有自己的文档与自己的 `color-scheme`。
