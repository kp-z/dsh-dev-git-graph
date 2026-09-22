---
title: 光圈形状的光斑
slug: bokeh-aperture-shape
category: 材质
tags: [光斑, 景深, 多边形]
since: 2026-10
source: 机制来自相机光圈孔径形状决定离焦光斑的形状，自行实现
when: 夜景背景要有虚化的灯光，但 blur 出来的光团太糊、不像照片
stage: dark
tier: core
params:
  - { name: soft, label: 边缘柔化, type: range, min: 0, max: 6, step: 0.5, default: 1.5, unit: px }
---

## 描述

深色夜景上散着一片灯，每一颗都是边缘清楚的六边形小亮块，大小不一——这是照片虚化背景里的光斑，不是一团团模糊的圆雾。

机制是 ==光斑的形状由光圈孔径决定，所以要裁出多边形，而不是把点模糊成圆==。真实镜头离焦时，一个点光源被镜筒成像成「光圈开口的形状」：六片叶片就是六边形，五片就是五边形；光斑内部亮度近乎均匀，边界是突然断掉的。CSS 的 `blur()` 是各向同性的高斯核，只会把点抹成中间亮、四周渐隐的软团，永远得不到那种「有形状的盘子」。所以顺序是先用 `clip-path` 把亮块裁成六边形，再用一点点模糊把多边形的硬边磨掉——模糊在这里只负责抗锯齿，一旦给大，多边形又被糊回圆形。

可变的是顶点数（就是叶片数）、`--soft`（边缘柔化）、以及每颗光斑的尺寸与色相。不同大小、不同颜色、部分重叠，才像一片真实的散景；全部一样大就变成图案了。示例把六边形的顶点算好写死，要更多边形就改这串坐标。

## 代码

```html
<div class="bokeh" aria-hidden="true">
  <span class="bokeh__dot" style="--x:18%;--y:30%;--s:64px;--hue:44deg"></span>
  <span class="bokeh__dot" style="--x:52%;--y:22%;--s:38px;--hue:16deg"></span>
  <span class="bokeh__dot" style="--x:74%;--y:58%;--s:92px;--hue:200deg"></span>
  <span class="bokeh__dot" style="--x:38%;--y:72%;--s:26px;--hue:280deg"></span>
  <p>虚化的灯光</p>
</div>
```

```css
.bokeh {
  position: relative;
  display: grid;
  place-items: center;
  width: min(420px, 86vw);
  height: 240px;
  overflow: hidden;
  background: #07070c;
  color: #7c8296;
  font: 400 13px/1.6 system-ui, sans-serif;
}

.bokeh__dot {
  position: absolute;
  left: var(--x);
  top: var(--y);
  width: var(--s);
  aspect-ratio: 1;
  translate: -50% -50%;
  /* @mechanism 六边形就是光圈叶片的形状；模糊只负责磨掉硬边，给大了就糊回圆 */
  clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  background: radial-gradient(circle, hsl(var(--hue) 100% 82%), hsl(var(--hue) 100% 62%));
  filter: blur(var(--soft, 1.5px));
  opacity: 0.85;
}

.bokeh p {
  position: relative;
  z-index: 1;
}
```

## 边界

- `blur()` 半径一旦超过光斑尺寸的一成左右，多边形的角就被抹圆，读起来又变回雾团。要「更软的光斑」应该改顶点数或内部渐变，不是加模糊。
- `clip-path` 的坐标是相对元素自身盒子的百分比，光斑被拉伸时多边形会跟着变形。要正六边形就必须锁 `aspect-ratio: 1`。
- 相邻光斑颜色接近时，`opacity: 0.85` 会让重叠处出现一块更亮的交集，形状变成一个不自然的葫芦。要么错开位置，要么给每颗更低的不透明度。
- 这些光斑不会真的叠在内容上产生光照，它们只是贴图上的一片亮块；想让它们「照亮」别的东西得再加混合模式，代价是对比度不可控。
- 舞台必须是深色。亮底上多边形亮块只会像一堆彩色贴纸，虚化的错觉完全不成立。

## 备注

- 顶点数是可以算出来的：几行 JS 按「叶片数」生成 `polygon()` 的坐标，就能做成可调光圈。
- 光斑的层次（近处的大而糊、远处的小而清）其实是景深，让它随滚动轻微平移，照片感会明显更强。
