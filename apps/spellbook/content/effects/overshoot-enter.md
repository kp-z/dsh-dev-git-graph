---
title: 过冲才有弹性
slug: overshoot-enter
category: 动效
tags: [keyframes, transform, 3d, 卡片, 入场]
since: 2026-09
source: miniMAC/magic（MIT） — boingInUp，改写为独立最小示例
when: 元素入场要有回弹的劲儿，不想引入弹性库
stage: dark
tier: core
---

## 描述

一块牌匾从「躺平」的位置甩起来，中途过头了一点，再回到正位。

机制是 ==过冲：让动画中段越过终态再回来==。关键帧是 `-90deg → +50deg → 0deg`——中间那个 **+50 度就是「过头了」**。回弹的那一段就是弹性的来源。

浏览器不会替你做这件事：线性或缓动插值永远单调地走向终态，**过头必须自己写进关键帧**。

## 代码

```html
<div class="boing-stage">
  <div class="boing-board">咒</div>
</div>
```

```css
.boing-stage {
  display: grid;
  place-items: center;
  width: min(300px, 78vw);
  height: 220px;
  background: #0a0810;
  perspective: 900px;
  overflow: hidden;
}

.boing-board {
  display: grid;
  place-items: center;
  width: 130px;
  height: 130px;
  background: linear-gradient(150deg, #d9a441, #a97c22);
  font: 700 34px/1 Georgia, serif;
  color: #241d33;
  /* @mechanism 原点在顶边，它像铰链一样甩起来 */
  transform-origin: 50% 0%;
  animation: boing-in 2.4s cubic-bezier(0.3, 0, 0.4, 1) infinite alternate;
}

@keyframes boing-in {
  0% {
    opacity: 0;
    transform: rotateX(-90deg);
  }
  50% {
    opacity: 1;
    /* @mechanism 这一帧「过头了」：越过终态再回来，才有回弹 */
    transform: rotateX(50deg);
  }
  100% {
    opacity: 1;
    transform: rotateX(0deg);
  }
}
```

## 边界

- 过冲量决定「硬度」：50 度是明显的弹性，10 度就只是「轻微晃了一下」。这个数字是本效果唯一需要调的。
- 用 **cubic-bezier** 也能做过冲（把第二或第三个控制点放到 [0,1] 之外），而且不用手写中间帧。但那样只能过冲一次且方向单一，关键帧方式能编排多次回弹。
- 过冲会**短暂超出终态的边界**。容器有 `overflow: hidden` 时，过头的那一瞬会被切掉，弹性感就没了——这是最常踩的坑。
- origin 在 `50% 0%` 时元素像帘子一样翻下来。换成 `50% 50%` 就是绕中心翻，弹性感会弱一些。
- 不要用在有大段文字的元素上。来回动的时候文字很难读，而且可能触发前庭不适。
- 要给 `prefers-reduced-motion` 留退路：关掉时元素直接以终态出现。

## 备注

- 原实现是 miniMAC/magic（MIT） 的 `boingInUp`（`boingOutDown` 是它的反向）。
- 过冲是「弹性」的唯一来源。想要弹性，就一定得有过头的帧——这不是风格问题，是机制问题。
