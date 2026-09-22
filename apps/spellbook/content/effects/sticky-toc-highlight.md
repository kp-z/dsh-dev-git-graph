---
title: 目录跟随滚动高亮
slug: sticky-toc-highlight
category: 交互
tags: [intersection-observer, 目录, 滚动]
since: 2026-09
source: 机制来自 IntersectionObserver 与 rootMargin 的经典用法，自行实现
when: 长文旁边有目录，滚到哪里就高亮哪一项
stage: plain
tier: core
---

## 描述

右边目录里，当前正在读的那一节一直是亮的。

机制是 ==把观察器的「视口」用 rootMargin 收窄成一条横带，然后观察哪个小节穿过这条带==。默认的视口太高，同时有三四节可见，判断不出「当前」；收成一条带之后，同一时刻只有一个能命中。

用观察器而不是监听滚动，是为了不在每帧里读布局——那些读操作会强制浏览器同步重排。

## 代码

```html
<div class="tc">
  <nav class="tc-nav" id="sb-tc-nav">
    <a class="tc-link is-active" href="#s1">第一节</a>
    <a class="tc-link" href="#s2">第二节</a>
    <a class="tc-link" href="#s3">第三节</a>
  </nav>
  <div class="tc-body">
    <section class="tc-sec" id="s1"><h4>第一节</h4><p>滚到哪一节，左边目录就亮哪一项。</p></section>
    <section class="tc-sec" id="s2"><h4>第二节</h4><p>靠的是把视口收窄成一条带。</p></section>
    <section class="tc-sec" id="s3"><h4>第三节</h4><p>同一时刻只有一个能穿过那条带。</p></section>
  </div>
</div>
```

```css
.tc {
  display: flex;
  gap: 16px;
  width: min(430px, 86vw);
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.tc-nav {
  display: grid;
  align-content: start;
  gap: 4px;
  flex: 0 0 84px;
  position: sticky;
  top: 0;
}

.tc-link {
  padding: 5px 8px;
  border-inline-start: 2px solid rgb(60 48 30 / 0.2);
  color: rgb(28 26 23 / 0.55);
  text-decoration: none;
  transition: color 0.2s, border-color 0.2s;
}

.tc-link.is-active {
  border-inline-start-color: #b4462f;
  color: #b4462f;
  font-weight: 600;
}

.tc-body {
  height: 190px;
  overflow-y: auto;
  flex: 1;
}

.tc-sec {
  min-height: 150px;
  padding: 8px 0 18px;
  border-bottom: 1px solid rgb(60 48 30 / 0.14);
}

.tc-sec h4 {
  margin: 0 0 6px;
  font-size: 15px;
}

.tc-sec p {
  margin: 0;
  opacity: 0.72;
}
```

```js
const body = document.querySelector('.tc-body')
const links = Array.from(document.querySelectorAll('#sb-tc-nav .tc-link'))
if (body && links.length) {
  const sections = Array.from(body.querySelectorAll('.tc-sec'))
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        links.forEach((a) => {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id)
        })
      }
    },
    {
      root: body,
      // @mechanism 把视口收窄成一条带，同一时刻只有一个能命中
      rootMargin: '-45% 0px -45% 0px',
      threshold: 0
    }
  )
  sections.forEach((s) => observer.observe(s))
  // 重播时旧观察器指向已经移除的节点，要断开
  if (window.__sbTocObserver) window.__sbTocObserver.disconnect()
  window.__sbTocObserver = observer
}
```

## 边界

- `rootMargin` 是这套的**核心**。默认整视口太高，多个小节同时可见时判断不出当前项；收成一条带（如 `-45%` 上下）才唯一。
- 观察目标要覆盖**整节内容**（含正文），不能只观察标题。只观察标题时，标题滚出带之后这一节就不再是「当前」，高亮会跳到下一节。
- 首屏（还没滚动时）可能没有任何小节穿过那条带，需要**默认高亮第一项**。
- 最后一个短节可能永远滚不到带的位置（后面没有足够内容把它推上去），要给末尾留出额外高度或放宽阈值。
- 高亮变化不要引起目录自身的高度或字重变化——那会让目录自己跳动，点起来很难受。用颜色与边框而不是 `font-weight` 加粗。
- 用观察器而不是 `scroll` 事件，是为了避免每帧读 `getBoundingClientRect()`（会强制同步布局）。这一点是性能上的取舍，不是风格偏好。

## 备注

- `root` 指定成滚动容器（这里是 `.tc-body`），`rootMargin` 才是相对它的。嵌在页面里的长文要把 `root` 留空（相对视口）。
- 同一机制可以做「图片懒加载」「无限滚动触发」「广告可见性统计」——都是「某元素进入某区域」这一个问题的变体。
