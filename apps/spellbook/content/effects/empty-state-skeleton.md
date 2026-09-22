---
title: 让 DOM 自己说还没数据
slug: empty-state-skeleton
category: 动效
tags: [骨架屏, 空状态, 伪类]
since: 2026-10
source: 机制来自 CSS Selectors 的 :empty 伪类，自行实现
when: 列表还没数据时要有骨架，但又不想为此维护一个 isLoading 状态
stage: plain
tier: core
---

## 描述

列表是空的时候显示两块骨头，一旦有了一条数据，骨架自己消失。

机制是 ==把「没有子节点」这个事实直接当作加载态，用 :empty 选中它==。渲染层不需要知道「加载中」这个布尔量：有内容就渲染内容，没内容就显示骨架——**状态是从 DOM 结构里推出来的，而不是另存一份**。数据到达时只管 `append`，骨架消失、内容出现是同一个动作的两个面，不可能出现「数据到了骨架还在」或「骨架没了数据还没到」的中间态。

骨架必须是伪元素，这一点是刻意的：`:empty` 判定的是「有没有子节点」，伪元素不是节点，所以骨架自己不会把列表撑成「非空」，条件是自洽的。要注意反过来的坑也很硬：HTML 里标签之间的换行和空格**也是子节点**，写成 `<ul>` 换行 `</ul>` 就已经不是空的了。所以这个列表必须写成标签紧贴，或者干脆由脚本创建。

## 代码

```html
<!-- :empty 看的是子节点，所以这两个标签之间不能有任何换行或空格 -->
<ul class="es" id="sb-es"></ul>
<button class="es-toggle" id="sb-es-toggle" type="button">填充 / 清空</button>
```

```css
.es {
  display: grid;
  gap: 10px;
  width: min(340px, 80vw);
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
}

/* @mechanism 骨架是伪元素而不是子节点，所以它不会破坏 :empty 的判定 */
.es:empty::before,
.es:empty::after {
  content: "";
  border-radius: 6px;
  background: rgb(60 48 30 / 0.15);
}

.es:empty::before {
  height: 64px;
}

/* 第二块窄一点，看起来才像一张卡片加两行字 */
.es:empty::after {
  height: 34px;
  width: 62%;
}

.es-item {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid rgb(60 48 30 / 0.22);
  font: 400 14px/1.5 system-ui, sans-serif;
}
```

```js
const list = document.getElementById('sb-es')

const items = '<li class="es-item"><b>数据到了</b>'
  + '<span>骨架自己让位，没有 isLoading 布尔量。</span></li>'
  + '<li class="es-item"><b>再追加一条</b>'
  + '<span>只要列表不是空的，骨架就不会出现。</span></li>'

document.getElementById('sb-es-toggle').addEventListener('click', () => {
  // @mechanism 只增删真实节点，"要不要显示骨架"由 :empty 从结构里推出来
  list.innerHTML = list.children.length ? '' : items
})
```

## 边界

- **最容易踩的坑**：写成 `<ul>\n</ul>`（标签之间有换行）时，那个换行就是个文本子节点，`:empty` 永远不成立，骨架永远不出现，而且不报任何错。
- `:empty` 判断的是「有没有子节点」，不是「内容是否可见」。用 `display: none` 藏起来的子元素照样算数——想用显隐控制骨架，这一招不适用。
- 「请求成功但没有条目」和「还没加载好」在 DOM 上是同一个样子，`:empty` 分不出来。要区分必须引入额外状态。
- 用 `innerHTML = ''` 清空是可靠的；用 `innerHTML = ' '`（一个空格）会让 `:empty` 失效，这是同一个换行坑的变体。
- 骨架只能是一块块矩形（伪元素，最多两个），头像圆形、多行文本的精细形状做不出来。
- 骨架块没有扫光。要 shimmer 就得有独立的定位层，那还是回到子元素方案。

## 备注

- 同一招可以给 `tbody:empty`、下拉列表 `ul:empty`、评论区容器用，凡是「空=还没好」的容器都合适。
- 判断元素是否真为空用 `el.childNodes.length === 0`，不要用 `textContent === ''`——后者看不出一堆空格和一整棵子树。
