---
title: 双层中空玻璃
slug: double-glaze
category: 材质
tags: [backdrop-filter, blur, 玻璃, 容器]
since: 2026-10
source: 机制来自 backdrop-filter 的逐层累积，自行实现
when: 一层玻璃压不住底下的乱，但你又不想把它糊成一块
stage: photo
tier: core
params:
  - { name: pane-blur, label: 单层模糊, type: range, min: 0, max: 12, step: 0.5, default: 5, unit: px }
---

## 描述

两块玻璃叠着放，中间留一层空气——像中空玻璃窗那样。底下乱糟糟的照片透上来还是看得见内容，只是被压得很安静。

机制是 ==backdrop-filter 在叠层之间会累积，而不是取最强的那个==。`backdrop` 指的是「已经画在自己下面的所有像素」。上面那块玻璃读到的，是下面那块玻璃**已经处理过**的结果，于是它又模糊了一遍。两片 5px 的玻璃得到的柔和度，比一片 10px 的更像真的厚玻璃——因为中间那层气隙各自贡献了一点散射，而不是一次性地重糊。

这也意味着旋钮的位置换了：单层玻璃只能靠加半径硬糊，双层则可以分别调「气隙有多浑」和「外片有多厚」。想把底部压得更平，加一层玻璃比把半径翻倍更划算。

## 代码

```html
<!-- @mechanism 两块玻璃是兄弟层，后画的那块读到的是前面已经处理过的画面 -->
<div class="glaze">
  <div class="glaze-pane"></div>
  <div class="glaze-pane"></div>
  <p class="glaze-label">双层中空</p>
</div>
```

```css
.glaze {
  position: relative;
  width: min(340px, 82vw);
  height: 190px;
  overflow: hidden;
  border-radius: 16px;
}

.glaze-pane {
  position: absolute;
  inset: 0;
  /* @mechanism 每层各模糊一遍，下面那层的输出会成为上面那层的背景，所以是累积 */
  backdrop-filter: blur(var(--pane-blur, 5px)) saturate(1.12);
  background: rgb(255 255 255 / 0.06);
}

/* 外片稍微厚一点、亮一点，才有「一片压一片」的层次 */
.glaze-pane:nth-child(2) {
  background: rgb(255 255 255 / 0.05);
  border: 1px solid rgb(255 255 255 / 0.3);
  border-radius: 16px;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.6);
}

.glaze-label {
  position: absolute;
  inset: 0;
  /* @mechanism 文字必须在两块玻璃之上，否则会被当成底图一起糊掉 */
  z-index: 1;
  display: grid;
  place-items: center;
  margin: 0;
  font: 500 17px/1 system-ui, sans-serif;
  letter-spacing: 0.18em;
  color: #fff;
  text-shadow: 0 1px 10px rgb(0 0 0 / 0.5);
}
```

## 边界

- 累积的是**模糊**，不是不透明度。三块 6% 白的面板叠起来只有 17% 白，远不是 18%——想让底下更暗得单独调 `background`。
- 每多一层就多一次离屏合成。四层以上在滚动时肉眼可见掉帧，而且收益已经很薄。
- 底层如果带 `filter` / `transform` / `will-change`，**累积会从那一层断开**：上面还有玻璃感，底下那层却完全没糊，看起来像错位。
- 各层的半径不能一样。两片都是 5px 时，加起来接近 7px 而不是 10px——同样会糊，但边缘的柔和度不同，调节感会失真。
- 这条完全依赖底图。空舞台上两层玻璃叠出来只是一块浅色矩形，累积没有任何东西可以累积。

## 备注

- 想做「隔热玻璃」那种带颜色的中空层，把中间那层换成 `saturate(0.6) hue-rotate(180deg)`，两片夹一层色偏，比直接不透明度染色更像真的。
- 同一招用在滚动容器上很划算：内容顶上两层玻璃，越靠上越糊，天然带出「内容滚进雾里」的感觉。
