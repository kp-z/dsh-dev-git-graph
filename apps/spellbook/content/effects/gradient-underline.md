---
title: 渐变下划线
slug: gradient-underline
category: 排版
tags: [下划线, 渐变, 链接]
since: 2026-09
source: 机制来自 CSS 背景定位，自行实现
when: 链接要一条彩色下划线，而且想让它从细变粗或从无到有
stage: plain
tier: core
params:
  - { name: thick, label: 线粗, type: range, min: 1, max: 8, step: 1, default: 3, unit: px }
---

## 描述

链接底下一条从红到金的细线，悬浮时从左侧长出来。

机制是 ==把线做成一张背景图，用 background-size 与 background-position 摆到底边==。`border-bottom` 只能是单色、也没法只画一部分；背景图既能上渐变，又能通过改 `background-size` 让它「长出来」。

这里动的是背景而不是伪元素，代价是动画会触发重绘；只在文字量小的链接上划算。

## 代码

```html
<p class="gu-p">机制要说得清，出处要记得住。<a class="gu" href="#">这条链接的下划线是渐变的</a>，鼠标移上去它会从左边长出来。</p>
```

```css
.gu-p {
  width: min(460px, 84vw);
  margin: 0;
  font: 400 16px/2 system-ui, sans-serif;
  color: #1c1a17;
}

.gu {
  color: inherit;
  text-decoration: none;
  /* @mechanism 线是背景图，贴到底边 */
  background-image: linear-gradient(90deg, #b4462f 0%, #d9a441 62%, #7c5cff 100%);
  background-repeat: no-repeat;
  background-position: 0 100%;
  background-size: 0% var(--thick, 3px);
  transition: background-size 0.36s ease;
  padding-bottom: 2px;
}

.gu:hover {
  background-size: 100% var(--thick, 3px);
}
```

## 边界

- `background-position: 0 100%` 贴的是**元素盒子**的底边，不是文字基线。`line-height` 大时下划线会离字很远，要靠 `padding-bottom` 把它推回来。
- 元素是行内的话，**跨行时每一行片段各画一次**，下划线会在换行处断开并重新从左边长起。长链接尤其明显，`box-decoration-break` 也只能部分缓解。
- 动画 `background-size` 会触发重绘。链接一多就明显，改成伪元素做 `transform: scaleX` 能把这份开销交给合成器。
- `text-decoration: none` 必须给：否则浏览器自带的装饰线会和这条叠在一起，看起来是双线。
- 去掉下划线就削弱了「这是链接」的信号。颜色或字重上得给一点别的提示，否则可访问性会退步。

## 备注

- `background-size` 从 `0%` 到 `100%` 是「长出来」；反过来从 `100%` 到 `0%` 是「收回去」。想要收回去要从右边开始，改 `background-position: 100% 100%`。
- 线粗做成参数时记得它的单位是 `px`，跟字号无关——标题链接要用更粗的值。
