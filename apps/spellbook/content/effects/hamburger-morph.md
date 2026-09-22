---
title: 汉堡按钮的形状变化
slug: hamburger-morph
category: 交互
tags: [transform, transition, 导航, 按钮, 点击]
since: 2026-10
source: 机制来自三条线共用同一原点后的平移与旋转，自行实现
when: 移动端导航按钮，点开时三条线要变成叉号，而不是换个图标
stage: plain
tier: core
---

## 描述

一根线加两个伪元素，就是三条线。点开时上下两根各走半步、各转 45 度，在中心合成一个叉。

机制是 ==三条线共用同一个绝对定位原点，于是「把平移归零、再旋转」就等于在中心交叉==。如果每条线各自参与布局（三行 flex、或三段不同 margin），要交叉就得分别算三个位移与三个旋转角，任何间距一变都要重算；共用原点之后，形变只剩三行声明：上下两条的 `translateY(±7px)` 换成 `rotate(±45deg)`，中条只改透明度。

状态放在 checkbox 上，所以连脚本都省了；代价是按钮的 `aria-expanded` 不会自己同步——视觉上的「已经展开」与无障碍树里的「一个复选框」会分家。要语义正确，还是 `<button aria-expanded>` 加两行脚本更稳。

## 代码

```html
<!-- @mechanism checkbox 放在前面当状态载体，:checked 靠兄弟选择器驱动形变 -->
<input class="hm-input" type="checkbox" id="sb-hm" />
<label class="hm" for="sb-hm" aria-label="打开导航">
  <span class="hm-bar"></span>
</label>
<div class="hm-panel">
  <a href="#">概览</a>
  <a href="#">机制</a>
  <a href="#">边界</a>
</div>
```

```css
.hm-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.hm {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: #1b1710;
  cursor: pointer;
}
/* @mechanism 中条是本体，上下两条是伪元素 —— 三条线共享同一个定位原点 */
.hm-bar,
.hm-bar::before,
.hm-bar::after {
  width: 20px;
  height: 2px;
  background: #efe9dd;
}
.hm-bar {
  position: relative;
  display: block;
  transition: background 0.2s;
}
.hm-bar::before,
.hm-bar::after {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  /* @mechanism 原点在线的中心，所以「平移归零 + 旋转」必然交在同一点 */
  transition: transform 0.24s;
}
.hm-bar::before {
  transform: translateY(-7px);
}
.hm-bar::after {
  transform: translateY(7px);
}
.hm-input:checked ~ .hm .hm-bar {
  background: transparent;
}
.hm-input:checked ~ .hm .hm-bar::before {
  transform: translateY(0) rotate(45deg);
}
.hm-input:checked ~ .hm .hm-bar::after {
  transform: translateY(0) rotate(-45deg);
}
.hm-input:focus-visible ~ .hm {
  outline: 2px solid #b4462f;
  outline-offset: 3px;
}
.hm-panel {
  display: grid;
  gap: 4px;
  width: min(180px, 60vw);
  margin-top: 14px;
  font: 400 13px/1.7 system-ui, sans-serif;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-6px);
  transition: opacity 0.24s, transform 0.24s, visibility 0.24s;
}
.hm-input:checked ~ .hm-panel {
  opacity: 1;
  visibility: visible;
  transform: none;
}
.hm-panel a {
  color: #1b1710;
  text-decoration: none;
  border-bottom: 1px solid rgb(60 48 30 / 0.2);
  padding: 3px 0;
}
```

## 边界

- 位移量（这里 7px）必须与线宽、按钮高度对上：线宽从 2px 改成 3px 而位移不动，叉的两笔就会在中心错开一格。这是「共用原点」省下的计算量换来的新耦合点。
- checkbox 承担状态时 `aria-expanded` 不会被同步，读屏听到的是「复选框」，与视觉上的展开不一致。要正确语义就换成 `<button aria-expanded>`，把形变交给 `[aria-expanded="true"]` 选择器。
- 中条用 `background: transparent` 而不是 `opacity: 0`：后者在半透明的那几帧里会露出一根淡线，而且它仍然参与命中测试。
- 连续点击会打断过渡，停在半开的中间态。视觉无害，但别把状态同步写在 `transitionend` 里——它会漏掉被打断的那一次。
- 触摸目标必须由 label 撑到 44px 见方；只有 20×2 的线本身在移动端几乎点不中，而 line 的命中区域不会因为视觉变大而变大。
- 线色写死会在换背景（浅色卡片、深色面板）时直接消失，用 `currentColor` 之类的继承来源才能跟着主题走。
- 展开面板如果用 `visibility: hidden` 隐藏，过渡期间它仍在 Tab 顺序里可被聚焦；配合 `inert` 或直接在收起态用 `display: none` 才彻底。

## 备注

- 同一招可做「加号变叉」的开关、形变的下拉箭头、带两条线的小型折叠按钮（只需一个伪元素）。
- 三个以上元素同时形变时仍然适用：让它们共享一个原点，各自的形变就只是一次 translate 加一次 rotate。
