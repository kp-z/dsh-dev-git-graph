---
title: 渐进模糊
slug: progressive-blur-mask
category: 材质
tags: [backdrop-filter, mask, 玻璃, 浮层, 页头]
since: 2026-10
source: 机制来自 backdrop-filter 与 mask-image 的叠加，自行实现
when: 顶部浮层要有一个软边，别让底下的内容在一条硬线上忽然糊掉
stage: photo
tier: core
params:
  - { name: fade, label: 过渡高度, type: range, min: 10, max: 80, step: 2, default: 34, unit: % }
---

## 描述

一条压在内容顶部的浮层，靠上的一段几乎糊成一片，往下逐渐变清楚，最后自然地接到下面完全清晰的正文——找不出玻璃的边在哪。

机制是 ==用 mask-image 的线性渐变把 backdrop-filter 的强度切出层次==。`backdrop-filter` 本身没有强度旋钮：它要么按给定的半径糊，要么不糊。要做出「渐变模糊」，就得叠几层模糊半径不同的面板，再用 `mask-image` 给每层一条渐隐的遮罩，让相邻两层在交界处各占一部分权重。层数够多，肉眼看就是连续过渡。

层与层不能重叠着都开 100% 不透明度——那样会变成算术平均，而不是层层加深。遮罩的色标要错开，每层只在自己的区间里占主导。

## 代码

```html
<!-- @mechanism 三层同尺寸浮层，只有模糊半径和遮罩区间不同 -->
<div class="pblur">
  <div class="pblur-layer pblur-a"></div>
  <div class="pblur-layer pblur-b"></div>
  <div class="pblur-layer pblur-c"></div>
  <p class="pblur-title">渐 进 模 糊</p>
</div>
```

```css
.pblur {
  position: relative;
  width: min(340px, 82vw);
  height: 190px;
  overflow: hidden;
  border-radius: 14px;
  font: 600 17px/1 system-ui, sans-serif;
  letter-spacing: 0.24em;
  color: #fff;
}

.pblur-layer {
  position: absolute;
  inset: 0;
  /* @mechanism 每层一条渐隐遮罩，只在各自的区间里占主导 */
  mask-image: linear-gradient(#000, transparent);
}

.pblur-a {
  backdrop-filter: blur(2px);
  background: rgb(255 255 255 / 0.06);
  mask-image: linear-gradient(#000 0%, transparent var(--fade, 34%));
}

.pblur-b {
  backdrop-filter: blur(7px);
  mask-image: linear-gradient(transparent 12%, #000 34%, transparent 62%);
}

.pblur-c {
  backdrop-filter: blur(16px);
  mask-image: linear-gradient(transparent 40%, #000 72%);
}

.pblur-title {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  /* @mechanism 文字必须留在所有模糊层之上，否则会被一起糊掉 */
  z-index: 1;
  margin: 0;
  text-shadow: 0 2px 10px rgb(0 0 0 / 0.5);
}
```

```js
// @mechanism 滚动只改遮罩的过渡高度：模糊半径不变，变化的是「糊到哪里为止」
const stage = document.querySelector('.pblur')
if (stage) {
  const sync = () => {
    const ratio = 22 + (stage.scrollTop / 180) * 40
    stage.style.setProperty('--fade', ratio + '%')
  }
  stage.addEventListener('scroll', sync, { passive: true })
  sync()
}
```

## 边界

- 每加一层就是一次离屏合成。三层以内还能接受，到六层以后滚动会明显掉帧，尤其是面板本身还在动的时候。
- 遮罩的色标一旦互相重叠得太多，几层会各占五成权重，过渡区就变成一团均匀的糊，层级感消失。
- `mask-image` 的渐隐区和 `blur` 半径要配套：半径 16px 却只给 10% 的过渡区，看起来还是一道硬边。
- 祖先带 `filter` / `transform` / `will-change` 时 `backdrop-filter` 会整块失效，表现是「突然全都不糊了」，而不是某层不糊。
- 中间层带一点 `background`（比如 `pblur-a` 的 6% 白）可以压住模糊边常见的暗环，但要在所有层上统一，否则会显出一条色带。

## 备注

- 同一套层叠+遮罩可以拿来做「聚焦特写」：中间清楚、四周糊掉，只要把遮罩换成一条径向渐变。
- 层数不够又想要更长的过渡时，先加半径跨度（2 / 7 / 16 → 1 / 6 / 20），比单纯加层数便宜。
