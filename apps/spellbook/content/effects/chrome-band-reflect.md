---
title: 铬的带状反射
slug: chrome-band-reflect
category: 材质
tags: [镀铬, 反射, 环境贴图]
since: 2026-10
source: 机制来自线性渐变的横向色带模拟环境反射，自行实现
when: 数字或徽标要做成镀铬的，但不想上 WebGL 或贴图
stage: dark
tier: core
---

## 描述

一条镀铬的横条，上面有天空、地平线、地面的分层倒影，两侧被压暗。

机制是 ==铬本身没有颜色，它显示的是环境的对比度==。一块完美的镜子放在空房间里就是一块灰板——你看到的全部是它反射的东西。所以做铬不是调一个「银色」，而是**画一条竖直的环境剖面**：上方亮（天）、中间一条极窄的暗线（地平线）、下方中灰（地面），再让这条剖面在曲面处挤压变形。眼睛认出的是那个明暗结构，不是任何色值。

示例里没有任何反射贴图，`linear-gradient` 就是那张环境图。它成立的原因是：一条水平放置的金属圆角条，其环境剖面在视觉上可以近似为竖直方向的一维函数。一旦物体是球或复杂曲面，这个近似就崩了——那才是必须上真反射的地方。

## 代码

```html
<div class="cb">
  <span class="cb-mark">CHROME</span>
</div>
```

```css
.cb {
  display: grid;
  place-items: center;
  width: min(420px, 82vw);
  height: 120px;
  border-radius: 60px;
  /* @mechanism 竖直的环境剖面：天光、地平线、地面，明暗结构就是铬的全部内容 */
  background: linear-gradient(
    180deg,
    #f6fbff 0%,
    #cdd9e4 14%,
    #8d9dae 34%,
    #2c3742 49%,
    #38424c 51%,
    #97a6b4 66%,
    #e2eaf2 84%,
    #aab6c2 100%
  );
  box-shadow:
    inset 0 2px 1px rgb(255 255 255 / 0.85),
    inset 0 -3px 6px rgb(0 0 0 / 0.5),
    0 14px 34px rgb(0 0 0 / 0.5);
}

.cb-mark {
  font: 800 22px/1 system-ui, sans-serif;
  letter-spacing: 0.28em;
  /* @mechanism 字母也吃同一套环境明暗，才会像刻在镜面上而不是贴上去 */
  background: linear-gradient(180deg, #5b6875, #10161c 48%, #7b8896);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
```

## 边界

- **地平线那条暗线是整个效果的支点。**它必须窄（49%→51%）并且明显暗于两侧；拉宽成一段渐变，铬就塌成一块灰色塑料。这条线对应的是「视线切过圆柱曲面」的那一段，物理上就是压缩最剧烈的地方。
- 环境剖面是**竖直的**，因此只对水平延展、上下受曲的物体（胶囊、横条、环）有效。放在正方形或球上，渐变不会跟着轮廓弯，看起来是一张贴纸。想用在球面上要靠 `radial-gradient` 重新排一次，不能直接复用。
- 顶部的 `inset 0 2px 1px` 白线和底部的暗影不是装饰：它们补上渐变表达不了的**边缘挤压**，没有它们，圆角处的反射会显得是平的。
- 铬在浅色底上会因为缺对比而变脏——它的全部信息都是明暗差，背景越亮，可用的动态范围越小。
- 它完全静止。真铬的高光随视角移动，这里动不了；想动只能换 `<canvas>` 或 WebGL 做真反射。

## 备注

- 同样的剖面换成偏黄的色值就是黄铜，换成偏青的就是镍。
- 反向使用也成立：想做「液面」而不是「金属」，把剖面的对比度大幅降低即可。
