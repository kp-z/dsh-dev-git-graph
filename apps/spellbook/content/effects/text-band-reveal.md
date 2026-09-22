---
title: 不拆 DOM 的逐字揭示
slug: text-band-reveal
category: 排版
tags: [background-clip, 硬色标, steps]
since: 2026-10
source: 机制来自 CSS background-clip 的硬色标渐变与 steps()，自行实现
when: 要逐字揭示一行代码或数字，但不想让 DOM 被几十个 span 撑大
stage: plain
tier: core
params:
  - { name: chars, label: 字数, type: range, min: 4, max: 32, step: 1, default: 22 }
  - { name: dur, label: 用时, type: range, min: 0.6, max: 5, step: 0.2, default: 2.4, unit: s }
---

## 描述

一行命令从左到右一格一格地亮起来，看起来就是一个字一个字地显示——但整段文字自始至终只有一个元素。

机制是 ==文字只当裁剪形状，真正在动的是它背后那张硬边渐变图，一格格平移==。`background-clip: text` 让背景只在字形的像素里显形，`color: transparent` 让字自己让开，于是「背景」就成了文字的填色。背景做成透明一段、实色一段、两处色标写在同一个位置，就得到一条硬边——硬边的位置就是揭示的边界。`steps(字数)` 把连续平移量化成整数跳，边界才会一格一格地蹦，而不是平滑地扫。

它和宽度加 `steps()` 的打字机做法是同一个「量化」原理，但量化的对象不同：这里动的是背景位置，所以文字的宽度、换行、字距全程不变，布局一次都不用重算。代价是揭示精度交给了背景的像素网格，而不是字本身——这正是它的边界所在。

## 代码

```html
<!-- @mechanism 整段只有一个元素：逐字是背景位移加 steps 做出来的，DOM 没有被拆 -->
<p class="band" id="sb-band">npm run build --silent</p>
```

```css
.band {
  width: fit-content;
  margin: 0;
  font: 400 18px/1.8 ui-monospace, SFMono-Regular, Menlo, monospace;
  /* @mechanism 字自己让开，背景才在字形里显形 */
  color: transparent;
  background-image: linear-gradient(90deg, #e9e4d8 50%, rgb(233 228 216 / 0.14) 50%);
  /* @mechanism 背景铺成两倍宽，硬边正好落在中线上 */
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  /* @mechanism steps 把连续平移量化成一格一字的跳变 */
  animation: band-run var(--dur, 2.4s) steps(var(--chars, 22), end) forwards;
}

@keyframes band-run {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}
```

```js
// @mechanism 只补一件事：让字数与 CSS 里的 steps 默认值保持一致
const band = document.getElementById('sb-band')
if (band) {
  band.style.setProperty('--chars', String(band.textContent.length))
}
```

## 边界

- 硬边只能落在背景的像素位置，而字的宽度由字体决定。等宽字体下每步正好一格；比例字体里每步跨过的字数忽多忽少，会出现半个字被切成左暗右亮的场面，甚至一步跳过两个字。
- 渐变里那两个色标必须写在**同一个位置**（这里是 50% 与 50%）才是硬边，差一点点就变成柔和扫过，逐字感直接消失。
- `background-clip: text` 与 `color: transparent` 是配对的。漏了前者看到一块渐变矩形盖在字上，漏了后者看到的是实色字把背景挡得干干净净。
- 背景是按整个元素盒铺的。文字跨行时高光不会逐行重来，长段落会揭示得歪七扭八——它只适合一行命令、一个标题或一段数字。
- 它的「字数」是一步一格，不是一字一格：字宽不等时，`steps(22)` 的二十二步与二十二个字符并不是一一对应。要严格对齐，还是得回到拆分字符那条路。
- 打印时背景默认被丢掉，禁用背景图的用户设置也会让它整行变成透明——字会彻底看不见，而不是「显示为实色」。

## 备注

- 同一招把硬边换成三个色标，就得到「高光带扫过」；把 `steps` 换成线性，就得到柔和的扫光。变体都在同一张渐变上。
