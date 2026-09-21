---
title: 按自身宽度换布局
slug: container-card
category: 布局
tags: [容器查询, 组件, 自适应]
since: 2026-09
source: 机制来自 CSS Containment 规范的容器查询，自行实现
when: 同一个卡片组件，放在窄侧栏要竖排、放在宽主区要横排
stage: grid
tier: core
params:
  - { name: width, label: 容器宽度, type: range, min: 200, max: 620, step: 10, default: 560, unit: px }
---

## 描述

拖动宽度滑杆，卡片会在竖排和横排之间翻一次——而它自己并不知道窗口有多大。

机制是 ==container-type: inline-size 配 @container 查询==。父元素声明自己是「查询容器」，子元素就可以用 `@container (min-width: …)` 问「我有多宽」，而不是问「窗口有多宽」。组件从此不关心自己被放在哪里。

这是媒体查询做不到的事：同一页面上，侧栏里的卡片竖排、主区里的卡片横排，两者用的是同一份 CSS。

## 代码

```html
<div class="cq-wrap">
  <div class="cq-card">
    <span class="cq-badge">图</span>
    <div class="cq-body">
      <h3>容器查询卡片</h3>
      <p>容器够宽时，图和文字并排；不够宽时，自动改成上下堆叠。</p>
    </div>
  </div>
</div>
```

```css
.cq-wrap {
  container-type: inline-size; /* @mechanism 声明自己是查询容器 */
  width: min(var(--width, 560px), 84vw);
  padding: 12px;
  border: 1px dashed rgb(60 48 30 / 0.45);
  background: rgb(255 255 255 / 0.3);
}

.cq-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #efe9dd;
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.cq-badge {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  background: #b4462f;
  color: #f7f1e6;
  font: 600 15px/1 system-ui, sans-serif;
}

.cq-body h3 {
  margin: 0 0 4px;
  font: 600 17px/1.3 system-ui, sans-serif;
}

.cq-body p {
  margin: 0;
  opacity: 0.72;
}

@container (min-width: 380px) {
  .cq-card {
    grid-template-columns: 56px 1fr;
    align-items: center;
  }
}
```

## 边界

- `container-type: size`（两个轴）会让元素**长宽都不再由内容决定**，没给显式高度就塌成 0——「加了容器查询我的 div 消失了」几乎都是这个。只想查宽度就用 `inline-size`。
- `@container` 找的是**最近的**有 `container-type` 的祖先。一个都没有时查询不匹配，且**不报错**，只是样式不生效。
- 给元素加 `container-type` 会同时让它成为包含块（类似 `position: relative` 的作用），里面原本相对页面的 `position: fixed` 会改成相对它定位。
- 容器查询查的是**内容盒**宽度，`padding` 与 `border` 不算在内，所以断点值要比设计稿上看到的小一圈。

## 备注

- 命名容器（`container-name`）在有嵌套容器时很有用，能把「问哪一层」写明确。
- 容器查询单位（`cqw` / `cqi`）可以拿来直接写字号，配合 `clamp()` 就是随组件缩放的排版。
