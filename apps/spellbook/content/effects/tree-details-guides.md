---
title: 用 details 搭可折叠树
slug: tree-details-guides
category: 交互
tags: [树, details, 引导线]
since: 2026-10
source: 机制来自嵌套 details 的 open 状态与伪元素画的引导线，自行实现
when: 文件树、目录或多层筛选，要能一层层展开又不想引入树控件
stage: plain
tier: core
---

## 描述

一层套一层的目录，点标题展开子级，左边一路有竖线和拐角把层级连起来。

机制是 ==嵌套的 `<details>` 本身就是一棵树==：嵌套关系就是层级，`open` 就是展开态。展开动画、键盘可达性、读屏的「展开/折叠」播报都由浏览器给；不需要把层级数据摊平成数组再算缩进，也不需要维护一张「哪些节点开着」的状态表——状态就长在节点自己身上。

引导线是另一处机制：竖线用 `border-inline-start`、拐角用一条短横线，都由伪元素画，不占布局。真正费神的细节是 ==最后一项的竖线要截断到拐角高度==，否则每个末级节点下面都拖一截没有去处的线头——判据必须是「直接子级里的最后一项」，因为最后一项自己往往也是一棵子树的根。

可变的是箭头怎么画。`::marker` 在各引擎上能改的内容、位置、间距都不一致，所以这里 `list-style: none` 关掉它，用边框拼一个小三角自己旋转——形状与对齐都可控，也不依赖字体里有没有那个符号。

## 代码

```html
<!-- @mechanism 嵌套的 details 就是树：层级靠嵌套、展开态靠 open，不需要额外的状态表 -->
<ul class="tr">
  <li class="tr-node">
    <details open>
      <summary>组件库</summary>
      <ul>
        <li class="tr-node">
          <details>
            <summary>按钮</summary>
            <ul>
              <li class="tr-leaf"><a href="#">主要按钮</a></li>
              <li class="tr-leaf"><a href="#">次要按钮</a></li>
            </ul>
          </details>
        </li>
        <li class="tr-node">
          <details>
            <summary>输入</summary>
            <ul>
              <li class="tr-leaf"><a href="#">文本框</a></li>
            </ul>
          </details>
        </li>
      </ul>
    </details>
  </li>
  <li class="tr-leaf"><a href="#">设计令牌</a></li>
</ul>
```

```css
.tr,
.tr ul {
  margin: 0;
  padding-inline-start: 16px;
  list-style: none;
}
.tr {
  width: min(320px, 84vw);
  font: 400 13px/1.9 system-ui, sans-serif;
  color: #1b1710;
}
.tr-node,
.tr-leaf {
  position: relative;
}
/* @mechanism 竖线来自每一项自己的左侧边框，深度只靠 padding 累加，不占布局 */
.tr ul .tr-node::before,
.tr ul .tr-leaf::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: -10px;
  border-inline-start: 1px solid rgb(60 48 30 / 0.18);
}
/* @mechanism 只给直接子级里的最后一项截断竖线，末级节点才不会拖出多余的线头 */
.tr ul > :last-child::before {
  inset-block-end: auto;
  height: 13px;
}
.tr ul .tr-node::after,
.tr ul .tr-leaf::after {
  content: '';
  position: absolute;
  inset-inline-start: -10px;
  top: 12px;
  width: 7px;
  border-top: 1px solid rgb(60 48 30 / 0.18);
}
.tr summary {
  cursor: pointer;
  list-style: none;
}
.tr summary::-webkit-details-marker {
  display: none;
}
/* @mechanism 箭头是边框拼的三角，形状与对齐可控，不依赖字体里有那个符号 */
.tr summary::before {
  content: '';
  display: inline-block;
  margin-inline-end: 6px;
  border-block: 4px solid transparent;
  border-inline-start: 6px solid rgb(27 23 16 / 0.45);
}
/* @mechanism 展开态的唯一真相是 open 属性，箭头方向由它推导 */
.tr details[open] > summary::before {
  transform: rotate(90deg);
}
.tr a {
  color: inherit;
  text-decoration: none;
}
```

## 边界

- `open` 不进 URL 也不参与表单，刷新后回到标记里的初始态。要记住用户展开了哪些节点，得自己存 localStorage 或写进片段——这是拿原生换来的代价。
- 竖线的截断依赖「直接子级里的最后一项」这个判据：写成 `:last-of-type`、或漏掉 `>`，当最后一项自己还是一棵子树的根时，线会被截在错误的地方，或者所有末级节点都拖着一截线头。
- 引导线必须用 `inset-inline-start` 之类的逻辑属性；用 `left` 时 RTL 下不会翻转，线会跑到文字右边去。
- 竖线靠 `inset-block: 0` 撑满父级，前提是父级 `position: relative`。为了省一层而用 `display: contents` 时，包含块消失，整条线会断掉。
- 层级深时这个结构会给出很长的 Tab 序列：每个 `summary` 一格、每个叶子又是一格，几十项的树要按上百次 Tab。树大到这个量级应该换成 `role="tree"` 加方向键的模型，别让原生结构硬扛。
- 折叠只是视觉收起，节点仍在 DOM 里；节点上千时要另外控制渲染成本，收起不等于卸载。
- `details` 的展开是从上到下的流式增长，父级展开时高度突变会推走下方内容；这是原生行为，不在视口里的子级展开会让用户失去位置感。

## 备注

- 同一结构可做多层筛选面板、文档侧栏目录、组织架构。
- 判断要不要自己写树控件：先看需求里有没有「拖拽排序、多选、虚拟滚动」。都没有，嵌套 details 就够了。
