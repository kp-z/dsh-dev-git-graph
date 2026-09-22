---
title: 原生互斥手风琴
slug: details-accordion-name
category: 交互
tags: [details, 手风琴, 互斥]
since: 2026-10
source: 机制来自 HTML 规范 details 元素的 name 属性，自行实现
when: 一组折叠面板，一次只想开一个，又不想为此写脚本
stage: plain
tier: candidate
---

## 描述

三个折叠面板同时只开一个——打开第二个，第一个自己合上，零 JS。

机制是 ==给同一组 `<details>` 起同一个 name，浏览器就把它们当成互斥组==。在此之前这需要监听 `toggle` 事件、遍历兄弟节点、手动摘掉别人的 `open`；`name` 把「组」写成 DOM 里的事实，谁都不必记着上一次开的是哪个。它和 radio 的 `name` 是同一个思路：把互斥关系落到结构上，而不是留在脚本的约定里。

可变的是「允许全关吗」。原生行为允许用户把当前面板再点一次收起，组内全关；如果业务要求「永远有一个开着」，`name` 帮不上忙，得自己补脚本。

另有一个不显眼的代价：`name` 是**文档级**的分组键，两个互不相干的组件取了同一个名字就会互相收起，所以名字要带组件前缀，别用 `accordion` 这种通用词。

## 代码

```html
<!-- @mechanism 同一个 name 把三个 details 绑成互斥组，开一个自动关一个 -->
<div class="acc">
  <details class="acc-item" name="sb-faq" open>
    <summary>为什么要用 name</summary>
    <p>互斥由浏览器实现，不必监听 toggle 再遍历兄弟节点。</p>
  </details>
  <details class="acc-item" name="sb-faq">
    <summary>和 radio 有什么关系</summary>
    <p>都在把「互斥」写成结构事实：radio 管取值，details 管展开。</p>
  </details>
  <details class="acc-item" name="sb-faq">
    <summary>什么时候不够用</summary>
    <p>要求永远有一个开着时，name 做不到，得自己补逻辑。</p>
  </details>
</div>
```

```css
.acc {
  width: min(380px, 86vw);
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #1b1710;
}
.acc-item {
  border-bottom: 1px solid rgb(60 48 30 / 0.16);
}
/* @mechanism 干掉原生三角标记，改用一个自己控制方向的箭头 */
.acc-item > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 2px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}
.acc-item > summary::-webkit-details-marker {
  display: none;
}
.acc-item > summary::after {
  content: '+';
  margin-inline-start: auto;
  color: #b4462f;
  font-weight: 400;
  transition: transform 0.2s;
}
/* @mechanism 展开态的唯一真相是 open 属性，箭头方向由它推导，不另存状态 */
.acc-item[open] > summary::after {
  transform: rotate(45deg);
}
.acc-item p {
  margin: 0 0 12px;
  opacity: 0.72;
}
```

## 边界

- 支持度：不认识 `name` 的浏览器会退化成一个「可以同时展开多个」的普通折叠列表——不破版，只是互斥没了，属于良性降级，但别把「只有一个开着」当成布局前提。
- `name` 是文档级分组键，跨组件重名会互相收起。取名带前缀，别用 `accordion`、`faq` 这种通用词。
- 它允许组内全关（再点一次当前项即可收起）。要「恒开一个」必须在 `toggle` 里补逻辑，而且补的时候要小心无限递归（你在 toggle 里又去改别人的 open）。
- 标记里给同组两个 `details` 都写 `open` 是自相矛盾的初始态，别依赖浏览器最终留下哪一个。
- 互斥关闭是 UA 直接改 `open` 属性，与你点击某一条的路径不同；如果展开动画绑在点击这条路径上（例如读一次 `scrollHeight` 再设高度），被自动关掉的那一侧经常来不及播动画。
- `name` 只解决互斥，不解决记忆：刷新后回到标记里的初始态。要记住用户上次开的是哪个，得自己存 localStorage 或改用 URL 片段。
- 收起只是视觉折叠，内容节点仍在 DOM 里，表单里的输入值会保留；别指望用收起当「清空」。

## 备注

- 同一机制可做 FAQ、设置面板、移动端的筛选分组；不同 `name` 的分组之间互不干扰。
- 判断一条折叠该不该收：机制（互斥、状态、动效）是否说得清；「能折叠」本身不算。
