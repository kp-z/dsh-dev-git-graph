---
title: 开关只读一次状态
slug: toggle-switch
category: 交互
tags: [custom-property, appearance, 开关, 表单, 点击]
since: 2026-10
source: 机制来自 CSS 自定义属性与 :checked 的组合，自行实现
when: 开关一多，轨道、滑块、文字、图标都要跟着切换，选择器越写越乱
stage: plain
tier: core
params:
  - { name: dur, label: 滑动用时, type: range, min: 0.05, max: 0.8, step: 0.05, default: 0.22, unit: s }
---

## 描述

一个开关：关着是灰轨道加左侧圆钮，打开时轨道染上强调色、圆钮滑到右边。

麻烦通常不在画出开关，而在于「打开」这个状态要影响好几处——轨道底色、圆钮位移、标签文字颜色、可能还有旁边的小图标。直觉写法是在每个选择器里都写一遍 `.input:checked ~ ...`，于是 `:checked` 这个事实被重复了四遍，以后想换判定条件就要全改。

机制是 ==把 :checked 只读一次，把结果写进一个自定义属性，其余规则全部读那个属性==。变量会沿 DOM 往下继承，所以只要在开关容器上定义一次 `--on`，轨道、滑块、文字都是它的下游。状态的真相只有一处，样式层再多也不会各说各话。

圆钮的位移从同一个 `--on` 算出来（`calc(var(--on) * 距离)`），轨道则把开启色叠在关闭色上面、只用 `--on` 调上层的不透明度。两者共享一个变量，就不会出现「钮滑到头了但底色还没变」这种两个属性各自过渡造成的错位。

可调的主要是滑动时长与回弹曲线——开关是高频点击的控件，短一点、带一点回弹手感最稳。行程距离不是自由参数：它等于轨道宽减钮宽减两侧内边距，改了尺寸就得同步改这个数。

## 代码

```html
<!-- @mechanism role="switch" 让读屏器把它念成开关而不是复选框 -->
<label class="sw">
  <input class="sw-input" type="checkbox" role="switch" checked />
  <span class="sw-track"><span class="sw-knob"></span></span>
  <span class="sw-text">自动同步</span>
</label>
```

```css
.sw {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
}

.sw-input {
  /* @mechanism 外观抹掉、尺寸归零，但它仍然可聚焦，空格仍然切换 */
  appearance: none;
  width: 0;
  height: 0;
  margin: 0;
}

.sw-track {
  /* @mechanism 全开关唯一的状态源：关＝0，开＝1，后面的样式只读它 */
  --on: 0;
  width: 46px;
  height: 26px;
  padding: 3px;
  border-radius: 999px;
  background-color: #ddd6ca;
  /* @mechanism 开启色叠在关闭色上面，用 --on 当它的 alpha，一个元素完成两色过渡 */
  background-image: linear-gradient(rgb(180 70 47 / var(--on)), rgb(180 70 47 / var(--on)));
  transition: background-color var(--dur, 0.22s) ease;
}

.sw-input:checked + .sw-track {
  --on: 1;
}

.sw-knob {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fffdf8;
  box-shadow: 0 1px 3px rgb(28 26 23 / 0.3);
  /* @mechanism 位移从同一个 --on 算出来，轨道与滑块不会各说各话 */
  translate: calc(var(--on) * 20px) 0;
  transition: translate var(--dur, 0.22s) cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* @mechanism 焦点环画在轨道上，因为真正可聚焦的 input 已经没有尺寸 */
.sw-input:focus-visible + .sw-track {
  outline: 2px solid #b4462f;
  outline-offset: 3px;
}
```

## 边界

- 可聚焦的 `input` 被压成 0×0 之后，浏览器的默认焦点环也就无处可画。必须自己把它转发到可见元素上，否则键盘用户看不到焦点。
- `translate` 的行程是写死的像素数。轨道宽度一改而这里没跟着改，圆钮就会停在半路或者越出轨道——这两个数字是绑定的。
- 用 `linear-gradient` 叠 alpha 是为了让两种底色共用一个元素。若改成两个元素互相淡入淡出，就必须同时管好 `visibility` 或 `pointer-events`，否则透明的那个还会挡住点击。
- `role="switch"` 是给读屏器改念法的；漏掉它就是个普通复选框。它本身不影响任何视觉，很容易忘。
- 过渡时长对高频控件很敏感：超过约 0.3 秒会让连续点击觉得「跟不上手」，这也是把 `--dur` 默认取 0.22 秒的原因。

## 备注

- 「状态只读一次、结果下发给下游」这套写法可以直接迁移到选项卡、折叠面板、树形菜单——凡是同一个布尔值要影响多个后代的地方都适用。
- 想让开关跟随系统配色，把 `--on` 的赋值条件换成媒体查询即可，样式层一行都不用动。
