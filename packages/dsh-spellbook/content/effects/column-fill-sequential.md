---
title: 多栏是填满还是均分
slug: column-fill-sequential
category: 布局
tags: [multi-column, 列表, 目录]
since: 2026-10
source: 机制来自 CSS Multi-column Layout 规范的 column-fill，自行实现
when: 一长串条目要按顺序灌进几栏，第一栏填到底再开第二栏，而不是三栏一样高
stage: plain
tier: core
---

## 描述

同样六条内容、同样三栏，一份是每栏两条整整齐齐，另一份是前两条栏填得满满当当、第三栏空着——差别只在一个属性的取值。

机制是 ==column-fill 决定多栏容器是「均衡分配」还是「按顺序填满」==。默认值 `balance` 会先把整段内容量一遍，再去找一个让各栏高度尽量接近的平分点；`auto` 不去量，顺序往当前栏里塞，塞到容器的高度上限再开下一栏。两种行为下**栏数都不变**，变的是内容怎么落进这些栏。

`auto` 要看到效果有个前提：容器必须有一个确定的块向尺寸。连续媒体里高度是 `auto` 时，`auto` 会被当作 `balance` 处理——"填满"总得有个可填的高度，没有高度的填满就是均分。所以写 `column-fill: auto` 却没给高度，看起来就像这条属性不存在。

## 代码

```html
<ol class="fill">
  <li>材质与光照</li>
  <li>动效与过渡</li>
  <li>排版</li>
  <li>交互</li>
  <li>布局</li>
  <li>图形</li>
</ol>

<ol class="fill fill-balanced">
  <li>材质与光照</li>
  <li>动效与过渡</li>
  <li>排版</li>
  <li>交互</li>
  <li>布局</li>
  <li>图形</li>
</ol>
```

```css
.fill {
  /* @mechanism columns 定的只是栏数，与内容怎么落进这些栏无关 */
  columns: 3;
  column-gap: 16px;
  column-rule: 1px solid rgb(60 48 30 / 0.18);
  /* @mechanism auto 逐栏填满：先把当前栏塞到高度上限，再开下一栏 */
  column-fill: auto;
  /* @mechanism 这个高度是 auto 生效的前提；删掉它，auto 会被退回成 balance */
  block-size: 108px;
  width: min(400px, 84vw);
  margin: 0 0 16px;
  padding: 0;
  list-style: none;
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.fill-balanced {
  /* @mechanism balance 是默认值：先量完内容再找平分点，各栏高度接近 */
  column-fill: balance;
}

.fill li {
  /* @mechanism 条目不能被栏缝劈开，否则会被拆到两栏上 */
  break-inside: avoid;
  padding: 2px 0;
  border-block-end: 1px solid rgb(60 48 30 / 0.12);
}
```

## 边界

- `column-fill: auto` 在没有确定块向尺寸时被当作 `balance`。现象是「写了 auto 还是均分」，而删掉高度改回去也一样——要先确认容器真的有高度。
- 它不会自动加栏。所有栏都填满之后，多出来的内容**直接溢出容器**（默认可见地溢到外面），不像 `balance` 那样重新分配。要收住得自己加 `overflow`。
- 定了 `columns: 3` 就真的是三栏，容器变窄时浏览器只会把栏挤窄，不会退回两栏或一栏。要「栏数随宽度变」就写栏宽下限（`columns: 200px`），让它自己算栏数。
- 分页媒体（打印 / 导出 PDF）里多栏的表现与屏幕上不同，`balance` 只在最后一个分栏片段上生效；多栏版式一定要在打印预览里另看一遍。
- `break-inside: avoid` 只对**装得进一栏**的条目有效。比一栏还高的条目照样会被断开——现象是「同样的规则对短条目管用、对长条目不管用」。
- 均分不是「每栏等高」。内容量除不尽栏数时总会有差，浏览器只是让差值尽可能小。

## 备注

- 需要「按顺序读」的清单（目录、索引、编号步骤）用 `auto`；需要「视觉均衡」的散文用默认的 `balance`，这也是它成为默认值的原因。
- 栏与栏之间的 `column-rule` 只是条装饰线，不占宽度；栏间距由 `column-gap` 决定，两者独立。
