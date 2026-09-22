---
title: 金属箔
slug: metal-foil
category: 材质
tags: [conic-gradient, 金属, 箔金, 徽章, 标题]
since: 2026-09
source: 机制来自 CSS 锥形渐变，自行实现
when: 徽章或标题要一片会反光的金属面，不想用贴图
stage: dark
tier: core
params:
  - { name: from, label: 高光角度, type: range, min: 0, max: 360, step: 10, default: 210, unit: deg }
---

## 描述

一片金色表面，高光沿一个方向拉长，转过某个角度立刻暗下去。

机制是 ==conic-gradient 配密集的明暗硬色标==。金属感的来源不是金色值，是**明暗交替的频率**：真正的金属高光窄而亮、暗部宽而缓，转一圈会有好几次亮暗跳变。锥形渐变让这些跳变绕着中心分布，正好模拟旋转视角下的反光。

把同一套配色放到 `linear-gradient` 上，它就只剩一条平滑的渐变 —— 完全不是金属。

## 代码

```html
<div class="mf">
  <span class="mf-mark">MCMXXVI</span>
</div>
```

```css
.mf {
  display: grid;
  place-items: center;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  /* @mechanism 明暗交替的频率才是金属感，配色只是次要 */
  background: conic-gradient(
    from var(--from, 210deg) at 50% 50%,
    #6b4e17 0%,
    #f7e39b 9%,
    #b8912f 20%,
    #fdf7d0 30%,
    #7a5b1e 42%,
    #e8c86a 54%,
    #a8811f 66%,
    #f4d98a 78%,
    #6b4e17 90%,
    #6b4e17 100%
  );
  box-shadow: inset 0 0 30px rgb(0 0 0 / 0.45);
}

.mf-mark {
  font: 700 17px/1 Georgia, "Times New Roman", serif;
  letter-spacing: 0.12em;
  color: #3b2a08;
  text-shadow: 0 1px 0 rgb(255 245 210 / 0.55);
}
```

## 边界

- 关键是明暗的**频率与不均衡**，不是那一串金色值。色标如果均匀分布，得到的是一圈彩虹环；金属的高光总是窄而亮、暗部宽而缓，所以色标要一紧一松。
- `from` 的角度决定了高光的方向。金属是「有方向」的——角度一改，光源位置就变了，不要当成随便调的美化参数。
- 锥形渐变绕**中心**分布。方形或长条元素上，渐变的中心会露出来，看起来像贴了一张图。圆形或接近圆形的形状最像金属。
- 它完全静止。真金属的高光随视角移动，这里动不了。想让角度转起来要用 `@property` 把自定义属性注册成 `<angle>` 再过渡，代价是每帧重绘。
- 深色底上金属最亮眼；浅色底上需要加一圈内阴影把边缘压住，否则像一张贴纸浮在纸上。

## 备注

- 内阴影（`box-shadow: inset`）在这里不是装饰，它给圆盘造出「有厚度」的错觉。
- 同一套色标换个色系就是银、铜、铬——机制不变，只换颜色。
