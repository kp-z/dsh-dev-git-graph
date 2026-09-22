---
title: 半透明叠层
slug: layered-translucency
category: 材质
tags: [混合模式, 透光, 叠层]
since: 2026-10
source: 机制来自 CSS Compositing 规范的 mix-blend-mode，自行实现
when: 好几层薄膜材质要各留个性，但还会互相影响颜色
stage: photo
tier: core
params:
  - { name: film, label: 覆膜浓度, type: range, min: 0, max: 0.6, step: 0.02, default: 0.26 }
---

## 描述

三层半透明的膜——一层偏暖的、一层偏冷的、一层带纹理的——压在照片上。关键是它们**每一层都没把自己叠死**：暖的那层压上去，冷的那层还看得见，纹理也还在。

机制是 ==mix-blend-mode 的可分离混合式==。普通的 `opacity` 叠加是「混入」：`result = src × α + dst × (1 − α)`，α 一高，下层的颜色就被抹掉。而 `multiply` / `screen` 是先算色彩再合成：`multiply` 取两层的乘积（只会变暗，不会抹掉），`screen` 取其补集的乘积（只会变亮）。两层都在场，颜色才会互相影响出第三种色——这正是油膜、有色玻璃、叠色纸的样子。

所以每层给一个**低于它看起来需要的不透明度**：blend 模式负责颜色，`opacity` 只负责「这层该有多浓」。把浓度压住，三层才叠得起来。

## 代码

```html
<div class="stack-glass">
  <span class="stack-film stack-warm"></span>
  <span class="stack-film stack-cool"></span>
  <span class="stack-film stack-grit"></span>
  <p class="stack-label">半 透 明 叠 层</p>
</div>
```

```css
.stack-glass {
  position: relative;
  width: min(340px, 82vw);
  height: 190px;
  overflow: hidden;
  border-radius: 16px;
}

.stack-film {
  position: absolute;
  inset: 0;
  /* @mechanism 可分离混合在合成前算色彩，下层不会被盖掉 */
  mix-blend-mode: multiply;
  opacity: var(--film, 0.26);
}

.stack-warm {
  background: linear-gradient(150deg, #ffb35c, #b4462f);
}

.stack-cool {
  /* @mechanism 一层压一层，一层变暗一层提亮，出来的才是两层的颜色 */
  mix-blend-mode: screen;
  background: linear-gradient(330deg, #4f7df0, #6ee7ff);
  opacity: calc(var(--film, 0.26) * 0.9);
}

.stack-grit {
  /* multiply 的颗粒只压暗，不会在照片上留下灰边 */
  mix-blend-mode: multiply;
  opacity: calc(var(--film, 0.26) * 1.4);
  background:
    radial-gradient(circle at 22% 30%, rgb(255 255 255 / 0.5) 0 1px, transparent 1.6px) 0 0 / 5px 5px,
    radial-gradient(circle at 70% 64%, rgb(0 0 0 / 0.5) 0 1px, transparent 1.6px) 2px 2px / 6px 6px;
}

.stack-label {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  /* @mechanism 文字不能被 blend 模式吃掉，必须自己隔离成一层 */
  isolation: isolate;
  mix-blend-mode: normal;
  z-index: 1;
  margin: 0;
  font: 600 18px/1 system-ui, sans-serif;
  letter-spacing: 0.2em;
  color: #fff;
  text-shadow: 0 1px 12px rgb(0 0 0 / 0.45);
}
```

## 边界

- `mix-blend-mode` 混的是**同一个层叠上下文里的所有下层**，不只是正下面那一层。所以它会连父级的背景、甚至 `body` 的底色一起混——父级没有自己的背景时，颜色会一路漏到最底。
- 混合层一多，浏览器就没法只靠合成器完成，会退化成整块重绘。三到四层是甜点，再多滚动就掉帧。
- 文字放进混合层里会一起被 blend，白字在 `multiply` 层上会直接变黑。要么给文字 `isolation: isolate`，要么像示例那样明确 `normal` 并抬 `z-index`。
- 用 `background-color` 而不用 `background-image` 时，blend 对透明区域不生效，只在有像素的地方混——用渐变或纹理时要注意边缘是透明的还是填充的。
- 这条依赖底图。空舞台上三层 blend 出来只是一块浑浊的色块，效果全在「底下有照片」这件事上。

## 备注

- `multiply` + `screen` 成对使用，等于一层压暗一层提亮，比单层加 `saturate` 更接近真实滤色片。
- 想要「油膜」那种彩虹边，把暖层换成 `conic-gradient`、混合模式换成 `hue`，色相会随角度来回摆。
