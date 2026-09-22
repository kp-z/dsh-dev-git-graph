---
title: 打印样式是做减法
slug: print-stylesheet-shed
category: 布局
tags: [打印, 分页, 媒体查询]
since: 2026-10
source: 机制来自 CSS 分页媒体与 @page 规则，自行实现
when: 页面要能被干干净净地打印或存成 PDF，而不是把导航栏也一起印出来
stage: plain
tier: core
---

## 描述

屏幕上是一整页带导航、带搜索框、带侧栏的界面，打印出来只剩正文，链接后面带着地址，章节不会从中间被切断。

机制是 ==打印样式是「减去」而不是「重做」==。屏幕上那套布局已经是对的，打印时只需要把交互件卸掉（`display: none`）、把不该断的地方钉住、再补一点纸面才需要的信息。写一套全新的打印布局是白费力气，还会与屏幕版走散。

真正需要新写的只有几处：`break-inside: avoid` 让一个卡片、一行表格不被拆到两页；`break-after: page` 在章节之间强制翻页；链接地址是用 `a[href]::after` 的 `content: attr(href)` **补**出来的——屏幕上不需要，纸面上没有它链接就丢了。

## 代码

```html
<nav class="nav">导航（不该被印出来）</nav>
<button class="act">操作按钮（不该被印出来）</button>

<article class="card">
  <h2>一节内容</h2>
  <p>详见 <a href="https://example.com/doc">这份文档</a>。</p>
</article>
```

```css
body { font: 400 15px/1.7 Georgia, serif; }

.card { padding: 16px; border: 1px solid #d8cfc0; }

@media print {
  /* @mechanism 打印样式做减法：卸掉交互件，剩下的版式照旧 */
  .nav,
  .act { display: none; }

  /* @mechanism 一个卡片不该被拆到两页上 */
  .card { break-inside: avoid; }

  /* @mechanism 纸面上点不动链接，地址得用 ::after 补出来 */
  a[href]::after { content: ' (' attr(href) ')'; font-size: 11px; color: #555; }

  /* @mechanism 浏览器默认会把背景刷白；要保住底纹必须显式声明 */
  .card { print-color-adjust: exact; -webkit-print-color-adjust: exact; }

  @page { margin: 18mm 16mm; }
}
```

## 边界

- 浏览器**默认不打印背景色与背景图**（除非用户自己在打印对话框里勾了）。靠背景色表达的信息在纸上会整片消失，`print-color-adjust: exact` 能让它保住，但也会让满屏色块原样印出来、费墨。两件事要分别决定。
- `break-inside: avoid` 只对**能装进一页**的元素有效。一个比一页还高的卡片，浏览器只能照断，规则会被忽略——现象是「同一条规则对短卡片生效、对长卡片不起作用」。
- `a::after` 补 URL 会让每个链接都变长，正文里链接密集时会明显撑乱行。通常要排除导航区与页脚，只对正文里的链接补。
- `@page` 的边距只在**分页**上下文生效，屏幕上看不到任何变化，所以这一段基本无法在浏览器里直接验证——要么打印预览，要么导出 PDF 看。
- 深色主题的页面直接打印会得到一大片黑（如果 `print-color-adjust: exact`）或是白纸黑字但对比度丢失（如果没写）。打印样式里通常要把配色显式改回浅色，这一步不能靠「浏览器会处理」。
