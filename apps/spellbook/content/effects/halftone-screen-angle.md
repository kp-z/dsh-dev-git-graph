---
title: 印刷网屏
slug: halftone-screen-angle
category: 图形
tags: [网屏, 半调, 摩尔纹, 混合模式]
since: 2026-10
source: 机制来自印刷业的网屏与 45 度丝网角度，自行实现
when: 图像要有一层均匀的印刷网点，而且不希望它跟屏幕像素栅格打架
stage: photo
tier: candidate
params:
  - { name: gap, label: 网屏间距, type: range, min: 4, max: 16, step: 1, default: 6, unit: px }
  - { name: angle, label: 网屏角度, type: range, min: 0, max: 90, step: 5, default: 45, unit: deg }
---

## 描述

整张图被一层细密的网点罩住：中间调里网点最清楚，纯黑的深处和纯白的高光处网点几乎消失，像被印在纸上。

机制是 ==网点的大小固定不变，用混合模式让它在明暗不同的地方显出不同的对比，并把这层网屏转过一个角度==。`overlay` 的计算在暗部近似乘法、在亮部近似提亮：黑点与白缝在中间调处的输出差最大，在纯黑和纯白处都被压回去，于是同一张网屏自己就「往中间调聚集」。

45 度这个角度不是随便选的：任何与屏幕像素栅格平行的网屏都会跟方格采样打架，拍出摩尔纹，而人眼对 45 度的栅格最不敏感，印刷业把丝网转 45 度就是为了这个。网屏间距与旋转角一起决定视觉上的线数——间距越小线数越高，也越容易被显示器采样出波纹。

## 代码

```html
<figure class="print">
  <div class="screen"></div>
  <figcaption>中间调最容易看见网点</figcaption>
</figure>
```

```css
.print {
  position: relative;
  overflow: hidden;
  /* @mechanism 被「印」的那张图：明暗跨度要大，网屏才有东西可依附 */
  background: radial-gradient(130% 120% at 30% 20%, #fffdf7, #b9ab97 45%, #171310 100%);
}

.screen {
  position: absolute;
  inset: -30%;                 /* 转过角度后四角不许露白 */
  /* @mechanism 一格 = 黑点 + 白纸，靠 background-size 复制成一整张网屏 */
  background-image: radial-gradient(circle closest-side, #000 0 46%, #fff 50%);
  background-size: var(--gap, 6px) var(--gap, 6px);
  /* @mechanism overlay 在中间调给出最大对比，在纯黑纯白处自己消失 */
  mix-blend-mode: overlay;
  rotate: var(--angle, 45deg);
  /* @mechanism 45 度是印刷业避开摩尔纹的角度，也躲开显示器的像素栅格 */
}

.print figcaption {
  position: relative;
  padding: 34px 30px;
  color: #fdf8ee;
  font: 600 18px/1.5 system-ui, sans-serif;
}
```

## 边界

- 这不是真正的调幅半调：真实半调的**点会随亮度变大**，CSS 做不到逐像素改点的大小，所以这里点的大小是固定的，覆盖率的变化完全来自混合模式在明暗处的对比差。想要真正的半调，得用 `feImage` 引入一张网屏图再逐像素阈值，成本高一个量级。
- 网屏间距接近设备像素时会出现规则花纹。`gap` 恰好是 `devicePixelRatio` 的整数倍时最明显，转 45 度能压下去但不是万能——换个 `gap` 往往比继续调角度有效。
- 旋转后四角会露出没被覆盖的区域，所以网屏层必须比容器大（这里是 `inset: -30%`）。少留一寸，四角就会出现没有网点的白块。
- `mix-blend-mode` 需要一个隔离的合成上下文。容器一旦带上 `transform`、`filter` 或 `opacity`，混合就被关进那一层里，网屏可能忽然「失效」——看起来像滤镜没生效，其实是混合对象变了。
- 网屏是均匀的，所以它对**已经过曝或已经死黑**的图像没有任何作用：人眼读不出网点变化。

## 备注

- 同一张网屏换成 `multiply` 就变成暗部显形，换成 `screen` 就变成亮部显形——三种混合模式刚好覆盖印刷里的三种说法（叠印、实底、露白）。
- 和「点阵底纹」「半调网点渐隐」的分工：那两条的点是装饰本身，这一条的点是**观察工具**，它自己不携带信息。
