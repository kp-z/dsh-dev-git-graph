---
title: 故障字
slug: glitch-slice-clone
category: 动效
tags: [clip-path, keyframes, 标题, 自动, 色彩]
since: 2026-10
source: 机制来自伪元素副本与 clip-path 水平切条，自行实现
when: 标题要像信号坏掉一样抽一下，是「偶尔抽一下」而不是一直在抖
stage: dark
tier: core
---

## 描述

标题偶尔撕开一下：一条横带里的字向左偏、另一条向右偏，偏出来的是红与青两色，然后瞬间复原。绝大多数时间是完好的。

机制是 ==把同一段文字复制两份，各自裁出一条水平切片再反向偏移==。两份副本靠 `content: attr(data-text)` 拿到同样的文字，一个染红向左、一个染青向右，`clip-path: inset()` 只让它们各露出一条横带。因为副本只在横带里可见、又与原字错位，那一条看起来就是被撕开的。红青一对不是随便挑的：它就是屏幕子像素的排列顺序，人眼把这对色差自动读成「信号错位」。

节奏比配色更要紧：关键帧里大半段时间偏移量是 0，只有很短一瞬给值。持续错位是「坏了」，偶尔错位才是「故障」。这也是它跟扫描线、闪烁这类效果的分界——故障是一个事件，不是一种状态。同理，页面上有好几个故障字时它们不该一起抽：周期一样会让它们整齐得像编排过的，所以周期与两个副本的错开量都该是随机的。

## 代码

```html
<!-- @mechanism 真文案放在属性上，两个伪元素副本靠 content: attr() 复制同一段字 -->
<h2 class="glitch" data-text="信号坏了">信号坏了</h2>
```

```css
.glitch {
  position: relative;
  margin: 0;
  font: 700 34px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.02em;
  color: #efe9dc;
}

.glitch::before,
.glitch::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  white-space: nowrap;
  /* @mechanism 副本只在一条横带里显形，那条横带就是被撕开的地方 */
  animation: glitch-jump var(--cycle, 2.6s) steps(1, end) infinite;
}

.glitch::before {
  --dx: -4px;
  color: #ff3d6e;
  animation-delay: var(--delay-a, -0.4s);
}

.glitch::after {
  --dx: 4px;
  color: #2ee6d6;
  /* @mechanism 两个副本错开一点启动，红与青才不会同时偏——同时偏就成了整体位移 */
  animation-delay: var(--delay-b, -0.47s);
}

@keyframes glitch-jump {
  /* @mechanism 大部分时间偏移为 0：偶尔错位才是故障，一直错位就是花屏 */
  0%, 84%, 100% {
    translate: 0 0;
    clip-path: inset(42% 0 52% 0);
  }
  86% {
    translate: var(--dx) 0;
    clip-path: inset(10% 0 78% 0);
  }
  90% {
    translate: calc(var(--dx) * -1) 0;
    clip-path: inset(62% 0 22% 0);
  }
  93% {
    translate: 0 0;
    clip-path: inset(36% 0 58% 0);
  }
}
```

```js
// @mechanism 周期与错开量都写成变量：同页多个故障字才不会整齐地一起抽
const glitch = document.querySelector('.glitch')
if (glitch) {
  const cycle = 1.8 + Math.random() * 2.4
  glitch.style.setProperty('--cycle', cycle.toFixed(2) + 's')
  // 两个副本的负延迟差得很小，红与青才是「错位」而不是「各走各的」
  glitch.style.setProperty('--delay-a', (-Math.random() * cycle).toFixed(2) + 's')
  glitch.style.setProperty('--delay-b', (-Math.random() * cycle - 0.07).toFixed(2) + 's')
}
```

## 边界

- 副本文字来自属性，属性值与正文必须严格一致。改文案只改了一处时，会看到两段错位的字叠在一起——那是「重影」，不是故障。
- 副本是绝对定位并 `inset: 0` 覆在原文上，行高、字距、字体任何一项不一致，两块字就会整体错开。这个效果只适合一行。
- 切片的百分比相对整个元素高度，多行文本时那条横带会横穿所有行。多行场景要按行拆成独立的元素。
- 伪元素里的 `attr()` 内容是生成内容，读屏软件对它的处理各引擎不一致，可能把整句读两遍。最省事的做法是副本一律标 `aria-hidden`，或者干脆用装饰性的无意义文字。
- 动画里偏移只出现几个百分点的时间，节奏一旦调长，就从「故障」退化成「花屏」。`steps(1, end)` 也必须是硬跳——换成默认缓动后偏移是滑过去的，看起来像卡片晃动。
- 红青在深底上成立，白底上要么看不见要么像套印不准。浅底应当换成深灰加浅灰的错位。

## 备注

- 同一招可以只做「色差」不做位移：两个副本不裁切片、偏移一两个像素，就得到暗角很轻的色散感，适合做按钮的按下反馈。
- 把 `--dx` 从固定值改成随机值，就从「信号故障」变成「机械抖动」。
