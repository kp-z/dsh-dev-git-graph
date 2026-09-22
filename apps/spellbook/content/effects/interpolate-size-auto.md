---
title: 过渡到 auto 高度
slug: interpolate-size-auto
category: 动效
tags: [高度, 关键字, 过渡]
since: 2026-10
source: 机制来自 CSS Values and Units Level 5 的 interpolate-size，自行实现
when: 折叠面板要平滑展开，可高度由内容决定，两端写不出数值
stage: plain
tier: candidate
params:
  - { name: dur, label: 展开用时, type: range, min: 0.1, max: 1.5, step: 0.1, default: 0.4, unit: s }
---

## 描述

一块面板按一下展开、再按一下收起，高度平滑地长出来——而它展开后有多高，写样式的时候根本不知道。

机制是 ==interpolate-size 允许 auto 这类内在尺寸关键字参与插值==。默认情况下 `auto`、`min-content`、`max-content` 都是**关键字**而不是数值：浏览器拿到 `0` 和 `auto`，算不出「中间应该是几像素」，于是 `transition: height` 直接不作数，值一步跳到头。开启之后，关键字会被换算成它实际用到的尺寸再参与插值，`0 → auto` 之间就有了连续的一串中间态。

这条属性只做一件很小的事：把关键字从「不可插值的常量」降级成「可插值的数值」。它不改变布局，`height` 仍然是 `auto`，只是过渡期间浏览器得按内容量出每一帧的高度——所以它同时也是有代价的：动画期间高度每帧重算，下面所有内容每帧重排。这一点决定了它该开在哪一层。

开启的层级和两个端点都是设计选择。它是**继承属性**，写在 `:root` 上等于全站放行关键字插值，从此任何一条顺手写下的 `transition: height` 都会真的动起来，而重排的代价是隐形的；收在要做动画的那棵子树上更稳妥。端点一侧用 `0` 最省事，视觉上像是「贴着地长出来」；另一侧必须是关键字（这里是 `auto`），这才是它存在的理由。时长和缓动按语义挑：折叠这类「结构变化」通常短时长配弱缓动，拖长了会显得面板很重。

## 代码

```html
<div class="ia">
  <button class="ia-btn" type="button" aria-expanded="false">展开</button>
  <div class="ia-panel">
    <p>高度是内容决定的，所以两端写不出数值。</p>
    <p>靠关键字插值，0 与 auto 之间就有了中间态。</p>
    <p>再拖一行进来，目标高度自己就跟着变。</p>
  </div>
</div>
```

```css
.ia {
  width: min(420px, 84vw);
  font: 400 15px/1.75 system-ui, sans-serif;
  color: #1b1710;
}

.ia-btn {
  padding: 9px 20px;
  border: 1px solid rgb(60 48 30 / 0.32);
  border-radius: 999px;
  background: rgb(255 255 255 / 0.65);
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.ia-panel {
  /* @mechanism 只在这一棵子树上放行关键字插值：全站放行会连带出看不见的重排代价 */
  interpolate-size: allow-keywords;
  height: 0;
  overflow: hidden;
  transition: height var(--dur, 0.4s) cubic-bezier(0.22, 0.61, 0.36, 1);
}

.ia.is-open .ia-panel {
  /* @mechanism 关键字端：过渡期间浏览器按内容量出每一帧的高度 */
  height: auto;
}

.ia-panel p {
  margin: 14px 2px 0;
}

.ia-panel p:last-child {
  margin-bottom: 2px;
}
```

```js
const wrap = stage.querySelector('.ia')
const btn = wrap.querySelector('.ia-btn')

// @mechanism 脚本只翻一个状态类，高度交给浏览器自己量
btn.addEventListener('click', () => {
  const open = wrap.classList.toggle('is-open')
  btn.setAttribute('aria-expanded', String(open))
  btn.textContent = open ? '收起' : '展开'
})
```

## 边界

- 只认内在尺寸关键字（`auto` / `min-content` / `max-content` / `fit-content`）。两端都是长度、或一端是父级百分比的情况，可不可插值取决于它们自己，这条属性一概不管。
- 动画期间的高度是**量出来的**。内容在动画中途变化（图片解码完、字体换了、文字重新折行）会让目标高度跳一下，过渡跟着重算，看起来是一次顿挫。
- 它不阻止重排：展开过程中下方内容每帧都在被推动。要在展开时不影响周围布局，得换另一条路（覆盖层配 `transform`，或者让面板脱出文档流）。
- 收起到底之后如果还想让内容彻底不占位（把 `overflow: hidden` 换成 `display: none` 或 `content-visibility: hidden`），那就轮到离散属性过渡，需要 `transition-behavior: allow-discrete` 配合。
- 支持面窄（Chromium 129+ 起）。不支持时整条声明被丢弃，过渡退化成瞬间展开——不报错，只是没有动画；可以包一层 `@supports (interpolate-size: allow-keywords)`，回退到 `grid-template-rows: 0fr → 1fr` 的老办法。

## 备注

- 同一个机制的显式版本是 `calc-size(auto, size + 2rem)`：把关键字直接写进算式，于是「比 auto 再高一点」这种目标也能插值。
- 想给展开设高度上限时，不要回到 `max-height` 那套写法（上限写大了速度就假）；这里的目标高度是真的，不需要猜。
