---
title: 光学尺寸
slug: optical-sizing-opsz
category: 排版
tags: [font-face, letter-spacing, 标题, 正文]
since: 2026-10
source: 机制来自 CSS Fonts 4 的 font-optical-sizing 与可变字体的 opsz 轴，自行实现
when: 同一款字体要同时用在 12px 的注释和 60px 的标题上，又不想维护两套字体
stage: plain
tier: core
---

## 描述

同一句话在两行里出现：小字那行开、笔画粗、字距松；大字那行紧、笔画细、粗细对比强。两个字形形状不同，用的却是同一个字体文件——浏览器自己按字号选的。

机制是 ==font-optical-sizing 把 font-size 喂给字体的 opsz 轴==，让字体换用为这个字号设计的那一套字形。小字号在屏幕上只占几个像素，细笔画会被抗锯齿吃掉、紧字距会糊成一团，所以小尺寸的字需要更粗的笔画、更大的 x-height、更松的间距；字号大了以后这些补偿全部变成缺点——笔画显笨、间距显散。传统上厂商为此出 Text 与 Display 两套，可变字体把两套之间的所有中间态做进一条轴，于是「选哪一套」变成一次连续取值。

这个属性默认就是 `auto`，所以真正要写代码的场合反而少见：要么是故意钉死某个光学尺寸（放大镜里的小字要保持 Text 的形状），要么是在排查「为什么我的大字用了 Text 字形」。示例把 12px 与 56px 并排，是为了看清两端的形状差异。

## 代码

```html
<!-- @mechanism 标记不参与选择：两行同一句话，光学尺寸只认字号 -->
<p class="os-small">Handgloves — 12px needs stronger strokes.</p>
<h2 class="os-large">Handgloves</h2>
<p class="os-pinned">Handgloves — 钉在小号字形上</p>
```

```css
.os-small,
.os-large,
.os-pinned {
  font-family: system-ui, sans-serif;
  margin: 0;
  /* @mechanism 默认值即 auto：引擎把 font-size 当作 opsz 的取值 */
  font-optical-sizing: auto;
}

.os-small {
  font-size: 12px;
}

.os-large {
  font-size: 56px;
  letter-spacing: -0.01em;
}

.os-pinned {
  font-size: 56px;
  /* @mechanism 关掉自动匹配，大字只能用回小字号的字形骨架 */
  font-optical-sizing: none;
  color: rgb(28 26 23 / 0.5);
}
```

## 边界

- 字体没有 opsz 轴时它是彻底的 no-op：不报错、不回退、什么都不变。引擎不会合成光学尺寸（这一点与合成粗体不同，别指望有兜底）。
- `font-variation-settings: "opsz" 20` 会覆盖自动匹配，而且优先级更高。两套写法同时存在时以它为准——这是排查「为什么没自动变」的第一站。
- 用 `transform: scale()` 放大文字不改变 `font-size`，opsz 也就不变：字是被几何放大的，而不是换成大字号的设计。放大镜、图表里的缩放文字最容易踩到。
- 系统中文字体基本没有 opsz 轴，示例用拉丁文演示。把 `font-optical-sizing` 写进 CJK 的字体栈不会有害，但也不会有任何效果。

## 备注

- 网页字体一般只带几个实例；如果只想要视觉冲击，直接把标题的字号、字距调好，往往比引入一个带 opsz 轴的字体更省。
