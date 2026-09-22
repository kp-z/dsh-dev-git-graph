---
title: 骨架换内容不跳版
slug: skeleton-swap-no-jump
category: 动效
tags: [骨架屏, 网格叠放, 防跳动]
since: 2026-10
source: 机制来自 CSS Grid 同格叠放与自动高度取最大值，自行实现
when: 骨架屏换成真实内容的那一瞬间，页面不该往上跳一下
stage: plain
tier: core
---

## 描述

骨架淡出、内容淡入，整个过程页面纹丝不动，没有「内容一出现就整体跳一下」的那一下。

机制是 ==把骨架层与内容层放进 grid 的同一格，容器高度自动取两者中较高的那个==。骨架屏最常见的毛病不是长得不像，而是**尺寸不匹配**：骨架块往往比真实内容矮，数据到达的瞬间容器从矮变高，下方所有东西一起往下跳，用户正在点的按钮会从手指底下溜走。写死 `min-height` 是一种补法，但那要你提前知道内容多高。让两层叠在同一格里，高度在骨架期就已经由真实内容决定了，切换时只换透明度——**布局从头到尾没参与过，也就没法跳**。

「叠放」本身还有第二个好处：两层都能在过渡中保持渲染，交叉淡入才成立。如果用 `display: none` 来切换，离散属性的切换会让其中一层立刻消失，根本来不及淡。

## 代码

```html
<div class="swj" id="sb-swj">
  <div class="swj-skeleton" aria-hidden="true">
    <i></i><i></i><i></i>
  </div>
  <div class="swj-real">
    <h3>内容终于到了</h3>
    <p>真实内容比骨架高，但容器的高度在骨架期就已经按它算好了。</p>
  </div>
</div>
<button class="swj-toggle" id="sb-swj-toggle" type="button">切换状态</button>
```

```css
.swj {
  display: grid;
  width: min(360px, 82vw);
}

/* @mechanism 两层占同一格：自动行高取两者较大值，高度在骨架期就定好了 */
.swj-skeleton,
.swj-real {
  grid-area: 1 / 1;
}

.swj-skeleton {
  display: grid;
  gap: 10px;
  align-content: start;
  opacity: 1;
  /* @mechanism 切换只动透明度，容器不参与重排 */
  transition: opacity 0.35s ease;
}

.swj-real {
  opacity: 0;
  transition: opacity 0.35s ease;
}

/* @mechanism 两层都保持渲染，交叉淡入才成立 */
.swj.is-ready .swj-skeleton {
  opacity: 0;
}

.swj.is-ready .swj-real {
  opacity: 1;
}

.swj-skeleton i {
  height: 14px;
  border-radius: 4px;
  background: rgb(60 48 30 / 0.15);
}

.swj-skeleton i:nth-child(2) {
  width: 88%;
}

.swj-skeleton i:nth-child(3) {
  width: 62%;
}

.swj-real h3 {
  margin: 0 0 6px;
  font: 600 16px/1.4 system-ui, sans-serif;
}

.swj-real p {
  margin: 0;
  font: 400 14px/1.6 system-ui, sans-serif;
}
```

```js
const box = document.getElementById('sb-swj')

document.getElementById('sb-swj-toggle').addEventListener('click', () => {
  // @mechanism 只切一个类名：高度早在骨架期就被真实内容撑好了，没有可跳的东西
  box.classList.toggle('is-ready')
})
```

## 边界

- 容器高度取「较高者」是这一招成立的前提。如果真实内容比骨架**矮**，切换时容器还是会缩一次，现象是「内容出现的同时页面往上跳」。这时骨架应该做得更矮，或者给容器一个 `min-height`。
- `opacity: 0` 不等于消失：那层仍然在布局里、仍会被 Tab 聚焦、也会被读屏念出来。所以骨架层要 `aria-hidden="true"`，未就绪的内容层应加 `inert`。
- 两层同时存在于 DOM，意味着内容里的图片、视频在骨架期就开始下载。通常这是好事（等于预加载），但它会让「加载中」期间的网络占用比看起来高。
- 用 `display: none` 切换会毁掉过渡（它是离散属性）。要保持两层都渲染，这是交叉淡入的代价。
- 如果内容高度依赖宽度（长文本换行），字体加载完成的瞬间宽度会变、容器高度也会跟着变一次——这不是这一招的锅，但会让人以为它没生效。
- grid 叠放要求两层都不设 `position: absolute`；用绝对定位也能叠，但那样容器高度就由内容层单独决定，反而丢了「取最大值」这个好处。

## 备注

- 同一招可以给「加载中 / 空 / 错误 / 内容」四态做交叉淡入，它们都占同一格。
- 想让隐藏层彻底不可聚焦，`visibility: hidden` 比 `opacity: 0` 干净，但它是离散属性，要过渡得配 `transition-behavior: allow-discrete`。
