---
title: 一块元素叠两个动画
slug: multi-animation-stack
category: 动效
tags: [keyframes, transform, 卡片, 入场, 自动]
since: 2026-09
source: 机制来自 CSS Animations 的多值语法，自行实现
when: 元素要一边做入场、一边持续呼吸，两件事同时进行
stage: dark
tier: core
---

## 描述

卡片升上来之后一直轻轻起伏——入场只播一次，呼吸永不停。

机制是 ==animation 用逗号分隔多组动画，每组各走各的时间轴==。`animation` 的每个子属性都可以写成列表，按位置一一对应。所以「0.6 秒的入场 + 2.4 秒的无限循环」可以同时挂在一个元素上。

唯一要守的规矩是：两组动画**不能碰同一个属性**。

## 代码

```html
<div class="ms">
  <b>入场 + 呼吸</b>
  <span>两个动画同时跑</span>
</div>
```

```css
.ms {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  width: min(240px, 76vw);
  height: 160px;
  border: 1px solid rgb(217 164 65 / 0.4);
  background: linear-gradient(160deg, #241d33, #120f1c);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
  /* @mechanism 逗号分隔多组动画，各走各的时间轴 */
  animation:
    ms-rise 0.65s ease both,
    ms-breathe 2.6s ease-in-out 0.65s infinite;
}

.ms b {
  font-size: 17px;
}

@keyframes ms-rise {
  from {
    opacity: 0;
    transform: translateY(22px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* @mechanism 只碰 scale，与入场动画的 translate/opacity 不重叠 */
@keyframes ms-breathe {
  0%,
  100% {
    scale: 1;
  }
  50% {
    scale: 1.035;
  }
}
```

## 边界

- 两组动画碰同一个属性时，**后声明的赢**（在重叠的时间段内）。这是「叠了动画但看起来只有一个」的原因。要分开就用不同属性——比如一个动 `translate`、另一个动 `scale`。
- `animation` 简写里两个 `<time>` 值按位置解析：**第一个是时长、第二个是延迟**。写反了不报错，但动画会以完全不同的节奏跑。
- `animation-fill-mode` 也是按组独立的。入场要 `both`、循环要 `none`，得分别写清楚。
- 简写会**重置**该元素所有动画子属性。想保留某组动画的某个子属性，就得用完整写法补回来。
- 动画数量越多，每帧的计算量越大。低端设备上多个 `transform` 动画叠加也会掉帧。
- 配合 `animation-timeline` 时，时间轴同样是按组分的：只给一组加了滚动驱动，另一组仍按时间播放——这个组合很有用，但也很容易看错。

## 备注

- 入场用 `transform`、循环用独立属性 `scale`，是避免冲突最省心的分工方式。
- 把「入场」和「循环」的动画名分开写，比在一个关键帧里既做位移又做缩放更好维护。
