---
title: 被祖先截住的粘性
slug: sticky-ancestor-clip
category: 布局
tags: [sticky, overflow, containing-block, 目录]
since: 2026-10
source: 机制来自 CSS 定位规范中 sticky 的滚动容器（scrollport）判定，自行实现
when: 侧栏目录要跟着长文滚动钉在顶部，却怎么也不肯钉住
stage: plain
tier: core
---

## 描述

侧栏里的目录该跟着长文滚动并钉在顶部，但它一动不动；或者只在卡片那么大的范围里钉一下就跟着滚走了。代码里找不出问题——`position: sticky` 和 `top: 0` 都写着。

机制是 ==sticky 的钉住范围由最近的「滚动容器」祖先决定，任何 overflow 不是 visible 的祖先都会接管它==。sticky 不是在视口里钉，而是在「自己的包含块」和「滚动容器的可滚动区域」之间做夹取；而滚动容器的定义包含 `overflow: hidden` 和 `auto / scroll`。所以为了「裁掉溢出」顺手加的那层包装，会瞬间变成 sticky 的新参照：那个盒子里没有可滚的距离，行程就是零，视觉上和没写一样。

诊断方法不是看 sticky 那句，而是从元素往上找第一个 `overflow` 非 `visible` 的祖先。要修有两条路：去掉那层溢出约束，或者换成 `overflow: clip`——它同样裁掉溢出，但不产生滚动容器，不会抢走参照。

## 代码

```html
<!-- @mechanism 两个目录的唯一差别，是包裹层有没有 overflow -->
<div class="pane">
  <div class="cols">
    <section class="col clipped">
      <h3>目录 A</h3>
      <ol><li>轨道尺寸</li><li>内在尺寸</li><li>容器查询</li><li>负外边距</li><li>粘性定位</li><li>滚动链</li><li>层叠上下文</li></ol>
    </section>
    <section class="col">
      <h3>目录 B</h3>
      <ol><li>轨道尺寸</li><li>内在尺寸</li><li>容器查询</li><li>负外边距</li><li>粘性定位</li><li>滚动链</li><li>层叠上下文</li></ol>
    </section>
  </div>
</div>
```

```css
.pane {
  height: 150px;
  overflow-y: auto;            /* 演示用的滚动容器，两个目录共用 */
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.34);
  font: 400 14px/2.1 system-ui, sans-serif;
  color: #1c1a17;
}

.cols { display: flex; gap: 14px; padding: 10px; }
.col { flex: 1; }

.clipped {
  /* @mechanism 就是这一行抢走了 sticky 的参照：钉住范围缩成它自己那一块 */
  overflow: hidden;
}

.col h3 {
  position: sticky;
  top: 0;                      /* @mechanism 偏移量决定钉在哪，参照则由最近的滚动容器决定 */
  margin: 0;
  padding: 6px 8px;
  background: #efe9dd;
  font: 600 14px/1.4 system-ui, sans-serif;
}

.col ol { margin: 0; padding-left: 22px; }
```

## 边界

- 症状很隐蔽：sticky 并没有「失效」，只是参照物从页面换成了那层 overflow 盒子。滚动时看得见的是「钉了一下就走」，很难联想到是包装层干的。
- 最容易中的是 `html` 或 `body` 上的 `overflow-x: hidden`——为了消除横向滚动条随手加的一行，会把它变成整页 sticky 的滚动容器，页面级 sticky 全部失灵。
- 只写 `position: sticky` 而忘了 `top`（或者 `top: auto`）什么也不会发生：没有偏移量就没有「钉」这个动作。这是另一个让人以为属性不支持的常见写法。
- 粘住的元素会被同一层里后面绘制的内容盖住——它仍然是普通文档流的一员，要压在别人上面得自己再配 `z-index`。
- sticky 只在滚动容器的可滚动范围内有效。容器高度恰好等于内容高度时（比如那层被顺手加上的 overflow 盒子），行程为零，看起来和没写一模一样。

## 备注

- 想让「裁掉溢出」和「不抢 sticky 参照」两件事同时成立，就用 `overflow: clip`。
- 如果那层 overflow 是必需的，就把 sticky 元素挪出那层盒子；含 sticky 的布局里，包装层越少越安全。
