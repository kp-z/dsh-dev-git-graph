---
title: 动效的等价替代
slug: reduced-motion-guard
category: 动效
tags: [无障碍, 动效, 媒体查询]
since: 2026-09
source: 机制来自 Media Queries Level 5 的 prefers-reduced-motion，自行实现
when: 系统里关掉了动效，界面还必须有完整的反馈与内容
stage: plain
tier: core
---

## 描述

系统里关掉动效之后，元素不再位移，但该出现的内容照样出现、该有的状态照样变。

机制是 ==prefers-reduced-motion 问的是「系统里关掉动画了吗」，用它把位移换成不位移的等价反馈==。关键在**不要简单地把动画删掉**：删掉之后元素可能停在起始帧（`opacity: 0`、位移未归零），内容直接看不见。正确做法是把动画替换成一个「无位移的终态」。

要删的是**大幅位移、旋转、缩放、视差**；颜色与透明度的淡入通常可以保留。

## 代码

```html
<div class="rm">
  <b>不会动的入场</b>
  <span>内容和状态一样完整</span>
</div>
```

```css
.rm {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  width: min(240px, 76vw);
  height: 150px;
  background: #efe9dd;
  border: 1px solid rgb(60 48 30 / 0.3);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
  animation: rm-slide 0.7s ease both;
  transition: translate 0.3s ease;
}

.rm:hover {
  translate: 0 -6px;
}

.rm b {
  font-size: 17px;
}

@keyframes rm-slide {
  from {
    opacity: 0;
    transform: translateY(28px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* @mechanism 换成无位移的等价终态，而不是把动画删掉 */
@media (prefers-reduced-motion: reduce) {
  .rm,
  .rm:hover {
    animation: none;
    transition: none;
    opacity: 1;
    transform: none;
    translate: none;
  }
}
```

## 边界

- **直接删掉 `animation` 而不处理填模式，元素会停在起始帧**（这里是 `opacity: 0`），内容彻底看不见。这是「无障碍处理」里最危险的一种写法。
- `reduce` 不等于「不要任何动静」。颜色变化与透明度淡入一般可以保留，要删的是大幅**位移、旋转、缩放与视差**。
- 只处理 `animation` 不处理 `transition` 会漏掉一大半：悬停位移通常就是 `transition` 做的。
- 这是**系统级**设置，不是浏览器偏好开关。它表达的不是「我不喜欢动画」，而是「这些效果可能让我不适」——值得认真对待。
- 用 `no-preference` 做正向判断（只在明确允许时才上动效）通常比反向覆盖更稳，因为旧浏览器上这个查询的求值行为不统一。
- 媒体查询改不了已经在 JS 里跑起来的动画。用脚本驱动的效果（比如递归 `requestAnimationFrame`）必须自己读 `matchMedia` 并停下。

## 备注

- 把「动效」与「状态变化」在设计上分开：前者可以被关掉，后者不行。这条边界清楚了，降级方案就是自然的。
- 配 `@media (prefers-reduced-motion: no-preference)` 包住动效，比事后覆盖更不容易漏。
