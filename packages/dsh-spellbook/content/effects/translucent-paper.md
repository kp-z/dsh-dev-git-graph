---
title: 透光纸
slug: translucent-paper
category: 材质
tags: [blend-mode, backdrop-filter, 纸感, 容器]
since: 2026-10
source: 机制来自 CSS Compositing 规范的 background-blend-mode，自行实现
when: 一张纸要透着背后的光，纤维和厚薄不均都得看得见
stage: photo
tier: core
params:
  - { name: thin, label: 薄处透光, type: range, min: 0, max: 0.8, step: 0.04, default: 0.42 }
---

## 描述

一张米色的纸压在照片上，逆着光看：纤维的横竖纹路都在，几处薄的地方亮得像要透过去，纸的边缘还毛着。

机制是 ==background-blend-mode 让两层背景在同一个元素里先混合，再参与外部合成==。它和 `mix-blend-mode` 的分工很清楚：`mix-blend-mode` 混的是「我和我下面的元素」，一定会漏到父级底色上去；`background-blend-mode` 混的是「我自己的这几层背景」，混完仍然是一个普通背景。做纸这种「多层纹理叠成一整块材质」的活儿，用后者才不会把父级的颜色也搅进来，也不需要额外加一层 DOM。

纸的透光感来自第三层：一条提亮的径向渐变，用 `screen` 混上去，对应「这一块薄、光透得多」。没有它，三层纤维混出来只是块花布，不是逆光的纸。而最底下那层纸色**必须留出透光率**——写成不透明的米色，背后那层光就一点也透不过来，逆光立刻不成立。

## 代码

```html
<div class="paper">
  <p>纸的纤维是两种方向的横竖纹叠出来的。</p>
</div>
```

```css
.paper {
  /* @mechanism 四层背景在同一个元素内混合，混完仍是一个普通背景，不会漏到父级 */
  background-image:
    repeating-linear-gradient(var(--fiber, 96deg), rgb(122 90 56 / 0.16) 0 1px, transparent 1px 4px),
    repeating-linear-gradient(8deg, rgb(146 116 78 / 0.12) 0 1px, transparent 1px 6px),
    radial-gradient(130% 100% at 28% 18%, rgb(255 255 255 / var(--thin, 0.42)), transparent 58%),
    /* @mechanism 底色必须留出透光率：不透明的纸，背后那点亮光根本透不过来 */
    linear-gradient(158deg, rgb(253 246 229 / 0.84), rgb(241 224 194 / 0.76));
  background-blend-mode: multiply, multiply, screen, normal;
  /* @mechanism 提亮背景才是「逆光」：纸本身不发光，光是从它背后透过来的 */
  backdrop-filter: brightness(1.14);
  border-radius: 4px 14px 6px 16px;
  padding: 30px 34px;
  color: #43331f;
  font: 400 15px/1.8 system-ui, sans-serif;
}
```

```js
// @mechanism 纤维走向交给脚本随机一次：每张纸的纹路角度不该完全一样
const paper = document.querySelector('.paper')
if (paper) {
  paper.style.setProperty('--fiber', (88 + Math.random() * 16).toFixed(1) + 'deg')
}
```

## 边界

- `background-blend-mode` 的列表与 `background-image` 的层**按位置一一对应**，写少一个就会错位，表现是纤维忽然盖掉了纸的底色。层数改了，列表必须跟着改。
- 参与混合的层如果有透明区域，透明处不参与计算，露出的是再下面一层——渐变的收尾位置因此很明显，收得太急会显出一圈色带。
- 两层 `multiply` 的纤维叠起来比看上去暗得多。第一层的 alpha 要给到 0.12 以下，否则纸会变灰。
- 逆光靠的是 `backdrop-filter: brightness()`，所以**这一条必须有底图**，白底上它只是一张米色的纸。
- 四角不等的 `border-radius` 是为了毛边的观感，但真正的毛边（deckle edge）需要遮罩；只靠圆角只能做到「不齐」，做不到「毛」。

## 备注

- 用 `mix-blend-mode` 也能做出纸，但那会连父级的底色一起混——放在浅色卡片里会脏，放在深色区又太亮。这就是选 `background-blend-mode` 的理由。
- 想要「双面印刷透过来」的观感，再叠一层 `scaleX(-1)` 的低透明度文字层，光穿过纸时能看见背面的字。
