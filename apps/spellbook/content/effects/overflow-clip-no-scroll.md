---
title: 裁剪但不滚动
slug: overflow-clip-no-scroll
category: 布局
tags: [overflow, 容器, 卡片]
since: 2026-10
source: 机制来自 CSS Overflow 规范的 overflow: clip（不产生滚动容器）与 overflow-clip-margin，自行实现
when: 想裁掉溢出的内容，却不想凭空多出一个滚动容器
stage: plain
tier: core
---

## 描述

两个一模一样的横排，里面的卡片都超出了右边缘 70px。上面那个只是把多出来的裁掉，下面那个也能裁掉，但它悄悄变成了一个滚动容器——在控制台里给它的 `scrollLeft` 赋值，内容真的会滑过去。

机制是 ==overflow: clip 只做裁剪、不产生滚动容器==。`hidden` 和 `clip` 视觉上常常一样，差别在「有没有可滚动区域」：`hidden` 的内容仍可被程序化滚动（`scrollLeft` 能改、`scrollIntoView` 会让它动），并且它因此成为后代的滚动容器——`position: sticky` 的参照、滚动锚定、`scroll-margin` 全都跟着改。`clip` 的元素根本没有可滚动溢出区，内容被硬裁掉，`scrollTop` 永远是 0，后代里也没人多出一个滚动参照。

`clip` 还解开了一个 `hidden` 做不到的组合：一个轴裁、另一个轴照样露出。规范规定 `visible` 与 `hidden` 搭在一起时，`visible` 会被计算成 `auto`（于是长出滚动条），而 `clip` 不在这个替换之列——想「横向裁掉、纵向越界可见」只有它写得出。配套旋钮是 `overflow-clip-margin`，它把裁剪框向外扩一圈，让「越界一点点」的部分留得住。

## 代码

```html
<!-- @mechanism 两个容器里的溢出完全一样，差别只在用 clip 还是 hidden -->
<div class="rails">
  <div class="rail clip">
    <article class="tile">一</article>
    <article class="tile">二</article>
    <article class="tile">三</article>
  </div>
  <div class="rail hide">
    <article class="tile">一</article>
    <article class="tile">二</article>
    <article class="tile">三</article>
  </div>
</div>
<output></output>
```

```css
.rails { display: grid; gap: 14px; }

.rail {
  display: flex;
  gap: 10px;
  width: min(300px, 82vw);
  padding: 10px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.34);
}

.tile {
  flex: 0 0 150px;             /* 三张 150px 只有前两张放得下：溢出是真的 */
  padding: 16px 0;
  text-align: center;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #efe9dd;
  font: 500 14px/1 system-ui, sans-serif;
  color: #1c1a17;
}

.clip {
  /* @mechanism 只裁不滚：没有可滚动区域，也不会成为后代的滚动容器 */
  overflow-x: clip;
  overflow-y: visible;         /* clip 与 visible 是合法组合，hidden 配 visible 会被算成 auto */
}

.hide {
  overflow-x: hidden;          /* 同样裁掉溢出，但它是一个真正的滚动容器 */
}

output {
  display: block;
  font: 400 13px/1.6 ui-monospace, monospace;
  color: #1c1a17;
}
```

```js
const [clipRail, hideRail] = document.querySelectorAll('.rail')
const out = document.querySelector('output')

// @mechanism clip 没有可滚动区域，scrollLeft 改不动；hidden 能滚，只是用户滚不了
clipRail.scrollLeft = 999
hideRail.scrollLeft = 999

out.textContent =
  `overflow: clip → scrollLeft ${clipRail.scrollLeft}；` +
  `overflow: hidden → scrollLeft ${hideRail.scrollLeft}`
```

## 边界

- `overflow-clip-margin` 只在真的走裁剪的那个轴上生效；给一个轴 `visible` 的元素配它，越界方向仍然照常露出。它也不是 padding：裁剪框向外扩，布局尺寸一点不变。
- 与 `hidden` 互换时最常见的翻车是 sticky：把裁剪层从 `hidden` 换成 `clip`，原来「钉不住」的元素会突然开始钉住——因为参照换了。反过来换也一样。
- 用 `clip` 裁掉的内容无法通过滚动访问，键盘焦点却仍然可能落进去。纯装饰性的溢出用它没问题，装了可交互内容的容器要另想办法。
- 这个属性 Safari 16 起才支持。更早的版本上 `overflow-x: clip` 会被整条丢掉，于是溢出干脆不裁也不滚。

## 备注

- 圆角图片、卡片里探出的角标、横向排列的缩略图，凡是「只是不想让它露出来」的场合，都该优先写 `clip`：少一个滚动容器，就少一类 sticky 与锚点跳转的怪事。
