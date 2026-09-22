---
title: 绒面光泽
slug: velvet-sheen
category: 材质
tags: [radial-gradient, 绒面, 容器]
since: 2026-09
source: 自行实现
when: 一块深色区域要有天鹅绒那种「顺着摸会变色」的柔光
stage: dark
tier: core
params:
  - { name: soft, label: 光斑大小, type: range, min: 30, max: 100, step: 5, default: 62, unit: % }
---

## 描述

深红的一块，靠近中间有一条很柔的亮，边缘沉下去——像绒布被压过。

机制是 ==多层径向渐变交叉，每一层都极低对比==。绒面的特征不是亮点，而是「一片大片区域在极小的明暗差里缓慢变化」。单层渐变做不出这种层次：一层的过渡是单调的，多层不同位置、不同尺寸的光斑叠起来，才有绒那种「各方向都在微微反光」的感觉。

对比度要压得很低。绒面之所以高级，就因为它**不亮**。

## 代码

```html
<div class="vs">
  <span>绒面</span>
</div>
```

```css
.vs {
  display: grid;
  place-items: center;
  width: min(280px, 78vw);
  height: 175px;
  border-radius: 3px;
  /* @mechanism 多层极低对比的径向渐变交叉，才有绒的各向反光 */
  background:
    radial-gradient(var(--soft, 62%) 58% at 38% 32%, rgb(255 190 190 / 0.16), transparent 70%),
    radial-gradient(48% 46% at 68% 62%, rgb(255 150 170 / 0.12), transparent 72%),
    radial-gradient(70% 60% at 50% 100%, rgb(0 0 0 / 0.36), transparent 76%),
    linear-gradient(168deg, #6d1f30 0%, #4a1622 58%, #2c0d15 100%);
  font: 500 14px/1 system-ui, sans-serif;
  color: rgb(255 232 236 / 0.8);
}
```

## 边界

- 关键是**对比度极低**。绒面的高级感来自它不亮——把光斑提亮到看得清边界，立刻变成塑料。
- 至少三层渐变（两亮一暗）。单层渐变只能给出单调的一维过渡，做不出「各方向都在微微反光」。
- 底色的明度不能太高。绒面需要深底，浅底上再怎么叠都像洒了果汁。
- 光斑位置不要对称。对称的光斑读作「球体高光」，而绒面是没有清晰高光的。
- 它完全静态。真绒面随视角变化，CSS 做不了——要动只能靠 `@property` 缓慢移动渐变位置，代价是每帧重绘。

## 备注

- 同一套结构换成深绿配米黄就是丝绒幕布，换成深蓝配青就是夜空绒。机制不变。
- 再叠一层极细的噪点（`dither-anti-banding` 那一招）能让大面积绒更「实」，但那是另一条。
