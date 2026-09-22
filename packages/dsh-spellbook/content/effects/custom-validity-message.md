---
title: 自定义校验文案
slug: custom-validity-message
category: 交互
tags: [form-validation, 表单, 错误态, 输入]
since: 2026-10
source: 机制来自 HTML 约束校验 API 的 setCustomValidity 与 validationMessage，自行实现
when: 校验规则比 minlength、pattern 能表达得更复杂，但还想用浏览器原生的提示气泡
stage: plain
tier: core
---

## 描述

验证码框里少填一位，点提交时浏览器弹出自己的气泡，上面写的是「验证码是 6 位数字」——这句话不是标在 HTML 里的，而是脚本在某个时刻交给浏览器的。

机制是 ==setCustomValidity 把文案存进浏览器持有的校验状态里，气泡与 :invalid、:user-invalid 都读同一份==。所以自定义规则不必自己画提示层：先说清「不合法」和「为什么」，剩下的呈现全部交给浏览器。这也意味着文案只有一处，不会出现气泡说一套、红字说另一套。

而它最锋利的性质是：==一旦设了非空字符串，字段就永久不合法，直到你显式把它设回空串==。`setCustomValidity('')` 不是「没设」，而是「清空」。所以任何一次校验都必须以清空开头，再按当前值重新判断；只关心出错路径、忘了清空，字段就再也不会变回合法——这是这条机制最经典的翻车方式，而且症状很怪：改对了也提交不了。

规则本身可以是任意逻辑——跨字段比对、查表、异步结果——浏览器不问你是怎么算出来的。这也是它相对 `pattern` 的价值：约束的表达力从正则一件事，扩到了全部脚本能表达的事。

## 代码

```html
<!-- @mechanism 文案不在 DOM 里，由脚本交给浏览器持有 -->
<form class="cv">
  <label class="cv-field">
    验证码
    <input class="cv-input" inputmode="numeric" placeholder="6 位数字" />
  </label>
  <p class="cv-msg" aria-live="polite"></p>
  <button class="cv-submit" type="submit">提交</button>
</form>
```

```css
.cv {
  display: grid;
  gap: 10px;
  width: min(300px, 80vw);
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.cv-field {
  display: grid;
  gap: 6px;
}

.cv-input {
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.35);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.55);
  font: 400 15px/1.4 system-ui, sans-serif;
  color: inherit;
}

/* @mechanism 样式跟 :user-invalid 走：一打开就被标红是最常见的表单事故 */
.cv-input:user-invalid {
  border-color: #b4462f;
  background: rgb(180 70 47 / 0.08);
}

.cv-msg {
  margin: 0;
  min-height: 1.6em;
  color: #b4462f;
}

.cv-submit {
  justify-self: start;
  padding: 8px 18px;
  border: 1px solid rgb(60 48 30 / 0.35);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.6);
  font: inherit;
  color: inherit;
  cursor: pointer;
}
```

```js
const form = document.querySelector('.cv')
const input = document.querySelector('.cv-input')
const msg = document.querySelector('.cv-msg')

function check() {
  // @mechanism 每次校验都必须先清空，否则上一次的错误会永久粘在这个字段上
  input.setCustomValidity('')
  const value = input.value.trim()
  if (value && !/^\d{6}$/.test(value)) input.setCustomValidity('验证码是 6 位数字')
  // @mechanism validationMessage 是取出那句话的唯一入口，自己画提示层只能靠它
  msg.textContent = input.validationMessage
}

input.addEventListener('input', check)

form.addEventListener('submit', (e) => {
  // @mechanism 不合法时浏览器在派发 submit 之前就拦下了，所以这里只在通过时才会执行
  e.preventDefault()
  msg.textContent = '校验通过'
})
```

## 边界

- 忘了 `setCustomValidity('')`，字段会永久不合法：值改对了也提交不了，气泡每次弹的都是那句旧话。任何依赖「表单是否有效」的判断也跟着全错。
- `setCustomValidity` 一设上，`:invalid` 立刻匹配——即使用户一个字都没动过，空字段本来就算不合法。所以样式必须配 `:user-invalid`，不能用 `:invalid`。
- 原生气泡的样式、位置、字体都不可定制。想自己画提示层，就用 `validationMessage` 把文案取出来渲染，同时通常会加 `novalidate` 关掉原生气泡，否则两套提示会一起出现。
- 原生校验在 **submit 事件派发之前**就拦下了不合法的表单，所以「在 submit 处理函数里统一处理错误」这条路根本走不到。要统一处理得监听每个字段的 `invalid` 事件。
- 文案会原样成为气泡内容，写太长会被截断，也不支持换行——它是一句话，不是段落。

## 备注

- 「把真相放进浏览器持有的状态，样式与提示都去读它」和 `:user-invalid`、`aria-pressed`、`indeterminate` 是同一条思路，区别只是这次真相由脚本写入。
- 跨字段规则（确认密码是否一致）要在**两个**字段上都重跑一遍校验，只监听出错的那个字段是不够的。
