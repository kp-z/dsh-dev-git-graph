---
title: 悬停就能按停的倒计时条
slug: pausable-timeout-bar
category: 动效
tags: [keyframes, transform, 提示, 进度, 悬停]
since: 2026-10
source: 机制来自 CSS Animations 的 animation-play-state，自行实现
when: 撤销提示、自动跳转、限时操作上有一条代表剩余时间的条，鼠标移上去应当停住
stage: plain
tier: core
params:
  - { name: dur, label: 倒计时总长, type: range, min: 2, max: 16, step: 1, default: 6, unit: s }
---

## 描述

一条红条从满格慢慢往左收，鼠标移上去它就停住，移开接着走；走完了提示条自己消失。

机制是 ==进度条本身就是 CSS 动画，暂停靠 animation-play-state: paused==。关键在于**只有一个时钟**：条的收缩既是「剩余时间」的可视化，也是计时器本身。JS 不维护剩余毫秒数、也不做 `setTimeout` 倒计时，它只监听动画的 `animationend`——而暂停时这个事件根本不会到达，于是「条停住」和「任务暂停」自动保持一致。若在 JS 里另开一个定时器来同步样式，两套时钟迟早会错开，现象是条明明停着，提示却已经消失了。

收缩用 `transform: scaleX` 配 `transform-origin: left`，而不是动画 `width`：`transform` 走合成器，而且缩放的原点放在左边时，条的右边缘才是在往左收——原点在中心会让它从两头一起缩，读起来像「在充能」。

## 代码

```html
<div class="pt" id="sb-pt">
  <p>已删除「草稿 3」，撤销还来得及。</p>
  <button class="pt-undo" id="sb-pt-undo" type="button">撤销</button>
  <i class="pt-bar"></i>
</div>
```

```css
.pt {
  position: relative;
  overflow: hidden;
  width: min(340px, 78vw);
  padding: 14px 16px 18px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.62);
  font: 400 14px/1.6 system-ui, sans-serif;
}

.pt-bar {
  position: absolute;
  inset: auto 0 0 0;
  height: 3px;
  background: #b4462f;
  /* @mechanism 原点放左边，缩放才读作"时间在流逝"而不是"在充能" */
  transform-origin: left center;
  /* @mechanism 这条动画本身就是倒计时，不是倒计时的装饰 */
  animation: pt-drain var(--dur, 6s) linear forwards;
}

/* @mechanism 把动画时钟按停即可暂停计时，样式层不需要任何 JS */
.pt:hover .pt-bar,
.pt:focus-within .pt-bar {
  animation-play-state: paused;
}

@keyframes pt-drain {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}
```

```js
const toast = document.getElementById('sb-pt')

// @mechanism 只有动画真的走完才会到这里；被暂停时它不会触发
toast.querySelector('.pt-bar').addEventListener('animationend', () => {
  toast.innerHTML = '<p>撤销窗口已关闭。</p>'
})

document.getElementById('sb-pt-undo').addEventListener('click', () => {
  toast.innerHTML = '<p>已撤销。</p>'
})
```

## 边界

- `forwards` 不能省。省掉之后动画结束的瞬间条会弹回满格，看起来像「又刷新了一次」。
- 只用 `:hover` 暂停会漏掉键盘用户：Tab 到「撤销」按钮上时计时照样走完。所以要配 `:focus-within`。
- 暂停的只是动画，不是别的东西。如果 JS 里还有定时器在跑，那条会停、提示却会消失，两边不一致。
- 标签页被挂起（后台标签、系统休眠）时动画时钟也会被节流，`animationend` 可能比预期晚很多。别把这一招当严格的时间保证。
- 用 `scaleX` 会同时缩放条的圆角与内容；纯色条没问题，条里要放文字时得改用 `clip-path` 或外层 `overflow: hidden` + 内层位移。
- 从右往左退还是从左往右退是设计选择：往左收像「时间在被消耗」，反过来会被读成「正在充能」，配错了文案就对不上。

## 备注

- 同一招适合验证码有效期、录音上限、抢购倒计时——凡是「剩余时间」同时也是「这个界面的寿命」的场合。
- 只有当暂停时还有别的没停（比如文字里的秒数、播放中的音频），才值得把剩余时间挪进 JS；否则动画时钟就够用。
