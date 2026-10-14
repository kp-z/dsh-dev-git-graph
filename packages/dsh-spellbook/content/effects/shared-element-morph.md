---
title: 列表到详情的共享元素过渡
slug: shared-element-morph
category: 动效
tags: [view-transition, transition, 卡片, 点击, 列表]
since: 2026-10
source: 机制来自 View Transitions API，自行实现
when: 点列表里的一行，那张小图要「飞出去」变成详情里的大图，而不是整页一闪
stage: dark
tier: candidate
---

## 描述

点一下列表里的一行，那张 44px 的小方片滑出去、放大成详情页整幅的头图；列表的其余部分淡掉，详情文字淡进来。

机制是 ==`startViewTransition()` 在切换前后各截一张快照，**同名的两个元素**被认成同一个东西，于是从旧位置滑到新位置==。

和「布局变化的平滑过渡」那条的区别在**配对靠的是名字，不是 DOM 节点**：旧态里是列表里的小图，新态里是详情里的大图 —— 两个不同的元素，只因为都叫 `sb-hero`，浏览器就把它们当成同一个正在移动的物体。**所以任意一个瞬间，全页只能有一个元素叫这个名字。**

## 代码

```html
<div class="se" id="sb-se">
  <ul class="se-list" id="sb-se-list">
    <li><button class="se-row" data-i="0"><span class="se-thumb" style="--a: #d9a441"></span><span class="se-name">金箔</span></button></li>
    <li><button class="se-row" data-i="1"><span class="se-thumb" style="--a: #b4462f"></span><span class="se-name">锈迹</span></button></li>
    <li><button class="se-row" data-i="2"><span class="se-thumb" style="--a: #5b7f9e"></span><span class="se-name">蓝晒</span></button></li>
  </ul>

  <article class="se-detail" id="sb-se-detail" hidden>
    <span class="se-hero" id="sb-se-hero"></span>
    <h3 class="se-head" id="sb-se-head"></h3>
    <p class="se-text">同一张图，在列表里是 44px 的方片，在这里是整幅头图。</p>
    <button class="se-back" id="sb-se-back">返回</button>
  </article>
</div>
```

```css
.se {
  width: min(360px, 82vw);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
}

.se-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* @mechanism 自己的 display 会盖掉 hidden 的默认样式，两块都得显式关 */
.se-list[hidden],
.se-detail[hidden] {
  display: none;
}

.se-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px;
  border: 1px solid rgb(217 164 65 / 0.35);
  background: #1b1626;
  font: 500 13px/1 system-ui, sans-serif;
  color: #f0ead9;
  text-align: left;
  cursor: pointer;
}

.se-thumb {
  width: 44px;
  height: 44px;
  background: linear-gradient(135deg, var(--a), #1b1626);
}

.se-detail {
  display: grid;
  gap: 10px;
  justify-items: start;
}

/* @mechanism 两个状态里的元素尺寸位置都不同，位移与缩放全由浏览器算 */
.se-hero {
  width: 100%;
  height: 156px;
  background: linear-gradient(135deg, var(--a), #1b1626);
}

.se-back {
  padding: 8px 16px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.14);
  font: 500 13px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

/* @mechanism 不起名字就只有交叉淡入，没有「移动」这个观感 */
::view-transition-group(sb-hero) {
  animation-duration: 380ms;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
```

```js
const wrap = document.getElementById('sb-se')
const list = document.getElementById('sb-se-list')
const detail = document.getElementById('sb-se-detail')
const hero = document.getElementById('sb-se-hero')
const head = document.getElementById('sb-se-head')
const rows = [...wrap.querySelectorAll('.se-row')]

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const supported = typeof document.startViewTransition === 'function'

/** 不支持、或用户要求减少动效时，直接换 —— 过渡是装饰，换状态才是功能。 */
const swap = (fn) => (supported && !reduce ? document.startViewTransition(fn) : fn())

/** 只让一个元素叫这个名字。留两个，整个过渡会静默失效。 */
function nameOnly(el) {
  for (const row of rows) row.querySelector('.se-thumb').style.viewTransitionName = ''
  if (el) el.style.viewTransitionName = 'sb-hero'
}

for (const row of rows) {
  row.addEventListener('click', () => {
    const thumb = row.querySelector('.se-thumb')
    head.textContent = row.querySelector('.se-name').textContent
    hero.style.setProperty('--a', thumb.style.getPropertyValue('--a'))
    // @mechanism 名字先挂到「要出发」的那个元素上，旧快照才认得出它
    nameOnly(thumb)

    swap(() => {
      // @mechanism 交棒要在回调里、和 DOM 改动同一帧完成
      nameOnly(hero)
      list.hidden = true
      detail.hidden = false
    })
  })
}

document.getElementById('sb-se-back').addEventListener('click', () => {
  const row = rows.find((r) => r.querySelector('.se-name').textContent === head.textContent)
  swap(() => {
    list.hidden = false
    detail.hidden = true
    nameOnly(row ? row.querySelector('.se-thumb') : null)
  })
})
```

## 边界

- **名字在任意瞬间必须唯一。** 三个缩略图都挂 `view-transition-name` 是最常见的写法，也是最常见的崩法：整页过渡直接失效，而且**不报错**。所以名字只在「这一行要出发」时才挂上，并且挂之前先把别人身上的摘干净。
- **配对靠名字，不靠节点。** 两个状态里可以是完全不同的元素（这里是 `span` 到 `span`），但它们必须**各自都存在且恰好一个**。新态里没有这个元素时，看到的是淡入而不是移动。
- **交棒的时机在回调里。** 摘掉旧元素的名字、给新元素挂上，都必须发生在传给 `startViewTransition` 的回调里。提前或延后都会让浏览器截到「两个同名」或「一个都没有」。
- **`view-transition-name` 的值是自定义标识符**，不能以数字开头，也不能带引号或不转义的点。写错只是没效果，不报错。
- **快照不可交互。** 过渡那 380ms 里点什么都点不动，长过渡会有「按了没反应」的感觉。
- **`hidden` 会被你自己的 `display` 盖掉。** 上面给 `.se-list` / `.se-detail` 都写了 `display`，就得各自补一条 `[hidden] { display: none }`，否则「隐藏」的那块还在原地。
- **要兼容旧内核就得自己兜底。** `document.startViewTransition` 不存在时，`swap` 里的回调仍然同步执行 —— 状态照样换，只是没有动画。

## 备注

- 同一个机制换个入口：`@view-transition { navigation: auto }` 能让**跨页面跳转**也用上它，多页站点不用写一行 JS。
- 想给一批元素套同一套进出场规则，别逐个起名，用 `view-transition-class` 配 `view-transition-name: none`。
- 详情文字那里通常要压掉默认的交叉淡入（`::view-transition-old(sb-hero) { animation: none }` 之类），否则大图在移动时文字也在糊。
- 一定要配 `prefers-reduced-motion`：大幅位移对前庭敏感的人是真难受，而这条咒语的位移幅度不小。
