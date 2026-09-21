---
title: 等宽数字
slug: tabular-numbers
category: 排版
tags: [数字, 表格, 对齐]
since: 2026-09
source: 机制来自 OpenType 的 tnum 特性与 font-variant-numeric，自行实现
when: 计时器、计数器或表格里的数字一变，整行就在左右抖
stage: plain
tier: core
---

## 描述

数字每秒跳一次，但整行纹丝不动。

机制是 ==font-variant-numeric: tabular-nums 让每个数字占同样的宽度==。默认的成比例数字里「1」比「0」窄，字数一样但总宽度却总在变，于是右边的所有内容跟着抖。等宽数字把每个数字锁定在同宽字格里，数字变动就成了原地替换。

表格、计时器、金额、计数器——凡是数字会变的地方都该开它。

## 代码

```html
<div class="tn">
  <div class="tn-row">
    <span class="tn-label">成比例（默认）</span>
    <b class="tn-num">1,111.11</b>
  </div>
  <div class="tn-row">
    <span class="tn-label">等宽数字</span>
    <b class="tn-num tn-fixed">1,111.11</b>
  </div>
</div>
```

```css
.tn {
  width: min(360px, 82vw);
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.4);
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.tn-row {
  display: flex;
  justify-content: space-between;
  padding: 13px 16px;
  border-bottom: 1px solid rgb(60 48 30 / 0.16);
}

.tn-row:last-child {
  border-bottom: 0;
}

.tn-num {
  font-variant-numeric: proportional-nums;
}

.tn-fixed {
  /* @mechanism 每个数字占同一宽度，数字变动不再撑动整行 */
  font-variant-numeric: tabular-nums;
  color: #b4462f;
}
```

## 边界

- 它依赖**字体本身**提供 `tnum` 特性。字体不支持时规则被无声忽略——没有任何提示，只能靠眼睛看出「还是没对齐」。
- 这是**字形级**的切换：等宽数字通常比成比例数字略宽，所以开启后整行的总宽度会变一点。布局紧的地方要留意。
- 只对数字生效，不影响字母与标点。要对齐小数点还得靠等宽数字加右对齐，属性本身不管对齐。
- 与之相对的是 `oldstyle-nums`（旧式数字，有升有降），正文字体里更雅致，但**绝不能用在表格里**——它的目的就是让数字不齐。
- `font-feature-settings: "tnum"` 也能开同一个特性，但那是底层接口、会覆盖其他特性设置。优先用 `font-variant-numeric`，别两个同时写。

## 备注

- 等宽数字是「让变化的东西不引起版面变化」这条原则的一个具体落法，和防布局抖动的思路一致。
- 代码与终端里所有字体默认就是等宽的，所以在等宽字体里这个属性没有可见效果。
