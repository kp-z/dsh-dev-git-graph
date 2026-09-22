---
title: 变形镜头拉丝
slug: anamorphic-streak
category: 材质
tags: [镜头光晕, 单向模糊, 蓝色]
since: 2026-10
source: 机制来自变形镜头在垂直方向压缩画面、使点光源被拉成水平线，自行实现
when: 画面里有一个高亮的光点，想要一条水平穿过去的蓝色光丝
stage: dark
tier: core
params:
  - { name: len, label: 拉丝长度, type: range, min: 4, max: 40, step: 1, default: 18 }
  - { name: soft, label: 柔化, type: range, min: 1, max: 20, step: 1, default: 7, unit: px }
---

## 描述

画面正中一颗高亮的白点，穿过它有一条又细又长的水平蓝线，两端淡下去——科幻片里最眼熟的那种镜头光丝。

机制是 ==光源先被压成一条扁线，再被模糊；顺序反了就只能得到一团雾==。变形镜头拍摄时把画面在垂直方向压缩过，光点因此被压成一个很扁的椭圆；放映时横向再拉回来，那个椭圆就成了一条贯穿画面的线。在 CSS 里复现等于老老实实按这个顺序做：先把圆点各向异性缩放成扁条，再 `blur()` 把边缘软化。反过来先模糊再拉伸就错了——`blur()` 是各向同性的圆核，拉长之后得到的是一个又大又软的椭圆，而不是一条收得干净的线。

这里有个容易踩的坑：`filter` 在元素的局部坐标里先算，`transform` 与 `scale` 后算，所以「先压扁再模糊」必须让压扁落在**内层元素**、模糊落在**外层**。颜色偏蓝是因为多数变形镜头的前组镀膜在蓝紫段反射较强。可变的是 `--len`（拉丝长度）、`--soft`（柔化），以及要不要再加一条对称的竖向短丝。

## 代码

```html
<div class="astreak">
  <span class="astreak__blur"><i></i></span>
  <b>点光源</b>
</div>
```

```css
.astreak {
  position: relative;
  display: grid;
  place-items: center;
  width: min(460px, 88vw);
  height: 220px;
  overflow: hidden;
  background: #05060a;
  color: #5f6678;
  font: 400 13px/1.6 system-ui, sans-serif;
  isolation: isolate;
}

/* @mechanism 模糊放在外层：filter 先于 transform 结算，放内层就变成「先模糊再拉伸」 */
.astreak__blur {
  position: absolute;
  inset: 0;
  filter: blur(var(--soft, 7px));
  mix-blend-mode: plus-lighter;
  pointer-events: none;
}

/* @mechanism 内层只负责把圆点压成扁条，这一步必须发生在模糊之前 */
.astreak__blur i {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 14px;
  aspect-ratio: 1;
  border-radius: 50%;
  background: #cfe4ff;
  translate: -50% -50%;
  scale: var(--len, 18) 0.28;
}

.astreak b {
  position: relative;
  translate: 0 56px;
}
```

## 边界

- 压扁是各向异性缩放，圆点越小、拉得越长，线条越细。原始尺寸太小时抗锯齿会让它在两端碎成虚线。
- 模糊层是整块的，`.astreak__blur` 必须 `pointer-events: none`，否则它会盖住底下所有交互。
- 线被容器裁掉时两端是硬切。真实镜头里线是自然收尾的，要靠容器宽度或额外的遮罩让它在边缘淡出。
- 只在接近水平的拉丝上成立。想做竖丝就把两个方向的缩放反过来，但变形镜头本身不产生竖丝，那就不是这个机制了。
- 大比例缩放会把 1px 的细节拉成半像素，某些缩放级别下线条会闪烁。用更小的原始圆点、更长的模糊来摊平。
- 压扁后的实际宽度是原始宽乘以 `--len`，很容易超出容器被切掉；把 `--len` 和容器宽度当成一对参数一起调。

## 备注

- 把混合模式从 `plus-lighter` 换成 `screen`，线条会软一点，但失去那种过曝的硬芯。
- 凡是「一个方向被压缩过」的成像缺陷都长这样：扫描仪的横向漏光、屏幕的横向反光、变形宽银幕的字幕光晕。
