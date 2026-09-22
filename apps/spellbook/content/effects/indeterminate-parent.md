---
title: 全选与半选
slug: indeterminate-parent
category: 交互
tags: [表单, 复选框, 三态]
since: 2026-10
source: 机制来自 DOM 的 HTMLInputElement.indeterminate 与 CSS :indeterminate 伪类，自行实现
when: 一组权限的子项只勾了一部分，头部那个框要显示成「半选」而不是全选或全不选
stage: plain
tier: core
---

## 描述

一张权限表：逐条勾选时，顶部的「全部权限」在三种状态之间走——全没勾是空框，勾了一部分是一道横杠，全勾上是一个勾。

复选框其实有三个状态，但 HTML 属性只有 `checked` 一个。第三个状态由 DOM 上的 `indeterminate` 属性表达，机制是 ==indeterminate 是属性而不是值：它不改变 checked，只是额外挂上「混合」这个含义==，样式侧则由 `:indeterminate` 伪类读出来。两个伪类并不互斥，所以半选时的样式必须单独写：只在 `:checked` 里画勾是不够的，半选要画的是横杠。

真正容易翻车的地方在于它的生命周期。机制是 ==浏览器在你点击该复选框时会自动把它清成 false，所以半选是个瞬态，必须每次重算==。也就是说，一旦用户点了顶部的框，`indeterminate` 就被浏览器抹掉，此时如果脚本只是把 `checked` 同步给子项而不再算一遍混合状态，那个横杠就永久消失了——直到整页刷新。所以子项变化、顶部点击、以及初始化，三条路径都必须走同一个 `sync()`。

这意味着「半选」不能像其它状态那样被 CSS 推导出来：CSS 能读 `:checked`，却算不出「我家里有 2 个子项勾了」，那是 `:has()` 也做不到的跨层计数。它只能由脚本写回 DOM，再由伪类读出来——脚本负责真相，样式负责呈现。

## 代码

```html
<!-- @mechanism 顶部框的混合状态没有 HTML 写法，只有 DOM 属性这一条通道 -->
<div class="pl">
  <label class="pl-row">
    <input class="pl-all" type="checkbox" />
    <span>全部权限</span>
  </label>
  <label class="pl-row pl-sub"><input class="pl-item" type="checkbox" checked /><span>读取</span></label>
  <label class="pl-row pl-sub"><input class="pl-item" type="checkbox" /><span>写入</span></label>
  <label class="pl-row pl-sub"><input class="pl-item" type="checkbox" /><span>删除</span></label>
</div>
```

```css
.pl {
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.pl-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  cursor: pointer;
}

.pl-sub {
  padding-left: 22px;
}

.pl-all,
.pl-item {
  /* @mechanism 关掉原生外观只是为了能画出第三种样子，形状本身不是这条的重点 */
  appearance: none;
  flex: none;
  width: 18px;
  height: 18px;
  margin: 0;
  border: 1.5px solid rgb(60 48 30 / 0.45);
  border-radius: 5px;
  background: rgb(255 255 255 / 0.6) center / 12px no-repeat;
}

.pl-all:checked,
.pl-item:checked {
  border-color: #b4462f;
  background-color: #b4462f;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.6l3 3 6-7.2'/%3E%3C/svg%3E");
}

/* @mechanism :indeterminate 与 :checked 不互斥，半选必须单独给样式，画的是横杠 */
.pl-all:indeterminate {
  border-color: #b4462f;
  background-color: #b4462f;
  background-image: linear-gradient(#fff, #fff);
  background-size: 10px 2px;
}
```

```js
const all = document.querySelector('.pl-all')
const items = [...document.querySelectorAll('.pl-item')]

function sync() {
  const on = items.filter((item) => item.checked).length
  // @mechanism 混合状态只能由脚本写回 DOM，CSS 算不出"子项里有几个勾了"
  all.indeterminate = on > 0 && on < items.length
  all.checked = on === items.length
}

items.forEach((item) => item.addEventListener('change', sync))

all.addEventListener('change', () => {
  items.forEach((item) => {
    item.checked = all.checked
  })
  // @mechanism 点击会顺手把 indeterminate 清掉，所以这里必须再算一遍把它补回来
  sync()
})

sync()
```

## 边界

- 漏掉初始化那次 `sync()`，页面加载时子项已经勾了部分（比如由服务端渲染出来），顶部框会显示成全不选——数据对不上界面。
- 顶部点击的处理函数里只写「把 checked 分发给子项」是不对的。浏览器已经先清掉了 `indeterminate`，不重算就永远回不到半选。
- `all.indeterminate = true` 不会同时把 `checked` 设成 true，两者相互独立。半选时通常希望 `checked` 为 false，所以 `sync()` 里两个都要显式赋值。
- 自定义的 `div` 版复选框要自己写 `aria-checked="mixed"`；这里用的是原生 `input`，无障碍层会自动把 `indeterminate` 映射成「混合」，不必手写——换成假元素就不成立了。
- 半选时的横杠和全选时的勾都是用同一组背景属性画的，改动时要确认三个状态都还认得出来。只靠颜色深浅区分三种状态，在色觉障碍用户那里等于只有一种。

## 备注

- 「脚本负责算，DOM 属性承载，伪类负责读」这条链适用于所有浏览器不肯替你推导的状态，`indeterminate` 只是最典型的一个。
- 同一套三态逻辑换成 `aria-checked` 就能搬到自定义控件上，思路不变。
