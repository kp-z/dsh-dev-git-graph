---
title: 铜绿锈迹
slug: patina-rust
category: 材质
tags: [氧化, 锈迹, 噪声滤镜]
since: 2026-10
source: 机制来自 SVG feTurbulence 配合离散型 feComponentTransfer 得到硬边斑块，自行实现
when: 一块金属要有久经风霜的氧化斑，而不是均匀的做旧
stage: dark
tier: core
---

## 描述

一块铜绿色表面，上面散布着形状不规则、边缘发碎的深褐色锈斑，斑块大小不一。

机制是 ==把湍流噪声的 alpha 做「离散」阈值化，得到硬边斑块，再把同一份噪声的灰度映射成锈色==。锈迹的特征是**边界硬、内部实、分布无规律**——那是腐蚀从一点向外扩展的结果。`feTurbulence` 给的是平滑随机场，直接拿它的灰度当遮罩只会得到雾气般柔和的斑块，像水渍不像锈。所以要在它后面接 `feComponentTransfer`：alpha 用 `discrete` 表把连续值**阶梯化**（低于阈值整片透明、高于阈值整片不透明），RGB 则用 `table` 把噪声灰度映射成一条锈色渐变。斑块的形状与斑块内的深浅变化，就都从同一份噪声里出来。

底下的金属保留自己的渐变与拉丝方向，锈只盖住一部分。这个「部分覆盖」是机制的要点而非美化：腐蚀从瑕疵处开始，没被侵蚀的地方仍是金属，所以斑块之间必然露出干净的表面。若锈层全覆盖，它就不是锈，而只是一块锈色的材质。

`baseFrequency` 的两个值刻意不同（横向更疏），于是斑块沿横向被拉长，读作「沿轧制方向蔓延」的锈。等频噪声更像云或布料，缺少方向性。

## 代码

```html
<div class="pr">
  <!-- @mechanism 噪声在 SVG 里生成并着色，再整层压上去；锈只出现在噪声阈值以上的区域 -->
  <svg class="pr-rust" viewBox="0 0 260 180" preserveAspectRatio="none" aria-hidden="true">
    <filter id="pr-noise" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="4" seed="7" />
      <!-- @mechanism alpha 走离散表 → 硬边；RGB 走连续表 → 锈色深浅 -->
      <feComponentTransfer>
        <feFuncA type="discrete" tableValues="0 0 0 0 1 1 1" />
        <feFuncR type="table" tableValues="0.09 0.66" />
        <feFuncG type="table" tableValues="0.04 0.34" />
        <feFuncB type="table" tableValues="0.01 0.10" />
      </feComponentTransfer>
    </filter>
    <rect width="260" height="180" filter="url(#pr-noise)" />
  </svg>
</div>
```

```css
.pr {
  position: relative;
  width: 260px;
  height: 180px;
  border-radius: 8px;
  overflow: hidden;
  /* @mechanism 干净的金属底层：斜向明暗给朝向，细纹给拉丝质感 */
  background:
    linear-gradient(115deg, rgb(255 255 255 / 0.2), rgb(0 0 0 / 0.38)),
    repeating-linear-gradient(92deg, #7a8c86 0 2px, #6a7b76 2px 4px);
}

.pr-rust {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* @mechanism 整层不封满，金属从斑块缝隙里透出来，才读作「局部被腐蚀」 */
  opacity: 0.88;
}
```

## 边界

- **`discrete` 才是锈，连续映射只是雾。**alpha 若改成 `type="table"` 的连续插值，会得到柔和渐变斑块，像打湿的纸；只有阶梯化、档与档之间不插值，才有腐蚀那种硬边。代价是边缘带像素级锯齿，`baseFrequency` 调得越细越明显。
- 滤镜**不能反过来当 CSS 遮罩用**（`mask-image: url(#某个 filter)` 无效，遮罩只接受 `<mask>` 元素或图片）。所以这里让 SVG 自己把噪声着色成一整层压在金属上，比绕道遮罩少一整条链路，也少一处各引擎行为不一致的地方。
- `baseFrequency` 决定斑块尺度，而且它写在 SVG 标记里，**没法用 CSS 变量从外部驱动**。要做响应式的斑块尺度，只能在 JS 里改属性或整个换滤镜。
- `feTurbulence` 的 RGB 与 alpha 是同一函数的不同通道，但彼此不相关：所以斑块边界和斑块内部的深浅图案不是一回事。想要二者对齐，得写成两份独立噪声并显式吻合，收益很小。
- 噪声用 `preserveAspectRatio="none"` 拉伸到容器尺寸，所以斑块**不随容器等比变密**：容器放大时斑块被拉长变糊，而不是变多。
- 它是逐像素的软件光栅化，`numOctaves` 每加一档成本线性上涨。4 档之后收益已很小，6 档足以让低端机掉帧。
- 它只给斑块，不给划痕、凹坑、积灰。真做旧要另外叠层——这套机制的职责边界到此为止。

## 备注

- 把 RGB 那三条映射表的色值换成孔雀绿（`#2f7d6b` 一系），同一份噪声就变成青铜器上的绿锈，形状逻辑完全一样。
- 换成大面积、低频率的噪声并降低 alpha 阈值，同一套做法就是「掉漆」「脱膜」「墙皮」——通用的破损遮罩。
