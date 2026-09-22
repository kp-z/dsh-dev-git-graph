---
title: 字符随机抖动
slug: char-jitter-random
category: 动效
tags: [随机, 抖动, 动画周期]
since: 2026-10
source: 机制来自逐字符随机化的动画周期，自行实现
when: 一段文字要像霓虹灯或手写一样不安分，每个字抖的节奏都不一样
stage: dark
tier: core
params:
  - { name: amp, label: 抖动幅度, type: range, min: 0, max: 4, step: 0.2, default: 1.2, unit: px }
---

## 描述

一句话一直轻微地晃，有的字往左上抽、有的往右下缩，看久了会发现它们谁都不跟谁同步。

机制是 ==把「随机」写成每个字自己的动画周期，周期互不相同就永远不同步==。每个字的时长取自一张质数毫秒表，再配一个随机的初始相位（用负延迟）。如果所有字都用同一个时长、只是相位不同，几秒之后它们会重新对齐，那一瞬间整段字会像被谁推了一把；周期互质时，重新对齐要等很久，观感就是「一直在乱」。随机只在初始化时算一次，之后整段动画由合成器接管——每帧重新摇反而是布朗运动，看起来是流动的噪声，不是「抖」。

这里还有一个容易被滑杆坑到的分工：幅度由全局旋钮 `--amp` 出，每字只写一个 0.6 到 1.4 的系数 `--k`。如果让脚本把随机幅度直接写进 `--amp`，逐字的内联值会盖掉旋钮，滑杆就成了假的。

## 代码

```html
<!-- @mechanism 原文交给脚本逐字包 span；抖动是每字一条独立的动画 -->
<h3 class="jit" id="sb-jit">不安分的一段字</h3>
```

```css
.jit {
  width: min(430px, 86vw);
  margin: 0;
  font: 600 24px/2.2 system-ui, sans-serif;
  color: #f4ead6;
  text-shadow: 0 0 16px rgb(244 234 214 / 0.25);
}

.jit span {
  display: inline-block;
  /* @mechanism 周期与延迟逐字不同，随机只在初始化时算一次 */
  animation: jit-shake var(--dur, 2.2s) ease-in-out infinite;
  animation-delay: var(--delay, 0s);
  /* @mechanism 每字只贡献一个系数，幅度旋钮 --amp 才不会被内联值盖掉 */
  --k: 1;
}

@keyframes jit-shake {
  0%,
  100% { transform: translate(0, 0) rotate(0deg); }
  25% {
    transform:
      translate(calc(var(--amp, 1.2px) * var(--k)), calc(var(--amp, 1.2px) * var(--k) * -0.6))
      rotate(-1.6deg);
  }
  50% {
    transform:
      translate(calc(var(--amp, 1.2px) * var(--k) * -0.7), calc(var(--amp, 1.2px) * var(--k) * 0.9))
      rotate(1.1deg);
  }
  75% {
    transform:
      translate(calc(var(--amp, 1.2px) * var(--k) * 0.5), calc(var(--amp, 1.2px) * var(--k) * 0.7))
      rotate(-0.7deg);
  }
}
```

```js
// 质数毫秒：两两之间没有公约数，凑齐一个共同相位要等很久
const PERIODS = [1301, 1601, 1907, 2203, 2503, 2801, 3203]
const root = document.getElementById('sb-jit')
const source = root.textContent
root.textContent = ''

source.split('').forEach((char, i) => {
  const span = document.createElement('span')
  span.textContent = char
  // @mechanism 逐字换周期，而不是逐字换相位：相位同步是必然的，周期同步要等很久
  span.style.setProperty('--dur', PERIODS[i % PERIODS.length] + 'ms')
  span.style.setProperty('--delay', '-' + ((i * 137) % 1300) + 'ms')
  span.style.setProperty('--k', (0.6 + Math.random() * 0.8).toFixed(2))
  root.append(span)
})
```

## 边界

- 每个字都是一条独立动画。几百个字就是几百条动画在跑，叠上 `will-change` 还会把每个字各自提升成一层，显存很快吃紧。抖动只该用在短标题上。
- 周期若都取相近的值（比如都在 2 到 2.5 秒之间），几十秒内必然对齐，能看到整段一起晃一下。差别要够大，取质数毫秒最省事。
- 随机只在初始化时算一次。改成每帧重算会绕过合成器，而且观感从「抖」变成「噪声在流」，是另一种东西。
- 这里用的是 `split('')`，emoji 与组合字符会被拆坏（家庭 emoji 拆成好几个孤立码元）。要拆得对得按字素簇切分。
- 逐字 `inline-block` 让空白折叠成零宽，也破坏了英文单词的换行规则：文本会粘成一坨，长句的断行位置也不自然。
- 幅度用 px 写，字号一变大就显得相对变小；用 `em` 更稳，但它会随字号一起放大，大标题上要重新调。
- 持续抖动是前庭敏感人群明确要避开的效果。`prefers-reduced-motion` 下应当整段停掉，或把幅度压到肉眼不可见。

## 备注

- 把 `rotate` 拿掉、只留位移，就从「手写感」变成「电磁干扰」；反过来加大旋转、缩小位移，会像每个字各有一根轴。
- 质数周期表这套做法与具体效果无关，凡是「一堆东西要一直不同步」的场合——音符指示灯、心跳点、随机闪烁的星星——都能直接用。
