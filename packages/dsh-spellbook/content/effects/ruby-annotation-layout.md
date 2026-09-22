---
title: 注音排版
slug: ruby-annotation-layout
category: 排版
tags: [ruby, line-height, 正文]
since: 2026-10
source: 机制来自 HTML 的 ruby 元素与 CSS Ruby 的 ruby-align / ruby-position，自行实现
when: 生僻字要标拼音，而且注音不能把行高顶开、也不能压到旁边的字
stage: plain
tier: core
params:
  - { name: rt, label: 注音字号, type: range, min: 0.3, max: 0.9, step: 0.05, default: 0.5, unit: em }
---

## 描述

汉字上方浮着一行小字注音，注音比本体长的时候，多出来的宽度被摊到本体上，而不是压住旁边的字。

机制是 ==ruby 是「本体 + 注音」的配对结构，浏览器按注音的宽度反过来决定本体要占多宽==。注音不是绝对定位的浮层：`<rt>` 参与行盒计算（所以行高会被抬高），而注音宽于本体时，多出来的宽度按 `ruby-align` 分配——默认居中，允许两端对齐时则摊到本体的两侧与相邻字符之间。这就是注音永远不会盖住邻字的原因。

用 `span` 加 `position: absolute` 手搓也能浮上去，但那样每一对的宽度、位置、与正文的避让都要自己算，而且注音不参与折行，长段落里会立刻穿帮。HTML 的 ruby 把「配对」这件事交给了排版引擎，这也是它存在的理由：折行只会发生在注音对之间，本体与它的注音不会被拆到两行。

注音字号做成参数是因为它是最常被调的那一格：`0.5em` 是中日文注音的传统比例，再小就没人看得清了。

## 代码

```html
<!-- @mechanism 本体与注音是配对结构，注音的宽度因此能反过来影响本体 -->
<p class="rb">
  <ruby>饕餮<rt>tāo tiè</rt></ruby>是生僻字，注音分开铺在本体上。
</p>
<p class="rb rb-spread">
  <ruby>咒语书<rt>zhòu yǔ shū</rt></ruby>的注音比本体宽，于是撑开了本体。
</p>
```

```css
.rb {
  margin: 0 0 20px;
  font-size: 26px;
  font-family: "Songti SC", "Noto Serif CJK SC", serif;
  color: #1c1a17;
}

/* @mechanism 注音字号归 rt 自己管，不写就继承本体字号 */
.rb rt {
  font-size: var(--rt, 0.5em);
  font-family: system-ui, sans-serif;
  letter-spacing: 0.02em;
  color: rgb(28 26 23 / 0.55);
}

/* @mechanism 注音宽于本体时，多出的宽度按 ruby-align 摊开而不是溢出 */
.rb-spread {
  ruby-align: space-between;
  ruby-position: over;
}
```

## 边界

- 注音会抬高行盒：`line-height` 必须容得下 rt，否则注音会和上一行叠在一起。想压回原行高只能给 ruby 负 margin 或缩小 rt，那是拿可读性换密度。
- `ruby-align` 只在注音比本体**宽**时起作用。本体更宽时它无事可做，注音默认居中——两种情况下看到的「对齐」不是同一个机制。
- 注音很长会显著撑宽一行：给长句逐字标拼音时，一行能放的字变少，段落会明显更早折行。
- `ruby-position: under` 与 `ruby-align: inter-character`（注音竖排进字与字之间）支持面窄，退化时注音会跑回上方，版面高度因此变化。
- 注音是真实文本，会被辅助技术读到；读本体还是读注音、会不会重复朗读，各家实现不一致。注音如果只是装饰，这一点要在无障碍层里单独处理。

## 备注

- 同一套配对思路在日文的振假名上更常见，但中日文的注音比例与行高补偿习惯不同，一套样式很难同时服务两种语言。
