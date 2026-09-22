---
title: 模糊占位交叉淡入
slug: blur-up-image
category: 动效
tags: [图片加载, LQIP, 模糊]
since: 2026-10
source: 机制来自 LQIP（低质量图像占位）的做法，自行实现
when: 图片要等一下才到，先用一张极小的模糊版本占住位置，加载完再淡入
stage: photo
tier: core
---

## 描述

图片位置先是糊成一团的色块，真图解码完成的那一刻整体变清晰，没有空白帧。

机制是 ==先用缩略图作 src 并给它加模糊滤镜，真图解码完再换 src、同一帧去掉滤镜==。关键在于「糊」不是为了好看，而是为了**掩盖这不是真图**：一张 20px 宽的缩略图放大到 300px 后本来就是马赛克，加上 `filter: blur()` 之后它会读成「大致的色块结构」而不是「一张很差的图」。用户看到的是主色和构图提前到位，心理上这段时间就不是空白。

模糊必须配一点放大。高斯模糊会把边缘像素和框外的透明区域混合，不放大时四周会出现一圈发白的毛边；`transform: scale(1.06)` 把这一圈推到裁剪区外。另外换 `src` 时浏览器会先清空再解码，中间有一帧空白——所以真图要先 `new Image()` 预加载并 `decode()`，等解码完再换，否则现象是「闪一下白」。

## 代码

```html
<figure class="bu" id="sb-bu">
  <img id="sb-bu-img" alt="示例图片" />
  <figcaption>先糊着占位，真图解码完再交叉淡入。</figcaption>
</figure>
<button class="bu-again" id="sb-bu-again" type="button">重新加载</button>
```

```css
.bu {
  position: relative;
  width: min(300px, 76vw);
  margin: 0 0 12px;
  border-radius: 8px;
  /* @mechanism 为了藏住模糊放大的那一圈，必须裁掉溢出 */
  overflow: hidden;
  background: rgb(60 48 30 / 0.12);
}

.bu img {
  display: block;
  width: 100%;
  transform: scale(1);
  /* @mechanism 只过渡滤镜与缩放，图片本体不换位 */
  transition: filter 0.6s ease, transform 0.6s ease;
}

/* @mechanism 加载态就是"变糊 + 稍微放大"，真图到了把这两个值收回去 */
.bu.is-loading img {
  filter: blur(14px);
  transform: scale(1.06);
}

.bu figcaption {
  padding: 8px 10px;
  font: 400 12px/1.5 system-ui, sans-serif;
}
```

```js
const figure = document.getElementById('sb-bu')
const img = document.getElementById('sb-bu-img')

// 生产里 THUMB 是一张 20px 宽的位图，几百字节；这里用等价的低清 SVG 代替
const THUMB = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Crect width='12' height='8' fill='%2314b8a6'/%3E%3Crect x='8' y='2' width='3' height='3' fill='%23d9a441'/%3E%3Cpath d='M0 8 L4 3 L8 8Z' fill='%23b4462f'/%3E%3C/svg%3E"
const FULL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 80'%3E%3Crect width='120' height='80' fill='%2314b8a6'/%3E%3Ccircle cx='88' cy='24' r='13' fill='%23d9a441'/%3E%3Cpath d='M0 80 L42 32 L78 80Z' fill='%23b4462f'/%3E%3C/svg%3E"

function show() {
  img.src = FULL
  // @mechanism 换图与去模糊同一帧发生，看过去是一次干净的交叉淡入
  figure.classList.remove('is-loading')
}

function load() {
  // @mechanism 先塞缩略图并保持模糊：模糊负责掩盖"这还不是真图"
  figure.classList.add('is-loading')
  img.src = THUMB

  const full = new Image()
  full.src = FULL
  // @mechanism 真图先解码好再换，否则换 src 的瞬间会闪一帧空白
  full.decode().catch(() => {}).finally(() => setTimeout(show, 1200))
}

load()
document.getElementById('sb-bu-again').addEventListener('click', load)
```

## 边界

- 模糊不带 `scale`：四周会出现一圈发白的毛边，因为高斯模糊把边缘像素和框外的透明区混在了一起。
- 占位图必须是**真的小图**。拿同一张大图加 `filter: blur()` 不省流量，还多一次解码，比不做占位更贵。
- 直接换 `src` 不预加载：中间有一帧空白，现象是「闪白一下再清晰」。要先 `decode()` 或等 `load` 再切换。
- 模糊半径要按**最终显示尺寸**给，不是按缩略图尺寸。给 20px 的缩略图糊 `blur(14px)` 再放大，糊得什么都看不出来。
- `filter` 会为元素创建包含块：里面一旦有 `position: fixed` 的后代，会以这张图为参照而不是视口。图片里一般没有，但同一招用在卡片容器上就会踩。
- 图片加载失败时模糊层会一直糊着，用户永远在等一张不会来的清晰图。要监听 `error` 给出失败态。

## 备注

- 生产里的 THUMB 通常由服务端生成（微型 WebP），或者用 BlurHash / 微型内联 SVG 代替，几十到几百字节就能给出整张图的主色与大致构图。
- 同一招也适合视频：先糊一张首帧缩略图，等 `loadeddata` 再淡入。
