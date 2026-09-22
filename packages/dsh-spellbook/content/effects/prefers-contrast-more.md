---
title: 用户要求更强的对比度
slug: prefers-contrast-more
category: 交互
tags: [media-query, 正文, 提示, 卡片]
since: 2026-10
source: 机制来自 Media Queries Level 5 的 prefers-contrast，自行实现
when: 有人把系统调成了「提高对比度」，页面上的浅灰细节应该变成实打实的深色
stage: plain
tier: core
---

## 描述

用户在系统里选了「提高对比度」之后，那些浅灰的辅助文字、半透明的分隔线、以及淡淡的边框，全都换成了实打实的深色与更粗的线。

机制是 ==`prefers-contrast` 报的是「用户想要多少对比」，与明暗模式是**两个独立**的维度==。所以它不是 `prefers-color-scheme` 的一个分支：一个用暗色模式的用户同样可能要求更高对比度，此时该做的是把灰字从 `#8a7f70` 加深到 `#cfc6b6`，而不是把它变黑。

这套查询最值得改的是三类东西：**半透明**（把 `rgb(... / 0.4)` 换成不透明）、**浅色**（把灰色文字加深）、**细线**（`border-width` 从 1px 提到 2px）。三者共同的作用是让「靠明暗差别暗示的层次」变成「靠明确边界表达的层次」——这正是对比度敏感的用户需要的信息载体转换。

## 代码

```html
<p class="hint">辅助说明文字（浅灰）</p>
<div class="card">卡片边框（很淡）</div>
```

```css
.hint {
  color: #8a7f70;
  font: 400 13px/1.6 system-ui, sans-serif;
}

.card {
  padding: 14px;
  border: 1px solid rgb(217 164 65 / 0.28);
  background: rgb(217 164 65 / 0.06);
  color: #f0ead9;
}

@media (prefers-contrast: more) {
  /* @mechanism 把「靠透明度暗示的层次」换成不透明与粗线，这是信息载体的转换 */
  .hint { color: #cfc6b6; }
  .card {
    border-width: 2px;
    border-color: #d9a441;
    background: #1b1622;
  }
}

@media (prefers-contrast: less) {
  /* @mechanism 也有人要求更柔和；这一档不是「没要求」，别当成默认什么都不做 */
  .hint { color: #6f6659; }
}
```

## 边界

- 取值是 `more` / `less` / `custom` / `no-preference` 四档，各有各的含义。`less` 不是「关闭」，`custom` 是「用户用系统里的选择器细调过」。只写 `more` 而不管 `less`，等于把一半的人当成默认。
- 提高对比度**不等于**把文字变黑。在暗色主题下 `#cfc6b6` 与把文字变纯白是两种观感：纯白在暗底上会产生光晕（halation），对某些视觉敏感的人反而更难读。提高对比度该提的是「前景与背景的差距」，同时避免走极端。
- 浅色模式下提高对比度的方向与深色模式相反，两套值要分开写（配合 `prefers-color-scheme`），不能共用一组颜色。
- 这条查询在页面加载后改变系统设置时**会**重新评估，样式会跟着切，所以不要在这套规则里做有副作用的假设（比如「只会生效一次」）。
- 它不改变你的颜色对比度是否达标——它只是用户表达需求的一个信号。真正的对比度还是要按 WCAG 的比例去测，两者是「声明」与「事实」的关系。
