---
title: 弹性项不肯缩
slug: flex-min-size-floor
category: 布局
tags: [flex, 收缩, 省略号]
since: 2026-10
source: 机制来自 CSS Flexbox 规范的自动最小尺寸（automatic minimum size）规则，自行实现
when: 头像加一段长文字的横排条目要塞进窄容器，文字该缩并出省略号
stage: plain
tier: core
---

## 描述

一行里左边是头像、右边是标题和一段长说明，整个条目只有 320px 宽。头像不动，右边的文字缩到装不下时出省略号，一行也不横向溢出。

机制是 ==弹性项的自动最小尺寸是 min-content，所以 min-width: auto 挡着收缩==。`min-width` 的初始值就是 `auto`，可它在弹性项上的含义不是「不限制」，而是「不得窄于内容的最小尺寸」——这是规范给「文字不该被压扁到看不清」留的护栏：只要 `overflow` 还是 `visible`，浏览器就拿 `min-content` 当收缩下限。所以给文字加 `text-overflow: ellipsis` 是没用的，元素压根没被允许变窄，省略号永远不会出现。`min-width: 0` 做的是把这道护栏手动撤掉，于是这一列可以一直窄下去，省略号才有机会。

撤护栏的位置可以放在弹性项上，也可以放在它的子块上，取决于你想让哪个盒子成为「可缩到任意窄」的那一个。给 `overflow: hidden` 同样能解除自动最小尺寸（规范只在 `overflow` 为 `visible` 时才应用它），但那是顺手把溢出也裁掉了。头像一侧写 `flex: 0 0 auto` 是刻意的：收缩压力应该集中在一处，两头都能缩的结果是头像被压扁、文字还是挤成竖条。

## 代码

```html
<!-- @mechanism 只有右侧那一列承担收缩，头像不参与 -->
<div class="row">
  <span class="avatar">咒</span>
  <div class="body">
    <strong>弹性项不肯缩</strong>
    <p>一段很长的说明文字，用来把这一行撑到装不下</p>
  </div>
</div>
```

```css
.row {
  display: flex;
  gap: 12px;
  width: min(320px, 82vw);
  padding: 14px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.4);
  font: 400 14px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.avatar {
  flex: 0 0 auto;              /* @mechanism 头像不参与收缩，压力全给右侧那一列 */
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #2f2a24;
  color: #f6f3ee;
  font-size: 17px;
}

.body {
  min-width: 0;                /* @mechanism 撤掉 min-content 下限，这一列才允许窄于内容 */
  display: grid;
  gap: 4px;
}

.body strong,
.body p {
  margin: 0;
  overflow: hidden;            /* 配合上一行，省略号才真的画得出来 */
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

## 边界

- 中文与长 URL 的 `min-content` 差得很远：中文的下限是一个字，而无处可断的长串（URL、哈希）下限是整个串。忘了 `min-width: 0` 时前者只是挤成竖条，后者直接把容器顶出横向滚动，症状看起来不像同一个毛病。
- 用 `overflow: hidden` 代替 `min-width: 0` 也能解除，但它同时把溢出裁掉了。如果本意是让子元素自己可以滚，那就等于凭空造出一个滚动容器，还会改写后代 `position: sticky` 的参照。
- 主轴换成列方向时，对应的下限是 `min-height: auto`，要写 `min-height: 0`。在弹性列里放滚动区忘写它，滚动条不会出现，而是整个容器被内容撑高。
- 记住这是**主轴**的概念：`min-width: 0` 写在列方向的弹性容器上不起作用，该写的是 `min-height: 0`。

## 备注

- 网格项也有同一套自动最小尺寸（`1fr` 隐含 `minmax(auto, 1fr)`），所以长内容撑破网格时，改 `minmax(0, 1fr)` 和给弹性项写 `min-width: 0` 是同一件事的两个版本。
