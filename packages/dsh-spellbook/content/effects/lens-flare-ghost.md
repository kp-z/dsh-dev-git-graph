---
title: 镜头鬼影
slug: lens-flare-ghost
category: 材质
tags: [radial-gradient, blend-mode, 悬停, 光晕, 指针]
since: 2026-10
source: 机制来自镜头内多次反射形成的鬼影关于光轴中心对称，自行实现
when: 画面里有一个强光源，想补上一串沿光轴排开的光斑
stage: dark
tier: core
---

## 描述

指针就是光源。一串大小不一、颜色各异的光斑从指针出发，穿过画面正中央，一直排到对面——对着强光拍摄时的那串鬼影。

机制是 ==每一枚鬼影的位置，是光源关于画面中心的反向延长按给定比例缩放的落点==。镜头里每片玻璃都有两面，光在它们之间反射一次就多出一个像；这个像必然落在过光轴的那条直线上，且在中心的两侧互换。所以鬼影不是随手撒的几个圆：给定中心 C 和光源 L，第 i 枚鬼影就在 `C + tᵢ·(C − L)` 上，tᵢ 由那片镜片的曲率决定。这样一来，光源一动，整串鬼影自动沿对称轴整体移动、自动穿过中心——这种整体感是手工摆位置摆不出来的，也是这类效果最容易露馅的地方。

可变的是 tᵢ 序列（决定间距，以及是否会跨到画面另一侧）、每枚的半径与颜色（不同镀膜的反射色，通常偏绿紫），以及最外面那枚的柔度。示例里 JS 只负责写位移，长相与混合全在 CSS，所以换配色不用碰脚本。

## 代码

```html
<div class="flare" id="sb-flare">
  <b>把指针移到面板上</b>
  <span class="flare__ghost" data-t="0.35"></span>
  <span class="flare__ghost" data-t="0.62"></span>
  <span class="flare__ghost" data-t="1.05"></span>
  <span class="flare__ghost" data-t="1.4"></span>
  <span class="flare__ghost" data-t="1.85"></span>
</div>
```

```css
.flare {
  position: relative;
  display: grid;
  place-items: center;
  width: min(460px, 88vw);
  height: 260px;
  overflow: hidden;
  background: #05060a;
  color: #6f7688;
  font: 400 13px/1.6 system-ui, sans-serif;
  isolation: isolate;
}

.flare__ghost {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 46px;
  aspect-ratio: 1;
  border-radius: 50%;
  translate: -50% -50%;
  /* @mechanism 位移由 JS 按「光源关于中心对称」算出来，样式只负责长相 */
  background: radial-gradient(circle, rgb(120 255 190 / 0.5), transparent 68%);
  mix-blend-mode: plus-lighter;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.35s ease;
}

.flare__ghost:nth-child(odd) {
  background: radial-gradient(circle, rgb(190 150 255 / 0.45), transparent 68%);
  scale: 1.6;
}

.flare:hover .flare__ghost {
  opacity: 1;
}
```

```js
const flare = document.getElementById('sb-flare')
const ghosts = flare ? [...flare.querySelectorAll('.flare__ghost')] : []

function track(event) {
  const box = flare.getBoundingClientRect()
  const lightX = event.clientX - box.left
  const lightY = event.clientY - box.top
  // 光源相对画面中心的偏移，取反就是鬼影的方向
  const dx = box.width / 2 - lightX
  const dy = box.height / 2 - lightY
  for (const ghost of ghosts) {
    // @mechanism C + t·(C − L)：共用一组 t，光源一动整串鬼影沿对称轴整体平移
    const t = Number(ghost.dataset.t)
    ghost.style.translate = `calc(-50% + ${dx * t}px) calc(-50% + ${dy * t}px)`
  }
}

if (flare) {
  flare.addEventListener('pointermove', track)
  flare.addEventListener('pointerleave', () => {
    ghosts.forEach((ghost) => ghost.style.removeProperty('translate'))
  })
}
```

## 边界

- t 大于 1 的鬼影会跑到光源的对称侧甚至出画。这是对的，但容器必须 `overflow: hidden` 兜住，否则它会盖到旁边的元素上。
- 鬼影的位置只跟光源与画面中心有关，跟光源多亮无关。真实鬼影在光源变暗时会先消失，所以强度只能靠整体透明度表达，不能用位置去表达。
- 不能用 `event.offsetX`：它是相对**事件目标**的，装饰层一旦接住指针，读到的坐标就变成相对那一层的，整串光斑会乱跳。示例同时用了 `pointer-events: none` 和 `clientX` 减 rect，两道都做才稳。
- `pointermove` 每秒能触发上百次，直接改 `left` / `top` 会每帧触发布局；写成 `translate` 就只走合成器。
- 触屏没有指针移动，这套完全失效，必须准备一个静态的等价外观。
- `plus-lighter` 叠多了中心会顶到纯白，鬼影重叠处会丢掉各自的颜色。示例靠把它们摊在一条线上避开了这一点。

## 备注

- 同一套对称算法套在星芒上就是「星芒随光源转向」；t 取负值则会得到一串落在光源同侧的鬼影，那是反射镜头的表现。
- 真实镜头还会给整串鬼影叠一层随光源方向变化的弧形位移，加一个二次项就能近似。
