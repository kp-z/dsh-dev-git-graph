---
title: 比例算在哪个盒子上
slug: aspect-ratio-box-sizing
category: 布局
tags: [比例, 盒模型, box-sizing]
since: 2026-10
source: 机制来自 CSS Sizing 规范中 aspect-ratio 与 box-sizing 的交互，自行实现
when: 两个盒子写了同样的宽度、同样的比例、同样的内边距，量出来的外框却不一样
stage: grid
tier: core
---

## 描述

两个盒子都写着 `width: 160px`、`aspect-ratio: 16 / 9`、`padding: 10px`、`border: 2px`。左边那个外框是 160×90，右边那个是 184×114——右边已经不是 16:9 了。

机制是 ==aspect-ratio 约束的是 box-sizing 指定的那个盒子==。默认的 `box-sizing: border-box` 让比例作用在**边框盒**上：外框就是 16:9，`padding` 与 `border` 从框内扣，内容区被挤小。改成 `content-box` 之后参照物换成**内容盒**——`width: 160px` 说的变成内容宽度，比例算出的 90px 也变成内容高度，内边距与边框**额外叠加上去**，外框于是变成 184×114。

这也解释了「给卡片加了内边距之后比例就不对了」：`aspect-ratio` 不是一句视觉描述，它是尺寸计算的一部分，而尺寸计算总要有一个参照的盒子。`box-sizing` 就是那个开关，两者必须一起读——只改其中一个，比例就换了含义。

## 代码

```html
<!-- @mechanism 两个盒子声明的宽度与比例完全相同，唯一的差别是 box-sizing -->
<div class="shot">
  <div class="shot-frame">border-box<br />160 × 90</div>
  <div class="shot-frame frame-content">content-box<br />184 × 114</div>
</div>
```

```css
.shot {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 12px;
  background: rgb(255 255 255 / 0.5);
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 400 12px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.shot-frame {
  /* @mechanism 比例的参照是 box-sizing 指的那个盒子；border-box 下外框就是 16:9 */
  box-sizing: border-box;
  aspect-ratio: 16 / 9;
  width: 160px;
  display: grid;
  place-items: center;
  text-align: center;
  border: 2px solid rgb(60 48 30 / 0.45);
  padding: 10px;
  background: rgb(60 48 30 / 0.06);
}

.frame-content {
  /* @mechanism content-box 把参照换成内容盒：内边距与边框再叠上去，外框就不成比例了 */
  box-sizing: content-box;
}
```

## 边界

- `content-box` 下比例按内容盒算，`padding` 与 `border` 会额外加上去。现象是「明明写了 16/9，量出来比 16/9 多一圈」——不是浏览器算错，是参照物换了。
- 比例只在一个方向上是"硬"的：同时写了 `width` 与 `height` 时 `aspect-ratio` 直接让位，两个值都写死就没有任何比例行为。
- 内容比比例框高时，`aspect-ratio` 只是**下限**。默认的 `min-height: auto` 会让盒子被内容撑高、比例被打破，要锁死就得显式写 `overflow: hidden` 或 `min-height: 0`。
- 绝对定位的子项以父级的**内边距盒**为包含块，`inset: 0` 铺满的也是内边距盒——边框那一圈永远不在里面。所以在比例框里看到「覆盖层少了一圈边框」，那是包含块的规则，与 `aspect-ratio` 无关。
- 替换元素（`img`）自带固有比例。外层再声明比例时，图片会按自己的比例缩进这个框，可能上下或左右留白；要铺满得配合 `object-fit`。
- 百分比子元素的解析基准是内容盒。`content-box` 下 `height: 100%` 指的是内容高度，与边框盒的高度之间差着内边距与边框的厚度。

## 备注

- 判断「比例作用在哪个盒子」最快的办法：给盒子加一圈粗边框和一片内边距，看外框比例变不变。
- 同一类取舍也出现在百分比高度、`min-height`、弹性项上——先问一句「这个比例/百分比相对谁」，答案通常就是 `box-sizing` 指的那个盒。
