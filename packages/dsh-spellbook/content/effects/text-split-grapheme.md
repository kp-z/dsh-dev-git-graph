---
title: 逐字入场的拆分
slug: text-split-grapheme
category: 排版
tags: [keyframes, custom-property, 标题, 入场]
since: 2026-10
source: 机制来自 Intl.Segmenter 的字素簇切分，自行实现
when: 要把一句话拆成单字再逐个入场，而句子里有 emoji 或带声调符号的字母
stage: plain
tier: core
params:
  - { name: stagger, label: 字间隔, type: range, min: 0, max: 160, step: 5, default: 45, unit: ms }
---

## 描述

一句话里的每个字依次浮上来，前面的先落地，后面的跟上。这件事本身不难，难的是「一个字」到底是什么。

机制是 ==按字素簇切分，而不是按 UTF-16 码元==。`text.split('')` 切开的是编码单位：`👨👩👧` 这种家庭 emoji 由好几个码元加零宽连接符组成，按码元拆会把一家人拆成红发阿姨加男孩；带声调的 `é` 有预组合与合成两种写法，合成的那种会被拆成字母加一个孤立的声调符号。人眼看到的字形边界才是动画该停顿的地方，而 `Intl.Segmenter` 带 `granularity: 'grapheme'` 是浏览器里唯一负责这件事的原生 API——零依赖，也不用自己写正则去猜。

拆分之后还有一个几乎必然踩到的坑：每个字都成了 `inline-block`，而 `inline-block` 会把空白折叠成零宽。源文本里那些空格于是全部消失，整句粘成一坨。所以空白字符必须单独认出来并给它一个显式宽度。

## 代码

```html
<!-- @mechanism 交给脚本拆的原文：含组合字符与家庭 emoji，按码元拆必然拆坏 -->
<p class="gx" id="sb-gx">排版里的 é 与 👨‍👩‍👧 都不该被拆坏</p>
```

```css
.gx {
  width: min(430px, 86vw);
  margin: 0;
  font: 400 19px/2 system-ui, sans-serif;
  color: #efe9dc;
}

.gx .ch {
  display: inline-block;
  /* @mechanism 序号换算成延迟：整段只有一套关键帧，节奏靠 calc 推出来 */
  animation: gx-rise 0.7s cubic-bezier(0.2, 0.9, 0.25, 1) backwards;
  animation-delay: calc(var(--i) * var(--stagger, 45ms));
}

.gx .sp {
  /* @mechanism inline-block 把空白折成零宽，空格必须自己带宽度 */
  width: 0.3em;
}

@keyframes gx-rise {
  from {
    opacity: 0;
    translate: 0 0.5em;
  }
}
```

```js
const el = document.getElementById('sb-gx')
const source = el.textContent
el.textContent = ''

// @mechanism 字素簇切分：emoji 与组合字符不会被切成半个
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

let i = 0
for (const { segment } of segmenter.segment(source)) {
  const span = document.createElement('span')
  span.textContent = segment
  // @mechanism 空白单独给类，靠 CSS 补回被折叠掉的宽度
  span.className = /^\s$/.test(segment) ? 'ch sp' : 'ch'
  span.style.setProperty('--i', String(i++))
  el.append(span)
}
```

## 边界

- 逐字 `inline-block` 之后，英文单词也成了可断的碎片：一句 `transform` 会被拦腰断到两行去。原文的自然断行规则没有了，窄屏上会折出很难看的位置。
- 拆分会把每个字变成独立文本节点，屏幕阅读器可能逐字念或念出停顿。要给它 `aria-label` 保留整句、再把拆出来的字全部隐藏，否则视障用户听到的是被剁碎的一句话。
- `Intl.Segmenter` 拿不到时的降级路径如果写回 `split('')`，就会在 emoji 上翻车——降级要不要留、还是干脆不做动画，是个取舍。旧引擎上根本没有这个 API。
- 文案一旦被脚本或框架改动，拆出来的 span 就全没了，必须重跑拆分。所以这个做法适合静态标题，不适合高频更新的文本。
- 延迟用 `calc(var(--i) * 间隔)` 推出来，字多时末尾那个字的等待会很长；几十个字以上要改成「按行分组」或给延迟设上限，否则最后几个字像是忘了动。
- 行内元素的 `translate` 不占据布局空间，逐字上浮时不会推开周围内容——这正是想要的，但也意味着它永远不会触发回流，别指望用它做布局动画。

## 备注

- 同一套拆分结果可以复用到别处：逐字悬停、随机抖动、按字复制。拆一次，多处消费。
- 字素簇的边界也就是「打字机该停顿的地方」，所以打字类效果要按字计数时，也该用同一套切分。
