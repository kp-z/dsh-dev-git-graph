---
title: 用户犯错了才标红
slug: user-invalid-hint
category: 交互
tags: [表单, 校验, 提示]
since: 2026-09
source: 机制来自 CSS Selectors Level 4 的 :user-invalid，自行实现
when: 表单刚打开时不要一片红，用户真的填错了才提示
stage: plain
tier: core
---

## 描述

页面一打开，空着的必填项安安静静；用户点进去又留空离开之后，它才变红提示。

机制是 ==:user-invalid 只在用户交互过、且当前值仍不合法时匹配==。`:invalid` 只问「值合法吗」——页面刚加载、用户一个字都没填，空必填项在它眼里就已经是「非法」了，于是一进来满屏红字。`:user-invalid` 多了一个「用户是否动过」的条件。

## 代码

```html
<label class="ui">
  邮箱
  <input class="ui-input" type="email" required placeholder="name@example.com" />
</label>
<label class="ui">
  必填
  <input class="ui-input" required />
</label>
<p class="ui-hint">什么都不填时它们不红；点进去再放空，才标出来。</p>
```

```css
.ui {
  display: grid;
  gap: 6px;
  width: min(420px, 84vw);
  margin-bottom: 14px;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.ui-input {
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.35);
  background: rgb(255 255 255 / 0.5);
  font: 400 15px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

/* @mechanism 用户交互过且仍不合法才匹配 */
.ui-input:user-invalid {
  border-color: #b4462f;
  background: rgb(180 70 47 / 0.08);
}

.ui-hint {
  margin: 0;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.6);
}
```

## 边界

- `:invalid` 会在页面一加载就把空必填项标红——用户还没动手就先被指责。这是最常见的表单体验事故，而 `:user-invalid` 就是为它准备的。
- 各浏览器对「何时算交互过」的判定有差异（失焦、输入过、提交过都可能触发），所以标红出现的时机会略有不同。
- 必须配 `required`、`type="email"`、`pattern` 之类的约束，否则任何值都合法，这条规则永远不会匹配。
- 只靠颜色区分是不够的：红绿色觉障碍的人分不出来。要同时给边框、图标或文字提示。
- 浏览器的原生校验气泡仍然会在提交时弹出，`:user-invalid` 只改样式，拦不住提交——真正的校验逻辑还得有。

## 备注

- `:user-valid` 是它的镜像，用来在「用户填对了」时给出正向反馈。
- 把提示文案放在 `<label>` 里而不是 `placeholder`：占位文字一输入就消失，用户回头看不到要求。
