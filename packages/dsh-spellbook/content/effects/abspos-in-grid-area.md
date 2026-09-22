---
title: 绝对定位落进网格区域
slug: abspos-in-grid-area
category: 布局
tags: [grid, position, 卡片, 徽章]
since: 2026-10
source: 机制来自 CSS Grid 规范：绝对定位子项在网格容器为其包含块时按网格区域定位，自行实现
when: 卡片右上角要挂一个角标，但不想为它多加一个定位包裹层
stage: grid
tier: core
---

## 描述

角标精确地贴在标题区的右上角，而它自己是 `position: absolute` 的——没有额外包裹层，也没有靠 `top` / `left` 手算坐标。改版式时把标题区挪到别的行，角标跟着走，因为它压根没写「在哪」，只说「属于哪个区域」。

机制是 ==绝对定位子项在网格容器里不是网格项，但网格容器是它的包含块时，它的静态位置由自己声明的网格区域决定==。它不参与轨道分配（不占格子、不影响列宽），而 `inset` 的百分比与长度全部相对**那个区域的矩形**解析。于是 `grid-area: head` 配上 `inset: 6px 6px auto auto`，就是「贴在 head 区域右上角内缩 6px」，而 head 是同一张区域图里定义的东西。

真正的前提是「网格容器得是它的包含块」——网格容器自身必须是定位元素。少了这一条，`grid-area` 会被完全忽略，角标按照常规规则去找更外面的定位祖先，找不到就贴到初始包含块上。另一个要注意的是：不写 `inset`（全 `auto`）时它落在区域的起点，视觉上像左对齐；要贴右贴下必须显式把对应边留成 `auto`。

## 代码

```html
<!-- @mechanism 角标没有占位、没有手算坐标，位置来自它声明的网格区域 -->
<section class="plate">
  <h2 class="title">网格区域</h2>
  <span class="badge">角标</span>
  <nav class="rail">导航</nav>
  <p class="body">正文占住剩下那一列。</p>
  <footer class="foot">页脚</footer>
</section>
<button id="move">改挂到 foot 区域</button>
```

```css
.plate {
  /* @mechanism 网格容器成为包含块，绝对定位子项才会按自己的网格区域就位 */
  position: relative;
  display: grid;
  grid-template-columns: 76px 1fr;
  grid-template-areas:
    'head head'
    'rail body'
    'foot foot';
  gap: 8px;
  width: min(380px, 86vw);
  padding: 12px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.34);
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.title { grid-area: head; margin: 0; font: 600 15px/1.4 system-ui, sans-serif; }
.rail { grid-area: rail; padding: 8px; border-radius: 8px; background: #efe9dd; }
.body { grid-area: body; margin: 0; }
.foot { grid-area: foot; padding-top: 8px; border-top: 1px solid rgb(60 48 30 / 0.25); opacity: 0.7; }

.badge {
  /* @mechanism 不占格子，但静态位置由它声明的网格区域决定 */
  position: absolute;
  grid-area: head;
  inset: 6px 6px auto auto;     /* 相对 head 区域的右上角内缩 6px */
  padding: 4px 10px;
  border-radius: 999px;
  background: #2f2a24;
  color: #f6f3ee;
  font: 500 12px/1.4 system-ui, sans-serif;
}

.badge.to-foot { grid-area: foot; }   /* 只换区域名，偏移量一个字不改 */

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
const badge = document.querySelector('.badge')
const btn = document.getElementById('move')

btn.addEventListener('click', () => {
  // @mechanism 只改区域名：角标自己的偏移量没变，位置却跟着版式走
  const moved = badge.classList.toggle('to-foot')
  btn.textContent = moved ? '挂回 head 区域' : '改挂到 foot 区域'
})
```

## 边界

- 忘了让网格容器成为包含块（`position: relative` 之类），网格区域就完全不作数：角标会去找更外面的定位祖先，找不到就贴到视口右上角。这是这类写法最常见的失效。
- 区域名写错不会报错。`grid-area` 里的自定义标识符找不到同名区域时会被当成网格线名解析，于是在网格末尾造出隐式轨道，角标跑到看不见的地方——比报错更难查。
- 全 `auto` 的 `inset` 会落到区域的起点（左上），看起来像左对齐；要贴右下必须显式把那一侧留成 `auto`，否则四边都给值会把角标拉伸到填满整个区域。
- 网格容器带 `overflow: hidden` 或 `clip` 时，探出区域的部分被裁掉——它仍然是网格容器的子元素，逃不出这个盒子。

## 备注

- `grid-area` 也可以写成 `grid-row` / `grid-column` 的行号形式，效果一样；用命名区域是为了让角标跟着版式改动走，不用同步改两个地方。
- 同一招也用来在图片区叠一层渐变、给某个命名区域加装饰边框：凡是「跟着这块区域走」的浮层，都能省掉一层包装 div。
