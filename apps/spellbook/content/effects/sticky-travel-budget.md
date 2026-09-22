---
title: 被拉伸的粘性项
slug: sticky-travel-budget
category: 布局
tags: [粘性定位, 拉伸, 网格项]
since: 2026-10
source: 机制来自 CSS 定位规范中 sticky 的包含块约束与对齐属性的拉伸行为，自行实现
when: 网格或弹性行里的侧栏目录不跟着滚，而在它外面包一层 div 就好了
stage: plain
tier: core
---

## 描述

同一份目录，放进网格里当其中一列，它跟着内容一起滚走；把 `position: sticky` 挪到外面包一层普通 div 上，又能钉住了。差别不在目录本身，而在「这一列有多高」。

机制是 ==sticky 能移动的行程等于「包含块高度 − 自身高度」，对齐属性的拉伸会把这两者变成相等==。网格项的对齐方式是 `stretch`，块轴尺寸又是 `auto` 时，它会被拉到和整行一样高——而网格项的包含块正是它所在的网格区域。自身高度等于包含块高度，行程就是零，sticky 无处可去，于是静静跟着滚。写一句 `align-self: start`（或在容器上 `align-items: start`）让这一项回到内容高度，行程立刻回来了。

这也解释了那个流传很广的「包一层 div 就好了」：被拉伸的是外层那一项，内层 div 的高度仍旧由内容决定，于是它相对外层的拉伸空间可以自由移动。知道原理之后就不必靠包装层——改成 `start` 更干净。行方向上的弹性盒同理，默认的 `stretch` 一样会把项拉满。

## 代码

```html
<!-- @mechanism 两块的差别只在容器的 align-items：被拉伸的那列没有行程 -->
<div class="viewport">
  <section class="cols stretch">
    <article class="doc">
      <p>第一段正文，用来把这一行撑高，好让右边的目录有地方可钉。滚动时盯着右边那个方框：它会跟着这一行一起滚走。</p>
    </article>
    <nav class="toc"><b>目录 A</b><span>stretch（默认）</span></nav>
  </section>
  <section class="cols start">
    <article class="doc">
      <p>第二块正文。同样的目录，这次容器把它对齐到顶部，高度就只剩内容那么高，于是行程来了。</p>
      <p>继续往下滚，右边的目录会一直贴在这个滚动区的顶部。</p>
      <p>行程用完之前它都在，用完之后才被推走。</p>
      <p>行程的长度就是「这一行有多高」减去「目录自己有多高」。</p>
      <p>所以行越高、目录越矮，能钉住的距离就越长。</p>
    </article>
    <nav class="toc"><b>目录 B</b><span>align-items: start</span></nav>
  </section>
</div>
```

```css
.viewport {
  height: 220px;
  overflow-y: auto;              /* 演示用的滚动容器 */
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.34);
}

.cols {
  display: grid;
  grid-template-columns: 1fr 132px;   /* 网格项的包含块就是它所在的网格区域 */
  gap: 12px;
  padding: 12px;
}

.cols.stretch {
  /* @mechanism 默认的对齐方式：这一列被拉到和整行一样高，自身高就等于包含块高 */
  align-items: stretch;
}

.cols.start { align-items: start; }

.toc {
  position: sticky;
  top: 0;                        /* @mechanism 行程 = 包含块高 − 自身高，被拉伸时它等于零 */
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #efe9dd;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.toc b { font: 600 14px/1.4 system-ui, sans-serif; }
.toc span { opacity: 0.6; }

.doc {
  margin: 0;
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.doc p { margin: 0 0 10px; }
```

## 边界

- 中招的前提是「它自己同时是网格项或弹性项」。把 sticky 写在内层元素上时，包含块变成外层那一项，通常就有行程了——所以「包一层 div 就正常了」并不是玄学。
- `stretch` 是默认值，什么都没写也会中招；诊断要看的是「这一项的盒子和它所在的网格区域是不是一样高」，而不是继续给 `top` 换数值。
- 行程用完之后 sticky 会被推着走：目录滚到最后一屏被顶掉是正常的，不是又一个 bug。
- 祖先里只要有 `overflow` 非 `visible` 的一层，参照会先被那一层接管——那是另一种失效，先修参照再谈行程。

## 备注

- 需要「整行同高」的视觉（比如两侧都有底色）又想让目录钉住，就让目录自己写 `align-self: start`，给同一行的装饰层留在外面被拉伸。
