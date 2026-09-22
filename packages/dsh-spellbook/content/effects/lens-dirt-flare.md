---
title: 镜头脏污与光斑
slug: lens-dirt-flare
category: 材质
tags: [feTurbulence, svg-filter, blend-mode, 颗粒, 胶片]
since: 2026-10
source: 机制来自 SVG feTurbulence 与 feComponentTransfer 的阈值化，自行实现
when: 光源进入画面时要有一层脏镜头才有的油渍与颗粒光斑
stage: dark
tier: core
params:
  - { name: dirt, label: 脏污浓度, type: range, min: 0, max: 0.5, step: 0.02, default: 0.2 }
---

## 描述

一个强光源压进画面，周围浮着一层不均匀的油渍和几点散斑——不是干净的镜头光晕，而是一块很久没擦的镜片。

机制是 ==用 feComponentTransfer 把噪声阈值化成稀疏亮斑==。`feTurbulence` 直接铺出来是一片均匀的灰雾，那不像脏污，像噪点。真正的脏污是「大片干净的地方夹着几个污点」。所以拿 `feFuncA` 的 `discrete` 把 alpha 分成几档，只保留最高的一档：绝大多数像素被压成完全透明，剩下少数变成实心，再轻微高斯模糊一下——一张油渍分布图就出来了。

光斑用 `screen` 叠上去，因为镜头光晕只会**加光**，不会减光。这两层都必须是「只加到画面上」的，否则会显出一块灰底。

## 代码

```html
<!-- @mechanism 从噪声里筛出稀疏污渍：discrete 分档把中间调全部压成透明 -->
<svg class="dirt-defs" aria-hidden="true">
  <filter id="sb-dirt">
    <feTurbulence type="fractalNoise" baseFrequency="0.018 0.042" numOctaves="3" seed="4" />
    <feComponentTransfer>
      <feFuncA type="discrete" tableValues="0 0 0 0 0 0 0 1" />
    </feComponentTransfer>
    <feGaussianBlur stdDeviation="1.1" />
  </filter>
</svg>

<div class="flare">
  <div class="flare-dirt"></div>
  <span class="flare-blob"></span>
  <span class="flare-blob flare-blob-b"></span>
</div>
```

```css
.dirt-defs {
  position: absolute;
  width: 0;
  height: 0;
}

.flare {
  position: relative;
  width: min(340px, 82vw);
  height: 190px;
  overflow: hidden;
  background: radial-gradient(circle at 38% 34%, #2a1f16 0%, #0a0a10 62%);
  border-radius: 14px;
}

.flare-dirt {
  position: absolute;
  inset: 0;
  /* @mechanism 噪声被阈值化后只剩下少数实心像素，这一层就是油渍本身 */
  filter: url(#sb-dirt);
  /* @mechanism screen 让脏污只会加亮，不会在暗场里压出一块灰 */
  mix-blend-mode: screen;
  opacity: var(--dirt, 0.2);
  /* 滤镜的输出就是噪声，原本的底色用不上，给个亮色让它有得可加 */
  background: #d8c9a8;
}

.flare-blob {
  position: absolute;
  left: 30%;
  top: 26%;
  width: 190px;
  height: 190px;
  translate: -50% -50%;
  border-radius: 50%;
  /* @mechanism 光斑是光，只能加：screen 保证叠加后只会更亮 */
  mix-blend-mode: screen;
  background: radial-gradient(circle, rgb(255 236 190 / 0.85), transparent 62%);
}

.flare-blob-b {
  left: 30%;
  top: 26%;
  translate: calc(-50% + 46px) calc(-50% + 30px);
  width: 42px;
  height: 42px;
  background: radial-gradient(circle, rgb(255 214 160 / 0.6), transparent 68%);
}
```

```js
// @mechanism 换一个 seed 就是换一块镜片：噪声的形状完全由它决定
const dirt = document.getElementById('sb-dirt')
if (dirt) {
  dirt.querySelector('feTurbulence').setAttribute('seed', String(1 + Math.floor(Math.random() * 90)))
}
```

## 边界

- `discrete` 的档数直接决定脏污的疏密。`tableValues` 里多写一个非零值，脏污就稠一倍——这张表是唯一的疏密旋钮。
- 噪声是固定尺寸的，不会被拉伸到元素上。窗口变宽时污点的**绝对大小不变、数量变多**，所以宽屏上看起来会比设计稿更脏。
- `filter: url(#sb-dirt)` 会把元素原有的图形整个替换成噪声输出。想同时保留底色必须再叠一层，别指望 `filter` 和 `background` 同时生效。
- 这一层必须在暗场里看。亮底上 `screen` 几乎无效，脏污会整块消失。
- 光斑不要去动 `left` / `top` 来「跟随鼠标」，那会每帧触发布局。真要跟就用 `translate` 配合 CSS 变量。

## 备注

- 脏污图也可以拿来做「指纹层」：把 `baseFrequency` 降到 0.004 一带，筛出来的就是大片模糊的指印。
- 同一张阈值化噪声反转一下（`type="table"` 让中间调保留），就变成镜头上的雨点或霉斑。
