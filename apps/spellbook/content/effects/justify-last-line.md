---
title: 最后一行也要两端对齐
slug: justify-last-line
category: 排版
tags: [text-align, 列表, 正文]
since: 2026-10
source: 机制来自 CSS Text 的 text-align-last，自行实现
when: 每行只有一条「标签 —— 值」的窄栏列表，想让两头都贴边
stage: plain
tier: core
---

## 描述

一份窄栏的参数清单：左边是标签，右边是值，每一行都只有一行文字。设了 `text-align: justify` 却一点反应都没有，两头还是空着。

机制是 ==`text-align: justify` 天生跳过最后一行==。理由很实在：最后一行是自然结束的，把它也拉满会在行尾凭空造出一大片空隙。而「一行只有一个行盒」的元素里，那一行同时也是最后一行，`justify` 于是完全没有可作用的对象。`text-align-last: justify` 单独对最后一行下令，把它也拉满——这才是单行元素两头贴边的正解。

为什么不用 flex 的 `justify-content: space-between`：纯文本场景里标签与值之间靠一个空格分隔（`space-between` 需要两个子元素），而且拉伸的余量会按空格的数量摊开，值长了、标签长了，观感都在同一套规则里。文字的事交给文字属性，比每一个小部件都上一个 flex 容器轻得多。

可变的只有一件事：这一行里有多少个可拉伸点。`justify` 拉伸的是**空格**，所以标签与值之间必须留一个空格；两者之间没有空格时，无从拉起的表现就是「属性明明写了，两头还是空着」。

## 代码

```html
<ul class="kv">
  <li><span>构建用时</span> <span>4 分 12 秒</span></li>
  <li><span>首字节</span> <span>86 ms</span></li>
  <li><span>产物体积</span> <span>212 KB</span></li>
</ul>
```

```css
.kv {
  width: min(320px, 80vw);
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  font: 400 14px/1.9 system-ui, sans-serif;
}

.kv li {
  /* @mechanism 最后一行也拉满 —— 单行元素的那一行就是最后一行 */
  text-align-last: justify;
  padding: 5px 10px;
  border-bottom: 1px dashed rgb(0 0 0 / 0.22);
}

.kv li span:last-child {
  color: #b4462f;
  font-variant-numeric: tabular-nums;
}
```

## 边界

- 只写 `text-align: justify` 是最常见的空操作：那一行就是最后一行。现象是「属性写了、检查器里也认，版式纹丝不动」，很容易怀疑到别处去。
- 值太长被折行时，`text-align-last: justify` 会把值的第二行也当成最后一行拉满，出现词间大洞。这种键值行要求值足够短，或者退成 `text-align: right`。
- 拉伸落点是空格。一行里有多个空格时余量被摊薄，只有一个空格时那一个空格要吃下全部余量——看起来最夸张。
- `text-align-last` 的另一个常见值是 `auto`（跟着 `text-align` 走）。写 `auto` 等于没写；它在 `text-align: justify` 的段落里不会带来任何变化。
- 中英混排时被拉开的空格会比平时宽，因为余量集中在少数几处；标签或值里再夹一个空格，余量就被分走了。

## 备注

- 目录页「章名 + 空格 + 页码」那一行也常用这招贴边，只是中间的点线还得自己用 `::after` 或下边框画出来。
- 同一元素上写 `text-align-last` 与 `text-align: justify` 并不冲突：前者只管最后一行，后者管其余行。
