---
title: 裁掉行高留白
slug: text-box-trim
category: 排版
tags: [行盒, 间距, 对齐]
since: 2026-09
source: 机制来自 CSS Inline Layout 的 text-box-trim，自行实现
when: 标题上方总有一块看不见的空，怎么调 margin 都对不齐
stage: plain
tier: candidate
---

## 描述

标题与上边界的距离正好是眼睛看到的距离，没有藏在行盒里的那一截。

机制是 ==text-box-trim 把行盒顶部与底部多余的留白裁掉==。字体为了容纳升部、降部以及更极端的字符，会在字形的上下各预留空间。所以文字块的上方永远有一块看不见的空——调 `margin` 时你在跟它较劲。这个属性让行盒贴合实际字形的高度。

它不改变盒模型，改变的是**行盒内部**文字所占的高度。

## 代码

```html
<div class="bt-box">
  <h3 class="bt-h">上边距是真实的</h3>
  <p class="bt-p">这两块之间的距离就是眼睛看到的距离。</p>
</div>
```

```css
.bt-box {
  width: min(380px, 82vw);
  padding: 22px 24px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.42);
  font-family: system-ui, sans-serif;
  color: #1c1a17;
}

.bt-h {
  margin: 0;
  font-size: 26px;
  line-height: 1.2;
  /* @mechanism 行盒裁到字形高度，上方的隐形留白没了 */
  text-box-trim: trim-both;
  text-box-edge: cap alphabetic;
}

.bt-p {
  margin: 14px 0 0;
  font-size: 15px;
  line-height: 1.7;
  text-box-trim: trim-both;
  text-box-edge: cap alphabetic;
}
```

## 边界

- 支持面还窄。不支持时留白照旧——**不破版**，只是「怎么调都不对」的问题依然在。
- `text-box-edge` 决定裁到哪：`cap alphabetic` 按大写字母顶端与基线，`ex alphabetic` 按小写 x 高度。**中文字形的度量与拉丁不同**，裁掉之后中文往往显得上紧下松。
- 它改变的是行盒内部的排布，不影响盒模型的尺寸。所以与下一个元素的视觉距离变短了，但 `margin` 的数值没变——协作时要说明白。
- 多行文本上只会裁首行与末行，中间行不变。这是它的设计意图，不是缺陷。
- 字体一换，理想的首行位置就变了。它让排版更精确，同时也让「同一样式在不同字体下的垂直位置」更难预测。

## 备注

- 它解决的是「文字块与容器之间的视觉间距」这一老问题，比 `padding` 猜数值可靠得多。
- 配 `line-height: 1` 一起用时效果最明显——那正是留白最突兀的情况。
