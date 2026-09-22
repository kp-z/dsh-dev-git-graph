---
title: 分层文字阴影
slug: layered-text-shadow
category: 排版
tags: [drop-shadow, 标题, 阴影, 浮雕]
since: 2026-10
source: 机制来自 CSS Text Decoration 的 text-shadow 多层叠加，自行实现
when: 标题要看起来悬在背景上方，而不是印在纸上
stage: dark
tier: core
params:
  - { name: depth, label: 悬空高度, type: range, min: 0.4, max: 3, step: 0.1, default: 1 }
  - { name: spread, label: 弥散, type: range, min: 0.4, max: 3, step: 0.1, default: 1 }
---

## 描述

字底下有三层影子：紧贴笔画的一圈硬边、中间一层柔和的暗部、远处一片几乎看不见的弥散。

机制是 ==一层阴影只能表达一种光，三层分别对应接触阴影、投影与环境遮蔽==。判断「悬得多高」靠的不是阴影有多黑，而是三层的分布：接触层几乎不模糊、很暗、紧贴字形，说明物体离地很近；投影层模糊半径与偏移成比例增加、颜色变淡；弥散层半径最大、透明度最低，负责让字与背景之间有一层过渡。只有一层模糊阴影时，眼睛读不出高度，只会觉得字脏、或者像在发光。

三层必须共用同一个光源方向（示例里光从正上方来，所以三层都是垂直偏移），并且各层的模糊半径与不透明度要**成对**变化——模糊变大、颜色就该变淡。这样每一层才携带不同的信息；若三层用同一个模糊半径，它们就退化成一层，只是把同一件事画了三遍。

`text-shadow` 是按字形轮廓绘制的，不是文字盒子，所以字距、字重、字形一变，影子立刻跟着变——这也是它比 `box-shadow` 更适合文字的原因。示例把字放在一块中调的面上，因为阴影需要一个能承接它的表面。

## 代码

```html
<!-- @mechanism 三层阴影都挂在同一个字形上，HTML 不必为阴影加任何元素 -->
<div class="ls-card">
  <h2 class="ts">悬着一层</h2>
  <p class="ts-note">接触 / 投影 / 弥散，三层各管一种光</p>
</div>
```

```css
.ls-card {
  width: min(420px, 86vw);
  padding: 48px 40px 54px;
  border-radius: 20px;
  /* @mechanism 阴影要有能落下的面，纯黑底上它无处可画 */
  background: radial-gradient(120% 90% at 28% 0%, #d8d2c6, #8f887a 72%);
  font-family: system-ui, "PingFang SC", sans-serif;
}

.ts {
  margin: 0;
  font-size: clamp(38px, 9vw, 60px);
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #26221c;
  /* @mechanism 三层分别压住接触面、投影面与环境光，模糊半径与不透明度成对递增 */
  text-shadow:
    0 calc(var(--depth, 1) * 2px) calc(var(--depth, 1) * 1px) rgb(0 0 0 / 0.8),
    0 calc(var(--depth, 1) * 14px) calc(var(--spread, 1) * 12px) rgb(0 0 0 / 0.5),
    0 calc(var(--depth, 1) * 34px) calc(var(--spread, 1) * 30px) rgb(0 0 0 / 0.3);
}

.ts-note {
  margin: 14px 0 0;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: rgb(38 34 28 / 0.6);
}
```

## 边界

- 层数越多越贵：每一层都要把整段文字重新光栅化一遍。正文里铺三层阴影会明显拖慢滚动，它只该给短标题用。
- 三层共用同一个模糊半径等于白铺：层与层之间没有信息差，眼睛看到的是「一层脏影」，而不是高度。
- 文字颜色透明时（渐变字、镂空字）`text-shadow` 仍会按字形画出阴影，现象是渐变字底下浮着一层灰影。要阴影跟着**上色后**的结果走，得改用 `filter: drop-shadow()`。
- 深色底上深色阴影几乎看不见（黑压黑）。深色主题里投影层要换成更亮的辉光层，否则只剩一圈模糊的光晕，高度读不出来。
- 阴影是画在字形轮廓上的，会跟着 `letter-spacing`、字重和字形变化；一个为静态标题调好的三层阴影，换字重后需要重新配平，否则接触层会露在笔画外面。
- 阴影不参与布局：`text-shadow` 溢出容器时不会被 `overflow: hidden` 收缩到盒子内，而是照原样画出去或干脆被裁掉，与所在容器的裁剪行为有关。

## 备注

- 与像素堆叠出来的长阴影（`long-shadow`）不是一回事：那里靠几十层硬边拼出实体投影，这里靠三层不同性质的光读出高度。
