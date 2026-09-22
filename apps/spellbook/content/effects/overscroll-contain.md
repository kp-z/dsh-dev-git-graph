---
title: 嵌套滚动的边界
slug: overscroll-contain
category: 交互
tags: [滚动链, overscroll-behavior, 嵌套滚动]
since: 2026-10
source: 机制来自 CSS Overscroll Behavior 规范的滚动链阻断，自行实现
when: 弹窗里有一个自己的滚动区，滚到底后不想把背后的页面一起带走
stage: plain
tier: core
---

## 描述

弹窗中间的列表滚到尽头，手指再继续划，底下的页面跟着滚走了——关掉弹窗，原来的阅读位置已经不知道跑哪儿去了。列表本身一切正常，多出来的是「滚动的接力」。

机制是 ==滚动链：内层容器滚到边界后，没被消费的滚动量会往上递给祖先滚动容器==。滚动增量不是就地耗尽的，浏览器在内层到达边界时会把剩下的部分交给最近的祖先，一路传到视口。这个默认行为在多数页面里是对的（一页滚到底接着滚下一页），但在「弹窗里的小滚动区」这种语义独立的容器里就变成了意外。`overscroll-behavior: contain` 把链在当前容器截断：内层的回弹与惯性还在，但多余的量不再外传。

三个取值各有分工：`auto` 是默认的外传；`contain` 阻断外传、保留自身回弹；`none` 连自身回弹也去掉，手感更硬，常用来关掉移动端的下拉刷新。属性写在**滚动容器**上而不是滚动内容上，需要区分横竖轴时用 `overscroll-behavior-x` / `-y` 单独写。

## 代码

```html
<!-- @mechanism 列表自己是一个滚动容器，页面是外层；两者之间才会形成滚动链 -->
<div class="page">
  <p>页面本身可以滚。下面是弹窗里的列表，把它滚到底再继续划。</p>
  <section class="sheet">
    <h3>弹窗里的列表</h3>
    <ul class="list">
      <li>第一项</li><li>第二项</li><li>第三项</li><li>第四项</li>
      <li>第五项</li><li>第六项</li><li>第七项</li><li>第八项</li>
    </ul>
  </section>
  <p>列表滚到底后，页面不应该跟着动——这一层由 contain 截断。</p>
  <p>页面当然还能自己滚，只要你把指针放在列表外面。</p>
</div>
```

```css
.page {
  height: 230px;
  overflow-y: auto;                 /* 外层滚动容器 */
  padding: 12px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.34);
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.sheet {
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #fffdf9;
}

.sheet h3 { margin: 0 0 6px; font: 600 14px/1.4 system-ui, sans-serif; }

.list {
  height: 110px;
  overflow-y: auto;                 /* 内层也能滚，于是有了「到边界之后往哪去」的问题 */
  /* @mechanism 内层到达边界后，滚动量就地截断，不再递给外层页面 */
  overscroll-behavior: contain;
  margin: 0;
  padding-left: 22px;
}
```

## 边界

- 加了 `contain` 之后，用户在内层滚到底会觉得「划不动」。如果外层内容才是主体、内层只是顺带出现的一段，这会被抱怨成卡顿。通常只对弹窗、抽屉、地图这类语义上明确独立的滚动区用它。
- Safari 16 以前不支持这个属性，iOS 上的滚动链照旧，得继续用阻止 `touchmove` 默认行为那一套，代价是连惯性也一起丢了。
- 内层没有可滚内容时它不算「到过边界」——滚动量直接外传。空列表、内容比容器矮的列表都挡不住外层。
- 它只影响滚动链，不影响滚动条本身与滚动吸附；`scroll-snap` 用的是另一套规则。

## 备注

- 竖轴和横轴往往只想截断一边（弹窗里横向滑的图片区不该把页面横滚也带走），写 `overscroll-behavior-x: contain` 更精确。
- 把内层的内容高度收得刚好不溢出的做法并不等价：一旦内容变多就失效，而 `contain` 是按滚动事件生效的。
