---
title: 图片在框里怎么裁
slug: object-fit-replaced
category: 布局
tags: [object-fit, aspect-ratio, 图片, 画廊]
since: 2026-10
source: 机制来自 CSS Images 规范的 object-fit 与 object-position（替换内容的尺寸适配），自行实现
when: 同一张宽图要塞进几个形状相同的方框当缩略图，还要控制露出画面里的哪一块
stage: grid
tier: core
---

## 描述

三个一样大的 4:3 方框，塞的是同一张 2:1 的宽图。左边那个只露出画面最左侧，右边那个只露出最右侧，中间那个居中——图没有被改过，改的是它的对齐点。

机制是 ==object-fit 决定替换元素的内容按什么规则装进它的内容盒，object-position 决定装不满或装不下时内容停在哪儿==。图片这类替换元素带**自己的固有比例**；CSS 给的 `width` 与 `height` 只描述那个盒子的形状，"内容怎么适应这个形状"是另一件事。默认值 `fill` 直接把图拉伸到填满（比例就失真了），`cover` 按固有比例放大到盖满整个盒，多出来的部分**不是消失而是溢出后被裁掉**——裁在哪一边由 `object-position` 决定。

所以三张图长得不一样，靠的不是三张图，也不是 `transform`，是**一个对齐点**。同一张图能出无数种构图，代价是每换一个位置就换一次裁切。

## 代码

```html
<!-- @mechanism 三个框形状相同、图相同，构图不同：位置由 object-position 决定 -->
<div class="strip">
  <img class="thumb" style="--pos: 0% 50%" alt="露出左侧"
    src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 20'%3E%3Crect width='40' height='20' fill='%23efe6d6'/%3E%3Ccircle cx='6' cy='10' r='4' fill='%23a33'/%3E%3Ccircle cx='20' cy='10' r='4' fill='%23369'/%3E%3Ccircle cx='34' cy='10' r='4' fill='%23084'/%3E%3C/svg%3E" />
  <img class="thumb" style="--pos: 50% 50%" alt="居中"
    src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 20'%3E%3Crect width='40' height='20' fill='%23efe6d6'/%3E%3Ccircle cx='6' cy='10' r='4' fill='%23a33'/%3E%3Ccircle cx='20' cy='10' r='4' fill='%23369'/%3E%3Ccircle cx='34' cy='10' r='4' fill='%23084'/%3E%3C/svg%3E" />
  <img class="thumb" style="--pos: 100% 50%" alt="露出右侧"
    src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 20'%3E%3Crect width='40' height='20' fill='%23efe6d6'/%3E%3Ccircle cx='6' cy='10' r='4' fill='%23a33'/%3E%3Ccircle cx='20' cy='10' r='4' fill='%23369'/%3E%3Ccircle cx='34' cy='10' r='4' fill='%23084'/%3E%3C/svg%3E" />
</div>
```

```css
.strip {
  display: flex;
  gap: 10px;
  padding: 12px;
  background: rgb(255 255 255 / 0.5);
  border: 1px solid rgb(60 48 30 / 0.28);
}

.thumb {
  /* @mechanism 框的形状由 CSS 定，图片的固有比例是另一回事 */
  inline-size: 104px;
  aspect-ratio: 4 / 3;
  /* @mechanism cover：按固有比例放大到盖满，多出来的部分溢出后被裁掉 */
  object-fit: cover;
  /* @mechanism 溢出部分留在哪一侧，看这个对齐点 */
  object-position: var(--pos, 50% 50%);
  border: 1px solid rgb(60 48 30 / 0.35);
  background: rgb(60 48 30 / 0.06);
}
```

## 边界

- `object-fit` 只对**替换元素**有效（`img`、`video`、`canvas` 这类）。写在普通 `div` 上完全无效：里面的背景图该用 `background-size: cover`，那是另一套机制，两者不能互替。
- `fill` 是初始值，会拉伸变形。没写 `object-fit` 时看到「人脸被拉宽」就是它，不是图片本身有问题。
- `cover` 必然裁掉一部分内容。`object-position` 的百分比语义是「图片上的对应比例点与容器上的同比例点重合」，所以 `50% 50%` 是居中而不是「偏移一半」——和 `background-position` 一致，写成 `left`/`top` 这类关键字更不容易记错。
- `object-position` 在 `fill` 下没有任何可见效果：内容刚好填满盒子，没有可挪的余地。它只在有溢出（`cover`、`none`）或有余量（`contain`、`scale-down`）时才有意义。
- `contain` 留出的空白露的是**元素的背景**，不是图片被缩小后的边。深色底上就变成上下两条黑边。
- `object-fit: none` 用图片的原始像素尺寸，不缩放：框更大时它不放大，框更小时它裁掉。它不等于 `scale-down`（后者取 `none` 与 `contain` 中更小的那个结果）。
- 图片没有固有比例时（某些 SVG 缺 `viewBox`），适配规则退化，实际表现接近按框拉伸。

## 备注

- 同一套机制也管 `<video>` 的封面构图与 `<canvas>` 在框内的贴合方式。
- 配 `aspect-ratio` 用是一对：框的比例由 `aspect-ratio` 提前定好，图在框内的构图由 `object-fit` / `object-position` 定，两者合起来才谈得上「缩略图排版不参差」。
