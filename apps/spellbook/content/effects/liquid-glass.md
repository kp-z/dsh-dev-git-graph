---
title: 液态玻璃面板
slug: liquid-glass
category: 材质
tags: [玻璃, 模糊, 深色模式]
since: 2025-09
source: 灵感来源 iOS 26，自行实现
when: 需要一块浮在内容之上的面板，又不想把底下的东西遮死
stage: photo
tier: core
params:
  - { name: blur, label: 模糊, type: range, min: 0, max: 40, step: 1, default: 18, unit: px }
  - { name: tint, label: 不透明度, type: range, min: 0.1, max: 0.9, step: 0.05, default: 0.55 }
  - { name: saturate, label: 饱和, type: range, min: 1, max: 3, step: 0.1, default: 1.6 }
---

## 描述

做成 iOS 26 那种会呼吸的玻璃面：半透明磨砂、一像素半透明白描边、顶边一道更亮的内高光。

机制是 ==backdrop-filter 的 blur 与 saturate==。它模糊的不是自己，是**面板底下真实存在的内容**——所以底下什么都没有的时候，它看起来就只是一块浅色方块。这也意味着它天生依赖排版：玻璃面板下面是照片、渐变或卡片，才成立。

## 代码

```html
<div class="glass">
  <strong>会呼吸的玻璃</strong>
  <span>底下有内容，才看得出磨砂</span>
</div>
```

```css
.glass {
  backdrop-filter: blur(var(--blur, 18px)) saturate(var(--saturate, 1.6)); /* @mechanism */
  background: rgb(255 255 255 / var(--tint, 0.55));
  border: 1px solid rgb(255 255 255 / 0.4);
  border-radius: 18px;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.65),
    0 10px 30px rgb(0 0 0 / 0.28);
  padding: 26px 30px;
  display: grid;
  gap: 6px;
}

.glass strong {
  font: 600 20px/1.2 system-ui, sans-serif;
  letter-spacing: 0.01em;
}

.glass span {
  font: 400 14px/1.5 system-ui, sans-serif;
  opacity: 0.85;
}
```

## 边界

- 白底或纯色底上几乎看不出效果——舞台必须先有可被模糊的内容，否则玻璃没有东西可折射。
- 祖先元素只要带 `filter`、`transform` 或 `will-change`，`backdrop-filter` 就会失效或退化成一块裁剪，而且不报错，只能靠肉眼看出来。
- 示例代码没带 `-webkit-backdrop-filter`。Safari 16.4 以前只认前缀版本，旧 Safari 上会完全没有玻璃，只剩半透明底。

## 备注

- 深色模式要降不透明度、提亮描边，玻璃感才立得住。
