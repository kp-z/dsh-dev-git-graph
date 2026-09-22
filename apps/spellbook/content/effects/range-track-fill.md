---
title: 滑杆画出去过的部分
slug: range-track-fill
category: 交互
tags: [custom-property, gradient, background-size, 滑杆, 拖拽]
since: 2026-10
source: 机制来自 CSS 自定义属性配合双色硬色标渐变，自行实现
when: 滑杆要一眼看出当前值占了全长的多少，而轨道本身没有这个信息
stage: plain
tier: core
---

## 描述

音量的那种滑杆：圆钮左边的轨道是强调色，右边是灰色底，拖动时两段的分界跟着圆钮走。

麻烦在于 `input[type=range]` 的轨道并不是两个元素，它是一个整体，「已经走过的部分」在盒模型里根本没有对应物。浏览器只给了一个值，比例要自己算。

机制是 ==把当前比例写进一个自定义属性，轨道用双色硬色标渐变把这个比例切出来==。`linear-gradient` 的色标若在同一个位置（`#b4462f 50%, #ddd6ca 50%`）就是一条硬边；把它写成 `calc(var(--p) * 100%)`，硬边的位置就随变量移动。再用 `background-size` 限制上层渐变的宽度，就得到「左段填色、右段留底」的效果。轨道宽度怎么变都不用管——比例是不依赖像素的。

比例必须由脚本写进去，因为 CSS 算不出「值在 min 与 max 之间的位置」。脚本的职责只有一句：把 `(value - min) / (max - min)` 存进变量，颜色的选择权完全留在样式里。这是分工的关键——脚本不做任何视觉决策，换配色不用碰 JS。

上层的填充色和下层底色是分开的两层，所以想改主题只改颜色值，比例逻辑不动。

## 代码

```html
<!-- @mechanism 比例是脚本与样式之间唯一的接口，元素上不写别的状态 -->
<label class="rf">
  音量
  <input class="rf-input" type="range" min="0" max="100" value="35" />
</label>
```

```css
.rf {
  display: grid;
  gap: 10px;
  width: min(280px, 80vw);
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.rf-input {
  appearance: none;
  width: 100%;
  height: 22px;
  background: transparent;
}

/* @mechanism 轨道是一整条，"已走过"没有对应元素，只能用渐变的两段色标画出来 */
.rf-input::-webkit-slider-runnable-track {
  height: 7px;
  border-radius: 999px;
  background-color: #ddd6ca;
  /* @mechanism 上层填充的宽度取 --p，硬色标让两段之间没有过渡带 */
  background-image: linear-gradient(#b4462f, #b4462f);
  background-repeat: no-repeat;
  background-size: calc(var(--p, 0) * 100%) 100%;
}

.rf-input::-moz-range-track {
  height: 7px;
  border-radius: 999px;
  background-color: #ddd6ca;
}

/* @mechanism Firefox 有原生的"已填充"伪元素，不必借变量；变量法是为了跨引擎写法统一 */
.rf-input::-moz-range-progress {
  height: 7px;
  border-radius: 999px;
  background-color: #b4462f;
}

.rf-input::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  margin-top: -6.5px;
  border-radius: 50%;
  background: #fffdf8;
  border: 1.5px solid #b4462f;
  box-shadow: 0 1px 3px rgb(28 26 23 / 0.3);
}

.rf-input::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fffdf8;
  border: 1.5px solid #b4462f;
}

.rf-input:focus-visible {
  outline: 2px solid #b4462f;
  outline-offset: 4px;
}
```

```js
const input = document.querySelector('.rf-input')

function paint() {
  const min = Number(input.min)
  const max = Number(input.max)
  // @mechanism 只算归一化比例，颜色和宽度一律由 CSS 从 --p 推导
  const p = (Number(input.value) - min) / (max - min)
  input.style.setProperty('--p', p)
}

input.addEventListener('input', paint)
paint()
```

## 边界

- 只在 `input` 上监听是不够的：用键盘方向键调整同样只发 `input`，这一点没问题，但如果值是被脚本改的，必须自己再调一次 `paint()`，否则轨道和值会脱节。
- `min` 与 `max` 必须一起读。只按 `value / max` 算比例，在 `min` 不是 0 的滑杆（比如 10 到 50）上分界线会明显偏离圆钮。
- WebKit 与 Firefox 的轨道伪元素名字不同，两套都得写：`::-webkit-slider-runnable-track` 配 `::-moz-range-track`。只写一套的话，另一个引擎上就是一个没有样式的原生滑杆。
- `::-webkit-slider-thumb` 的 `margin-top` 是负值，用来在比轨道高的滑块元素里居中。这个数取决于轨道高度与滑块高度之差，改了尺寸要重算，否则圆钮会浮起来。
- 伪元素继承不到父级的 `--p` 这种事不会发生（自定义属性会继承），但把它定义在 `input` 上而不是 `:root` 上是刻意的：一条页面上多个滑杆各自维护自己的比例，互不干扰。

## 备注

- 「比例 → 变量 → 硬色标渐变」这套可以原样搬到进度条、评分条、步骤条，凡是「一条线上有个分界点」的地方都适用。
- 想让填充色也随比例变化（比如越高越红），只需把填充那层的 `linear-gradient` 换成 `color-mix`，脚本仍然只负责写比例。
