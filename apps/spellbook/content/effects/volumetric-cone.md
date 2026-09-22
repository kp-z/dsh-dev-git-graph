---
title: 体积光的错觉
slug: volumetric-cone
category: 材质
tags: [conic-gradient, mask, repeating-gradient, 颗粒, 容器]
since: 2026-10
source: 机制来自丁达尔效应，光柱靠被照亮的介质才可见，用锥形渐变与遮罩合成，自行实现
when: 一束光从上方缝隙射进暗房间，要看到光锥本身
stage: dark
tier: core
params:
  - { name: haze, label: 尘埃条纹, type: range, min: 1, max: 12, step: 1, default: 4, unit: px }
---

## 描述

一束光从画面顶部中间射下来，越往下越宽、也越淡；光锥里还能看出疏密不均的亮纹，像浮着尘埃。

机制是 ==光柱本身不可见，可见的是被它照亮的尘埃，所以要用条纹加距离遮罩去假装介质==。真空里光不留下痕迹；你能看到光锥，是因为空气里的微粒在散射。所以这里不能画一个实心的、边缘干净的梯形——那读起来是一块塑料片。正确的做法是三件事叠起来：一个扇形给出光锥的整体轮廓，一层等距细条纹当作尘埃造成的疏密，再一张顺着锥体方向的遮罩把远端压掉——光在远处既弥散、也照不到那么多粒子，这层衰减才是「体积感」的来源。

可变的是 `--haze`（条纹间距）、锥角与衰减距离。条纹要斜着切过锥轴，不能平行于锥轴，否则会看成灯罩的骨架。示例把扇形角度写死在 `conic-gradient` 里，改锥角就是改那两个角度。

## 代码

```html
<div class="cone">
  <p>体积光</p>
</div>
```

```css
.cone {
  position: relative;
  display: grid;
  place-items: end center;
  width: min(440px, 88vw);
  height: 260px;
  overflow: hidden;
  background: #05060a;
  color: #6a7186;
  font: 400 13px/1.6 system-ui, sans-serif;
}

.cone::before {
  content: "";
  position: absolute;
  inset: -12% -20%;
  /* @mechanism 扇形给轮廓、条纹给尘埃、遮罩给距离衰减，缺一层就退化成一块塑料片 */
  background:
    repeating-linear-gradient(
      78deg,
      rgb(255 250 226 / 0.12) 0 1px,
      transparent 1px var(--haze, 4px)
    ),
    conic-gradient(
      from 150deg at 50% -8%,
      transparent 0deg 20deg,
      rgb(255 246 214 / 0.26) 20deg 40deg,
      transparent 40deg 60deg
    );
  filter: blur(6px);
  /* @mechanism 远端必须淡出，光在远处弥散、也照不到那么多尘埃 */
  mask-image: linear-gradient(to bottom, #000 2%, rgb(0 0 0 / 0.4) 48%, transparent 86%);
  pointer-events: none;
}

.cone p {
  position: relative;
  padding-bottom: 18px;
}
```

## 边界

- `conic-gradient` 的扇形从一个顶点张开，顶点必须落在画面外（示例是 `at 50% -8%`）。顶点落在画面里就会出现一个明显的尖，立刻穿帮。
- 遮罩在旧 Safari 上要写 `-webkit-mask-image`，否则整块光锥不显示或者变成实心的一坨。
- 条纹是等距的，仔细看有明显周期性。真实尘埃是分形的，要更真就叠第二层间距不成整数倍的条纹。
- `filter: blur()` 会把条纹一起糊掉。条纹间距压到 2px 以下时它们会消失，只剩一片灰雾，所以 `--haze` 不能给太小。
- 光锥不参与场景光照，它不会真的照亮地板或人物。要「照亮」得另外做一块受光的地面亮斑，两者位置必须对得上，否则空间关系会崩。
- 锥体的宽度只由那两个角度决定，与容器宽度无关。容器一变窄，光锥的下缘会先被切掉。

## 备注

- 把 `conic-gradient` 换成两条更细的扇形、各自偏一点角度，就得到透过百叶窗的两道光柱。
- 让 `conic-gradient` 的角度轻微摆动会让整个场景活起来，但动画会每帧重算模糊，代价不低。
