---
title: 不额外加元素的脉冲环
slug: shadow-ring-pulse
category: 动效
tags: [脉冲, 阴影, 扩散]
since: 2026-10
source: 机制来自 CSS box-shadow 的 spread 半径可动画，自行实现
when: 一个小圆点要表示"正在连接 / 正在收录"，向外一圈圈扩出去
stage: dark
tier: core
params:
  - { name: dur, label: 一次脉冲, type: range, min: 0.8, max: 4, step: 0.1, default: 1.8, unit: s }
---

## 描述

一个青色小圆点，一圈光环从它身上生出来、扩散、淡掉，周而复始。

机制是 ==动画 box-shadow 的第四个值（扩散半径），让阴影从贴身长到远处==。`box-shadow: 0 0 0 0 color` 的最后一个数是 spread，它把阴影轮廓向外扩；把它从 0 动画到 20px 以上、同时把颜色的透明度从有到无，就得到一圈向外扩散并消失的环。妙处在于这**不需要第二个元素**：常做法是叠一个 div 做环、或者用 `::after` 画一个带 border 的圆，而 box-shadow 本来就是这个元素的附属品，用它等于白拿一个图层。

起始半径从 0 开始，环看起来是从本体「长出来」的；透明度终值必须是**同色相的透明版**（`rgb(94 234 212 / 0)`），不能写 `transparent`——后者在多数引擎里是透明黑，脉冲终点会整体发灰，像是掉色而不是淡出。

## 代码

```html
<!-- 状态点本身就承担脉冲，不需要再叠一层"ring"元素 -->
<span class="srp" role="status" aria-label="正在连接"></span>
```

```css
.srp {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #5eead4;
  /* @mechanism 动画 box-shadow 的扩散半径，环就是这个元素的阴影 */
  animation: srp-pulse var(--dur, 1.8s) ease-out infinite;
}

@keyframes srp-pulse {
  0% {
    /* @mechanism 从 spread 0 起步，环才是从本体长出来的 */
    box-shadow: 0 0 0 0 rgb(94 234 212 / 0.5);
  }
  100% {
    /* @mechanism 终点是同色相的透明版，写 transparent 会发灰 */
    box-shadow: 0 0 0 20px rgb(94 234 212 / 0);
  }
}
```

## 边界

- `box-shadow` 不是合成属性，每一帧都要重绘。一个页面上几个脉冲没问题，两百个点同时脉冲就会掉帧——那时应换成伪元素 + `border` 的 `scale`/`opacity`，那两个走合成器。
- 终点颜色写成 `transparent` 会在部分引擎上退化成透明黑，脉冲结尾整体发暗发灰。始终用 `rgb(... / 0)` 的同色透明版。
- 阴影不参与布局，所以环不会把邻居挤开——这是优点，但也意味着父级的 `overflow: hidden` 会直接把扩散到框外的部分切掉，现象是「环扩到一半就没了」。
- 起始 spread 给一个非 0 值（比如 4px）会让第一帧就凭空出现一圈，看起来像闪了一下。
- 脉冲是持续的「有在做事」暗示。任务失败、断线、已完成时还留着它，用户会一直等下去。
- `ease-out` 在这类扩散上比 `linear` 自然（真实波纹也是先快后慢），但也意味着后半段时间里视觉变化很小——周期太短会看起来像静止。

## 备注

- 同一招给「设备在线点」「录音中」「后台同步中」都合适，颜色换一下就是另一层含义。
- 想要双层错位脉冲，加一个伪元素给它一个错开的延迟即可，DOM 上仍然只有一个元素。
