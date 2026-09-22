---
title: 字重的连续过渡
slug: variable-font-weight-morph
category: 排版
tags: [font-weight, keyframes, 标题, 自动]
since: 2026-10
source: 机制来自 CSS Fonts 4 的 font-weight 数值插值与 OpenType 可变字体的 wght 轴，自行实现
when: 悬停或入场时字重要从细长到粗，而不是从一个字重跳到另一个
stage: plain
tier: core
params:
  - { name: dur, label: 周期, type: range, min: 0.8, max: 8, step: 0.2, default: 3.4, unit: s }
  - { name: wt, label: 峰值字重, type: range, min: 400, max: 900, step: 10, default: 850 }
---

## 描述

一行拉丁文标题在呼吸：笔画缓慢变粗又变细，中间没有哪一帧是跳过去的。

机制是 ==font-weight 在可变字体里是轴上的一个数字，可以直接插值==。静态字体只有 400 和 700 两个文件，550 只能靠引擎描粗近似（合成加粗）；可变字体把整段字重做进了同一个文件，浏览器在两个轴坐标之间取中间值，那中间的形状是字体母版插值出来的——笔画粗细与字宽的配比由设计师定，不是算法加上去的描边。

所以「过渡顺不顺」不取决于时长曲线，而取决于字体文件里有没有这条轴。同一段 `animation` 换到静态字体上，看到的就是从细到粗的一次跳变。

时长做成参数是因为字重插值的观感很依赖速度：太快读作闪烁，太慢读作加载中。

## 代码

```html
<!-- @mechanism 字重不在这里给：可变字体把它做成轴上的数字，HTML 只提供文字 -->
<h2 class="vw">SPELLBOOK</h2>
<p class="vw-note">字重是一条可以停在任意位置上的轴</p>
```

```css
.vw {
  margin: 0;
  font-family: system-ui, sans-serif;
  font-size: clamp(32px, 8vw, 60px);
  letter-spacing: 0.02em;
  font-weight: 200;
  /* @mechanism 插值的是数字：200 与 850 之间的每一帧都是字体算出来的形状 */
  animation: vw-breathe var(--dur, 3.4s) ease-in-out infinite;
}

@keyframes vw-breathe {
  0%,
  100% {
    font-weight: 200;
  }
  50% {
    font-weight: var(--wt, 850);
  }
}

.vw-note {
  margin: 10px 0 0;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.55);
}
```

## 边界

- 字体没有可变轴时过渡会退化成跳档：引擎先取最近的可用字重，再对缺档做合成加粗，于是动画看起来是「停一下、跳一次、再停一下」。而且合成加粗会把字撑宽，居中的标题会左右抖动。
- 中文字体几乎都是几档静态字重，所以这个效果在 CJK 上常常完全不出现。示例用拉丁文就是这个原因。
- 同一条轴不要同时用两套写法：`font-variation-settings` 能覆盖 `font-weight` 拿不到的轴（GRAD、slnt），但它与 `font-weight` 同时出现在一个字重上时结果由引擎的优先级决定，很容易出现「过渡到一半就卡住」。
- 字重变化会改变字宽，行宽跟着变，折行位置也就可能变。用在短标题上，或者给容器固定宽度加 `white-space: nowrap`，否则会看到文字在动画里自己换行。

## 备注

- 同一招可以套在 `font-stretch` 与 `font-optical-sizing` 上：可变字体的每条轴都是可插值的数字，凡是数值插值成立的地方，动画就成立。
