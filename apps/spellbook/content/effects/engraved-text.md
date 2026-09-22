---
title: 金属凹刻
slug: engraved-text
category: 材质
tags: [雕刻, 文字, 内阴影]
since: 2026-10
source: 机制来自内嵌容器的双向 inset 阴影与文字反向 text-shadow，自行实现
when: 金属铭牌上的字要是被刻进去的，而不是印上去的
stage: plain
tier: core
params:
  - { name: depth, label: 刻痕深度, type: range, min: 0.5, max: 3, step: 0.25, default: 1, unit: px }
---

## 描述

一块灰色金属牌上，字形比周围表面暗一点，上沿有阴影、下沿有亮线，字看起来是陷进去的。

机制是 ==文字的明暗与容器的内阴影共用同一个光向，但方向相反==。刻痕成立需要两个证据同时在场：字**内部**要暗（凹陷处接不到光），字的**下沿**要亮（凹陷的底边被照亮）、**上沿**要暗（凹陷的上壁挡住了光）。这正好和 `emboss-relief` 里凸起的规则完全相反——那里是上亮下暗。两套规则不能混用，否则同一个画面里的凸字和凹字会像来自两个不同光源。

`inset` 的容器阴影是第二重证据：它让整块牌子有边缘内收的厚度，字才不是平铺在一块无限薄的板上。文字自己的那对反向 `text-shadow` 和容器的 `inset` 阴影必须共用同一条对角方向（示例里都是左上受光），否则眼睛会读到两个光源。

`depth` 同时控制文字阴影的偏移与容器内阴影的厚度。它们是同一个物理量——刻得越深，字的阴影越明显、牌子边缘的立体感也越强，拆成两个参数就会互相矛盾。

## 代码

```html
<div class="eg">
  <span class="eg-mark">SERIES 07</span>
</div>
```

```css
.eg {
  display: grid;
  place-items: center;
  width: 300px;
  height: 130px;
  border-radius: 8px;
  background: linear-gradient(166deg, #b9bec4, #8b9198 54%, #a8aeb5);
  /* @mechanism 内收的亮/暗边给出牌子的厚度，光向与文字的阴影保持一致 */
  box-shadow:
    inset calc(var(--depth, 1px) * 1.5) calc(var(--depth, 1px) * 1.5) calc(var(--depth, 1px) * 4) rgb(255 255 255 / 0.85),
    inset calc(var(--depth, 1px) * -1.5) calc(var(--depth, 1px) * -1.5) calc(var(--depth, 1px) * 4) rgb(0 0 0 / 0.4),
    0 8px 20px rgb(0 0 0 / 0.35);
}

.eg-mark {
  font: 700 30px/1 ui-monospace, "SFMono-Regular", Consolas, monospace;
  letter-spacing: 0.24em;
  color: #7c8288;
  /* @mechanism 上沿暗、下沿亮＝刻进去；这与凸起浮雕的规则正相反，不可混用 */
  text-shadow:
    calc(var(--depth, 1px) * -1) calc(var(--depth, 1px) * -1) calc(var(--depth, 1px) * 0.6) rgb(0 0 0 / 0.65),
    var(--depth, 1px) var(--depth, 1px) calc(var(--depth, 1px) * 0.6) rgb(255 255 255 / 0.85);
}
```

## 边界

- **光向必须全局统一。**文字那对阴影是「上暗下亮」，容器的 `inset` 就必须是「左上亮、右下暗」。任何一处反过来，画面里就出现两个光源，刻痕读不出来——这是这类拟物效果最常见的翻车点，而且很难归因，因为每一条阴影单独看都「没错」。
- 文字颜色只比底色**暗一点点**。刻痕的暗来自阴影，不是来自把字涂黑；用 `#333` 这类深色会立刻变成印刷字，凹陷感随阴影一起消失。
- 金属底色必须是**斜向渐变**，不能是纯色。纯色底上，字下沿那条亮线会显得像描边；有斜向明暗时，它才融进整块牌子的反光里。
- 字号太小或字重太细时，上下两条 1px 的阴影会在笔画里互相吃掉，字会糊成一团灰。30px 以上、`700` 左右是这套参数的合理区间。
- 它不产生真正的深度。俯视角度变化时（比如给牌子加 3D 旋转），刻痕不会跟着变，会立刻暴露成一张平面贴图。这是所有用阴影伪造的立体感的共同边界。
- 浅色底（牌面很亮）时亮线几乎不可见，只剩上沿的暗边，凹刻会退化成「带下划线的字」。

## 备注

- 把两处光向同时反转，同一份代码立刻得到**凸**的字，机制一字不改——凸凹在这个效果里就是一对开关。
- 换成等宽字体加更宽的 `letter-spacing`，观感从铭牌变成机箱丝印或仪表盘刻度。
