---
title: 只在键盘操作时显焦点环
slug: focus-visible-ring
category: 交互
tags: [focus, 键盘, 焦点, 按钮, 输入]
since: 2026-09
source: 机制来自 CSS Selectors 规范的 :focus-visible，自行实现
when: 鼠标点击不要留下难看的焦点框，但键盘 Tab 时必须看得见自己在哪
stage: plain
tier: core
params:
  - { name: ring, label: 环宽, type: range, min: 0, max: 8, step: 1, default: 3, unit: px }
---

## 描述

用鼠标点按钮不留痕迹，用键盘 Tab 到它时却有一圈清楚的轮廓。

机制是 ==:focus-visible 只在浏览器判断「用户需要看到焦点」时才匹配==。它的判定依据是触发方式与元素性质：键盘 Tab 一定匹配，鼠标点击普通按钮一般不匹配，而文本输入框无论怎么获得焦点都会匹配（因为用户确实需要知道光标在哪）。

这是纯 CSS 做不到的分辨——`:focus` 只有「有焦点」这一个信息，分不出来是怎么来的。

## 代码

```html
<button class="fv">点我，再按 Tab 试试</button>
<p class="fv-hint">鼠标点：没有环。按 Tab 移动：有环。</p>
```

```css
.fv {
  padding: 12px 22px;
  border: 1px solid rgb(60 48 30 / 0.4);
  border-radius: 2px;
  background: #efe9dd;
  font: 500 15px/1 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
}

.fv:focus {
  outline: none; /* 先把浏览器的默认框去掉，下面自己给 */
}

/* @mechanism 只在键盘操作时匹配，鼠标点击不匹配 */
.fv:focus-visible {
  outline: var(--ring, 3px) solid #b4462f;
  outline-offset: 3px;
}

.fv-hint {
  margin: 18px 0 0;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.6);
}
```

## 边界

- **绝不能只写 `outline: none` 就完事。**那样键盘用户会完全看不到自己在哪，是最常见的无障碍事故。上面那行 `outline: none` 后面必须紧跟着给 `:focus-visible` 一个替代的环。
- `:focus` 和 `:focus-visible` 不是一回事。用 `:focus` 会让鼠标点击也留下环；很多人因此去治 `outline`，结果把键盘可达性一起废掉了。
- 判定由浏览器的启发式决定，我们控制不了全部。大致规律是：键盘触发一定匹配，鼠标点击按钮不匹配，文本输入类无论怎么获得焦点都匹配。
- 用 `div` 冒充按钮（`role="button"`）时，必须同时给 `tabindex="0"` 才能获得焦点——否则它根本不可聚焦，样式无从谈起。
- `outline` 不占空间、跟随边框圆角，所以它比 `box-shadow` 更适合做焦点环：后者会被祖先的 `overflow: hidden` 裁掉。

## 备注

- 用 `outline-offset` 让环离开元素本身一点，在贴边的布局里更容易看清。
- 如果确实不想要默认样式，用 `:focus-visible` 覆盖它，而不是全局 `outline: none`。
