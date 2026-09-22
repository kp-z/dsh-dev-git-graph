---
title: 栅格版瀑布流
slug: grid-masonry-auto-rows
category: 布局
tags: [瀑布流, 行跨度, 网格]
since: 2026-10
source: 机制来自 CSS Grid 的 grid-auto-rows 加 span 行跨度，跨行数由脚本测量，自行实现
when: 卡片要参差排布，但又要能跨列、要按行阅读顺序、要能排序
stage: grid
tier: core
---

## 描述

高矮不一的卡片排成三列，每列自己往下接。但它不是多列布局——它是网格，所以卡片能跨列，阅读顺序也还是从左到右。

机制是 ==把 grid-auto-rows 设成很小的固定步长，再用 grid-row: span N 让每个元素占住整数个步长==。设想每一行只有 8px，一张 186px 高的卡片就占 23 行——`span 23`。于是所有元素都对齐在同一套细密的行网格上，接缝自然平齐，而且空出来的步长数完全由内容高度算出来，不需要预设行高。

步长要**小于最小卡片的高度**，否则小卡片会撑破一格；步长越小越贴合，但行数越多、布局计算越重，8px 是常用的折中。

## 代码

```html
<div class="gm">
  <article class="gm-card" style="--h: 120px">一</article>
  <article class="gm-card" style="--h: 200px">二</article>
  <article class="gm-card" style="--h: 88px">三</article>
  <article class="gm-card" style="--h: 160px">四</article>
  <article class="gm-card" style="--h: 132px">五</article>
</div>
```

```css
.gm {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  /* @mechanism 行高固定成极小步长，元素用它当尺子量自己有多高 */
  grid-auto-rows: 8px;
  gap: 0 10px;
  width: min(560px, 90vw);
}

.gm-card {
  /* @mechanism 跨行数 = 内容高度 ÷ 步长，接缝因此落在同一套细线上 */
  grid-row: span var(--span, 1);
  height: var(--h, 100px);
  margin-bottom: 10px;
  display: grid;
  place-items: center;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.44);
  font: 500 14px/1 system-ui, sans-serif;
  color: #1c1a17;
}
```

```js
// @mechanism 只有脚本能测出真实高度，再折算成步长数
const STEP = 8
for (const card of document.querySelectorAll('.gm-card')) {
  const gap = 10
  const rows = Math.ceil((card.offsetHeight + gap) / STEP)
  card.style.setProperty('--span', String(rows))
}
```

## 边界

- **必须有脚本测量。** CSS 里拿不到元素自身的高度，`span` 只能由 JS 写进去。这条是这个机制的入场费——纯 CSS 做不到，纯 CSS 能做的只有 `columns`（但那不能跨列、阅读顺序是竖的）。
- 脚本要在字体加载完、图片有尺寸之后跑，否则量到的是次态高度，卡片会短一截或长一截。`ResizeObserver` 比 `window.onload` 更稳。
- 步长越小，`span` 数值越大、重排越频繁。步长大于最矮卡片时，矮卡片会把所在那一行撑高，出现不该有的空隙。
- 跨列的大块会**打乱瀑布流的均衡**：它占掉相邻列的空间，附近几列的高低差会明显变大。要大块与瀑布流兼得，得容忍这种不齐。
- `auto-fit` 的列数会随宽度变，`span` 是按高度算的、与列数无关，所以缩放窗口时行数不用重算，但卡片换列位置会跳。

## 备注

- 这是 `masonry-columns` 的互补方案：多列版省脚本、但不能跨列且按列阅读；这条要脚本、但保留网格的全部能力。
- 真正的 `grid-template-rows: masonry` 还在规范讨论中，浏览器尚未普遍实现——上面的步长法就是它的当下替代。
