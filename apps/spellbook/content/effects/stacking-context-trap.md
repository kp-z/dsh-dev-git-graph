---
title: 被层叠上下文困住的 z-index
slug: stacking-context-trap
category: 布局
tags: [层叠上下文, z-index, 定位]
since: 2026-10
source: 机制来自 CSS 定位规范的层叠上下文与绘制顺序，自行实现
when: 下拉菜单的 z-index 已经写到 9999，还是被隔壁卡片盖住
stage: plain
tier: core
---

## 描述

两张并排的卡片，A 里的菜单写着 `z-index: 9999`，B 只是一张普通卡片，可菜单还是被 B 盖住。把 A 的 z-index 撤成 `auto`，菜单立刻冒出来了——数值没动，动的是「谁建立了层叠上下文」。

机制是 ==z-index 只在同一个层叠上下文内部比较，祖先一旦建立上下文，子元素就再也越不过它的兄弟==。绘制顺序是树状的：每个层叠上下文先把内部整套画完，再作为**一个整体**去参与父级的排序。A 的 `z-index` 决定的是「A 这个整体」的位置，菜单的 9999 只在 A 内部有效。所以只要 A 在父级里排在 B 下面，A 里面写多大的数字都出不来——z-index 从来不是全局排名。

真正要记的清单是「什么会建立层叠上下文」：定位元素配非 auto 的 `z-index`、`opacity` 小于 1、`transform`、`filter`、`backdrop-filter`、`isolation: isolate`、非 normal 的 `mix-blend-mode`、`contain: paint`、`container-type`、以及弹性或网格项上非 auto 的 `z-index`。给卡片加淡入动画、加圆角遮罩、加 `will-change`，都会顺手把里面的弹层关进一个新上下文里。修复落在共同祖先那一层：抬高整个 A，或者把菜单挪出这个上下文。

## 代码

```html
<!-- @mechanism 两张卡片各自建立了层叠上下文，菜单的数值只在 A 内部有效 -->
<div class="row">
  <section class="card a">
    <b>卡片 A</b>
    <div class="menu">z-index: 9999</div>
  </section>
  <section class="card b">
    <b>卡片 B</b>
  </section>
</div>
<button id="flat">把 A 的 z-index 撤成 auto</button>
```

```css
.row {
  display: flex;
  gap: 10px;
  width: min(400px, 84vw);
}

.card {
  position: relative;
  /* @mechanism 定位 + 非 auto 的 z-index：卡片自己成了一个层叠上下文 */
  z-index: 1;
  flex: 1;
  padding: 12px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #f3efe7;          /* 不透明，才看得清遮挡 */
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.card.flat {
  /* 不再建立上下文，A 里的定位子元素回到根上下文里排序 */
  z-index: auto;
}

.menu {
  position: absolute;
  /* @mechanism 9999 只在卡片 A 的上下文内部排序，越不过 B */
  z-index: 9999;
  top: 36px;
  left: 30px;
  width: 210px;
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.4);
  background: #efe9dd;
  box-shadow: 0 10px 24px rgb(0 0 0 / 0.18);
  font: 400 13px/1.5 system-ui, sans-serif;
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
const cardA = document.querySelector('.a')
const btn = document.getElementById('flat')

btn.addEventListener('click', () => {
  // @mechanism 只把 z-index 撤成 auto：A 不再是层叠上下文，菜单回到根上下文里比大小
  const flat = cardA.classList.toggle('flat')
  btn.textContent = flat ? '装回 A 的 z-index: 1' : '把 A 的 z-index 撤成 auto'
})
```

## 边界

- 跨上下文时，比较的是祖先的 `z-index`，不是自己的。给菜单继续加零只会在自家上下文里越排越前，对外面毫无影响——这是最典型的白费功夫。
- 同一个上下文里 `z-index` 相等时按文档顺序绘制，后写的在上；只有数值不同才按数值排。所以「我写在后面」本身也能制造遮挡，和 z-index 大小无关。
- 建立上下文的条件很多而且不显眼：`opacity: 0.999`、`filter: blur(0)`、`transform: translateZ(0)`、`mix-blend-mode`、`contain: paint`、`container-type`，以及弹性/网格项上非 auto 的 `z-index`。加动画时最容易顺手造出一个。
- 修在共同祖先那层才有用。如果共同祖先本身也被更上层的上下文困住，得继续往上找，直到找到那个真正参与页面级排序的盒子。

## 备注

- 真正需要「永远在最上层」的浮层用 `popover` 或 `dialog` 的顶层（top layer）：它们不参与普通层叠上下文的排序，也不会被任何祖先的上下文困住。
