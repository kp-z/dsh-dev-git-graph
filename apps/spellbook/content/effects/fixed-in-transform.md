---
title: 浮层被祖先的变换困住
slug: fixed-in-transform
category: 布局
tags: [固定定位, transform, 包含块]
since: 2026-10
source: 机制来自 CSS 变换规范：非 none 的 transform 让元素成为绝对与固定定位后代的包含块，自行实现
when: 浮层写在卡片组件内部，结果它相对卡片定位而不是视口
stage: plain
tier: core
---

## 描述

同一个 `position: fixed` 的浮层，挂在页面根下时钉在视口的角上；跟着组件一起被搬进一张带 `transform` 的卡片里之后，它开始贴着卡片右下角待着。组件的 markup 没改，只多了一层会做变换的祖先。

机制是 ==非 none 的 transform 会让元素成为固定定位后代的包含块==。`fixed` 的默认包含块是视口，前提是祖先链上没有任何一步建立了自己的坐标系；而变换需要一个可以复合的坐标系，规范于是规定：只要有这一层，后代里所有固定定位都改以它为准。包含块换了，`inset` 的参照物就一起换了——数值一个字没改，位置全变了。

它也解释了「本来好好的，加了 hover 缩放就坏了」：`transform` 只在 hover 时存在，坏也只在那一刻出现。同族的不只 `transform`，`filter`、`backdrop-filter`、`perspective`、`contain: paint`/`layout`、以及 `will-change` 指向它们中的任何一个，都会建立这个包含块。诊断办法是沿祖先链找这些属性，或者看开发者工具里那个 fixed 元素的实际包含块虚线框。

## 代码

```html
<!-- @mechanism 浮层就写在卡片里面，没有额外的定位包裹层 -->
<section class="card" id="card">
  <header>祖先带 transform</header>
  <p>浮层写在卡片内部，它贴着卡片右下角，而不是视口。</p>
  <div class="pop">position: fixed</div>
</section>
<button id="toggle">去掉祖先的 transform</button>
```

```css
.card {
  width: min(320px, 80vw);
  padding: 16px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #f3efe7;
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
  /* @mechanism 只要祖先有变换，它就变成 fixed 后代的包含块 */
  transform: translateZ(0);
}

.card.plain {
  /* 只是把变换撤掉，其他什么都没动 */
  transform: none;
}

.card header { font: 600 15px/1.4 system-ui, sans-serif; }
.card p { margin: 8px 0 0; }

.pop {
  /* @mechanism 参照物是最近的「有变换」的祖先，不是视口 */
  position: fixed;
  inset: auto 12px 12px auto;   /* 贴住那个包含块的右下角 */
  padding: 8px 12px;
  border-radius: 8px;
  background: #2f2a24;
  color: #f6f3ee;
  font: 500 13px/1.4 system-ui, sans-serif;
}

button {
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid rgb(60 48 30 / 0.4);
  border-radius: 8px;
  background: #fffdf9;
  font: 400 14px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}
```

```js
const card = document.getElementById('card')
const toggle = document.getElementById('toggle')

toggle.addEventListener('click', () => {
  // @mechanism 只撤掉变换：fixed 的包含块立刻从卡片换回视口
  const detached = card.classList.toggle('plain')
  toggle.textContent = detached ? '装回祖先的 transform' : '去掉祖先的 transform'
})
```

## 边界

- 症状不是报错，而是「浮层跑进卡片里」。用 `inset` 相对卡片定死之后看起来还挺正常，所以很难第一时间怀疑到祖先的变换上。
- 只有 `transform: none` 才算没有；`translate(0)`、`scale(1)` 一样建立包含块。为了「开启 GPU 加速」随手加的 `translateZ(0)` 是重灾区。
- `container-type: inline-size` 会带来 layout containment，按规范同样让元素成为 fixed 后代的包含块（各浏览器对这条的落实历史上有过出入）。`contain: paint` / `layout` / `strict` 同理。
- 换了包含块的还有 `position: absolute`：同一个祖先也是绝对定位后代的包含块，所以「父元素没写 position 却对齐了」也可能是变换干的。
- 浮层要被祖先裁剪时，这个包含块还会和 `overflow` 叠加：贴卡片右下角 + 卡片裁溢出，浮层探出去的部分直接消失。

## 备注

- 组件内部要放「真正贴视口」的浮层，正路是顶层机制：`popover` 与 `dialog.showModal()` 的元素不参与祖先的包含块链，也不受裁剪影响。
- 该不该让祖先有变换，是性能与布局的取舍：变换能省一次重排，代价是后代的定位参照被改写。把变换限制在没有浮层的子树里最省心。
