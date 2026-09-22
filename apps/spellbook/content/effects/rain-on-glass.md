---
title: 雨痕玻璃
slug: rain-on-glass
category: 材质
tags: [backdrop-filter, blur, 玻璃, 液体, 自动]
since: 2026-10
source: 机制来自多个独立 backdrop-filter 面板的拼贴，自行实现
when: 玻璃上要有几道往下爬的雨痕，每道都把底下的画面擦亮一小块
stage: photo
tier: core
params:
  - { name: wet, label: 水膜厚度, type: range, min: 0, max: 8, step: 0.5, default: 2.5, unit: px }
---

## 描述

一块被雨打湿的玻璃：整面蒙着一层薄水膜，上面挂着十几道水痕，每一道都往下爬，并且把贴着它的那一小块画面擦得比周围更清楚、更亮。

机制是 ==每一道水痕都是一个独立的小 backdrop 面板==。没有哪一层能真的「只模糊一部分背景」——`backdrop-filter` 要么作用于整个盒子，要么不作用。所以反过来做：先给整块玻璃铺一层轻度的全域水膜模糊，再扔上去十几个细长的椭圆元素，每个自己开一个 `blur` 很小的 backdrop 面板。小面板只覆盖它自己那点面积，于是局部的水痕就把底下的画面**擦清楚**并推亮一点，跟周围的水膜形成对比——这就是水痕看起来像凸起透镜的原因。

细长比是关键：宽度和高度设成 1 : 3.4 左右的椭圆，才是挂着的水痕形状。做成圆形会被读成气泡。

## 代码

```html
<!-- @mechanism 玻璃只负责裁剪，水痕是脚本塞进来的独立小面板 -->
<div class="rain-glass" id="sb-rain">
  <p class="rain-label">雨 痕</p>
</div>
```

```css
.rain-glass {
  position: relative;
  width: min(340px, 82vw);
  height: 190px;
  overflow: hidden;
  border-radius: 14px;
}

/* 全域水膜：整块先蒙一层轻模糊，水痕才有「擦清楚」的对照 */
.rain-glass::before {
  content: "";
  position: absolute;
  inset: 0;
  backdrop-filter: blur(var(--wet, 2.5px));
  background: rgb(210 228 245 / 0.08);
}

.rain-drop {
  position: absolute;
  top: -20%;
  width: var(--w, 10px);
  height: calc(var(--w, 10px) * 3.4);
  border-radius: 50%;
  /* @mechanism 每道水痕自己开一个小 backdrop 面板：它把自己那一小块画面擦清楚、推亮 */
  backdrop-filter: blur(0.4px) contrast(1.3) brightness(1.08);
  box-shadow:
    inset 1px 1px 1px rgb(255 255 255 / 0.85),
    inset -1px -1px 2px rgb(255 255 255 / 0.3);
  animation: rain-fall var(--dur, 5s) linear infinite var(--delay, 0s);
}

@keyframes rain-fall {
  to {
    translate: 0 340px;
  }
}

.rain-label {
  position: absolute;
  inset: 0;
  /* @mechanism 文字要压在雨痕之上，否则会被水痕的对比切碎 */
  z-index: 1;
  display: grid;
  place-items: center;
  margin: 0;
  font: 500 17px/1 system-ui, sans-serif;
  letter-spacing: 0.2em;
  color: #fff;
  text-shadow: 0 1px 10px rgb(0 0 0 / 0.45);
}
```

```js
// @mechanism 脚本只负责摆位置与错开时间，外观全部是 CSS 的事
const glass = document.getElementById('sb-rain')
if (glass) {
  for (let i = 0; i < 14; i++) {
    const drop = document.createElement('i')
    drop.className = 'rain-drop'
    drop.style.left = (Math.random() * 94) + '%'
    drop.style.setProperty('--w', (5 + Math.random() * 9).toFixed(1) + 'px')
    drop.style.setProperty('--dur', (4 + Math.random() * 4).toFixed(1) + 's')
    // 负延迟让雨一开始就在半空中，而不是全体从顶上同时出发
    drop.style.setProperty('--delay', (-Math.random() * 6).toFixed(1) + 's')
    glass.append(drop)
  }
}
```

## 边界

- 水痕数量是有代价的：每个 `backdrop-filter` 元素都要单独采样一次背景。十几个还扛得住，五十个就开始明显掉帧。
- 水痕只能「擦清楚」，不能真的放大或倒转底图。想做出水滴里那种倒像，CSS 做不到，必须换 WebGL 或预制的位移图。
- 负延迟是必须的。没有它，所有水痕会同时从顶上出现，一眼假。
- 元素被 `overflow: hidden` 裁掉时，`backdrop-filter` 采样的是**滚动/位移之后**的位置，动画途中不会有残影；但如果给容器加了 `transform`，采样区域会跟着变换，边缘容易出现一圈错位。
- `contrast(1.3)` 在没有内容的纯色底上完全不显形。这一条和所有玻璃类一样，先要有底图。

## 备注

- 想让雨变小、变疏，调的是脚本里的数量与 `--dur`，不是把水痕做小——做小之后每块采样面积太小，效果会消失。
- 换成横向移动、把椭圆做成横躺的，就是「斜雨打在侧窗上」。
