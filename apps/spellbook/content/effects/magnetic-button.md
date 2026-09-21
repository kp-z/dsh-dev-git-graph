---
title: 磁性吸附按钮
slug: magnetic-button
category: 交互
tags: [指针, 跟随, 微交互]
since: 2025-09
source: 自行实现
when: 想让一个按钮在指针靠近时轻微跟过去，显得有回应
stage: grid
tier: core
params:
  - { name: strength, label: 吸附强度, type: range, min: 0, max: 1, step: 0.05, default: 0.4 }
  - { name: scale, label: 按下放大, type: range, min: 1, max: 1.2, step: 0.01, default: 1.04 }
---

## 描述

指针靠近时，按钮朝指针方向偏一点，像被吸过去；指针离开又弹回原位。

机制是 ==把指针相对按钮中心的偏移写进 CSS 变量，再由 transform 乘上强度==。偏移量本身是死的，强度才决定手感——所以乘法放在 CSS 里，JS 只负责报坐标。这也意味着松开指针时不需要写回弹逻辑：把变量归零，`transition` 自己会补上那一段。

## 代码

```html
<div class="field">
  <button class="magnet" type="button">按我一下</button>
</div>
```

```css
.field {
  display: grid;
  place-items: center;
  width: min(420px, 78vw);
  height: 200px;
}

.magnet {
  --mx: 0px;
  --my: 0px;
  transform: translate(calc(var(--mx) * var(--strength, 0.4)), calc(var(--my) * var(--strength, 0.4))) scale(var(--scale, 1.04)); /* @mechanism */
  transition: transform 240ms cubic-bezier(0.22, 0.61, 0.36, 1);
  padding: 15px 32px;
  border: 0;
  border-radius: 999px;
  background: #1c1a17;
  color: #f4f4f0;
  font: 500 15px/1 system-ui, sans-serif;
  cursor: pointer;
}

.magnet:not(:hover) {
  transition-duration: 460ms;
}
```

```js
const field = document.querySelector('.field')
const magnet = document.querySelector('.magnet')

// 以按钮的静止位置为基准；换算成中心点后用 clientX 相减
let center = { x: 0, y: 0 }
const measure = () => {
  const box = magnet.getBoundingClientRect()
  center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}
measure()
field.addEventListener('pointerenter', measure)

field.addEventListener('pointermove', (event) => {
  magnet.style.setProperty('--mx', event.clientX - center.x + 'px') // @mechanism
  magnet.style.setProperty('--my', event.clientY - center.y + 'px')
})

field.addEventListener('pointerleave', () => {
  magnet.style.setProperty('--mx', '0px')
  magnet.style.setProperty('--my', '0px')
})
```

## 边界

- 触屏上没有 hover，`pointermove` 只在按下时才触发，效果直接退化成普通按动——这条咒语本来就是桌面增强，不是全端方案。
- 没有处理 `prefers-reduced-motion`。对动效敏感的用户照样会看到按钮跟手，正式项目要自己补一条媒体查询把位移关掉。

## 备注

- 偏移基准要用按钮的**静止位置**。若每帧都用当前中心去算，按钮会追着自己跑，越偏越远。
- 只在指针进入容器时量一次基准，离开时把变量归零，回弹交给 `transition`。
- 强度超过 0.6 就开始显得滑，0.3 到 0.45 是最舒服的区间。
