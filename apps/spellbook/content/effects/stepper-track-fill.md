---
title: 步骤条的进度填充
slug: stepper-track-fill
category: 交互
tags: [custom-property, has-selector, 步骤, 进度]
since: 2026-10
source: 机制来自 CSS 自定义属性与 calc 的换算、以及 :has() 的前向兄弟匹配，自行实现
when: 一条三到七步的流程条，要知道走到第几步，但不想为每一步写一条规则
stage: grid
tier: core
---

## 描述

一条横线穿过所有圆点，走过的部分染上颜色；改动只有一个数字。

机制是 ==把轨道与填充分成两层：轨道用伪元素铺满整排（两端各缩进半个圆点），填充是叠在它上面的另一条，宽度由「当前步 / 总步数」用 calc 算出来==。于是「走完第几步」不需要 JS 换算，也不需要逐段连线——加一步两步只是多一个圆点，线本身不用动。逐段点亮的写法还有个隐患：圆点间距一旦不等，段与段之间会露出口子。

这里的分母是 ==间隔数而不是步数==：四步之间只有三段间隔，用步数当分母，最后一步永远差一格到不了满。另一半是完成态：`:has(~ [aria-current])` 这条前向兄弟匹配把「后面还站着当前步」翻译成「我在它前面」，于是已完成、未完成都不用逐项写类名。

可变的是填充从哪来。演示里它是写在 CSS 里的两个数，真实流程里由同一次状态更新同时给出「当前步」和「是否是最后一步」，让高亮与长度不会各说各话。

## 代码

```html
<!-- @mechanism 当前步只写在 aria-current 上，完成态由它反推，不另设类名 -->
<ol class="stp">
  <li class="stp-item">
    <span class="stp-dot">1</span>
    <span class="stp-txt">填写</span>
  </li>
  <li class="stp-item">
    <span class="stp-dot">2</span>
    <span class="stp-txt">校验</span>
  </li>
  <li class="stp-item" aria-current="step">
    <span class="stp-dot">3</span>
    <span class="stp-txt">提交</span>
  </li>
  <li class="stp-item">
    <span class="stp-dot">4</span>
    <span class="stp-txt">完成</span>
  </li>
</ol>
```

```css
.stp {
  --count: 4;
  --step: 3;
  --pad: 15px;
  position: relative;
  display: flex;
  justify-content: space-between;
  width: min(400px, 86vw);
  margin: 0;
  padding: 0;
  list-style: none;
  font: 400 12px/1.6 system-ui, sans-serif;
  color: #1b1710;
}
/* @mechanism 轨道只画一条、铺满整排，两端各缩进半个圆点，线才不会从圆点中心穿出去 */
.stp::before,
.stp::after {
  content: '';
  position: absolute;
  top: 14px;
  height: 2px;
}
.stp::before {
  inset-inline: var(--pad);
  background: rgb(60 48 30 / 0.16);
}
.stp::after {
  inset-inline-start: var(--pad);
  background: #b4462f;
  /* @mechanism 分母是间隔数（步数减一）：用步数当分母，最后一步永远到不了满 */
  width: calc((100% - var(--pad) * 2) * (var(--step) - 1) / (var(--count) - 1));
}
.stp-item {
  display: grid;
  justify-items: center;
  gap: 6px;
}
.stp-dot {
  /* @mechanism 绝对定位的填充层会压过在流内容，圆点必须自己抬上来 */
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 2px solid rgb(60 48 30 / 0.2);
  border-radius: 50%;
  background: #efe9dd;
}
/* @mechanism 已完成 = 它后面还站着一个当前步，一条前向兄弟选择器就够 */
.stp-item:has(~ .stp-item[aria-current='step']) .stp-dot {
  background: #b4462f;
  border-color: #b4462f;
  color: #fff;
}
.stp-item[aria-current='step'] .stp-dot {
  border-color: #b4462f;
  color: #b4462f;
  font-weight: 600;
}
.stp-txt {
  color: rgb(27 23 16 / 0.6);
}
.stp-item[aria-current='step'] .stp-txt {
  color: #b4462f;
  font-weight: 600;
}
```

## 边界

- 分母写成步数而不是间隔数（`count` 而不是 `count - 1`），最后一步的填充永远差一格到不了末端，而圆点却已经是「完成」的样子——两个信号互相矛盾。
- 两端缩进必须等于圆点半径。写成 0 时线会从圆点中心穿出去，视觉上像被圆点串起来而不是连起来；写死像素则意味着换圆点尺寸要连改两处。
- 填充层是绝对定位的，会盖在在流内容之上；圆点不设 `position: relative; z-index: 1` 就会被线划过。
- `:has(~ ...)` 要求当前步与其它项是**兄弟**。一旦为了布局给每一步包一层 div，前向兄弟匹配就跨层失效，完成态整排都不亮。
- `--count` 是手写的，与 HTML 里的步骤数必须人工同步。多一步少一步忘了改，比例就错，而且不报错——这是把结构信息塞进样式变量必然要付的账。
- 两步流程时公式仍然成立（间隔数为 1），但进度线退化成一整段，视觉上不如直接省掉这条线。
- 这套只解决「显示」。步骤条通常不该可点：跳进未完成的步骤会得到半成品。要让某些步骤可点，得另加可点状态与语义（`aria-current` 之外还要说明它是链接），别只加个 cursor。

## 备注

- `aria-current="step"` 同时承担语义与样式来源，不必再维护一个 `.is-current` 类——两个来源迟早对不上。
- 同一套「一条轨道 + 一层按比例的填充」可以搬到阅读进度、容量占用、评分条：凡是「总量固定、只变一个比例」的地方，都别逐段画。
