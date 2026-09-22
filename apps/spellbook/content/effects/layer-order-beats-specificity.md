---
title: 顺序压过具体性
slug: layer-order-beats-specificity
category: 布局
tags: [层叠层, 优先级, 覆盖]
since: 2026-10
source: 机制来自 CSS Cascading and Inheritance Level 5 的 @layer，自行实现
when: 覆盖某个样式要不停堆具体性，样式表越改越硬，谁赢全看选择器写得多长
stage: plain
tier: core
---

## 描述

左边那块被主题层刷成了青色，而基础层给它的规则用的是「一个 ID 加一个类」——具体性高出整整一档，仍然输了；右边那块同样的 ID 规则写在层外，它反而赢了。

机制是 ==@layer 把「层的先后顺序」提到具体性之前参与级联==。常规级联的顺序是先比具体性、再比源码顺序，于是想覆盖某条样式就只剩一条路：写得比它更具体（堆 ID、堆类名、加 `!important`），样式表会随着时间越来越硬，谁赢完全取决于选择器有多长。层叠层在中间插了一级：先看规则属于哪一层，层与层之间的先后在具体性之前生效；只有同一层内部，才回到具体性那套规则。于是「主题层永远压得住基础层」这句话可以在样式表开头用一行声明定下来，覆盖关系从「比谁的刀更长」变成了「说清楚谁在后」。

这就是它最实用的地方：把基础样式、主题、第三方库各放一层，顺序写在最前面，之后在里面怎么写都不会越界。反过来还有一条同样重要：**没写层的规则优先级高于所有分层样式**。所以你把库整个放进层里，自己随手写的样式不写层，就自动赢——不必去跟库的选择器斗具体性。

层的顺序、分层粒度、以及什么该留在层外，是这条咒语的全部旋钮。层数不必多：基础、组件、主题、第三方工具各一层已经够用，层越多越容易忘掉谁在谁后面。真正要守住的是「顺序声明只出现在一个地方」——分散在多处用 `@layer a, b;` 与 `@layer b; @layer a;` 交叉声明，那样谁都算不清最终顺序。

## 代码

```html
<div class="ly">
  <figure class="ly-item">
    <div class="ly-plate" id="ly-a">主题胜</div>
    <figcaption>基础层用 ID + 类，主题层只有一个类<br>层序在前 → 主题赢</figcaption>
  </figure>
  <figure class="ly-item">
    <div class="ly-plate" id="ly-b">基础胜</div>
    <figcaption>同样的 ID 规则写在层外<br>未分层的样式压过所有层</figcaption>
  </figure>
</div>
```

```css
/* @mechanism 层的先后在这里一次定死：theme 在 base 之后，于是主题永远压得住基础 */
@layer base, theme;

@layer base {
  /* 一个 ID 加一个类，具体性 1,1,0 */
  #ly-a.ly-plate {
    background: #4b4740;
    color: #f0ead9;
  }
}

@layer theme {
  /* @mechanism 只有 0,1,0 的具体性，却赢了上面那条 1,1,0 —— 层序先于具体性比较 */
  .ly-plate {
    background: linear-gradient(150deg, #1f7a6f, #38e0c8);
    color: #06231f;
  }
}

/* @mechanism 不写层的规则优先级高于所有层，所以这条 ID 规则照样赢过主题层 */
#ly-b.ly-plate {
  background: #4b4740;
  color: #f0ead9;
}

.ly {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.ly-item {
  display: grid;
  gap: 8px;
  margin: 0;
  width: min(150px, 42vw);
  font: 400 12.5px/1.6 system-ui, sans-serif;
  color: rgb(27 23 16 / 0.75);
}

.ly-plate {
  display: grid;
  place-items: center;
  height: 110px;
  border-radius: 14px;
  border: 1px solid rgb(60 48 30 / 0.25);
  font: 600 15px/1 system-ui, sans-serif;
}
```

## 边界

- 层序是「先声明的先输」。`@layer base, theme;` 里靠后的 theme 更强；如果靠 `@layer` 块出现的先后自动排序，读起来就得从头扫到尾——所以顺序声明最好集中写一次。
- 层只在**同源**的规则之间比较。用户代理样式、用户样式、行内样式、`!important` 各有自己的级联出处，`@layer` 管不到它们；行内样式照样压过任何分层规则。
- `!important` 会让层序**反过来**：带重要声明时靠前的层反而赢。两种方向的规则混在同一套层里几乎没人算得清楚，最稳的用法是层内不写 `!important`。
- 未分层的样式压过所有层，这条对「先放库、后写自己的」很方便，但反过来也意味着：**忘了给某段旧样式分层**，它就会一直压着新写的主题——症状是「主题改了没反应」，而不是报错。
- 层不改变继承：元素从祖先继承到的值，与哪一层写了它无关。继承值没有层的概念。
- 支持面已经够用（Chromium 99+ / Safari 15.4+ / Firefox 97+），但旧引擎会把整条 `@layer` 块连同里面的规则一起丢掉——症状是这块样式整体消失。迁移老项目时要先确认目标浏览器。

## 备注

- 把第三方库整个装进层里的标准写法是 `@import url(...) layer(vendor);`，一行就把它的优先级压到你自己的规则之下。
- 配合 `:where()` 用效果更好：层负责「大顺序」，`:where()` 负责把层内的选择器具体性抹成零，两层防线各管一件事。
