---
title: 打字机的光标
slug: typewriter-caret
category: 动效
tags: [keyframes, easing, 正文, 自动]
since: 2026-10
source: 机制来自 CSS Animations 的动画重启与 step-end 硬切换，自行实现
when: 一段文字要逐字打出来，光标得像真人一样「打的时候不闪、停笔才闪」
stage: plain
tier: core
---

## 描述

一个字一个字地用打字机敲出来，末尾跟一根竖条。竖条在打字的全过程里是恒亮的，敲完最后一个字才开始一闪一闪。

机制是 ==光标是独立的一层，它的闪烁与打字进度是两条时钟，打字时必须把闪烁关掉==。光标 1s 闪一次、文字三秒打完——这两件事本来毫无关系。真人在打字时手一直在动，光标就是实心的；只有停笔了，闪烁才有意义。所以脚本每打一格就主动把闪烁关掉，停笔那一刻再交还给 CSS。反过来，如果光标只是文字的 `border-right`，它不但会随着文字变宽一路向右爬，还会自顾自地按自己的节拍闪，看起来像机器在刷屏而不是人在打字。

闪烁本身也要求一次硬切换：关键帧在 50% 与 50.01% 两处写相邻的色标，明暗是跳过去的。用普通的透明度补间得到的是呼吸灯——那是「慢速淡入淡出」，没有光标那种干脆。打字间隔则用递归 `setTimeout` 而不是 `setInterval`：定时器会把回调攒起来，切走标签页再回来时整段字会一瞬间补完；递归写法天然不会。

## 代码

```html
<!-- @mechanism 光标是与文字分开的元素：它不参与文字宽度的增长，所以不会被挤着往右走 -->
<p class="tw" id="sb-tw">
  <span class="tw-text"></span><span class="tw-caret" aria-hidden="true"></span>
</p>
```

```css
.tw {
  display: flex;
  align-items: baseline;
  font: 400 17px/1.8 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #e9e4d8;
}

.tw-text {
  white-space: pre;
}

.tw-caret {
  /* @mechanism 光标自己有一条时钟（1.05s），与打字进度毫无关系 */
  width: 9px;
  height: 1.05em;
  margin-left: 1px;
  background: #d9a441;
  animation: tw-blink 1.05s step-end infinite;
}

.tw.is-typing .tw-caret {
  /* @mechanism 打字期间把闪烁整个摘掉，光标变成恒亮的实心条 */
  animation: none;
  opacity: 1;
}

/* @mechanism 50% 与 50.01% 两处相邻色标 = 硬切换，不是呼吸灯 */
@keyframes tw-blink {
  0%,
  50% { opacity: 1; }
  50.01%,
  100% { opacity: 0; }
}
```

```js
const TYPED = '机制要能迁移，例子只是它的一次落地。'
const text = document.querySelector('#sb-tw .tw-text')
const box = document.getElementById('sb-tw')

let i = 0
const step = () => {
  text.textContent = TYPED.slice(0, ++i)
  if (i < TYPED.length) {
    // @mechanism 手在动的时候，光标不该闪：先关掉闪烁再排下一格
    box.classList.add('is-typing')
    // 每格耗时略随机，才不像节拍器在打拍子
    setTimeout(step, 80 + Math.random() * 70)
    return
  }
  // @mechanism 停笔才把闪烁交还 CSS；此时关键帧从 0 起算，光标从实心开始闪
  box.classList.remove('is-typing')
}
step()
```

## 边界

- 光标写成文字的 `border-right`、或者干脆用一个 `|` 字符，就会跟文字共用一套节奏：要么一直在闪（不像人在打），要么完全不动（看不出是光标）。它必须是独立的一层。
- 打字期间被摘掉闪烁，就等于放弃了「还在活动」的提示。停笔后必须真的让动画重新开始——`animation: none` 再置回空串可以，只把 `opacity` 改回去不行，那样动画不会重启，光标会一直亮着。
- `setInterval` 在标签页被节流后攒下的回调会一次性补完，现象是回来时整句话已经打完了。递归 `setTimeout` 或 `rAF` 加时间戳都没有这个问题。
- 每格都替换文本节点，长文案上的开销并不小。真实站点常用另一种做法：全文一开始就放进 DOM，只动画一个遮罩——这样复制和页面内搜索仍然拿得到完整句子，而这里只能复制到已经打出来的部分。
- 没有 `prefers-reduced-motion` 兜底时，敏感人群看到的是持续重排的一段文字，应当直接显示整句。

## 备注

- 「进行中恒亮、结束才闪」这套双时钟可以搬去任何进行态：录音、上传、录制中。
- 光标用一块 `background` 而不是管道字符，好处是它的宽度与所用字体无关，换字体不会跑版。
