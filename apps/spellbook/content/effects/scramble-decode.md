---
title: 乱码解码
slug: scramble-decode
category: 动效
tags: [乱码, 解码, 定时器]
since: 2026-10
source: 机制来自逐字符解锁阈值的定时刷新，自行实现
when: 一段文字要像被终端解出来，从噪声慢慢定形
stage: dark
tier: core
---

## 描述

一行字先是乱码，然后一个字一个字地定下来，最后露出完整的句子，像老电影的密码机在解密。

机制是 ==每个位置有自己的解锁时刻，没轮到的位置每帧重新抽一个乱码字符==。整行从左到右推进：已经过线的地方永远显示真字，没过线的地方每次刷新都抽一个新的噪声字符。同一帧里既有定形的真字、又有正在跳的噪声，这才是「正在解码」——如果整行一起从乱码变成真字，那只是闪烁，不是解码。方向也不一定要从左到右，按随机顺序解锁会更像机器在搜索。

关键的第二半是等宽：噪声字符与真字必须同宽，否则每次刷新都在重新排版，整行会在原地抖。所以乱码表要用同一套半角字符，并配等宽字体。

## 代码

```html
<!-- @mechanism 真文案放在属性上：正文节点始终只有一个，只换它的文本 -->
<p class="sc" id="sb-sc" data-text="乱码解码：真字与噪声混在同一帧里。" data-frames="26"></p>
```

```css
.sc {
  width: min(430px, 86vw);
  /* @mechanism 等宽字体：乱码与真字同宽，换字时整行才不会抖 */
  font: 400 16px/1.9 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
  color: #8ee6a0;
  text-shadow: 0 0 14px rgb(142 230 160 / 0.35);
  min-height: 1.9em;
}
```

```js
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺ01<>[]{}=+*/#$%'
const node = document.getElementById('sb-sc')
const final = node.dataset.text
const total = Number(node.dataset.frames)

let frame = 0
const timer = setInterval(() => {
  frame++
  let out = ''
  for (let i = 0; i < final.length; i++) {
    // @mechanism 每个位置有自己的解锁时刻，过线后永远是真字
    const settled = frame >= (i / final.length) * total
    // @mechanism 未解锁的位置每帧重抽：噪声一直在变，真字一旦定形就不动
    out += settled
      ? final[i]
      : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
  }
  node.textContent = out
  if (frame >= total) clearInterval(timer)
}, 45)
```

## 边界

- 用比例字体、或让噪声表里混进全角的中日韩字符，每个字的宽度就会变，整行每次刷新都重排——现象是「抖」而不是「解码」。等宽字体加半角字符是前提。
- 每帧替换 `textContent` 会销毁并重建文本节点。字数多时更省的写法是先把节点填满、之后只改每个节点的 `nodeValue`。
- 中文文本的乱码观感与拉丁字母完全不同：字母乱码像机器码，汉字乱码像排版事故。面向中文的场景要把噪声表也换成同宽的符号，或者只对数字与英文段做解码。
- 解锁是按位置线性推进的，所以「打乱顺序」只能靠给每个位置换一个阈值函数。不做这一步时，观感是很规矩的从左到右，少了搜索的意味。
- 定时器与屏幕刷新不同步，慢机器上会跳帧。这里本来就不需要每帧，所以影响不大；但别改用 `requestAnimationFrame` 去「修」它——那是把速度交给帧率。
- 屏幕上一旦有 `prefers-reduced-motion`，应当直接显示最终文本。解码过程的字面内容在每一帧都不同，读屏软件与页面内搜索在这段时间里都拿不到真文本，所以真文案最好同时留在属性或隐藏节点里。

## 备注

- 同一套「逐位解锁」可以用于数字：让未解锁位显示随机的 0–9，就得到冒烟的计算器。
- 解锁阈值不必线性，改成 `i / length` 的平方或开方，就能得到「先慢后快」的解码节奏。
