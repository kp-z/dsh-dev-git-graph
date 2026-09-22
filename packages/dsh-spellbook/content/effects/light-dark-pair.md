---
title: 一处写两个颜色
slug: light-dark-pair
category: 材质
tags: [light-dark, color-scheme, 卡片, 切换]
since: 2026-10
source: 机制来自 CSS Color Level 5 的 light-dark()，自行实现
when: 同一套组件要在明暗两种配色下都对，但不想把每条规则写两遍
stage: plain
tier: core
---

## 描述

按一下按钮，整块面板从浅底深字翻成深底浅字，连原生控件的滚动条和输入框底色一起换了——而每一种颜色在样式里只声明了一次。

机制是 ==light-dark(a, b) 按元素当前生效的 color-scheme 在两个颜色里挑一个==。`color-scheme` 本来只是一句「浏览器你自己那套默认渲染该用哪一版」的开关（滚动条、原生控件、自动填充底色），`light-dark()` 把它复用成了选色的依据：同一个声明在两套配色下取到不同的值，于是既不用写 `@media (prefers-color-scheme)` 把整块规则抄一遍，也不用在 `:root` 上维护两套变量名再逐条引用。

它比媒体查询多出的一件事是「看谁说话」：媒体查询只读系统偏好，而 `light-dark()` 读的是元素**实际生效的** `color-scheme` 计算值。所以手动切换也能带动它——在祖先上写一句 `color-scheme: dark`，整棵子树的 `light-dark()` 立刻改口。这也是它和「加一个 `.dark` 类再写一遍规则」的根本区别：切换的是一条声明，不是一个类名，样式表里没有第二份副本可供走样。

两个颜色是设计选择，`color-scheme` 写在哪一层也是：写在 `:root` 上是「跟随系统、并且允许手动覆盖」，写在某个组件上是「这块跟着配色的变化走」。示例用了脚本改根元素的行内 `color-scheme` 来手动切换——注意脚本改的必须是这条属性，改类名对它毫无影响。两个色值建议都取中性偏暖的一对，这样在暗色下不会显脏，在亮色下也不会发灰。

## 代码

```html
<div class="ld">
  <button class="ld-btn" type="button">切换配色</button>
  <div class="ld-card">
    <h3 class="ld-title">一份声明，两种配色</h3>
    <p class="ld-text">卡片上的每个颜色都写在 light-dark() 里。</p>
    <label class="ld-row">滑杆 <input type="range" min="0" max="100" value="64"></label>
  </div>
</div>
```

```css
:root {
  /* @mechanism 两个值都允许，light-dark() 才有得挑；切换只需要动这一条 */
  color-scheme: light dark;
}

.ld {
  font: 400 15px/1.7 system-ui, sans-serif;
}

.ld-btn {
  margin-bottom: 14px;
  padding: 8px 18px;
  border: 1px solid light-dark(rgb(60 48 30 / 0.3), rgb(255 255 255 / 0.2));
  border-radius: 999px;
  background: light-dark(rgb(255 255 255 / 0.7), rgb(255 255 255 / 0.08));
  font: inherit;
  color: light-dark(#1b1710, #f0ead9);
  cursor: pointer;
}

.ld-card {
  width: min(340px, 84vw);
  padding: 20px 22px;
  border-radius: 16px;
  /* @mechanism 同一个声明按当前 color-scheme 取不同值，不必写两遍规则 */
  background: light-dark(#fdfaf4, #241d2e);
  color: light-dark(#1b1710, #f0ead9);
  border: 1px solid light-dark(rgb(60 48 30 / 0.18), rgb(255 255 255 / 0.16));
  box-shadow: 0 16px 34px light-dark(rgb(60 48 30 / 0.16), rgb(0 0 0 / 0.5));
}

.ld-title {
  margin: 0 0 8px;
  font-size: 17px;
}

.ld-text {
  margin: 0 0 14px;
  color: light-dark(rgb(27 23 16 / 0.7), rgb(240 234 217 / 0.72));
}

.ld-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
```

```js
const root = document.documentElement
const btn = stage.querySelector('.ld-btn')

// @mechanism 手动切换改的是 color-scheme 这一条属性，所有 light-dark() 一起改口
btn.addEventListener('click', () => {
  root.style.colorScheme = root.style.colorScheme === 'dark' ? 'light' : 'dark'
})
```

## 边界

- 必须先在祖先上允许两种配色（`color-scheme: light dark`）。只写 `color-scheme: dark` 时两个值里永远取第二个，切换按钮看起来完全没反应——最常见的原因不是 `light-dark()` 坏了，而是它没被问到问题。
- 它只能产出颜色。图片、阴影参数、布局差异、字体粗细这些它管不了，那些仍然要靠 `@media (prefers-color-scheme)` 或自定义属性。
- 它不读系统偏好本身，读的是 `color-scheme` 的计算值。「自动跟随系统」这件事仍由 `color-scheme: light dark` 与浏览器完成的映射提供，只是你不再需要为此重复写样式。
- 老引擎不认识这个函数时，那条声明**整条失效**（不是退回第一个颜色），颜色落回继承值。稳妥的写法是前面先给一条普通声明兜底：`color: #1b1710; color: light-dark(#1b1710, #f4efe6);`
- 它与原生控件共用同一个开关：改 `color-scheme` 会同时带动滚动条、`<select>` 弹层、日期选择器的明暗。这通常是好事，但别在同一个元素上把控件颜色写死，那样两边会打架。
- 嵌套时内层可以用自己的 `color-scheme` 局部反转（一块始终深色的胶片区域就是这样做的），代价是那棵子树里的 `light-dark()` 也跟着反向，写之前先确认这是你要的。

## 备注

- 一套暗色主题真正难的不是颜色本身，而是「浏览器画的那些东西」。`color-scheme` 那一半是另一条咒语，两条合起来才是完整的一套。
