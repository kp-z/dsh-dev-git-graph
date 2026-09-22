---
title: 虹彩珠光
slug: iridescent
category: 材质
tags: [conic-gradient, 珠光, 虹彩, 色彩]
since: 2026-09
source: 自行实现
when: 一块表面要在转动时透出不同的颜色，像珠光漆或鲍鱼壳
stage: dark
tier: core
params:
  - { name: from, label: 起始角度, type: range, min: 0, max: 360, step: 15, default: 200, unit: deg }
---

## 描述

一块表面从紫到蓝再到青，颜色本身在移动，不是明暗在变。

机制是 ==虹彩是**色相**在变，金属是**同一色相的明暗**在变==。把 `conic-gradient` 里放一圈相邻色相（紫→蓝→青→绿），就得到珠光；而金属的色标是同一个金色反复明暗跳变。混了这两件事，结果就成了一块「脏金属」。

这是最容易说清、也最容易做混的一对。

## 代码

```html
<div class="ir">
  <span>虹彩</span>
</div>
```

```css
.ir {
  display: grid;
  place-items: center;
  width: 190px;
  height: 190px;
  border-radius: 50%;
  /* @mechanism 色相本身在移动（不是同色明暗），这才是虹彩 */
  background: conic-gradient(
    from var(--from, 200deg),
    #7c5cff,
    #4f7cff,
    #14b8a6,
    #a3e635,
    #f43f5e,
    #7c5cff
  );
  box-shadow:
    inset 0 0 34px rgb(0 0 0 / 0.4),
    inset 0 8px 24px rgb(255 255 255 / 0.16);
  font: 600 15px/1 system-ui, sans-serif;
  color: rgb(255 255 255 / 0.86);
}
```

## 边界

- **金属与虹彩的区别在这里**：金属是同一色相的明暗交替（高光窄而亮），虹彩是色相本身在走。把金属的硬色标拿到这里就成了脏色块。
- 色相要按顺序排（紫→蓝→青→绿→红）。跳着放会显得脏，因为相邻色之间没有可过渡的中间色。
- 过渡段比金属宽、比普通渐变窄。太宽像彩虹糖，太窄又变成一块块色斑。
- 它需要面积才看得出来。小图标上只剩一坨颜色，虹彩的感觉完全丢失。
- 深色底上最明显。浅色底上要降低饱和度，否则像廉价的塑料玩具。
- 内阴影是必要的：它给这块表面一点「弧度」，否则平涂的锥形渐变看着就是一张色卡。

## 备注

- 把 `conic-gradient` 换成 `linear-gradient` 就是「全息贴纸」的斜向虹彩，机制一样、方向单一。
- 配 `@property` 注册角度就能让它缓慢转动，不过那就是另一个条目了。
