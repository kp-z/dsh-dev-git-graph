---
title: 移动端的一屏高度
slug: dvh-viewport-100
category: 布局
tags: [containing-block, 容器, 页头]
since: 2026-10
source: 机制来自 CSS 视口单位 dvh / svh 的定义，自行实现
when: 想在手机上做一屏高的首屏，又不想被地址栏收放搞出滚动条
stage: plain
tier: core
---

## 描述

手机上做一屏满高的首屏，用 `height: 100vh` 会超出一点——地址栏在的时候 `vh` 不缩，于是页面凭空多出一截滚动条。用 `100dvh` 就刚好贴住当前可视高度。

机制是 ==`vh` 对的是「地址栏收起时的最大视口」，而 `dvh` 对的是「此刻的实际视口」==。移动浏览器的地址栏会随滚动收放，可视高度一直在变，`vh` 取的是那个**最大值**（等于 `lvh`），所以在地址栏还在时，`100vh` 比看得见的地方高。`dvh` 是动态的，跟随当前值——`svh` 则是那个最小值（地址栏展开时）。

三者的取舍在于「你要的是哪个量」：`svh` 做首屏最稳（永远不会超出，地址栏收起时底下留一点空），`dvh` 严丝合缝但会随地址栏收放**让内容跳动**，`lvh` 适合做「至少铺满一屏但可以更高」的背景。多数场景该用 `svh` + `min-height`，而不是 `dvh` + `height`。

## 代码

```html
<section class="hero">
  <h1>一屏高的首屏</h1>
  <p>手机上看不到多余的滚动条</p>
</section>
```

```css
.hero {
  display: grid;
  place-content: center;
  gap: 8px;
  padding: 24px;
  background: linear-gradient(160deg, #2b2434, #14101a);
  color: #f0ead9;
  /* @mechanism 先给旧浏览器一个 100vh 的回退，下一行才覆盖它 */
  min-height: 100vh;
  /* @mechanism min-height 配 svh：永远不会超出，地址栏收起时留下一点空也不出滚动条 */
  min-height: 100svh;
  /* @mechanism dvh 会随地址栏收放变化，只适合做背景层，不适合放正文 */
  --live: 100dvh;
}
```

## 边界

- 用 `height: 100dvh` 而不是 `min-height` 时，地址栏一收，元素跟着变高，**里面所有内容都上下跳一下**。用户滑动页面时地址栏收收放放，正文就在跳——这就是「一屏高」这个需求本身用 `dvh` 的风险。
- `100vh` 的回退必须写在前面：两条同属性的声明，不支持 `svh` 的旧浏览器会忽略后一条。反过来写，旧浏览器只会看到 `100vh`，其实也对——但若只写 `svh` 而不写回退，旧浏览器上高度就完全丢了（`height: auto`）。
- `svh`/`dvh`/`lvh` 描述的是**视口**，不是**滚动容器**。放在一个自身可滚动的 `div` 里它们仍然对窗口算，不会变成那个 div 的高度——那要用容器查询单位 `cqh`。
- 桌面端三者相等，看不出差别。这类问题只在移动端浏览器（或开发者工具的设备模拟里）才出现，且模拟器对不同单位的处理与真机并不总一致。
- 与 `position: fixed` 底部栏配一套时，`dvh` 的跳动会让底部栏一上一下。底部栏该用 `svh` 或干脆用 `position: fixed` 加 `env(safe-area-inset-bottom)` 一起算。
