---
title: 竖排文字
slug: vertical-text
category: 排版
tags: [竖排, 书写模式, 东亚]
since: 2026-09
source: 机制来自 CSS Writing Modes 的 writing-mode，自行实现
when: 要一行从右往左竖着排的字，像旧书封面或牌匾
stage: dark
tier: core
---

## 描述

文字从上往下排，一行行从右往左走，整块像一块匾。

机制是 ==writing-mode: vertical-rl 把整条排版轴转 90 度==。它转的不是这几个字，而是**整个书写方向**：行内轴变成从上到下，块轴变成从右到左。所有依赖轴的属性都跟着变——`width` 量的是行宽，`height` 量的是行数，直觉完全反过来。

这也是为什么东亚文字的竖排不能靠 `transform: rotate` 凑：那样标点不会转正、拉丁字母会躺着。

## 代码

```html
<div class="vt">咒语书　前端效果速查</div>
```

```css
.vt {
  /* @mechanism 换书写模式，不是旋转文字 */
  writing-mode: vertical-rl;
  text-orientation: mixed;
  width: min(340px, 74vw);
  max-height: 300px;
  padding: 16px 18px;
  border: 1px solid rgb(217 164 65 / 0.45);
  background: rgb(0 0 0 / 0.24);
  font: 500 22px/1.6 "Songti SC", "SimSun", serif;
  letter-spacing: 0.18em;
  color: #f0ead9;
}
```

## 边界

- 它改变的是**尺寸与轴的语义**，不只是视觉。原来的 `width` 现在表示一行的长度，`height` 表示能放几行；写响应式时所有尺寸要重新想。
- `text-orientation: upright` 会把拉丁字母也一个个立起来，读起来很别扭。中英混排一般用 `mixed`，让西文保持侧躺。
- flex 与 grid 的主轴会跟着书写模式走。`flex-direction: row` 在这里变成从上到下排列——布局不只是「看起来转了」。
- 两位数字要占一格（竖排数字的正确排法）得靠 `text-combine-upright: digits 2`，不写的话「26」会各占一格竖起来。
- 竖排字体依赖字体的竖排字形。系统宋体通常没问题，无衬线字体常常直接退化成横排字形。

## 备注

- 标点的竖排压缩（句号挪到右上角）由字体与浏览器共同处理，用对字体就自动对。
- 做牌匾时配 `letter-spacing` 拉开字距，比加粗更接近刻字的感觉。
