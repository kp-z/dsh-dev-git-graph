---
title: 按自身宽度收缩的面包屑
slug: breadcrumb-fold
category: 交互
tags: [面包屑, 容器查询, 折叠]
since: 2026-10
source: 机制来自 CSS Containment 的容器查询 @container 与弹性收缩优先级，自行实现
when: 面包屑放在侧栏或窄容器里，层数一多就挤成一团
stage: plain
tier: core
params:
  - { name: w, label: 面包屑宽度, type: range, min: 200, max: 520, step: 10, default: 300, unit: px }
---

## 描述

拖一下宽度滑杆：面包屑先丢掉中间的层级，再丢掉倒数第二层，首页与当前页始终留着。

机制是 ==用容器查询而不是媒体查询来决定折叠——判断依据从「视口多宽」换成「这一条自己有多宽」==。媒体查询问的是窗口，而面包屑常被塞进侧栏、抽屉、分栏里：窗口很宽，它那一段只有 280px。只有 `@container` 问的是「我自己」。另一半同样重要：首尾钉成 `flex: 0 0 auto`，只让中间那截可收缩并给 `min-width: 0`，否则 flex 会把所有项等比例压扁，文字挤成竖条，而不是干净地丢掉中间层。

可变的是「丢谁、留谁」。通常留首页与当前页——它们是路径的两端，去掉了用户就不知道自己在哪——丢中间的层级；也可以只留最后两级、把前面收进一个「…」入口，但那个入口必须能点开，不然折叠就等于删信息。折叠点用容器查询的宽度阈值，而不是给每一层单独设断点，那样层数一变就要全部重写。

## 代码

```html
<!-- @mechanism 查询容器就是这个 nav 自己，所以折叠依据是它自己的宽度，而不是窗口宽度 -->
<nav class="bc" aria-label="面包屑">
  <a class="bc-end" href="#">首页</a>
  <span class="bc-mid">
    <span class="bc-sep">/</span><a href="#">平台</a>
    <span class="bc-sep">/</span><a href="#">组件库</a>
  </span>
  <span class="bc-sep bc-sep-last">/</span>
  <span class="bc-here" aria-current="page">按钮</span>
</nav>
```

```css
/* @mechanism container-type 让这个 nav 成为查询容器，后代才能问「我有多宽」 */
.bc {
  container-type: inline-size;
  display: flex;
  align-items: center;
  gap: 6px;
  width: var(--w, 300px);
  overflow: hidden;
  white-space: nowrap;
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #1b1710;
}
/* @mechanism 首尾不许收缩，被牺牲的只能是夹在中间的那几层 */
.bc-end,
.bc-here {
  flex: 0 0 auto;
}
.bc-here {
  font-weight: 600;
}
.bc-mid {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bc-sep {
  color: rgb(27 23 16 / 0.35);
}
.bc a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid rgb(60 48 30 / 0.25);
}
@container (max-width: 330px) {
  .bc-mid a:last-of-type,
  .bc-mid .bc-sep:last-of-type {
    display: none;
  }
}
@container (max-width: 260px) {
  .bc-mid {
    display: none;
  }
}
```

## 边界

- `@container` 只对**后代**生效：把 `container-type` 设在被查询的那个元素自己身上是无效的（它只能被后代查询）。想要「自己的宽度」就必须多一层外壳，这一点最容易写反。
- `container-type: inline-size` 附带布局与内联尺寸的 containment：该元素的内联尺寸不再受内容影响（正好是想要的），同时它会成为绝对定位后代的包含块——里面若有浮层要留意定位基准变了。
- 阈值是硬编码的经验值。层级文字变长（「组件库」变成「Design System 组件库」）之后 330px 就不对了：容器查询只知道容器多宽，不知道内容多长。要按内容折，得配合 `text-overflow` 或 JS 量测。
- 折叠用 `display: none`，被折掉的层级对读屏和页内查找**直接消失**；要保留完整路径可访问，得在 nav 上另给一个描述，或把省略做成可展开的按钮。
- 首尾都钉住时，如果当前页标题本身比容器还宽，`overflow: hidden` 裁掉的是标题**末尾**——最该看清的几个字反而看不见。这时要允许当前页换行或缩略。
- 折叠发生在布局阶段，所以拖宽度时不会抖，这是相对 JS 量宽再切类的好处；代价是它只按**尺寸**判定，算不进「用户点开过完整路径」这类交互状态。
- 只用 `flex-shrink` 让中间层被压缩，会先出现文字被压扁/溢出，而不是整层消失；`min-width: 0` 与显式的 `display: none` 两个都要，分工不同。

## 备注

- 同一机制可搬到窄容器里的「标题 + 标签行」「工具条上的次要按钮」「卡片头部的一串元信息」。
- 判断该不该用容器查询：问一句「这个组件被放到别处时，它的可用宽度会和窗口一起变吗」。不会，就该用 `@container`。
