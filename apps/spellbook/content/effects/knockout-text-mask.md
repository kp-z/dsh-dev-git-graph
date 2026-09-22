---
title: 遮罩挖空的字
slug: knockout-text-mask
category: 排版
tags: [遮罩, 镂空, SVG]
since: 2026-10
source: 机制来自 SVG mask 的黑白通道语义，自行实现
when: 想从一个不透明的面上把字挖出来，让背后的东西从字里透出去
stage: dark
tier: core
---

## 描述

一块深色板上挖出几个字形的洞，洞里透出背后缓缓转动的彩色光，洞口边缘还有一圈细亮的刻痕。

机制是 ==SVG 遮罩里白色留下、黑色挖掉，所以字形可以直接当作挖洞的工具==。这正好和 `background-clip: text` 互为反面：那里是把背景裁进字形里（字是**有**颜色的），这里是把覆盖层从字形处剪掉（字是**空**的）。挖洞的好处是洞里透出来的是真实内容——一段动画、一张图、一段视频，不需要为它改一行代码；clip 方案只能把静态背景或渐变塞进字里。

那圈细亮边是第二层 `text` 画的：在遮罩里给同一个字形描一条白边，白色就意味着「这一圈留下」，于是洞口边缘保留了一条覆盖层的细线。它的作用是把「挖空」和「背后的光晕洒出来」区分开——没有这圈边，字会读成发光而不是镂空。

## 代码

```html
<div class="ko">
  <div class="ko-light" aria-hidden="true"></div>
  <svg class="ko-plate" viewBox="0 0 560 220" aria-hidden="true">
    <defs>
      <!-- @mechanism 白留黑挖：黑色字形就是挖洞的模具 -->
      <mask id="ko-hole">
        <rect width="560" height="220" fill="#fff" />
        <text x="280" y="145" text-anchor="middle" class="ko-word" fill="#000">咒语书</text>
        <!-- @mechanism 在洞口描一条白边，覆盖层因此在字形边缘留下一圈刻痕 -->
        <text x="280" y="145" text-anchor="middle" class="ko-word" fill="none" stroke="#fff"
          stroke-width="1.5">咒语书</text>
      </mask>
    </defs>
    <rect width="560" height="220" fill="#0b0910" mask="url(#ko-hole)" />
  </svg>
  <!-- @mechanism 洞不是 HTML 文本，这里补一份给读屏与复制 -->
  <p class="ko-sr">咒语书</p>
</div>
```

```css
.ko {
  position: relative;
  width: min(560px, 92vw);
  aspect-ratio: 560 / 220;
  overflow: hidden;
  background: #0b0910;
}

/* @mechanism 运动的内容真实存在，只是被上面那块板挡着 */
.ko-light {
  position: absolute;
  inset: -30%;
  background: conic-gradient(from 0deg, #f0a14a, #f43f5e, #7c5cff, #14b8a6, #f0a14a);
  filter: blur(26px);
  animation: ko-turn 14s linear infinite;
}

.ko-plate {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.ko-word {
  font-family: system-ui, "PingFang SC", sans-serif;
  font-size: 104px;
  font-weight: 800;
}

.ko-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
}

@keyframes ko-turn {
  to {
    rotate: 360deg;
  }
}
```

## 边界

- 洞里的字不是 HTML 文本：SVG 的 `<text>` 选不中、复制不到、读屏也读不到。必须另放一份视觉隐藏的 HTML 文本，否则标题对搜索与无障碍等于不存在。
- 遮罩用灰度当透明度：文字的抗锯齿边缘本来带灰，洞口因此天然有一圈半透明过渡（这是想要的）；但若在遮罩里再画半透明形状，就会在板上留下擦不掉的雾。
- SVG `<text>` 不会自动换行，长文本要自己切成多个 `<text>`；字号、字距也要手动与 HTML 版本对齐，用 `textLength` 拉宽会把字形挤变形。
- 旧引擎上跨 SVG 引用 mask 不稳定，现象是被遮罩的整块板直接变成全黑（洞也没了）。排查顺序：mask 的 id、白色矩形的覆盖范围、drawing 元素上的 `mask="url(#…)"`。
- 遮罩会让被遮罩层多走一次合成。把动画放在遮罩**下面**（示例就是这么做的）比让遮罩本身变大便宜得多——后者的每一次缩放都会重算遮罩。

## 备注

- 同一套「白留黑挖」还能挖出图片窗口、进度条的缺口、表单里透出的背景纹理；只要是需要「一整块面上开洞」的场合，它都比 clip 更直接。
