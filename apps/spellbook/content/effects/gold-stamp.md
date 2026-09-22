---
title: 金箔压印
slug: gold-stamp
category: 材质
tags: [金箔, 烫印, 文字]
since: 2026-10
source: 机制来自 background-clip: text 与底层独立的 text-shadow 副本，自行实现
when: 标题要做成烫金压印的样子，像精装书封面上压出来的字
stage: dark
tier: core
params:
  - { name: depth, label: 压印深度, type: range, min: 0.5, max: 3, step: 0.25, default: 1, unit: px }
---

## 描述

深色纸面上的金色字，上沿一道暗边、下沿一道亮边，看起来是被压进去的。

机制是 ==金色填色与明暗阴影必须分居两层，金色在上、阴影在下==。烫金的立体感不来自金色，来自**边缘的明暗错位**：受光侧（上）暗、背光侧（下）亮，光就被读成从左上来，字形随之被理解为凹下去。难点在于 `text-shadow` 是画在**字形之上**的一层（它是文字渲染的一部分），而 `background-clip: text` 的金色只是元素的背景，画在更下面。同一元素上同时用这两者，阴影会盖住金色，字变成一团深灰。

所以这里让底层用一条 `::before` 复制文字：字色透明、只留两组反向阴影；真正的字用金色渐变裁进字形，压在它上面。于是两组偏移的影只从边缘露出一线，金色面完好无损。

四条方向（上暗下亮，再加左右各半）比只写上下两条更耐看。只写上下时，斜笔画（K 的撇、S 的弧）两侧没有过渡，边缘会显得是描了一圈假边。

`depth` 是唯一的旋钮，同时控制两组阴影响偏移与模糊。真压印的深度就在 1px 上下：再深就不是纸上的烫印，而是浮雕了，那时该换成 `emboss-relief` 那套双向 inset 阴影。

## 代码

```html
<div class="gs" data-text="烫金">
  <span class="gs-mark">烫金</span>
</div>
```

```css
.gs {
  position: relative;
  display: inline-grid;
  place-items: center;
  font: 700 76px/1.1 "Songti SC", Georgia, serif;
  letter-spacing: 0.06em;
}

.gs-mark,
.gs::before {
  /* 两个副本叠在同一格里，靠绘制顺序分层 */
  grid-area: 1 / 1;
}

.gs::before {
  content: attr(data-text);
  /* @mechanism 字色透明＝只留下偏移的影子；影在底层，金面才不被糊住 */
  color: transparent;
  /* @mechanism 上暗下亮＝凹；两组方向让斜笔画的边缘也有同一光向 */
  text-shadow:
    calc(var(--depth, 1px) * -1) calc(var(--depth, 1px) * -1) calc(var(--depth, 1px) * 1.2) rgb(0 0 0 / 0.9),
    calc(var(--depth, 1px) * -1) var(--depth, 1px) calc(var(--depth, 1px) * 1.2) rgb(0 0 0 / 0.4),
    var(--depth, 1px) var(--depth, 1px) calc(var(--depth, 1px) * 1.2) rgb(255 244 200 / 0.5),
    var(--depth, 1px) calc(var(--depth, 1px) * -1) calc(var(--depth, 1px) * 1.2) rgb(255 244 200 / 0.22);
}

.gs-mark {
  position: relative;
  /* @mechanism 金色裁进字形后压在影子之上，于是明暗只从边缘露出一线 */
  background: linear-gradient(168deg, #fff3bd, #e0b34a 28%, #8a5f14 55%, #f6df94 78%, #b98a26);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
```

## 边界

- **金色和 `text-shadow` 不能放在同一个元素上。**背景（含 `background-clip: text` 的金色）绘制在元素背景层，而文字阴影属于文字层、画在其上；两者叠加时阴影会盖住金色。这是这个效果最容易踩的坑，表现是「字看起来是深灰的，完全不像金」。分辨方法：把 `text-shadow` 临时删掉，如果金色立刻出现，就是踩了这个。
- 金色靠 `linear-gradient` 的多段明暗成立（亮—暗—亮—暗）。只有一段的话是一块平金色，金属感全无——这和 `metal-foil` 同源：金属感来自明暗跳变的**频率**。
- 底层的 `::before` 用 `content: attr(data-text)` 复制文字，所以**文本必须同时写在 HTML 和 `data-text` 里**，两处不一致时影子和金面会错位——这是纯 CSS 方案的固有代价。
- `-webkit-text-fill-color: transparent` 与 `color: transparent` 要同时写。只写 `color` 时，部分引擎仍会用 `color` 画抗锯齿边缘，字会挂一圈脏边。
- 深色底几乎是必需的。浅底上暗边与亮边都缺对比，压印会退化成模糊描边，金色本身也失去明暗区间。
- 极细字重会糊：阴影偏移量是按笔画宽度被感知的，weight 100~200 的字在 1px 偏移下直接变成一坨。
- `letter-spacing` 必须写在容器上让两层共同继承。只写在其中一层时，两层的字宽不同，影子会整体错位。

## 备注

- 把明暗方向对调（亮在上、暗在下）就是把字**凸**起来，机制一字不改。
- 金色渐变两端换成偏青与偏洋红就是镭射烫金，压印的立体感仍在。
