---
title: 有内容时自己出现的滚动阴影
slug: scroll-shadow
category: 布局
tags: [gradient, overflow, 列表, 滚动]
since: 2026-09
source: 机制来自 CSS background-attachment 的 local 值，自行实现
when: 可滚动区域的上下边缘要提示「这里还有内容」，但滚到底时提示要自动消失
stage: plain
tier: core
---

## 描述

列表上方有一条阴影提示上面还有内容，滚到顶它自己消失；底部同理。

机制是 ==background-attachment: local 让背景跟着内容滚，scroll 让它钉在容器上==。前面两层 `local` 是不透明色块（遮挡层），后面两层 `scroll` 是阴影。内容没滚时，`local` 色块正好压在阴影位置上把它盖住；一旦滚动，色块跟着内容移开，阴影就露出来。

判断「能不能滚」这件事本来就是浏览器的强项。这里只是把它借过来当条件用，零 JS。

## 代码

```html
<div class="ss">
  <p>上面的阴影只在能往上滚时出现。</p>
  <p>继续往下滚。</p>
  <p>再往下。</p>
  <p>滚到底部，下面的阴影会消失。</p>
  <p>而中间过程两侧都有。</p>
  <p>这是一段足够长的内容。</p>
  <p>最后一行。</p>
</div>
```

```css
.ss {
  width: min(340px, 78vw);
  height: 180px;
  overflow-y: auto;
  padding: 0 16px;
  /* @mechanism local 跟着内容滚、scroll 钉在容器上 */
  background:
    linear-gradient(#efe9dd 30%, rgb(239 233 221 / 0)) local,
    linear-gradient(rgb(239 233 221 / 0), #efe9dd 70%) local,
    radial-gradient(farthest-side at 50% 0, rgb(40 30 14 / 0.3), rgb(40 30 14 / 0)) scroll,
    radial-gradient(farthest-side at 50% 100%, rgb(40 30 14 / 0.3), rgb(40 30 14 / 0)) scroll;
  background-repeat: no-repeat;
  background-size: 100% 40px, 100% 40px, 100% 14px, 100% 14px;
  background-attachment: local, local, scroll, scroll;
  font: 400 14px/1.9 system-ui, sans-serif;
  color: #1c1a17;
}

.ss p {
  margin: 0 0 12px;
}
```

## 边界

- 两层 `local`（遮挡）必须写在**前面**、两层 `scroll`（阴影）在后面。背景是前面的画在上面，顺序写反就什么都看不到。
- `background-size` 的高度（40px）必须**大于**阴影层的高度（14px），否则遮不住，阴影会一直露着。
- 遮挡层必须是**不透明**的实色。半透明盖不住阴影——用 `rgb(239 233 221 / 0)` 而不是 `transparent` 是为了让过渡更平滑，但关键的那个色标位置要完全不透明。
- 容器的 `background-color` 不能再写：它画在所有背景之下，会与这套冲突。底色直接并进遮挡层的渐变色里。
- 横向滚动要另外加一组 `90deg` 的渐变，四边齐全就是八层背景，代码很啰嗦——只在真的需要时做。
- 系统的滚动条样式会影响观感（overlay 滚动条不占宽度），但机制本身不受影响。

## 备注

- 这套是「纯 CSS 条件渲染」的经典案例：把「能不能滚」这个浏览器已知的状态，通过背景跟随与否转换成可见的差异。
- 现代做法是 `scroll-driven animations` + `animation-timeline: scroll()`，但那个支持面比这套窄。
