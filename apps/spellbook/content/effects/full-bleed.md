---
title: 通栏突破
slug: full-bleed
category: 布局
tags: [grid, 正文, 图片, 容器]
since: 2026-09
source: 机制来自 CSS Grid 的命名列与跨列，自行实现
when: 正文要窄栏好读，但图、色块和引用要突破到整屏宽
stage: plain
tier: core
params:
  - { name: measure, label: 正文宽度, type: range, min: 30, max: 80, step: 2, default: 54, unit: ch }
---

## 描述

正文是窄窄一栏，读起来舒服；该通栏的图和色块一路铺到两边。

机制是 ==三列网格：内容默认走中间列，要突破的项跨三列==。中列定下阅读宽度，两侧的 `1fr` 是剩余空间（也就是留白）。同一套网格里于是有了「正文宽度」和「整屏宽度」两个语义，突破只是换一条 `grid-column`。

比负 margin 方案好在：不需要知道侧栏有多宽，也不用给每个通栏元素写单独的外层。

## 代码

```html
<div class="fb">
  <p>正文落在中间那一列。窄栏读起来省力，这是排版的老规矩。</p>
  <p class="fb-wide">这一块跨了三列，于是它铺到了两边。</p>
  <p>回到正文。同一套网格里同时存在两种宽度。</p>
</div>
```

```css
.fb {
  display: grid;
  /* @mechanism 中列定阅读宽度，两侧 1fr 是留白 */
  grid-template-columns:
    1fr
    min(var(--measure, 54ch), 100% - 3rem)
    1fr;
  width: min(640px, 88vw);
  font: 400 15px/1.85 system-ui, sans-serif;
  color: #1c1a17;
}

.fb > * {
  grid-column: 2;
}

.fb-wide {
  /* @mechanism 跨三列 = 突破到通栏 */
  grid-column: 1 / -1;
  margin: 14px 0;
  padding: 20px 24px;
  background: #efe9dd;
  border-left: 3px solid #b4462f;
  font-weight: 600;
}
```

## 边界

- `min()` 里的 `100% - 3rem` 是**两侧合计**的留白，不是单侧。想要单侧 1.5rem 就得写 `100% - 3rem`，写 `1.5rem` 的话中列会贴着边。
- 两侧的 `1fr` 是「剩余空间」。窄屏上没有剩余时它会被压成 0，留白就消失了——这就是 `min()` 里那个 `100% - 3rem` 存在的理由。
- 它是接近全宽，但**不是严格的 100vw**（父容器决定了真实宽度）。要真贴视口边得配负 margin + `100vw`，而 `100vw` 在移动端包含滚动条宽度，会横向溢出。
- 通栏元素是子元素，它的宽度由网格决定。塞进去一个自己的 `width: 100vw` 会立刻溢出——两者是替代关系。
- 只写两列的话做不出「一侧突破」（比如图只往右伸）。那需要更多列或命名网格线，代码会长得多。

## 备注

- 把 `grid-template-columns` 换成命名线（`[full-start] ... [content-start] ... [content-end] ... [full-end]`）可读性会好很多，尤其是有多个突破层级时。
- `ch` 单位是按「0」的宽度算的，中文正文字数会与 `ch` 不符——中文场景用 `em` 或直接写 `rem` 更准。
