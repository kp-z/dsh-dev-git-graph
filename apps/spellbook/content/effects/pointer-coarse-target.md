---
title: 给手指更大的靶子
slug: pointer-coarse-target
category: 交互
tags: [触摸, 命中区域, 无障碍]
since: 2026-09
source: 机制来自 Media Queries Level 4 的 pointer 特性，自行实现
when: 桌面端合适的按钮在手机上总是点不中
stage: grid
tier: core
---

## 描述

同一排按钮，桌面端紧凑，触屏上每个都胖了一圈——外观没变，但好点多了。

机制是 ==pointer: coarse 表示主输入设备精度低（手指）==，拿它把可点区域放大到能可靠命中的尺寸。44 CSS px 这个下限不是随便定的，Apple 与 WCAG 的触控目标建议都在这个量级。

它是「同一套 UI 在触摸端给更大靶子」的最短路径。

## 代码

```html
<div class="pc">
  <button class="pc-btn">确定</button>
  <button class="pc-btn">取消</button>
</div>
```

```css
.pc {
  display: flex;
  gap: 10px;
}

.pc-btn {
  position: relative;
  padding: 9px 16px;
  border: 1px solid rgb(60 48 30 / 0.34);
  background: rgb(255 255 255 / 0.52);
  font: 500 14px/1 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
}

/* @mechanism 手指精度低，把命中区域撑到能可靠点中的尺寸 */
@media (pointer: coarse) {
  .pc-btn {
    min-width: 44px;
    min-height: 44px;
    padding: 12px 22px;
  }

  /* 相邻目标之间也要留缝，否则会互相误触 */
  .pc {
    gap: 14px;
  }
}
```

## 边界

- `pointer: coarse` 只看**主**输入设备。带触屏的笔记本主设备仍是鼠标，这条不匹配——触屏上依然是小靶子。这是它的固有局限。
- 放大的是**命中区域**，不一定是视觉尺寸。用伪元素扩张热区（`::after { inset: -10px }`）能不改变外观就扩大可点范围。
- 相邻目标之间也要留间距。只放大单个目标会让它们挤在一起，误触反而更多。
- 触屏上 `:hover` 会粘住，反馈要用 `:active` 而不是 `:hover`。
- 还有 `any-pointer: coarse`：它问的是「是否存在精度低的输入设备」而不是主设备。混合设备上用它才能覆盖到触屏。
- 别把它当成「手机端」判断。`pointer` 描述的是输入能力，不是屏幕大小——屏幕大小要看宽度媒体查询。

## 备注

- `(pointer: coarse)` 与 `(hover: none)` 常常一起用：前者管靶子大小，后者管去不掉悬停效果。
- 热区扩张用伪元素时记得伪元素本身不可见，视觉上完全无感——这是「无形中变得好用了」的做法。
