---
title: 悬停时字符四散
slug: hover-scatter-chars
category: 交互
tags: [悬停, 逐字, 位移函数]
since: 2026-10
source: 机制来自逐字位移变量与过渡延迟，自行实现
when: 标题被悬停时整句话散开、移开又合上，作为一次轻量的趣味回应
stage: plain
tier: core
params:
  - { name: spread, label: 散开幅度, type: range, min: 0, max: 6, step: 0.5, default: 2, unit: px }
---

## 描述

鼠标移上去，一句话「炸」开：字依次错开往两边跑掉一些，移开鼠标又依次归位。

机制是 ==位移量是字符序号的函数，方向由序号奇偶决定==。每个字拿到自己的序号 `--i` 与一个上下符号 `--dy`，悬停时的位移就是 `序号 × 幅度`、方向乘上 `--dy`。因为位移量与过渡延迟都是序号的函数，一个 `:hover` 就够，不需要 `mouseenter` 事件，也不需要脚本记状态——CSS 自己会在指针离开时把过渡倒回去。

这里刻意不用随机数：随机的位移方向会互相抵消，整句话看起来只是「抖了一下」，看不出散开。确定性的函数才会形成形状——序号越大跑得越远，就成了扇形；奇偶交替上下，就成了开合的扇页。随机值只在初始化时算一次也不行，那样每次刷新的形状都不一样，同一页组件会不统一。

## 代码

```html
<!-- @mechanism 一句话被拆成逐字 span，序号与上下符号由脚本写一次，之后全靠 CSS -->
<h3 class="scatter" id="sb-scatter">移上来，整句话散开</h3>
```

```css
.scatter {
  width: min(420px, 86vw);
  margin: 0;
  font: 600 27px/1.9 system-ui, sans-serif;
  color: #f4ead6;
}

.scatter .ch {
  display: inline-block;
  /* @mechanism 过渡自己会倒放：指针离开时不需要任何脚本干预就能归位 */
  transition: transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1);
  transition-delay: calc(var(--i) * 18ms);
}

.scatter:hover .ch {
  /* @mechanism 位移是序号的函数，方向来自脚本写好的上下符号 */
  transform:
    translate(
      calc(var(--i) * var(--spread, 2px)),
      calc(var(--dy) * var(--spread, 2px) * 3)
    )
    rotate(calc(var(--dy) * 7deg));
}
```

```js
const root = document.getElementById('sb-scatter')
const source = root.textContent
root.textContent = ''

;[...source].forEach((char, i) => {
  const span = document.createElement('span')
  span.textContent = char
  // @mechanism 序号决定跑多远、也决定延迟：位移量是序号的连续函数，形状才成立
  span.style.setProperty('--i', String(i))
  // @mechanism 上下符号取自序号奇偶，交替开合而不是各自乱飞
  span.style.setProperty('--dy', i % 2 ? '1' : '-1')
  root.append(span)
})
```

## 边界

- 过渡延迟在「散开」与「归位」两个方向是同一套值，所以归位时仍然是第一个字先动、末尾拖在后面。想要对称得为离开状态单独写一份反向延迟，否则回弹看起来是「扫过去」而不是「收回」。
- 逐字 `inline-block` 之后，英文单词成了可断的碎片，长句在窄屏上会折在很难看的位置；空白也会被折叠成零宽，句子粘成一坨。
- 拆分会破坏复制粘贴的连续性与读屏朗读（可能逐字念）。纯装饰的拆字应当给容器留 `aria-label`，并把拆出来的 span 全部隐藏。
- 悬停只对指针设备有效，触屏点不到它。键盘用户也不行——必须补一个 `:focus-visible` 的等价状态，否则这个反馈只服务一部分人。
- 位移里带 `rotate` 会产生亚像素采样，动画期间中文会有轻微模糊；停下来就恢复。整句都在动时最明显。
- 每次悬停都会重新触发整句过渡，快速来回移动指针会让动画反复被打断，看起来是抖。延迟越长越明显。
- 幅度用 px 写，字号变大时会显得散得更近；用 `em` 更稳，但要重新调 `--spread` 的量纲。

## 备注

- 把方向函数从「奇偶」换成「离中心的距离」，就从扇页变成膨胀；换成「按字符的笔画数」就成了有语义的散开。
- 同一套序号变量可以同时驱动颜色、字重、旋转：只要它们是序号的函数，整段效果就自洽。
