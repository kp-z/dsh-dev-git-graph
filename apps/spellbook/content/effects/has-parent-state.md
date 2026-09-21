---
title: 让父级跟着子级变
slug: has-parent-state
category: 交互
tags: [has, 选择器, 状态]
since: 2026-09
source: 机制来自 CSS Selectors Level 4 的 :has()，自行实现
when: 勾选之后整张卡片要换样子，但不想加 JS、也不想给父级加类名
stage: plain
tier: core
params:
  - { name: tint, label: 选中底色, type: range, min: 0, max: 100, step: 5, default: 55, unit: % }
---

## 描述

勾上复选框，整张卡片连同边框一起换色——父级没有类名变化，也没有一行 JS。

机制是 ==:has() 让选择器能够「向上」匹配==。`:has(input:checked)` 的含义是「包含一个被勾选的 input 的元素」，于是我们可以从子级的状态反推父级的样式。CSS 诞生以来第一次能这样选。

这不是 `:focus-within` 的替代品——那个只能表达「有焦点」，`:has()` 能表达任意后代状态。

## 代码

```html
<label class="hs">
  <input type="checkbox" checked />
  <span class="hs-text">勾选时整张卡片换色</span>
</label>
<label class="hs">
  <input type="checkbox" />
  <span class="hs-text">取消勾选试试</span>
</label>
```

```css
.hs {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(420px, 84vw);
  margin-bottom: 10px;
  padding: 14px 16px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.3);
  font: 400 14px/1.5 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

/* @mechanism 从子级状态反推父级样式 */
.hs:has(input:checked) {
  border-color: #b4462f;
  background: color-mix(in srgb, #b4462f var(--tint, 55%), #efe9dd);
}

.hs input {
  width: 18px;
  height: 18px;
  accent-color: #b4462f;
}
```

## 边界

- `:has()` 匹配的是「**某个后代**满足条件」，不只是直接子级。写 `:has(input)` 时，嵌套深处任意一层有 input 都会命中——范围比直觉大。
- 它的匹配成本高于普通选择器，因为没法用简单的从右往左扫描。用在成百上千个元素上、又频繁改状态时会拖慢样式重算。
- 不支持它的浏览器（Firefox 121 以前）会**整条规则丢弃**，所以不要把「只有选中时才可见」当唯一入口，否则旧浏览器上内容永远看不到。
- 别写太深：`:has()` 里再套复杂选择器会让匹配范围难以预测，调试时现象是「莫名其妙也命中了」。

## 备注

- 把 `:has()` 作用在 `:focus-within` 上是很实用的组合：整块表单区域跟随「哪个输入框有焦点」高亮。
- `color-mix()` 让底色由主题色算出来，改一个颜色整块跟着变，比手写第二套色值好维护。
