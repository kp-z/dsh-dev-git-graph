---
title: 跟着容器缩放的排版
slug: cqi-typescale
category: 布局
tags: [容器查询, 单位, 字号]
since: 2026-09
source: 机制来自 CSS Containment 的容器查询长度单位，自行实现
when: 同一个卡片组件要放进宽窄不同的槽位，字号得跟着槽位走
stage: grid
tier: core
params:
  - { name: scale, label: 缩放比例, type: range, min: 1, max: 6, step: 0.5, default: 3, unit: cqi }
---

## 描述

同一个卡片放进窄栏时字号自动变小，放进全宽区块时跟着变大——跟着**容器**，不是窗口。

机制是 ==cqi 表示「容器宽度的百分之一」==。用 `vw` 时字号跟着视口走：一张 240px 宽的卡片放在大屏上会拿到按整屏算出来的巨大字号，直接撑破。`cqi` 把参照物换成最近的那个容器查询祖先，于是同一份 CSS 在任何宽度的槽位里都保持比例。

前提是祖先上要声明 `container-type`——不声明，`cqi` 会回退成视口单位，得到完全不是你想要的结果。

## 代码

```html
<div class="cq-row">
  <div class="cq-slot cq-narrow">
    <div class="cq-card"><b>窄栏</b><p>字号跟着这一格走。</p></div>
  </div>
  <div class="cq-slot cq-wide">
    <div class="cq-card"><b>宽栏</b><p>同一份 CSS，字号更大。</p></div>
  </div>
</div>
```

```css
.cq-row {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 14px;
  width: min(520px, 86vw);
}

.cq-slot {
  /* @mechanism 没有这句，cqi 会回退成视口单位 */
  container-type: inline-size;
}

.cq-card {
  padding: 16px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.44);
  color: #1c1a17;
}

.cq-card b {
  display: block;
  /* @mechanism 字号按容器宽度算，再加 clamp 兜上下限 */
  font-size: clamp(14px, var(--scale, 3cqi), 30px);
  font-weight: 700;
}

.cq-card p {
  margin: 6px 0 0;
  font: 400 13px/1.6 system-ui, sans-serif;
  opacity: 0.7;
}
```

## 边界

- 祖先必须声明 `container-type: inline-size`。少了它，`cqi` 会**回退成视口单位**——不报错，只是尺寸完全不对，这个坑很难自己看出来。
- `cqi` 参照的是**最近的**容器查询祖先。中间若嵌了另一个容器，参照物就换了，效果会莫名其妙地变小。
- `container-type: inline-size` 会让该元素的宽度**不再由内容决定**（只看外部约束）。对原本靠内容撑开的盒子是实打实的行为改变。
- 单位本身没有上下限。不套 `clamp()` 的话，小容器里会小到看不清、大容器里会大到溢出。
- 它在「同一组件放进多种槽位」时才比 `rem` + 断点更划算。普通正文用固定字号仍然是最稳的选择——别为了新而用。

## 备注

- `cqi` 是宽度（inline 轴），`cqb` 是高度（block 轴）。做流式字号用 `cqi`，做「按高度缩放」的插图才用 `cqb`。
- 配 `clamp()` 时下限用 `rem`（尊重用户字号设置）、中间用 `cqi`、上限用 `rem`，是无障碍上比较稳的组合。
