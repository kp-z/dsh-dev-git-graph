---
title: 竖向跑马灯与渐隐边
slug: marquee-vertical-fade
category: 动效
tags: [mask, keyframes, 渐隐, 列表, 自动]
since: 2026-10
source: 机制来自内容复制与 mask-image 渐隐，自行实现
when: 一列公告要上下无尽循环，进出两端要淡掉而不是硬切
stage: dark
tier: core
params:
  - { name: speed, label: 一圈用时, type: range, min: 4, max: 40, step: 1, default: 12, unit: s }
---

## 描述

一列公告从下往上走，走到顶就消失，新的从底下补上来，永远接得上。两端是淡出淡入的，没有一条硬边。

机制是 ==两端渐隐只能用遮罩，不能盖一块同色矩形==。横向跑马灯那套「复制一份内容、位移一半」在这里同样管用，竖向只是把位移换到 Y 轴；真正新的是边界：想让条目在顶部淡掉，最直觉的做法是盖一块从背景色渐变到透明的矩形。这在纯色背景上完全成立，但底一旦是照片、渐变或半透明面板，那块补丁的色号就露出来了。遮罩不参与绘制，它抠的是元素自己的像素，与底下是什么无关，所以任何底上都成立。

竖向还多一个基准问题：位移的百分比是相对轨道的，而轨道高度等于两份内容。所以「五十」正好是一份内容的完整高度，第二份恰好补上第一份的空位。这也是为什么容器高度最好是一份内容高度的整数倍——差一点点，循环点上就会看见一次跳动。

## 代码

```html
<!-- @mechanism 只写一份内容，另一份由脚本复制：位移量才能定为轨道的一半 -->
<div class="mv" id="sb-mv">
  <ul class="mv-track">
    <li>节点池已扩容</li>
    <li>镜像同步完成</li>
    <li>缓存命中率 97%</li>
    <li>灰度发布到 10%</li>
  </ul>
</div>
```

```css
.mv {
  width: min(320px, 82vw);
  height: 160px;
  overflow: hidden;
  background: #0d0a14;
  color: #efe9dc;
  font: 400 15px/1.8 system-ui, sans-serif;
  /* @mechanism 遮罩抠的是自己的像素，所以底是照片还是渐变都不影响淡出 */
  mask-image: linear-gradient(180deg, transparent 0, #000 24%, #000 76%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 24%, #000 76%, transparent 100%);
}

.mv-track {
  margin: 0;
  padding: 0;
  list-style: none;
  /* @mechanism 轨道是两份内容，位移半程正好回到起点，接缝看不出来 */
  animation: mv-run var(--speed, 12s) linear infinite;
}

.mv-track li {
  display: flex;
  align-items: center;
  height: 54px;
  padding-left: 20px;
  border-left: 2px solid rgb(217 164 65 / 0.7);
}

@keyframes mv-run {
  from { translate: 0 0; }
  to { translate: 0 -50%; }
}
```

```js
const track = document.querySelector('#sb-mv .mv-track')
if (track) {
  // @mechanism 复制一份接在末尾，位移 50% 时第二份正好顶到第一份的位置
  for (const li of [...track.children]) {
    const copy = li.cloneNode(true)
    copy.setAttribute('aria-hidden', 'true')
    track.append(copy)
  }
}
```

## 边界

- 位移必须是轨道的**百分之五十**，也就是一份内容的完整高度。容器高度不是内容高度的整数倍时，循环点上会看见一次跳动——多出来的那截空白会跟着一起滚。
- 给轨道写死 `height: 100%` 会让百分比位移的基准从内容高度变成容器高度，位移量与内容脱钩，接缝立刻显形。高度要由内容撑开。
- 盖同色矩形来做淡出的写法只在纯色背景上成立。半透明面板、照片、渐变底上那块补丁会明显浮出来。
- `mask-image` 在旧引擎上要 `-webkit-` 前缀，漏了就是两端硬切——不破版，但渐隐没了，而且不报错。
- 复制出来的那份会让读屏与页面内搜索看到两遍列表，装饰性的副本必须 `aria-hidden`。
- 循环没有暂停入口时，用户想读某一条却抓不住。竖向公告几乎必须配 `animation-play-state: paused` 的悬停暂停。
- 它是纯视觉循环，与「真正更新了内容」无关：新条目推入时不会被读屏播报，需要另配一个 `aria-live` 区。

## 备注

- 同一套遮罩加复制也能做横向的渐隐两端，横向的位移基准是宽度而不是高度，其余同理。
- 把 `linear` 换成 `ease-in-out` 会让每条在中间「停留」一下，看起来更从容，但接缝处会出现减速，无缝感就打折了。
