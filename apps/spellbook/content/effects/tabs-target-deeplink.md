---
title: URL 片段当状态的标签页
slug: tabs-target-deeplink
category: 交互
tags: [target, 深链, 无脚本]
since: 2026-10
source: 机制来自 CSS :target 伪类与 URL 片段标识符，自行实现
when: 标签页要能被直接分享、后退键能回到上一页，而状态不想只活在内存里
stage: plain
tier: core
---

## 描述

点到第二页，这件事记在地址栏里：`#sb-p2`。刷新、复制链接、按后退，都回到同一页。

机制是 ==:target 让 CSS 直接读到 URL 的片段标识符==——被片段指到的元素会被 `:target` 命中，于是「当前是哪一页」不必经过任何脚本。与 `:checked` 那套相比，状态不在 DOM 里而在 URL 里：换来的是可分享、可收藏、可被前进后退遍历，代价是每次点击都会写一条历史记录，而且浏览器会真的滚到那个元素上。

兜底那一句是这套能不能用的关键：首次进入、片段写错、清掉片段之后，没有任何元素匹配 `:target`，必须用 `:not(:has(:target))` 让第一块面板露出来，否则用户看到的是一片空白，而且控制台什么都不说。

可变的是标签用什么元素承载。`<a href="#p2">` 最省事，但读屏不会认它是 tab；要语义正确就换成 `role="tab"` 的按钮，自己接管前进后退并同步 URL——那就又回到脚本了。

## 代码

```html
<!-- @mechanism 片段标识符就是状态：href 指向面板 id，:target 便能命中它 -->
<div class="dl">
  <nav class="dl-bar">
    <a class="dl-tab" href="#sb-p1">概览</a>
    <a class="dl-tab" href="#sb-p2">机制</a>
    <a class="dl-tab" href="#sb-p3">边界</a>
  </nav>
  <section class="dl-pane" id="sb-p1"><h4>概览</h4><p>点标签只改地址栏里的片段。</p></section>
  <section class="dl-pane" id="sb-p2"><h4>机制</h4><p>:target 直接读 URL，不需要脚本。</p></section>
  <section class="dl-pane" id="sb-p3"><h4>边界</h4><p>没有片段时必须兜底，否则是空白。</p></section>
</div>
```

```css
.dl {
  width: min(360px, 86vw);
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #1b1710;
}
.dl-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}
.dl-tab {
  padding: 6px 12px;
  border-radius: 999px;
  background: rgb(60 48 30 / 0.08);
  color: rgb(27 23 16 / 0.6);
  text-decoration: none;
}
/* @mechanism 面板自己读片段决定显隐，状态只有一个来源：URL */
.dl-pane {
  display: none;
  min-height: 78px;
  padding: 12px 14px;
  border-inline-start: 3px solid #b4462f;
  background: rgb(60 48 30 / 0.05);
  scroll-margin-top: 12px;
}
.dl-pane:target {
  display: block;
}
/* @mechanism 一个都没命中时回落到第一页，这是首次进入不空白的原因 */
.dl:not(:has(.dl-pane:target)) .dl-pane:first-of-type {
  display: block;
}
.dl:has(#sb-p1:target) [href="#sb-p1"],
.dl:has(#sb-p2:target) [href="#sb-p2"],
.dl:has(#sb-p3:target) [href="#sb-p3"],
.dl:not(:has(.dl-pane:target)) [href="#sb-p1"] {
  background: #b4462f;
  color: #fff;
}
.dl-pane h4 {
  margin: 0 0 4px;
  font-size: 14px;
}
.dl-pane p {
  margin: 0;
  opacity: 0.75;
}
```

## 边界

- 没有片段时所有面板都不匹配 `:target`，没有兜底就是**空白页**且不报错。判据要写成 `:not(:has(:target))`，漏掉就等于没实现。
- 片段是全局命名空间：目录锚点、脚注、`<details id>` 都在这一个空间里抢名字，id 撞车会让两个组件同时点亮。
- 每次点击都往历史里压一条记录，用户按后退是在标签页之间来回，而不是退出这个页面。对「可分享的选项卡」是优点，对向导类流程是灾难。
- 跳转必然引发滚动：面板在页面深处时，点标签等于把用户拽下去，方位感会丢。要缓解只能让面板贴近视口，或用 `scroll-margin` 决定它停在哪。
- 没有脚本就**清不掉**片段——用户想回到「未选中」只能点一个 `href="#"` 的关闭链接，或者手动改地址栏。
- 片段指向不存在的 id 时既不高亮也不报错，静默回落取决于兜底写法；打包进 iframe、id 重复、或被弹层复制一份时行为都会跟着变。

## 备注

- 同一机制可以做「原生弹层的深链」：让 `:target` 命中浮层容器，再用 `:not(:has(:target))` 控制初始态。
- 渐进增强路线：保留 `<a>` 的 URL 状态，另外加 `role="tab"` 与方向键，拿到深链加正确语义。
