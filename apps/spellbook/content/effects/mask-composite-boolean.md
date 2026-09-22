---
title: 两层遮罩做布尔运算
slug: mask-composite-boolean
category: 图形
tags: [mask, repeating-gradient, gradient, 图案]
since: 2026-10
source: 机制来自 CSS Masking 的 mask-composite，自行实现
when: 想只在渐变淡出的范围里露出条纹，而不是整块都露
stage: dark
tier: core
---

## 描述

斜条纹只在中间那一段出现：往上、往下都渐变淡出，像隔着一道百叶窗看灯光。

机制是 ==mask-composite 决定多层遮罩之间怎么合成，intersect 取交集、subtract 从下面几层里挖掉一层==。一层遮罩只能表达「一张灰度图当作透明度」，而「条纹」和「中间亮、上下淡出」是两件互相独立的事，必须拆成两层。默认的合成方式是 `add`——后写的那层叠在累积结果**之上**，于是条纹不透明的地方直接把淡出带的透明度盖掉，条纹一路通到顶，淡出只剩下条纹之间的缝隙。改成 `intersect` 就是取交集（alpha 相乘），两个约束同时成立：条纹给出横向节奏，渐变给出纵向范围。

这就是「一个效果由两个正交条件共同定义」时的通用解法。同一套运算反过来用就是挖洞：`subtract` 从渐变里减掉一个圆，得到一圈只在某处透光的形状；`exclude` 取异或，两层重叠的地方反而被镂空。它们都不是新的属性，只是同一个 `mask-composite` 换了取值。

层序是这里的第二个变量，也是最容易搞反的一处：合成是「这一层与它**下面所有层**的累积结果」做运算，不是相邻两层逐一算。对 `intersect`、`add` 这类可交换的运算感觉不出来，但 `subtract` 的顺序决定了谁挖谁，换一个层序结果完全反过来。另外，条纹的粗细与角度、淡出带的位置都是设计选择，而它们的分工是固定的：条纹决定「哪儿有」，渐变决定「哪儿亮」。

## 代码

```html
<div class="mc">
  <input class="mc-toggle" id="mc-on" type="checkbox" checked>
  <label class="mc-label" for="mc-on">取交集</label>
  <div class="mc-plate"></div>
</div>
```

```css
.mc {
  display: grid;
  justify-items: center;
  gap: 10px;
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #f0ead9;
}

.mc-plate {
  width: min(320px, 82vw);
  height: 220px;
  border-radius: 16px;
  background: linear-gradient(150deg, #38e0c8, #7c5cff 55%, #ff9a5a);
  /* @mechanism 两层遮罩各管一件事：条纹管横向节奏，渐变管纵向范围 */
  mask-image:
    repeating-linear-gradient(96deg, #000 0 9px, transparent 9px 22px),
    linear-gradient(180deg, transparent, #000 38%, #000 62%, transparent);
  /* @mechanism intersect 取交集（alpha 相乘），两个条件同时成立 */
  mask-composite: intersect;
}

/* 取消勾选做对照：回到默认的 add，条纹层盖在淡出带之上，于是通到顶 */
.mc-toggle:not(:checked) ~ .mc-plate {
  mask-composite: add;
}

.mc-toggle {
  accent-color: #b4462f;
}
```

## 边界

- 关键字在旧 WebKit 上是另一套：`-webkit-mask-composite` 用的是 SVG 的命名（`source-in`、`destination-in`……），含义与标准的 `intersect` / `subtract` 并不一一对应。只写标准属性时，旧 Safari 上整条声明失效，遮罩退回默认的 `add` 合成——元素比预期亮，且不报错。要照顾旧版就把两条都写上，并逐条核对关键字。
- 层数不必与 `mask-composite` 的项数一一对应（值会循环使用），但每一项的含义始终是「与我下面的累积结果合成」，所以要从下往上读，别按视觉层序猜。
- `intersect` 是 alpha 相乘，两层都半透明的地方会变得更透（0.5 × 0.5 = 0.25）。这是「交集」的定义，不是变暗的 bug；想要「至少一层可见」那应该用 `add`。
- 每层的 `mask-size` / `mask-position` 各自独立（它们本身也是列表）。用重复渐变时若不显式给尺寸，渐变会铺满整个盒子，条纹的节奏会随元素尺寸变化——同一个效果在宽屏上就变粗了。
- 遮罩只管可见性，不改布局也不改命中区域：被遮掉的部分仍然可以被点到、被选中——元素盒本身没有变小。
- 多层大面积遮罩要参与合成，低端设备上有成本；静态的小元素无所谓，别把它铺满整屏还叠动画。

## 备注

- 同一套布尔运算也适用于 `mask-border` 之外的场合：交集做「装饰限定在某个区域内」，差集做「镂空 / 挖洞」，异或做「只留两边、中间透掉」。
