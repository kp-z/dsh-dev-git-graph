---
title: 逼近但不到达的进度条
slug: trickle-progress
category: 动效
tags: [transition, 进度, 加载, 定时]
since: 2026-10
source: 机制来自 NProgress（MIT）的 trickle 增量思路，自行实现最小示例
when: 请求不知道要跑多久，但页面上得有一条一直在动、且不会撒谎的进度
stage: plain
tier: core
---

## 描述

页面顶部一条细进度条，越往后爬得越慢，最后「啪」一下撑满然后消失。

机制是 ==用非线性增量逼近一个小于 1 的上限，只有任务真的结束才跳到 1==。每一跳的长度与「离上限还差多少」成正比（`(1 - p) * 0.06`），于是快的时候它冲得很快，接近上限时几乎不动，并且被 `clamp` 在 0.9。这样做的理由不是数学，是观感：线性爬到 100% 之后还卡着，用户读成「卡死了」；停在 0.9 附近慢慢蠕动，用户读成「快好了，别关」。**进度条的意义是让人别关掉页面，不是报数**——既然报不出准数，就报一个诚实的「还在动」。

脚本只负责算数字并写宽度，缓动交给 CSS 的 `transition`。这样每一跳都短、都由合成器补间，看起来是连续生长而不是一格一格跳。

## 代码

```html
<div class="tp" id="sb-tp" role="progressbar" aria-label="正在加载">
  <i class="tp-fill"></i>
</div>
<button class="tp-again" id="sb-tp-again" type="button">再来一次</button>
```

```css
.tp {
  width: min(320px, 78vw);
  height: 4px;
  overflow: hidden;
  background: rgb(60 48 30 / 0.16);
}

.tp-fill {
  display: block;
  height: 100%;
  width: 0;
  background: #b4462f;
  /* @mechanism 时序交给 CSS：脚本只写目标宽度，补间由浏览器做 */
  transition: width 0.34s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.tp-again {
  margin-top: 14px;
  font: 400 13px/1 system-ui, sans-serif;
}
```

```js
const bar = document.getElementById('sb-tp')
const fill = bar.querySelector('.tp-fill')
let value = 0
let timer = null

const render = () => {
  // @mechanism 只写宽度百分比，其余全部由 CSS 的 transition 补间
  fill.style.width = value * 100 + '%'
}

function tick() {
  // @mechanism 越接近上限，每一跳越短，并且封顶 0.9——这就是"永远差一点"
  const step = Math.max(0.008, (1 - value) * 0.06)
  value = Math.min(0.9, value + step)
  render()
}

function start() {
  clearInterval(timer)
  value = 0.05
  render()
  timer = setInterval(tick, 300)
  // 真实项目里这里是 await fetch(...)；用定时器代替网络等待
  setTimeout(() => {
    clearInterval(timer)
    value = 1
    render()
  }, 4000)
}

start()
document.getElementById('sb-tp-again').addEventListener('click', start)
```

## 边界

- 任务失败时进度条会永远停在 0.9 附近蠕动。必须有失败态（收回或变色），否则用户一直在等一个不会来的 100%。
- 上限不能写成 1。留出最后一跳的空间正是这个数字的全部作用，写 1 就等于宣布已完成却还在跑。
- 每一跳的步长必须是变化的。固定步长就是线性进度，等于报了一个你并不知道的数字。
- `transition` 的时长要短于 `tick` 间隔（这里 0.34s < 0.3s 略超一点也无妨，因为补间会被下一跳接管）。写得太长，连续的宽度变化互相打断，看起来发黏。
- 任务被取消或组件卸载时忘了 `clearInterval` 和 `clearTimeout`，现象是后台还有定时器在空转改一个已经不在页面上的元素。
- 前 5% 直接给一个初始值（这里 0.05）：从 0 起步时，用户会觉得「点了没反应」。

## 备注

- 0.9 这个数字是经验值，不是规范。它的作用只是把「最后一跳」留给真实完成事件。
- 真实进度可得时（分片上传、逐条处理）就别装：那时精确进度比「有在动」更有价值，混着用反而像骗人。
