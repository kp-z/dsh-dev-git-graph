---
title: 玻璃上的可读性护栏
slug: glass-scrim
category: 材质
tags: [backdrop-filter, blur, gradient, 图片, 正文]
since: 2026-10
source: 机制来自 backdrop-filter 只作用于高频这一特性，自行实现
when: 文字压在有内容的底上，加多少模糊都不够清楚
stage: photo
tier: core
params:
  - { name: veil, label: 遮蔽浓度, type: range, min: 0, max: 0.9, step: 0.05, default: 0.55 }
  - { name: smear, label: 磨砂半径, type: range, min: 0, max: 20, step: 1, default: 8, unit: px }
---

## 描述

一段文字压在一张有天空、有暗部的照片上。只加磨砂的话，字还是会被那块大面积的亮天空吃掉；把遮蔽加厚一点，字立刻立住，但又没有把照片盖死。

机制是 ==磨砂抹掉的是高频，遮蔽压低的是低频，两者不能互相替代==。`blur` 让相邻像素互相平均：细节被抹平了，但一整块亮天空的平均值还是亮的——模糊一块均匀的亮色，得到的是同一块亮色。所以「加模糊让文字变清楚」只在背景有细碎纹理时成立。真正决定文字能不能读的，是文字与它背后那一片区域的**平均亮度差**。这个差只有靠遮蔽（或文字自身的描边、阴影）才压得下来。

因此这两层是分工的：磨砂负责把杂乱的纹理收干净，遮蔽负责把整片区域的亮度拉到文字的对立面。想让文字更清楚，先看背景是「乱」还是「亮」——乱就加模糊，亮就加遮蔽。

## 代码

```html
<!-- @mechanism 两层分工：磨砂收纹理，遮蔽压亮度 -->
<div class="scrim">
  <div class="scrim-veil"></div>
  <p class="scrim-text">压在有照片的底上，字要立得住</p>
</div>
```

```css
.scrim {
  position: relative;
  width: min(340px, 82vw);
  height: 190px;
  overflow: hidden;
  border-radius: 14px;
}

.scrim-veil {
  position: absolute;
  inset: 0;
  /* @mechanism 磨砂只抹高频：它收干净纹理，但抹不亮一整片天空 */
  backdrop-filter: blur(var(--smear, 8px));
  /* @mechanism 遮蔽压低频：文字与背景的平均亮度差靠这一层拉开 */
  background: linear-gradient(
    to top,
    rgb(8 10 16 / var(--veil, 0.55)) 0%,
    rgb(8 10 16 / calc(var(--veil, 0.55) * 0.55)) 46%,
    transparent 100%
  );
}

.scrim-text {
  position: absolute;
  inset: auto 0 0 0;
  /* @mechanism 文字留在两层之上；它自己不用再加阴影，护栏已经由遮蔽提供 */
  z-index: 1;
  margin: 0;
  padding: 0 22px 20px;
  font: 500 16px/1.6 system-ui, sans-serif;
  color: #f4f7fb;
}
```

## 边界

- 模糊半径对可读性的帮助有上限：背景本身是大色块时，把 `blur` 从 8px 加到 40px 在对比度上几乎没有变化，只是像素更糊、更费性能。
- 遮蔽是**渐变**的，不是均匀的。顶部透明处文字（如果有）就等于完全没有护栏，长文本要按实际排版把渐变起点往下移。
- 渐变的 alpha 别指望线性叠加：`linear-gradient` 的中间档给 46% 看起来才像「自然衰减」，按 50% 写会显出一条能看出来的分带。
- 遮蔽一浓就失去玻璃的意味，变成一块半透明黑板。真要在浓遮蔽下保住玻璃感，得把遮蔽做成只覆盖文字行高的一条窄带，而不是整个面板。
- 底图对比度极高时（纯黑纯白各占一半），磨砂与遮蔽都只能救局部——文字横跨两种底时，唯一的解是分开处理或换位置。

## 备注

- 把遮蔽换成同一位置的 `text-shadow`，效果类似但不会动到底图，适合只能改文字样式的场景（比如第三方组件里的标题）。
- 判断该加哪一层有个快办法：把背景缩到很小再看。缩小后仍然和文字反差不够，就是低频问题，加遮蔽；缩小后看不清的细节消失了、但整体还是花的，就是高频问题，加磨砂。
