---
title: 自绘复选框与单选钮
slug: custom-checkbox-radio
category: 交互
tags: [表单, 控件, appearance]
since: 2026-10
source: 机制来自 CSS 的 appearance 属性与 :checked 伪类，自行实现
when: 原生控件太素、又不想用 div 假装一个复选框，怕丢掉键盘和表单提交值
stage: plain
tier: core
---

## 描述

复选框和单选钮换成自己的样子：一个描边方块，选中时填色、露出一个勾；单选钮换成圆点。

机制是 ==appearance: none 只抹掉浏览器对控件的绘制，不抹掉它的语义、键盘操作与表单值==。常见做法是拿 `div` 加点击事件自己「画」一个复选框，那要付出三笔代价：Tab 停不上去、空格不切换、提交时表单里没有这个名字值对，无障碍树里也没有选中状态。`appearance: none` 走的是相反的路——还是原来那个 `input`，浏览器只是不再画它，别的行为原封不动。

选中与否交给 ==:checked 伪类== 去读，它描述的是控件自己的状态，跟你打算怎么画完全无关。勾用什么手段画出来其实是次要选择：内联 SVG 背景图最稳，`::before` 在部分引擎上对 `input` 这种替换元素支持不一。

这样做的价值在于尺寸、圆角、过渡能和页面其余部分共用同一套尺度，而语义一点没让出去。要注意的是别把 input 真的隐藏掉——`display: none` 会把焦点一起弄丢，`opacity: 0` 又不占位；让它保持一个可点击、可聚焦的尺寸，视觉全由背景与边框承担即可。

## 代码

```html
<!-- @mechanism 语义留在 input 上，label 负责把点击面积扩到整行文字 -->
<label class="cb">
  <input class="cb-input" type="checkbox" checked />
  <span>接收更新</span>
</label>

<label class="cb">
  <input class="cb-input" type="radio" name="plan" />
  <span>按年付费</span>
</label>
```

```css
.cb {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin: 0 22px 10px 0;
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
}

.cb-input {
  /* @mechanism 只关闭绘制，键盘、label 关联与提交值都留在元素上 */
  appearance: none;
  flex: none;
  width: 19px;
  height: 19px;
  margin: 0;
  border: 1.5px solid rgb(60 48 30 / 0.45);
  border-radius: 5px;
  background: rgb(255 255 255 / 0.6) center / 13px no-repeat;
  transition: background-color 0.15s, border-color 0.15s;
}

/* @mechanism 勾是内联 SVG，随 :checked 出现；不必依赖 input 上的 ::before */
.cb-input:checked {
  border-color: #b4462f;
  background-color: #b4462f;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.6l3 3 6-7.2'/%3E%3C/svg%3E");
}

/* @mechanism 单选钮不用图片：圆角加一层径向渐变就是那个点 */
.cb-input[type="radio"] {
  border-radius: 50%;
}

.cb-input[type="radio"]:checked {
  background-color: #b4462f;
  background-image: radial-gradient(circle, #fff 0 3px, transparent 3.5px);
}

.cb-input:focus-visible {
  outline: 2px solid #b4462f;
  outline-offset: 2px;
}
```

## 边界

- `display: none` 会连键盘焦点一起隐藏，Tab 再也停不到这个控件上。要「看不见但还在」，用 `opacity: 0` 加足够的尺寸，或干脆像上面这样把它画出来。
- 别指望在 `input` 上写 `::before` 画勾：`input` 是替换元素，各引擎对它的伪元素渲染支持不一致，同一个页面在 Chrome 和 Safari 上可能一个有一个没有。
- 自己画之后，`focus-visible` 的焦点环也一并没了——原生外观里它本来由浏览器提供。必须补上自己的 `:focus-visible` 规则，否则键盘用户彻底看不到自己停在哪。
- 内联 SVG 里的颜色写死在 data URI 里，改主题色要改两处。想让它跟随 `currentColor`，得改用 `mask` 而不是 `background-image`。
- 改了尺寸和边框就意味着接管了「控件在整行里的对齐」。多行场景里要自己保证每行控件同宽，否则文字起始位置会参差。

## 备注

- 同一套机制能直接搬去做开关、星级评分、选项卡——共同点是「状态由元素自己持有，样式只是它的投影」。
- 半选（`indeterminate`）是第三个状态，它不由 `:checked` 表达，见「全选与半选」那条。
- 如果你只想换颜色、不想换形状，别走这条路：一行 `accent-color: #b4462f` 就能让复选框、单选钮、滑杆、进度条一起染上品牌色，代价是形状仍然归浏览器管。先问清需求是「换色」还是「换形态」，两者的成本差一个量级。
