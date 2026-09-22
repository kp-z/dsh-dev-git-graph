---
title: 荧光灯的闪烁
slug: fluorescent-flicker
category: 材质
tags: [keyframes, 霓虹, 发光, 容器, 自动]
since: 2026-10
source: 机制来自荧光灯镇流器不稳定时的闪烁波形，自行实现
when: 一个场景要「这盏灯快坏了」的不安感
stage: dark
tier: core
---

## 描述

深色房间里一盏偏青绿的灯亮着，大部分时间是稳的，但每隔几秒会不规律地抖一下，偶尔短暂掉到大半暗。

机制是 ==可信度来自关键帧之间间距不等，而不是亮度变化的幅度==。人眼对周期性极其敏感：只要亮度按固定节奏起伏，哪怕幅度很小，也会立刻被读成呼吸灯。真实荧光灯的抖动是镇流器的电气不稳定造成的，它的波形是长时间平坦、加上极短促的几次跌落，而且每次跌落的深度和间隔都不同。所以关键帧要写成几组挨得很近、彼此间距不一致的百分比（37.6、38.9、39.4、40.2……），并且只占整个周期的很小一部分，其余全钉在 100%。

这也能用 `steps()` 做，但 `steps()` 给出的必然是等间隔跳变，恰好是要避免的东西；它适合做机械式的逐格推进，不适合做故障。可变的是跌落深度、抖动段的疏密，以及整体的色偏——荧光灯偏绿来自荧光粉的光谱。

## 代码

```html
<div class="tube">
  <span>荧光灯</span>
</div>
```

```css
.tube {
  position: relative;
  display: grid;
  place-items: center;
  width: min(400px, 84vw);
  height: 200px;
  background: #05070a;
  color: #8b9a8e;
  font: 400 13px/1.6 system-ui, sans-serif;
}

.tube::before {
  content: "";
  position: absolute;
  inset: 38px 36px auto;
  height: 26px;
  border-radius: 13px;
  background: linear-gradient(#eafff0, #b6ffd2 60%, #86f0b8);
  box-shadow:
    0 0 24px rgb(150 255 200 / 0.55),
    0 0 70px rgb(120 255 190 / 0.3);
  /* @mechanism 抖动段只占周期的一小截，其余时刻全钉在 100%，才不像呼吸灯 */
  animation: ballast 6.5s infinite;
}

.tube span {
  position: relative;
  translate: 0 62px;
}

@keyframes ballast {
  0%, 37%, 38.4%, 41%, 52%, 68%, 100% { opacity: 1 }
  37.6% { opacity: 0.42 }
  38.9% { opacity: 0.72 }
  39.4% { opacity: 0.28 }
  40.2% { opacity: 0.85 }
  51.4% { opacity: 0.55 }
  51.8% { opacity: 1 }
  67.3% { opacity: 0.34 }
  67.9% { opacity: 0.93 }
}
```

## 边界

- 关键帧的百分比必须严格递增，写乱了整条动画会被浏览器丢弃，现象是灯一直亮着、什么都不发生，而且不报错。
- 抖动段太密就变成频闪，对光敏感的人有风险。真实的荧光灯故障是稀疏的，`prefers-reduced-motion` 下应当整个关掉。
- 灯管的发光是靠 `box-shadow` 画的，而动画改的是 `opacity`，会连带让阴影重新栅格化。同屏多盏灯时这是可观的代价。
- 整条灯管的透明度都被动画占用了，它就不能再用来表达别的东西（比如开关）。要「关灯」得另加一层。
- 周期写死成 6.5s 时，观察久了还是听得出节奏。要真正不可预测就得用 JS 随机重排，代价是失去纯 CSS 的可暂停性。
- 跌落的最低值只到 0.28，是因为再暗下去就不像荧光灯而像接触不良的灯泡。深度和灯的「型号」是绑定的。

## 备注

- 同一套不等距关键帧就是所有「电子设备故障感」的做法：坏掉的霓虹灯、接触不良的显示器、闪烁的仪表盘。
- 给同屏的多盏灯各写一个随机的负 `animation-delay`，它们就不会同步闪，观感真实很多。
