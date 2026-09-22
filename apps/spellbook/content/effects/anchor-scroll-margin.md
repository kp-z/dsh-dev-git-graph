---
title: 锚点跳转的让位
slug: anchor-scroll-margin
category: 交互
tags: [锚点, 滚动, 固定头部]
since: 2026-10
source: 机制来自 CSS Scroll Snap 规范的 scroll-margin 与 scroll-padding 属性，自行实现
when: 顶部有固定工具栏，点目录里的锚点跳过去时标题总被压在工具栏底下
stage: plain
tier: core
params:
  - { name: gap, label: 让位高度, type: range, min: 0, max: 120, step: 8, default: 64, unit: px }
---

## 描述

点目录里的「第三节」，那一节的标题停在固定工具栏下方一点，而不是被压在工具栏底下。

机制是 ==scroll-margin 给目标元素加一圈「只在滚动对齐时才算的空白」==。浏览器把元素滚进视口时对齐的是它的外边距盒，所以多出来的这段 margin 会被算进对齐位置，元素的上边缘就落在工具栏下面。它不改变元素自身的位置与尺寸，也不占布局——只在对齐这一刻生效。等价的做法是把 `scroll-padding-top` 加在滚动容器上，那是给整条滚动轴留白；两者选一个，同时写两处会让让位叠加成两倍。

让位值本身从哪来是第一个坑：工具栏会收缩、会长高、会在窄屏上换行成两行，写死一个 64px 在工具栏一变就不对了，所以它应该跟工具栏高度共用同一个来源。第二个坑是理解边界——`scroll-margin` 只在**浏览器执行对齐**（片段跳转、`scrollIntoView`、scroll-snap 吸附）时参与，用户自己拖滚动条时元素当然还是贴顶的。

## 代码

```html
<!-- @mechanism 滚动发生在内层容器里，固定工具栏也贴在它里面，让位才有意义 -->
<div class="am">
  <nav class="am-nav">
    <a href="#sb-a1">第一节</a>
    <a href="#sb-a2">第二节</a>
    <a href="#sb-a3">第三节</a>
    <a href="#sb-a4">第四节</a>
  </nav>
  <div class="am-scroll">
    <header class="am-bar">固定工具栏</header>
    <section class="am-sec" id="sb-a1"><h4>第一节</h4><p>点目录，标题停在工具栏下面。</p></section>
    <section class="am-sec" id="sb-a2"><h4>第二节</h4><p>靠的是对齐时才算上的那段空白。</p></section>
    <section class="am-sec" id="sb-a3"><h4>第三节</h4><p>把让位拖到 0，标题就被压住了。</p></section>
    <section class="am-sec" id="sb-a4"><h4>第四节</h4><p>它后面没有内容了，让位会被夹住。</p></section>
  </div>
</div>
```

```css
.am {
  width: min(360px, 86vw);
  overflow: hidden;
  border-radius: 12px;
  background: #f6f2ea;
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #1b1710;
}
.am-nav {
  display: flex;
  gap: 12px;
  padding: 8px 14px;
  background: rgb(60 48 30 / 0.07);
}
.am-nav a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid rgb(60 48 30 / 0.3);
}
.am-scroll {
  height: 196px;
  overflow-y: auto;
  padding: 0 14px;
  scroll-behavior: smooth;
}
.am-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0 -14px;
  padding: 11px 14px;
  background: #b4462f;
  color: #fff;
  font-weight: 600;
}
/* @mechanism 让位只在对齐那一刻参与：它属于目标元素的滚动边距，不占布局也不移元素 */
.am-sec {
  min-height: 118px;
  scroll-margin-top: var(--gap, 64px);
  padding: 12px 0 20px;
  border-bottom: 1px solid rgb(60 48 30 / 0.14);
}
.am-sec h4 {
  margin: 0 0 4px;
  font-size: 14px;
}
.am-sec p {
  margin: 0;
  opacity: 0.72;
}
/* 平滑滚动不属于 transition，全局的 reduced-motion 规则管不到它，要自己关 */
@media (prefers-reduced-motion: reduce) {
  .am-scroll {
    scroll-behavior: auto;
  }
}
```

## 边界

- 让位值必须不小于固定头部的高度，而且两者应该共用同一个来源。头部换行或收缩后写死的数就不对了，现象是标题被遮住一半——看起来像「点了没反应」。
- `scroll-margin` 只在浏览器执行**对齐**时生效（片段跳转、`scrollIntoView`、scroll-snap）。手动拖滚动条时目标当然还是贴顶的，这不是 bug，是它只管对齐。
- 与滚动容器上的 `scroll-padding-top` 同时写会出现**叠加**：让位变成两份，标题停得太靠下，而且两处的数值都不容易看出谁在起作用。
- 目标位于嵌套滚动容器里时，只有**直接滚动它**的那个容器上的 `scroll-padding` 生效；外层固定头部的高度内层并不知道，所以通用做法是把让位写在目标自己的 `scroll-margin` 上。
- 目标是 `position: sticky`、或者本身处在固定层里时，让位不起作用——它根本不随滚动移动。
- 目标**后面内容不够**时让位会被夹住：浏览器滚到底就停，标题到不了让位高度，看起来像 scroll-margin 没生效。滚到「第四节」（它下面没有内容了）就能看到这个现象；末尾补一段占位内容即可。
- `scroll-behavior: smooth` 要跟着 `prefers-reduced-motion` 关掉：平滑滚动会让前庭敏感的用户不适，而它不属于 transition/animation，全局的降级规则兜不住。
- 用 `padding-top` 或 `::before` 占位来「顶开」头部，会把目标的命中区域一起挪走（标题上的链接会偏），而且只在视觉上管用——对齐位置依旧按元素上边缘算。要为对齐留白，就用只为对齐存在的 scroll-margin。

## 备注

- 同一机制适用于「带固定表头的表格内跳转」「带吸顶筛选条的长列表」「单页文档的目录」。
- 配合 `scroll-margin-block` 可以只留纵向让位，横向的滚动对齐不受影响。
