---
title: 平衡换行
slug: text-wrap-balance
category: 排版
tags: [text-wrap, custom-property, 标题]
since: 2026-09
source: 机制来自 CSS Text 规范的 text-wrap，自行实现
when: 短标题换行后末行只剩一两个字，看着别扭
stage: plain
tier: core
params:
  - { name: width, label: 文字宽度, type: range, min: 180, max: 520, step: 10, default: 340, unit: px }
---

## 描述

两行的标题，两行长度差不多——不再是第一行满满当当、第二行孤零零两三个字。

机制是 ==text-wrap: balance==。浏览器在排版时反过来调整断行位置，让各行的长度尽量接近。这跟 `pretty` 不是一回事：`pretty` 只管把最后一行从孤字救回来，`balance` 是让整段均匀。

## 代码

```html
<h3 class="tw">一条咒语要同时说清它靠什么成立、又什么时候不管用</h3>
```

```css
.tw {
  width: min(var(--width, 340px), 84vw);
  margin: 0;
  text-wrap: balance; /* @mechanism 反推断行位置，让各行等长 */
  font: 600 25px/1.28 system-ui, sans-serif;
  color: #1c1a17;
}
```

## 边界

- `balance` **只对短文本有效**。浏览器为了性能限制了行数（Chromium 是 6 行左右，且逐块递减），超出的部分直接忽略——效果「时有时无」就是这个原因，不是 CSS 写错了。
- 正文段落不该用它。长段落要的是「避免最后一行孤单」，那是 `text-wrap: pretty`；用 `balance` 会把整段的行长掐齐，读起来反而更累。
- 它会让元素高度变化，因此放在 flex 或 grid 布局里可能引发布局抖动；已知高度依赖的地方要留意。
- 对已经手动断行的文本（含 `<br>`）无效——手动断行优先级更高。

## 备注

- 现在三个引擎都支持了，但降级行为是「静默不生效」，不需要 `@supports` 兜底，也不会破版。
- 它和 `max-width` 是搭档：先限制行长到易读的范围内，再让 `balance` 分配这两三行。
