---
title: 下划线的位置与粗细
slug: text-underline-offset
category: 排版
tags: [text-decoration, 正文, 悬停]
since: 2026-09
source: 机制来自 CSS Text Decoration 的三个独立属性，自行实现
when: 默认下划线贴着字、穿过字母尾巴，看着很挤
stage: plain
tier: core
params:
  - { name: offset, label: 离字距离, type: range, min: 0, max: 0.4, step: 0.02, default: 0.2, unit: em }
---

## 描述

下划线离文字有点距离、粗细均匀，而且遇到 g、j 的尾巴会自动让开。

机制是 ==下划线由三个独立属性控制：粗细、位置、以及「是否避开字母降部」==。`text-decoration-skip-ink: auto` 是印刷里一直有的做法——装饰线在字母的尾巴处断开，读起来更干净。三者都是独立属性，可以分别调。

默认值在各浏览器上并不一致，所以要跨浏览器一致就得显式写全。

## 代码

```html
<p class="uo">机制要说得清，出处要记得住。看看 <a class="uo-link" href="#">这条链接</a> 的下划线，它的位置和粗细都是显式给的。</p>
```

```css
.uo {
  width: min(440px, 84vw);
  margin: 0;
  font: 400 17px/1.9 system-ui, sans-serif;
  color: #1c1a17;
}

.uo-link {
  color: #b4462f;
  text-decoration: underline;
  /* @mechanism 三个独立属性：粗细、位置、避让 */
  text-decoration-thickness: 2px;
  text-underline-offset: var(--offset, 0.2em);
  text-decoration-skip-ink: auto;
  text-decoration-color: rgb(180 70 47 / 0.55);
  transition: text-decoration-color 0.2s;
}

.uo-link:hover {
  text-decoration-color: #b4462f;
}
```

## 边界

- `text-underline-offset` 用带单位的相对值（`em`）才随字号缩放。用 `px` 时字号一换位置就错——这是「小字下划线离得远、大字贴得近」的原因。
- `text-decoration-skip-ink: none` 会让线穿过 g、j、p、q 的尾巴，看起来脏。但某些 CJK 场景下让开反而奇怪，要按语种决定。
- `text-decoration-thickness: auto` 时各引擎给的粗细不同。要跨浏览器一致必须显式写厚度，不能靠默认值。
- 装饰线的能力就到颜色、粗细、位置、线型为止——**做不出渐变、圆头或虚线动画**。渐变下划线只能用背景图方案（那是另一个条目）。
- 覆盖 UA 样式时不要顺手 `text-decoration: none` 把链接的下划线彻底去掉。去掉之后链接只剩颜色可辨，对色觉障碍用户不友好。

## 备注

- `text-decoration-color` 通常设得比文字色淡一点，视觉上更安静；悬停时再提饱和，是很轻的反馈。
- `text-underline-position: under` 与 `text-underline-offset` 是两套定位方式，混用时以其中一个为准。
