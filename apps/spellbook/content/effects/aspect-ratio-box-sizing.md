---
title: 比例算在哪个盒子上
slug: aspect-ratio-box-sizing
category: 布局
tags: [比例, 盒模型, 覆盖层]
since: 2026-10
source: 机制来自 CSS Sizing 规范中 aspect-ratio 与 box-sizing 的交互，自行实现
when: 一个固定比例的框里要放绝对定位的覆盖层，却总差出边框和内边距那几像素
stage: grid
tier: core
---

## 描述

给缩略图声明了 16/9，再往里塞一层 `inset: 0` 的遮罩，遮罩却比图片矮——四周被边框和内边距吃掉了一圈。

机制是 ==aspect-ratio 约束的是 box-sizing 指定的那个盒子==。默认 `box-sizing: border-box`，比例算的是边框盒：高度等于宽度的 16/9，这里面的内边距与边框都从盒内扣，留给内容的是缩小后的那一块。子元素写 `inset: 0` 贴的是**内容盒**，自然比整个框小一圈。如果改成 `content-box`，比例的参照物就换成内容盒，加上边框和内边距之后，肉眼看到的外框就不再是 16/9 了。

所以这条不是「比例失效」，是**比例作用在哪一层**的问题：想让覆盖层铺满整个比例框，就别让子元素贴内容盒——把覆盖层也放进那个边框盒的后代里，或者干脆不给框加边框和内边距。

## 代码

```html
<figure class="shot">
  <div class="shot-frame">
    <span class="shot-cap">16 / 9</span>
  </div>
  <figcaption>覆盖层贴着内容盒，所以没有压到边框上。</figcaption>
</figure>

<figure class="shot">
  <div class="shot-frame frame-separated">
    <span class="shot-cap">16 / 9</span>
  </div>
  <figcaption>内边距归内层承担，比例框本身干干净净。</figcaption>
</figure>
```

```css
.shot {
  width: min(280px, 74vw);
  margin: 0 0 18px;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.shot-frame {
  position: relative;
  /* @mechanism 比例约束的是 box-sizing 指定的盒；默认 border-box，所以边框和内边距从里面扣 */
  aspect-ratio: 16 / 9;
  box-sizing: border-box;
  border: 1px solid rgb(60 48 30 / 0.4);
  padding: 6px;
  background: rgb(255 255 255 / 0.55);
}

.shot-cap {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: rgb(28 26 23 / 0.62);
  background: repeating-linear-gradient(
    45deg,
    rgb(60 48 30 / 0.08) 0 8px,
    rgb(60 48 30 / 0) 8px 16px
  );
}

/* @mechanism 要边框盒比例就保持 border-box；换成 content-box 后外框会因内边距而不再是 16/9 */
.frame-separated {
  padding: 0;
}

.frame-separated .shot-cap {
  inset: 6px;
  border: 1px solid rgb(60 48 30 / 0.4);
}
```

## 边界

- `box-sizing: content-box` 下比例按内容盒算，`padding` 与 `border` 会额外叠加上去。现象是「明明写了 16/9，量出来是 16/9 再多一圈」——不是浏览器算错。
- 比例只在一个方向上是「硬」的：同时给了 `width` 和 `height` 时 `aspect-ratio` 直接让位，两个值都写死就不会有任何比例行为。
- 内容比比例框高时，`aspect-ratio` 是**下限而非上限**：默认 `min-height: auto` 会让盒子被内容撑高，比例被打破。要锁死比例就得显式写 `overflow: hidden` 或 `min-height: 0`。
- 子元素用 `height: 100%` 时，父级的百分比高度解析依赖比例盒已经定高；`content-box` 下 100% 指的是内容盒高度，跟覆盖层想要的边框盒高度差着内边距的厚度。
- 替换元素（`img`）自己带固有比例，外层再声明比例时，图片会按自己的比例缩进这个框里，可能出现上下或左右留白。要让图片铺满得配合 `object-fit`。

## 备注

- 判断「比例作用在哪个盒子」最快的方法：给盒子加一圈粗边框，看外框比例变不变。
- 同一套取舍也出现在百分比高度、`min-height` 与弹性项上——先问一句「这个百分比/比例相对谁」，答案通常是 `box-sizing` 指的那个盒。
