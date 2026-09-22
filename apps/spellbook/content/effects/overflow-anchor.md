---
title: 上面变了，位置不动
slug: overflow-anchor
category: 布局
tags: [scroll-anchor, overflow, 容器, 滚动]
since: 2026-10
source: 机制来自 CSS Scroll Anchoring 规范的 overflow-anchor，自行实现
when: 滚动位置上方的内容异步变高了（图片加载、插进一条新内容），视口不该跟着往下跳
stage: plain
tier: candidate
---

## 描述

你正在读页面中间的一段，上方异步插进来一块新内容，把下面的整体推下去——但视线里的那一段没有动。

机制是 ==浏览器在滚动容器里挑一个锚点元素，上方内容改变尺寸时按它的位移补偿滚动位置，让它相对视口不动==。这条机制默认就是开着的（`overflow-anchor: auto`），所以多数时候你根本不用写它。它和 `aspect-ratio` 预留高度是两种不同的对策：预留高度是**预防**尺寸变化，滚动锚定是变化已经发生之后的**补偿**；前者做不干净的地方（内容高度真的无法预知）就靠后者兜住。

正因为默认开启，这条属性的实际用途是**排除**：某个元素的变化（轮播切换、广告位伸缩、折叠面板展开）总把锚定带偏时，用 `overflow-anchor: none` 把它从候选里摘出去。锚点是谁由浏览器决定，你没法指定——只能否掉捣乱的那一个。

## 代码

```html
<!-- @mechanism 两个容器内容与滚动位置完全相同，差别只有 overflow-anchor 一个开关 -->
<div class="panes">
  <section class="pane">
    <h4>锚定开着（默认）</h4>
    <div class="pane-scroll" id="pane-a">
      <p>上面已经有一小段内容，先往下滚一点才看得清对照。</p>
      <p>滚动位置先滚到中间，这一段就是接下来要盯住的锚点。</p>
      <p>我正在读这一段：上方插入内容时，它不该从眼前跳走。</p>
      <p>下面还留着一些内容，这样容器才有可滚动的余量。</p>
      <p>最后一段。</p>
    </div>
  </section>
  <section class="pane">
    <h4>锚定关掉</h4>
    <div class="pane-scroll no-anchor" id="pane-b">
      <p>上面已经有一小段内容，先往下滚一点才看得清对照。</p>
      <p>滚动位置先滚到中间，这一段就是接下来要盯住的锚点。</p>
      <p>同一段话。这里上方插入内容，整块内容会往下跳。</p>
      <p>下面还留着一些内容，这样容器才有可滚动的余量。</p>
      <p>最后一段。</p>
    </div>
  </section>
</div>
```

```css
.panes {
  display: flex;
  gap: 12px;
  padding: 12px;
  width: min(400px, 88vw);
  background: rgb(255 255 255 / 0.5);
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 400 12px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.pane {
  flex: 1;
  min-width: 0;
}

.pane h4 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
}

.pane-scroll {
  /* @mechanism 锚定要有一个滚动视口才谈得上「相对视口不动」 */
  block-size: 112px;
  overflow-y: auto;
  padding: 8px 10px;
  border: 1px solid rgb(60 48 30 / 0.2);
  background: rgb(255 255 255 / 0.6);
}

.pane-scroll p {
  margin: 0 0 8px;
}

.no-anchor {
  /* @mechanism none 让这个容器退出锚定：上方内容变高时滚动量不再被补偿 */
  overflow-anchor: none;
}

.inserted {
  padding: 6px 8px;
  border: 1px dashed rgb(180 70 47 / 0.55);
  background: rgb(180 70 47 / 0.14);
  color: #b4462f;
}
```

```js
const panes = ['#pane-a', '#pane-b'].map((sel) => document.querySelector(sel))

// @mechanism 两个容器先滚到同一位置，唯一的变量只剩锚定开关
panes.forEach((el) => {
  el.scrollTop = 60
})

// @mechanism 在滚动位置上方插入内容：锚定会补上这段高度，视口内容不动；关掉则不补
setTimeout(() => {
  panes.forEach((el) => {
    const block = document.createElement('p')
    block.className = 'inserted'
    block.textContent = '↑ 后插入的一段，把下面的内容整体往下推'
    el.prepend(block)
  })
}, 1400)
```

## 边界

- Safari 没有实现滚动锚定，也不认 `overflow-anchor`。同一份代码在 Chrome 上不跳、在 Safari 上照跳，所以它不能单独充当稳定性方案——预留尺寸（`aspect-ratio`、占位高度）那一路仍然要写。
- 它补偿的是**滚动偏移**，不是布局。内容确实变高了、后面的内容确实被推下去了，只是视口跟着补偿过去。任何自己缓存的 `offsetTop` / 滚动进度计算仍然会失效。
- 锚点由浏览器挑，`overflow-anchor: none` 只能**排除候选**，不能指定谁当锚点。要让某一块稳定，做法是在它上方那个易变元素上写 `none`，而不是给目标写点什么。
- 用户正在拖动滚动或惯性滑动时锚定会被临时抑制（浏览器不跟用户抢视口），程序化设置 `scrollTop` 后的头一帧也可能不补偿。现象是「有时候跳、有时候不跳」。
- 已经滚到顶部（`scrollTop: 0`）或内容不足以滚动时没有可补偿的余地，这条机制不会带来任何变化——验证前必须先往下滚一段。
- 变化发生在**视口下方**时不参与：要保的是可视内容不动，在底部追加内容不会触发锚定。

## 备注

- 与 `scroll-behavior: smooth` 共存时，锚定的补偿是瞬时的位置调整，不会触发平滑动画，也不会打断用户正在看的内容。
- 动态列表的稳妥组合：先给可变内容预留尺寸（`aspect-ratio` / 占位骨架），再用锚定兜住那些没能预料到的尺寸变化。
