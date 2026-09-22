---
title: 亚克力侧光
slug: acrylic-edge-lit
category: 材质
tags: [亚克力, 内阴影, 侧光]
since: 2026-10
source: 机制来自 CSS 内阴影与 background-clip 描边，自行实现
when: 一块亚克力板要有厚度：上沿亮、下沿暗，切边还能看到一道亮线
stage: dark
tier: core
params:
  - { name: thick, label: 板厚, type: range, min: 4, max: 28, step: 1, default: 12, unit: px }
---

## 描述

一块亚克力面板，上沿有一道亮光、下沿压着一层暗，切边处还有一条几乎贴着边界的亮线——看着有厚度，不是一张纸。

机制是 ==内阴影的偏移方向决定光从哪边来==。`inset` 阴影画在边框内侧：偏移给正值，阴影从上方压下来；给负值，就从下方翻上来。一个面板上同时写一条正偏移的亮内阴影和一条负偏移的暗内阴影，等于声明「上边受光、下边背光」，厚度就是这么被读出来的。两边的半径必须小于板厚，否则光会漫到中间，变成一团雾。

外面那圈贴边亮线不能用 `border`：`border` 有厚度，会占掉版面。用 `linear-gradient` 画底、`background-clip` 分给 `padding-box` 与 `border-box`，再让 `border` 透明，就得到一条不占空间的亚克力切边。

## 代码

```html
<!-- @mechanism 一块面板上同时存在「受光的上沿」与「背光的下沿」 -->
<div class="acrylic">
  <strong>亚克力</strong>
  <span>上沿受光、下沿背光</span>
</div>
```

```css
.acrylic {
  /* @mechanism 渐变画在 padding-box，边框区留给另一层，切边才不占厚度 */
  background:
    linear-gradient(rgb(255 255 255 / 0.1), rgb(255 255 255 / 0.04)) padding-box,
    linear-gradient(160deg, rgb(255 255 255 / 0.85), rgb(255 255 255 / 0.12)) border-box;
  border: 1px solid transparent;
  border-radius: 16px;
  /* @mechanism 内阴影的偏移方向决定光源位置：正偏移压顶、负偏移翻底，厚度由两侧半径撑出 */
  box-shadow:
    inset 0 var(--thick, 12px) var(--thick, 12px) calc(var(--thick, 12px) * -0.4) rgb(255 255 255 / 0.4),
    inset 0 calc(var(--thick, 12px) * -1) var(--thick, 12px) calc(var(--thick, 12px) * -0.5)
      rgb(0 0 0 / 0.45),
    0 18px 40px rgb(0 0 0 / 0.4);
  padding: 26px 30px;
  display: grid;
  gap: 6px;
  color: #f2f5fa;
}

.acrylic strong {
  font: 600 19px/1.2 system-ui, sans-serif;
}

.acrylic span {
  font: 400 13px/1.5 system-ui, sans-serif;
  opacity: 0.7;
}
```

## 边界

- 内阴影的模糊半径一旦超过板厚，上下的光会在中间糊成一片，读起来就不是「厚板」而是「一团雾」。
- 亮内阴影的不透明度要克制在 0.4 上下。纯白的内阴影会把浅色文字吃掉，尤其是上沿那一行。
- `background-clip` 的两层必须都在 `background` 简写里，且顺序不能反：`padding-box` 在前、`border-box` 在后。写反了切边那条线会被底层盖住。
- 深色底上这套发光很好，白底上几乎全废——内阴影的白色与背景同色，只剩一层灰边。
- 完整外阴影（第三条）是给面板「浮起来」用的。只想要厚度、不想要悬浮感时必须删掉，否则会被读成一张卡片而不是一块板。

## 备注

- 把亮/暗两条内阴影的偏移量对调，就得到一块从下往上打光的板——同一招，光源方向反过来。
- 这条和 `inner-glow` 的区别在于方向：内发光是四周均匀的一圈，侧光是**有方向的**，靠两条偏移相反的内阴影撑出体积。
