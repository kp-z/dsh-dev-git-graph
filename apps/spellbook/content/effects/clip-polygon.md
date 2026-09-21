---
title: 多边形裁切
slug: clip-polygon
category: 图形
tags: [裁切, 形状, 斜切]
since: 2026-09
source: 机制来自 CSS Shapes 的 clip-path，自行实现
when: 色块要有斜切口或非矩形的轮廓，不想用 SVG、也不想透明图片
stage: grid
tier: core
params:
  - { name: skew, label: 斜切量, type: range, min: 0, max: 18, step: 1, default: 8, unit: % }
---

## 描述

色块的右上角被斜着切掉一块，整块看起来像贴着角飞出去的纸片。

机制是 ==clip-path: polygon() 用一个点序列定义可见区域==。点在元素盒子里的百分比坐标上给出，连起来围成的多边形之外的像素全部不画。任意多边形都行，不需要图片、不需要 SVG，也不用为了形状多包一层。

配合 `calc()` 与自定义属性，切角量还能做成可调的。

## 代码

```html
<div class="cp">
  <b>斜切块</b>
  <p>裁掉的地方不显示，但仍然占着布局空间。</p>
</div>
```

```css
.cp {
  width: min(340px, 78vw);
  padding: 26px 26px 22px;
  /* @mechanism 点序列围出的区域才可见 */
  clip-path: polygon(
    0 0,
    calc(100% - var(--skew, 8%)) 0,
    100% var(--skew, 8%),
    100% 100%,
    0 100%
  );
  background: linear-gradient(150deg, #b4462f 0%, #6b3550 100%);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f7f1e6;
}

.cp b {
  display: block;
  margin-bottom: 6px;
  font-size: 18px;
}

.cp p {
  margin: 0;
  opacity: 0.82;
}
```

## 边界

- `clip-path` **只裁显示，不改变布局占用**。被切掉的部分依然占着原来的空间，周围的元素不会靠过来填补。
- 被裁掉的区域**也点不到**——指针事件跟着可见区域走。按钮上用它时要确认可点范围还够用。
- 它不跟随 `border-radius`。两者同时写时以 `clip-path` 为准，圆角会被无声忽略。
- `box-shadow` 会被一起裁掉（阴影画在元素盒子之外），所以斜切块做不出投影。要投影得给父级加 `filter: drop-shadow()`，它会按裁切后的轮廓算。
- 百分比是相对元素**自己的盒子**，不是父级。用一个固定的 `%` 做斜切时，容器一变形斜角角度就变了——想要恒定角度得用 `calc()` 配固定长度。

## 备注

- 给元素留出足够的内边距，否则文字会被斜边切到。
- `polygon()` 的点可以用 `calc()` 计算，这一条让它从「固定形状」变成「可参数化的形状」。
