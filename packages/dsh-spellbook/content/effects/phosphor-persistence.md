---
title: 荧光屏余辉
slug: phosphor-persistence
category: 材质
tags: [custom-property, box-shadow, 发光, 光晕]
since: 2026-10
source: 机制来自 CRT 荧光粉余辉，以及用半透明覆盖代替历史轨迹的经典画法，自行实现
when: 一个移动的光点要留下逐渐消退的拖尾
stage: dark
tier: core
params:
  - { name: decay, label: 余辉长度, type: range, min: 0.02, max: 0.5, step: 0.02, default: 0.14 }
---

## 描述

一个亮点在黑色画布上绕着圈跑，身后拖着一条越长越暗的光尾，亮度平滑地衰减掉。

机制是 ==不记录轨迹，每帧只铺一层半透明黑把上一帧压暗==。想画拖尾，直觉是保存过去 N 个位置，再依次画出越来越淡的点——那样内存与循环次数都随拖尾长度增长。换一个角度：拖尾的本质就是「旧像素按固定比例变暗」，于是每帧先铺一层低透明度的黑色（是 `fillRect`，不是 `clearRect`），再把新的一帧画上去。旧像素每帧乘一次 `(1 − α)`，n 帧后剩 `(1 − α)ⁿ`，正好是指数衰减的余辉，和荧光粉的物理过程同构；代价则是恒定的一层填充。

可变的是 `--decay`（覆盖色的不透明度）：越小余辉越长、越拖泥带水，越大越干脆。把它调到 1 就等于每帧清屏，拖尾完全消失——这条边界也说明整条效果只由这一行决定。画布必须按 `devicePixelRatio` 放大，否则在高分屏上会拖着明显的像素块。

## 代码

```html
<canvas class="phosphor" id="sb-phosphor" width="420" height="200"></canvas>
```

```css
.phosphor {
  display: block;
  width: min(440px, 88vw);
  height: auto;
  background: #04060a;
  border-radius: 10px;
  /* @mechanism 屏幕自身的冷光浓度与 JS 里用的覆盖 alpha 是同一个变量 */
  box-shadow: 0 0 44px rgb(90 160 240 / calc(var(--decay, 0.14) * 1.2));
}
```

```js
const canvas = document.getElementById('sb-phosphor')
const ctx = canvas.getContext('2d')
const dpr = window.devicePixelRatio || 1
const w = canvas.clientWidth
const h = canvas.clientHeight
canvas.width = w * dpr
canvas.height = h * dpr
ctx.scale(dpr, dpr)

// canvas 里写不了 var()，只能把同一个 CSS 变量读出来；它也不会自动更新，得定期重读
let decay = Number(getComputedStyle(canvas).getPropertyValue('--decay')) || 0.14

// 图版重播会重新挂载并再跑一次脚本，上一轮的循环必须自己收掉
if (canvas.__loop) cancelAnimationFrame(canvas.__loop)

let angle = 0
let tick = 0

function frame() {
  if (tick++ % 15 === 0) {
    decay = Number(getComputedStyle(canvas).getPropertyValue('--decay')) || decay
  }
  // @mechanism 每帧只盖一层薄黑，不存任何历史轨迹，旧像素自己按 (1 - alpha) 衰减
  ctx.fillStyle = `rgba(4, 6, 10, ${decay})`
  ctx.fillRect(0, 0, w, h)
  angle += 0.045
  const x = w / 2 + Math.cos(angle) * w * 0.3
  const y = h / 2 + Math.sin(angle * 1.6) * h * 0.28
  ctx.beginPath()
  ctx.arc(x, y, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = '#bfe6ff'
  ctx.fill()
  canvas.__loop = requestAnimationFrame(frame)
}

canvas.__loop = requestAnimationFrame(frame)
```

## 边界

- 覆盖色的不透明度同时决定余辉长度和「底色能不能被洗掉」。给得太小（比如 0.02），旧内容要几百帧才淡完，画面会一直挂着一层洗不干净的脏底。
- 覆盖必须在**同一坐标系**里。示例先 `ctx.scale(dpr, dpr)` 再按 CSS 像素画，如果把这里改成 `canvas.width`（设备像素），覆盖区域会大一倍。
- 设置 `canvas.width` / `canvas.height` 会重置整个上下文状态，包括之前的 `scale`。缩放必须放在赋值之后，顺序反了整套坐标就错位。
- 画布尺寸取自 `clientWidth`，如果它处在 `display: none` 的元素里，读到的就是 0，画布会变成空白而且不报错。
- CSS 变量不会自动流进 canvas。示例每 15 帧重读一次，滑杆拖动时才跟得上；每帧都重读会强制样式重算，得不偿失。
- 图版重播会重新执行脚本。不做取消，上一轮的 `requestAnimationFrame` 仍在跑，两个循环同时往同一张画布上画，余辉会短一半。

## 备注

- 同一招用在鼠标轨迹上就是签名板或手势轨迹；把覆盖色从黑换成半透明的白，则得到「残影反而变亮」的灼烧感。
- 逐帧衰减是天然的降帧自由：帧率掉下去时余辉会自然变长，看上去仍然连贯，不需要额外补偿。
