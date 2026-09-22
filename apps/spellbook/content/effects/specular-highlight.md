---
title: 镜面高光的位置
slug: specular-highlight
category: 材质
tags: [radial-gradient, box-shadow, 发光, 卡片]
since: 2026-09
source: 自行实现
when: 色块看起来是平的，想让它有一点「表面朝向」
stage: dark
tier: core
params:
  - { name: size, label: 高光大小, type: range, min: 20, max: 80, step: 5, default: 44, unit: % }
---

## 描述

一块深色面板，左上角有一团柔和的白，看起来鼓起来了一点。

机制是 ==高光的形状是光源形状的镜像，位置则说明了表面的朝向==。一个圆润的亮斑放在受光侧的角上，人眼立刻把它读成「这块面朝左上」。这是拟物材质里成本最低、收益最明显的一步。

高光要**软**。硬边的高光看起来是贴了一张白纸，不是反光。

## 代码

```html
<div class="sh">
  <span class="sh-hint">光从左上来</span>
</div>
```

```css
.sh {
  position: relative;
  display: grid;
  place-items: center;
  width: min(230px, 70vw);
  height: 160px;
  border-radius: 6px;
  /* @mechanism 高光斑放在受光侧的角上，表面就有了朝向 */
  background:
    radial-gradient(
      var(--size, 44%) var(--size, 44%) at 22% 16%,
      rgb(255 250 236 / 0.5) 0%,
      rgb(255 250 236 / 0.12) 42%,
      rgb(255 250 236 / 0) 72%
    ),
    linear-gradient(155deg, #2c2440 0%, #14101f 70%);
  box-shadow: 0 20px 40px rgb(0 0 0 / 0.42);
  font: 500 13px/1 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.82);
}
```

## 边界

- 高光必须放在**受光侧**，并且与阴影方向一致。放反了（高光在暗侧）会觉得「哪里不对」但一时说不出——这是最耗时间的返工。
- 过渡段要长。两个色标挨得近就是硬边高光，看起来像贴了张纸；`42%` 这种中间档是必需的。
- 高光亮度不要到纯白。留一点余地才有「反光」的质感，纯白像是表面破了洞。
- 它只是一层视觉暗示，不改变元素的实际表面。元素被倾斜或旋转时，高光位置要跟着重新安排，否则光源方向就矛盾了。
- 同一画面里所有元素的高光位置必须一致（同一个光源）。这一点做不到，整块界面就会显得脏——和压印浮雕是同一个道理。

## 备注

- 把高光从圆形改成沿边的一条（`linear-gradient` 在顶部一小段）就是「上边缘反光」，适合做卡片。
- 高光 + 内阴影 + 外阴影三件套齐了，一个平面色块就有了完整的体积感。
