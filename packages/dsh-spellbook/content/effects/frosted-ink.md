---
title: 局部磨砂
slug: frosted-ink
category: 材质
tags: [backdrop-filter, mask, 玻璃, 标题, 图片]
since: 2026-10
source: 机制来自 mask-image 与 backdrop-filter 的局部裁剪，自行实现
when: 只想把内容的一小块磨掉，让标题从这块磨砂里浮出来
stage: photo
tier: core
params:
  - { name: radius, label: 磨砂范围, type: range, min: 25, max: 85, step: 5, default: 55, unit: % }
---

## 描述

一段压在照片上的标题。它周围的内容被磨成一团雾，标题所在的中间却越来越清楚，像是玻璃只有那一块被擦干净了。

机制是 ==mask-image 的径向渐变给 backdrop-filter 划出一个软边界==。`backdrop-filter` 默认作用于元素的整个盒子，边界是硬的。把它挂到一个铺满的大元素上、再用 `mask-image` 给一条中间实、四周渐隐的径向渐变，模糊就只在遮罩不透明的区域生效——**遮罩的 alpha 成了模糊的浓度旋钮**。渐变带越宽、过渡越长，中间到边缘就越柔和；`0% → 40%` 直接切，就会显出一圈硬边。

要留意方向：这里遮罩**保中间、隐四周**，所以中间清楚、四周模糊。反过来写就是「中间一块毛玻璃」。

## 代码

```html
<!-- @mechanism 模糊层铺满整块，靠遮罩把它裁成「中间清楚、四周模糊」 -->
<div class="spot">
  <div class="spot-frost"></div>
  <p class="spot-title">局部磨砂</p>
</div>
```

```css
.spot {
  position: relative;
  width: min(340px, 82vw);
  height: 190px;
  overflow: hidden;
  border-radius: 14px;
}

.spot-frost {
  position: absolute;
  inset: 0;
  backdrop-filter: blur(14px) saturate(1.2);
  /* @mechanism 遮罩的 alpha 就是模糊的浓度：中间实、四周渐隐，边界才不会是一条硬线 */
  mask-image: radial-gradient(
    circle at 50% 52%,
    #000 0,
    #000 calc(var(--radius, 55%) * 0.6),
    transparent var(--radius, 55%)
  );
}

.spot-title {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  /* @mechanism 文字留在模糊层之上，且自带压边，不然在雾里会散掉 */
  z-index: 1;
  margin: 0;
  font: 700 22px/1.2 system-ui, sans-serif;
  letter-spacing: 0.06em;
  color: #fff;
  text-shadow: 0 2px 14px rgb(8 12 20 / 0.7);
}
```

## 边界

- 遮罩的渐变至少要留出 20% 的过渡带。窄于这个值，四角会出现一圈能看见的圆弧硬边，比不做还显眼。
- 遮罩只影响 alpha，不影响模糊半径。想「中间完全不糊」就必须让遮罩中心真的到不了全实——渐变中心留一点透明，别写成纯 `#000 0 100%`。
- mask 让元素在合成前多一道处理工序，模糊半径大又元素大时，滚动会明显掉帧。
- 通过 `radial-gradient` 做软边时不要叠加 `border-radius`，两套边界可能对不齐，四角会露出被裁掉的痕迹。
- 依赖底图：没有内容的底色上，这块磨砂等于什么也没做，文字只是浮在空处。

## 备注

- 换成椭圆或斜向的线性遮罩，就能得到「只有画面下三分之一被磨掉」的横向分层，适合给长页面做章节分隔。
- 想做那种「聚光灯扫过去、擦干净一块」的交互，把 `--radius` 和渐变中心一起交给 JS 写 CSS 变量就行，样式一句不用改。
