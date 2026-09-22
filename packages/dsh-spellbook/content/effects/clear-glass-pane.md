---
title: 透光清晰玻璃
slug: clear-glass-pane
category: 材质
tags: [backdrop-filter, 玻璃, 容器]
since: 2026-10
source: 机制来自 CSS Filter Effects 规范的 backdrop-filter 反差函数，自行实现
when: 面板压在内容上，你要的是能看清底下，而不是糊掉底下
stage: photo
tier: core
params:
  - { name: clarity, label: 清晰度, type: range, min: 1, max: 3, step: 0.1, default: 1.4 }
  - { name: lift, label: 提亮, type: range, min: 0.9, max: 1.6, step: 0.05, default: 1.08 }
---

## 描述

一块压在照片上的玻璃板：底下的画面没有被磨掉，反而比周围更清楚、亮一点、颜色更足，像是真的隔了一层清玻璃在看。

机制是 ==backdrop-filter 的反差与提亮函数==。它做的正好是模糊的反面——`blur` 把底下的细节抹平，而 `contrast()` 把邻接像素的差异拉大、`brightness()` 整体抬高。所以玻璃底下是「更硬」的画面，不是更软的。反差放大对低对比区域尤其明显：灰蒙蒙的天、逆光的暗部，一压上玻璃就分出了层次。

因此玻璃要薄：透光率压到 0.1 左右，只留一点冷色和上沿的一条高光。透光率一高，底下的画面就被自己的颜色盖住了，机制也就白做了。

## 代码

```html
<!-- @mechanism 这块面板自己不带图，它显示的全是底下透上来的内容 -->
<div class="clear-pane">
  <strong>清玻璃</strong>
  <span>底下比周围更清楚</span>
</div>
```

```css
.clear-pane {
  /* @mechanism 反差与提亮，而不是模糊：底下的细节被拉大而不是抹平 */
  backdrop-filter: brightness(var(--lift, 1.08)) contrast(var(--clarity, 1.4));
  /* 透光率必须低，底下的画面才没有被自己的颜色盖住 */
  background: rgb(214 232 250 / 0.1);
  border: 1px solid rgb(255 255 255 / 0.5);
  border-radius: 14px;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.75),
    0 14px 34px rgb(10 16 26 / 0.3);
  padding: 24px 28px;
  display: grid;
  gap: 6px;
}

.clear-pane strong {
  font: 600 20px/1.2 system-ui, sans-serif;
  letter-spacing: 0.02em;
}

.clear-pane span {
  font: 400 14px/1.5 system-ui, sans-serif;
  color: rgb(234 242 255 / 0.85);
}
```

## 边界

- 反差放大会同时放大噪声。底图本身有噪点或被 JPEG 压过时，玻璃底下会显出一层颗粒，比不压玻璃还脏。
- 同样是祖先带 `filter` / `transform` / `will-change` 就整块失效——不报错，只是忽然不再变清楚，很容易被误当成「配色不对」。
- 底图色调偏冷时 `contrast` 会把蓝紫一起推上去，整块玻璃看着发脏。这时该加的是 `saturate(0.92)`，不是继续加亮度。
- 白底或纯色底上它几乎看不出来：反差只放大差异，而纯色没有差异可放大。这和 `liquid-glass` 是同一个依赖。
- 没有 `-webkit-` 前缀。Safari 16.4 以前只认前缀版本，旧 Safari 上会退成一块近乎空的半透明矩形，文字直接压在照片上。

## 备注

- 同一招用在视频或 canvas 上的观感差别很大：视频本身每帧都在动，反差拉大后更像一台真的显示器压在玻璃下。
- 想在深色主题里做「夜景望远」，把 `lift` 降到 1.02、`clarity` 提到 1.6 更合适，别靠提亮去补暗。
