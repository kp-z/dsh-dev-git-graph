---
title: 折叠面板的展开动画
slug: details-animate
category: 交互
tags: [details, 折叠, 网格过渡]
since: 2026-09
source: 机制来自 CSS Grid 的 fr 可插值特性，自行实现
when: 用原生 details 做折叠，但打开时想要一段展开动画而不是硬跳
stage: plain
tier: core
params:
  - { name: dur, label: 展开用时, type: range, min: 0.1, max: 1, step: 0.05, default: 0.35, unit: s }
---

## 描述

点开标题，内容从 0 高度平滑长出来，而不是啪一下全出现。

机制是 ==grid-template-rows 从 0fr 过渡到 1fr==。这里的关键是：`fr` 是**长度**，两端都是长度才可插值。而 `height: 0 → auto` 不行——`auto` 不是一个可计算的数值，浏览器没有中间态可算，所以过渡直接不生效。

用一行网格轨道顶替「不知道有多高」的内容高度，就不必再用 JS 去测 `scrollHeight` 了。

## 代码

```html
<details class="dt">
  <summary>展开看看</summary>
  <div class="dt-wrap">
    <div class="dt-body">
      <p>内容高度是未知的，但这不影响动画。</p>
      <p>因为这里动的是网格轨道，不是高度。</p>
      <p>再多一行，动画照样准确。</p>
    </div>
  </div>
</details>
```

```css
.dt {
  width: min(460px, 84vw);
  border: 1px solid rgb(60 48 30 / 0.32);
  background: rgb(255 255 255 / 0.36);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.dt summary {
  padding: 13px 16px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}

.dt summary::-webkit-details-marker {
  display: none;
}

.dt-wrap {
  display: grid;
  grid-template-rows: 0fr;               /* @mechanism 收起来时是 0fr */
  transition: grid-template-rows var(--dur, 0.35s) ease;
}

.dt[open] .dt-wrap {
  grid-template-rows: 1fr;               /* @mechanism 展开时是 1fr，两端都是长度才能插值 */
}

.dt-body {
  overflow: hidden;                      /* @mechanism 没有它，轨道是 0 内容照样溢出可见 */
  padding: 0 16px;
}

.dt-body p {
  margin: 0 0 10px;
}
```

## 边界

- 内层必须有 `overflow: hidden`。没有它时轨道虽然收成 0 高度、内容却照样画在外面，看起来像动画完全没生效。
- `height: 0 → auto` 是过渡不了的，浏览器没有可算的中间值。这就是必须绕道 `fr` 的原因——别在这条路上浪费时间。
- **关闭方向要额外处理。**`open` 一被移除，浏览器立刻把内容从渲染树里拿掉，收起动画根本来不及播。要双向都动，得给内容加 `transition-behavior: allow-discrete`。
- `summary` 默认自带三角标记，各引擎的隐藏方式不同（`::-webkit-details-marker` 只覆盖 WebKit），要跨浏览器一致就得自己画箭头。
- `<details>` 的 `open` 属性由浏览器管理，别用 `hidden` 去替代它——两者语义与可访问性都不同。

## 备注

- 同一招也能做「折叠侧栏」「折叠搜索框」，只要内容高度未知就适用。
- `0fr → 1fr` 只解决高度；宽度方向用 `0fr → 1fr` 配 `grid-template-columns` 一样成立。
