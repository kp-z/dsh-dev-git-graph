---
title: 跳转链接与它的落点
slug: skip-link-reveal
category: 交互
tags: [跳转链接, 焦点, 键盘]
since: 2026-10
source: 机制来自 CSS transform 移出视口与 tabindex 的顺序焦点模型，自行实现
when: 键盘用户要跳过一整排导航，直接落到正文
stage: plain
tier: core
---

## 描述

按第一个 Tab，页面左上角滑出一条「跳到正文」；按回车之后，焦点真的在正文里，再按 Tab 走到的是正文里的链接。

机制是 ==用 transform 把链接移出视口，而不是 display: none==。「隐藏起来、聚焦才出现」这句话里，隐藏必须是不影响焦点顺序的那种隐藏：`display: none` 与 `visibility: hidden` 的元素都不可聚焦，键盘永远到不了它，这条效果就凭空消失了——而且是静默消失，只有键盘用户会发现。用 transform 只是视觉上挪走，链接仍在焦点顺序里，一聚焦就滑回来。

第二半在落点：==拿到片段的元素要带 tabindex="-1"，让焦点被真正移过去，而不是只把画面滚过去==。现代浏览器确实会把顺序焦点导航的起点挪到锚点上，但读屏是否播报「正文开始」取决于焦点真的落在那；显式给 `tabindex="-1"`（可被脚本聚焦、不进 Tab 顺序）也让「焦点在哪」这件事在测试里可以断言。代价是那个元素会短暂获得焦点，焦点指示的样式要单独设计，别顺手写一句 `outline: none` 把整个键盘用户的方位感关掉。

可变的是入口有几个。跳正文是最基本的，还可以有「跳到导航」「跳到搜索」；放多个时用 `:focus-within` 让整组一起出现，否则按 Tab 走到第二项时第一项已经收回去，鼠标根本点不中。

## 代码

```html
<!-- @mechanism 链接排在所有可聚焦元素之前，并且用 transform 挪走而不是隐藏 -->
<header class="sk-head">
  <a class="sk-link" href="#sb-main">跳到正文</a>
  <nav class="sk-nav">
    <a href="#">首页</a>
    <a href="#">组件</a>
    <a href="#">关于</a>
  </nav>
</header>
<!-- @mechanism 落点带 tabindex="-1"：可被聚焦，但不占用 Tab 顺序 -->
<main class="sk-main" id="sb-main" tabindex="-1">
  <h4>正文从这里开始</h4>
  <p>按 Tab 时，先出现的是左上角那条跳转链接。</p>
</main>
```

```css
.sk-head,
.sk-main {
  width: min(380px, 86vw);
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #1b1710;
}
/* @mechanism 用 transform 移出视口：链接仍留在焦点顺序里，display:none 会让它永远无法被聚焦 */
.sk-link {
  position: absolute;
  z-index: 5;
  padding: 9px 14px;
  border-radius: 0 0 8px 0;
  background: #b4462f;
  color: #fff;
  text-decoration: none;
  transform: translateY(-130%);
  transition: transform 0.18s;
}
.sk-link:focus-visible {
  transform: none;
}
.sk-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.sk-nav a {
  color: rgb(27 23 16 / 0.6);
  text-decoration: none;
}
/* @mechanism 落点要看得见焦点，否则用户不知道「跳过去了」这件事发生了 */
.sk-main:focus-visible {
  outline: 2px solid #b4462f;
  outline-offset: 5px;
}
.sk-main h4 {
  margin: 0 0 6px;
  font-size: 14px;
}
.sk-main p {
  margin: 0;
  opacity: 0.72;
}
```

```js
const link = document.querySelector('.sk-link')

link.addEventListener('click', () => {
  const target = document.getElementById(link.getAttribute('href').slice(1))
  // @mechanism 只滚动不聚焦的落点，读屏不播报；补一次 focus 把焦点真的交过去
  if (target) target.focus({ preventScroll: true })
})
```

## 边界

- 隐藏一旦写成 `display: none` 或 `visibility: hidden`，链接不可聚焦，Tab 直接跳过——效果彻底不存在，且没有任何报错或视觉异常，只有键盘用户能发现。
- `opacity: 0` 是另一种常见的错法：可聚焦、可被读屏读到，但一条看不见的链接会让视力正常的键盘用户困惑。移出视口兼顾两者。
- 落点没有 `tabindex="-1"` 时，浏览器只负责滚过去；顺序焦点导航的起点会移动，但读屏不一定播报，测试里也无法断言「焦点在正文上」。
- 给落点加了 `tabindex="-1"` 之后，为了去掉点击时的框而写 `outline: none`，会让键盘用户完全丢失焦点指示。用 `:focus-visible` 精确控制，或改成 `box-shadow` 之类不占布局的指示。
- 链接必须排在**所有可聚焦元素之前**。放到 header 末尾等于让用户先 Tab 过整个导航才能用它，功能还在，意义没了。
- 多个入口要放在同一个容器里并用 `:focus-within` 让整组一起显示；散落在 header 各处时，鼠标想点第二项，第一项已经收回去。
- 这套只解决「跳过」。落点之后的内容顺序仍要是对的：跳过去发现正文前还有一大段推广位，等于白跳。
- 沙箱 iframe（无 `allow-same-origin`）里片段跳转仍可用，但跨域/`srcdoc` 场景下行为会随宿主实现变化；这条效果的验收方式必须是真按键盘，不能靠看截图。

## 备注

- 同一机制可做「跳到搜索」「跳到页脚」「跳到表单」，以及长表单里的「跳到第一个错误项」。
- 无障碍巡检的第一项通常就是它：新开页面按一次 Tab，看有没有东西出现。
