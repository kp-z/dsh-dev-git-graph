---
title: 强制颜色模式下还能看
slug: forced-colors-system-keywords
category: 交互
tags: [color-scheme, 按钮, 提示]
since: 2026-10
source: 机制来自 CSS Color Adjustment 的强制颜色模式与系统色关键字，自行实现
when: 用户开了 Windows 高对比度之类的强制配色，页面不能变成一片糊
stage: plain
tier: core
---

## 描述

用户开启了系统级的强制配色之后，页面上的品牌色全部被替换成系统调色板里的颜色。用系统色关键字写的地方看起来仍然正确，用固定色号写的地方可能变成白底白字。

机制是 ==强制颜色模式下浏览器**覆盖**你的颜色值，只有系统色关键字能在这场替换里存活==。`color: CanvasText` 这类关键字不表示一个具体色号，而表示「当前配色方案里承担这个角色的颜色」，所以在任何配色方案下都成立。这就把「我挑了 #333」换成了「我要的是正文色」——意图而不是数值。

这条模式下手写的 `box-shadow` 会被整个移除（系统配色里没有阴影这个角色），于是「靠阴影区分层级」的地方会突然失去边界。替代品是 `border` 或 `outline`：轮廓是系统有的角色，会被保留并按配色重绘。

## 代码

```html
<button class="btn">主按钮</button>
<p class="note">提示文字</p>
```

```css
.btn {
  padding: 9px 20px;
  border: 1px solid #d9a441;
  border-radius: 6px;
  /* @mechanism 系统色关键字在任何配色方案下都成立，不会被强制替换掉 */
  background: ButtonFace;
  color: ButtonText;
  font: 600 14px/1 system-ui, sans-serif;
}

.note {
  /* @mechanism 阴影在强制颜色下会被移除，所以边界要靠边框表达 */
  border-left: 3px solid #b5705e;
  padding-left: 10px;
  color: GrayText;
}

@media (forced-colors: active) {
  /* @mechanism 强制颜色模式是在替换颜色，不是加滤镜 —— 这里只补回被移除的层次 */
  .btn { border-color: ButtonBorder; }
  .note { border-left-color: CanvasText; }
}
```

## 边界

- 判定条件是 `forced-colors: active`，不是「用户的对比度设置」。高对比度主题可能开启它，也可能不开（取决于浏览器与系统）；反过来，它也可能在没开高对比度时被别的辅助工具打开。二者不是同一件事。
- 这条模式**覆盖**颜色而不是叠加滤镜：你的 `background: #14101a` 会被直接换成系统背景色。所以「深色设计在强制颜色下变亮」是正常的，不是 bug——能保住的是对比关系，不是配色。
- `box-shadow`、`text-shadow`、背景图里的颜色会被移除或替换，靠它们表达的信息会丢。用背景图拼出来的图标在强制颜色下要能退化成纯文字或 `currentColor` 的矢量图。
- `forced-color-adjust: none` 可以让某个元素豁免这场替换，但它同时把「保证可读」的责任全揽回自己身上——豁免之后你的暗色卡片在浅色系统主题下就是一块黑。只在确有必要（比如色板选择器必须显示真实颜色）时才用。
- 系统色关键字在**非**强制颜色模式下也有定义（取自浏览器主题），但在普通页面里它们通常不是你想要的样子。同一条规则在两种模式下都生效，靠 `@media` 分档写才是可控的。
