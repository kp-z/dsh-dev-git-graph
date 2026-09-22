---
title: 作用域到边界为止
slug: scope-donut-island
category: 布局
tags: [scope, 容器, 卡片]
since: 2026-10
source: 机制来自 CSS Cascading and Inheritance Level 6 的 @scope，自行实现
when: 一套组件样式套在嵌套实例上，内层被外层的选择器一并染指
stage: plain
tier: core
---

## 描述

外层面板有自己的底色、边框和一套标题样式；内嵌的那一块面板保持它自己的样子，标题没有被外层的规则改掉。

机制是 ==@scope (.panel) to (.panel-embed) 给规则划出一个下边界，一进入边界元素就不再命中==。后代选择器只有「能命中什么」，没有「到哪为止」——`.panel .panel-title` 会一路穿进任意深度的嵌套面板，这是嵌套组件的样式最难收拾的地方。`to (...)` 补上下边界：边界元素及它的子树被排除在作用域之外，于是「给面板族上一层皮肤」不会顺手改掉嵌在里面的那块。写 `.panel > .panel-title` 只是把层级限定死，形状一变就失效，而边界是语义的：「别再往里走」。

另一条与它配套的规则是**邻近性**：当多条 `@scope` 规则同时命中一个元素时，作用域根离它更近的那一条胜出，而且这个比较发生在具体性之前。所以内层作用域天然盖住外层，不需要靠 `:where()` 去削具体性，也不需要 `!important`——嵌套组件「内层说了算」的直觉，在这里第一次成了语言的一部分。

什么可变：上下边界都是设计选择。上边界可以是 `@scope (.panel)`（一路到底）也可以带下边界；`:scope` 用来指作用域根自身，这是它能给「容器自己」加样式的原因，也是后代选择器做不到的事。边界选择器与被作用的元素不必同类，只要它能唯一指认出「不想再往里走」的那一层就行。要不要把 `timeline-scope` 那类跨树的名字放在这里、要不要把作用域收在一棵组件子树上而不是全页，取决于你想让哪一部分拥有「局部规则」。

## 代码

```html
<div class="panel">
  <h3 class="panel-title">外层面板</h3>
  <p class="panel-text">外层皮肤只作用到这里为止。</p>
  <div class="panel-embed">
    <h3 class="panel-title">内嵌面板</h3>
    <p class="panel-text">它有自己的作用域，外层规则在这里停下。</p>
  </div>
</div>
```

```css
.panel-embed {
  margin-top: 14px;
}

/* @mechanism 从 .panel 开始，到内嵌面板为止：下边界是后代选择器表达不出来的东西 */
@scope (.panel) to (.panel-embed) {
  :scope {
    padding: 18px 20px;
    border-radius: 16px;
    border: 1px solid rgb(60 48 30 / 0.2);
    background: rgb(255 255 255 / 0.62);
  }

  .panel-title {
    margin: 0 0 6px;
    font: 600 16px/1.4 system-ui, sans-serif;
    color: #b4462f;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .panel-text {
    margin: 0;
    font: 400 14px/1.75 system-ui, sans-serif;
    color: rgb(27 23 16 / 0.68);
  }
}

/* 内嵌面板是一处新的作用域，只负责它自己的容器外观 */
@scope (.panel-embed) {
  :scope {
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px dashed rgb(60 48 30 / 0.32);
    background: rgb(60 48 30 / 0.06);
  }

  .panel-title {
    margin: 0 0 4px;
    font: 600 15px/1.4 system-ui, sans-serif;
    color: #1b1710;
    letter-spacing: 0;
    text-transform: none;
  }

  .panel-text {
    margin: 0;
    font: 400 13.5px/1.7 system-ui, sans-serif;
    color: rgb(27 23 16 / 0.6);
  }
}
```

## 边界

- 邻近性只在 `@scope` 之间比较。作用域规则与普通规则相遇时仍然按常规级联走（具体性、源码顺序），所以页面里一条高具体性或带 `!important` 的普通规则照样能压过作用域内的声明。
- 边界是活的：边界元素被移除、改了类名、或者被条件渲染掉之后，外层规则会立刻重新渗透进去。它挡的是「当前存在的这一层」，不是「永远不许往下」。
- `@scope` 完全不管继承。内层元素仍然继承外层传下来的可继承属性（颜色、字体、自定义属性），要隔断得显式重置那几条；`all: revert` 太猛，通常只会连带把有用的值一起清掉。
- 它不改变选择器本身的含义：作用域里的 `.panel-title` 仍然是后代选择器，只是被框在上下边界之间，具体性计算照旧。
- 支持面（Chromium 118+ / Safari 17.4+ / Firefox 128+）已经够用，但旧引擎上**整条 `@scope` 规则会被丢弃**，连同里面的所有声明，而不是只丢边界——症状是整块样式消失，比嵌套泄漏更糟。基础样式建议用普通写法另写一份。
