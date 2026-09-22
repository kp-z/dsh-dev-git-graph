---
title: min 反而是上限
slug: min-max-inversion
category: 布局
tags: [clamp, grid, 容器]
since: 2026-10
source: 机制来自 CSS 值与单位规范的 min() / max() / clamp() 与 Grid 的 minmax()，自行实现
when: 一个尺寸要跟着容器缩放，但两头都得兜住，又不想写媒体查询
stage: grid
tier: core
---

## 描述

`width: min(100%, 320px)` 的效果是「最多 320px」——名字里写着 min，干的却是封顶的活。

机制是 ==min() 与 max() 是「从候选值里挑一个」，挑小值的自然成了上限、挑大值的自然成了下限==。`min()` 在候选里取最小的那个，所以只要 100% 比 320px 大，它就会切回小的那一支，于是它是**上限**；`max()` 取最大的，所以它是**下限**。名字描述的是函数在做什么运算，不是它给元素定了个什么边界——把「谁赢」记住就不会再绕。

`minmax()` 把同一条思路搬到网格轨道上：`minmax(160px, 1fr)` 是「至少 160px，最多弹性分配到的量」。它有个静默的例外——**max 小于 min 时，整个 max 被丢弃**，轨道退化成 min 的固定尺寸。这是这一族属性里唯一"写反了却不报错"的地方。

## 代码

```html
<!-- @mechanism 同一个函数在不同位置扮演不同的边界角色 -->
<div class="pad">
  <p class="pad-box">宽度封在 320px 以内，内边距最少 14px。</p>
</div>

<div class="tracks">
  <span>minmax(180px, 90px)</span>
  <span>minmax(90px, 1fr)</span>
</div>
```

```css
.pad {
  width: min(420px, 86vw);
}

.pad-box {
  /* @mechanism min() 挑小值，所以它在这里是上限：100% 大了就切回 320px */
  width: min(100%, 320px);
  margin: 0;
  /* @mechanism max() 挑大值，所以它在这里是下限：再窄也留 14px */
  padding-block: 10px;
  padding-inline: max(14px, 3vw);
  background: rgb(255 255 255 / 0.55);
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.tracks {
  display: grid;
  /* @mechanism max 小于 min 时整个 max 被丢掉，第一列成为固定的 180px */
  grid-template-columns: minmax(180px, 90px) minmax(90px, 1fr);
  gap: 8px;
  width: min(420px, 86vw);
  margin-block-start: 14px;
  font: 400 12px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.tracks span {
  padding: 8px 6px;
  text-align: center;
  background: rgb(60 48 30 / 0.08);
}
```

## 边界

- 把 `min()` 读成「最小尺寸」会写出 `min(320px, 100%)` 以为它保底——它保的是上限。反过来 `max()` 才是保底。两个函数名描述的是运算，不是意图。
- `minmax()` 的 max 小于 min 时**不报错、不警告**，max 被静默忽略。用变量拼 `minmax(var(--lo), var(--hi))` 时一段写反了完全看不出来，只能靠量出来核对。
- `clamp(a, b, c)` 等价于 `max(a, min(b, c))`：下限 a 与上限 c 冲突时**下限赢**。写成 `min(c, max(a, b))` 结果不同，两者不可互换。
- 比较发生在**计算值**上，涉及百分比时要先解析基准。`min(100%, 320px)` 里的 100% 相对包含块，包含块尺寸不确定时结果可能不走你以为的那一支。
- 候选值必须能算成同一类型（长度与百分比可以混，长度与颜色不行），否则整条声明无效被丢弃——现象是「尺寸完全没生效」。
- `max()` / `min()` 里嵌套 `calc()` 是允许的，但嵌套之后的可读性掉得很快，通常值得先在外层声明一个变量再引用。

## 备注

- 记忆口诀：`min()` 里越小的越容易赢，`max()` 里越大的越容易赢——谁赢谁就决定边界是哪一头。
- 和 `clamp()` 的分工：两端都要兜且中间是连续变化的量时用 `clamp()`；只有一头需要兜时 `min()` / `max()` 更短也更清楚。
