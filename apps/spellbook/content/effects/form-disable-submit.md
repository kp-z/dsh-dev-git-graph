---
title: 表单无效时才提示提交
slug: form-disable-submit
category: 交互
tags: [表单, 校验, has]
since: 2026-09
source: 机制来自 CSS Selectors 的 :has(:user-invalid)，自行实现
when: 提交按钮不该在用户还没动手时就变灰
stage: plain
tier: candidate
---

## 描述

表单刚打开时按钮一切正常；用户真的填错了，提示才出现。

机制是 ==用 :has() 从表单整体判断「里面有没有出错的字段」==，于是按钮的状态变成纯 CSS。关键是选 `:user-invalid` 而不是 `:invalid`——后者在页面一加载就把空必填项算作非法，按钮一开始就是灰的。

这里体现的是同一条原则：**用浏览器的状态，但要挑语义正确的那一个**。

## 代码

```html
<form class="fd" novalidate>
  <label class="fd-field">
    邮箱
    <input class="fd-input" type="email" required placeholder="name@example.com" />
  </label>
  <p class="fd-hint">填错之后，按钮才会给出提示样式。</p>
  <button class="fd-submit" type="submit">提交</button>
</form>
```

```css
.fd {
  display: grid;
  gap: 12px;
  width: min(340px, 80vw);
  padding: 20px 22px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.42);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.fd-field {
  display: grid;
  gap: 6px;
  font-weight: 500;
}

.fd-input {
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.34);
  background: rgb(255 255 255 / 0.66);
  font: 400 15px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

.fd-input:user-invalid {
  border-color: #b4462f;
  background: rgb(180 70 47 / 0.08);
}

.fd-hint {
  margin: 0;
  color: rgb(28 26 23 / 0.58);
}

.fd-submit {
  padding: 12px;
  border: 1px solid rgb(60 48 30 / 0.34);
  background: rgb(60 48 30 / 0.1);
  font: 500 15px/1 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
}

/* @mechanism 从表单整体判断有没有出错字段 */
.fd:has(:user-invalid) .fd-submit {
  border-color: rgb(180 70 47 / 0.6);
  background: rgb(180 70 47 / 0.12);
  color: #8d3524;
}
```

## 边界

- 用 `:invalid` 会让表单**一打开按钮就是异常态**（空必填项已经非法）。要用 `:user-invalid`——它多一个「用户是否动过」的条件。
- 这里只改样式、**不禁用**按钮。用 `pointer-events: none` 挡不住键盘的 Enter 提交；真要禁用得用 `disabled` 属性，而那只能由 JS 控制。
- 禁用提交按钮本身有可访问性问题：键盘用户看到按钮灰着却不知道哪里错了。更好的做法是允许提交，然后明确指出错误。
- `:has()` 在旧浏览器上整条规则被丢弃，按钮就一直是正常态——这个降级方向是安全的，可以接受。
- 表单有效性只在字段值变化时重算，所以提示出现会有极短的延迟。
- `novalidate` 关掉了浏览器的原生气泡提示。想要原生提示就别加它，两者可以共存。

## 备注

- 同一条规则可以顺手把错误汇总区显示出来：`.fd:has(:user-invalid) .fd-errors { display: block }`。
- 「不阻塞提交、只指出错误」通常比「禁用按钮」体验好，因为它不会让用户猜。
