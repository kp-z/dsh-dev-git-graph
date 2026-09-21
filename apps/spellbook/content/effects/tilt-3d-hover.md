---
title: 内层有深度的倾斜卡片
slug: tilt-3d-hover
category: 交互
tags: [3D, 倾斜, 深度]
since: 2026-09
source: 机制来自 CSS translateZ 与 preserve-3d，自行实现
when: 悬浮时卡片倾向一边，而且里面的元素看起来有厚薄
stage: dark
tier: core
---

## 描述

指针移上去卡片微微侧倾，卡上的标题浮得比底色高一点，像一块真的牌子。

机制是 ==preserve-3d 让子元素各自有真实深度（translateZ）==。只倾斜外层，看到的是「一整张图被压歪」；给内层不同的 `translateZ`，透视就会让近的那层在倾斜时移动得更多，于是产生厚薄。

差别很细微，但一眼就能看出哪个是贴纸、哪个是实体。

## 代码

```html
<div class="tl">
  <div class="tl-card">
    <b class="tl-title">浮起来的标题</b>
    <span class="tl-sub">它在更靠前的一层</span>
  </div>
</div>
```

```css
.tl {
  /* @mechanism 透视在外层，内层才有共同的深度空间 */
  perspective: 800px;
  width: min(260px, 78vw);
}

.tl-card {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8px;
  height: 170px;
  /* @mechanism 保住子元素的 3D 位置 */
  transform-style: preserve-3d;
  border: 1px solid rgb(217 164 65 / 0.36);
  background: linear-gradient(150deg, #241d33, #120f1c);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
  transition: transform 0.4s cubic-bezier(0.3, 0.7, 0.3, 1);
}

.tl:hover .tl-card {
  transform: rotateX(12deg) rotateY(-14deg) scale(1.03);
}

.tl-title {
  font-size: 18px;
  /* @mechanism 这一层比底色更靠前 */
  transform: translateZ(34px);
}

.tl-sub {
  opacity: 0.72;
  transform: translateZ(14px);
}
```

## 边界

- 只倾斜外层、内层全在 `translateZ(0)`，看到的是「一张图被压歪」。深度差是这个效果的全部来源，`translateZ` 必须给到内层。
- `translateZ` 越大，元素在倾斜时的位移越明显。给太大（超过透视距离的一半）会让内容飘出卡片边界。
- 内层元素超出卡片范围时**不会被裁掉**（除非卡片有 `overflow: hidden`），这可能正是想要的，也可能是没料到的。
- `preserve-3d` 会被卡片的 `overflow: hidden`、`filter`、`opacity` 小于 1 打断。这几个属性很容易在别处被顺手加上，然后 3D 就悄悄失效了。
- 倾斜角度别太大（10–16 度之间）。再大就会像「卡片要倒了」，而不是「有厚度」。
- 它是纯 CSS 的固定角度倾斜。要跟着指针方向变，得把指针位置写进 CSS 变量——那就是另一个条目了。

## 备注

- 标题比副标题更靠前是刻意的：层次拉开了，倾斜时的视差才看得出来。
- 给卡片加一点阴影，倾斜时它也跟着变，厚薄感会更实。
