---
title: 字数还剩多少
slug: char-counter
category: 交互
tags: [表单, 计数, 自定义属性]
since: 2026-10
source: 机制来自 HTML 的 maxlength 约束与 CSS color-mix 的连续插值，自行实现
when: 输入框有长度上限，用户需要提前知道自己离超限还有多远
stage: plain
tier: core
---

## 描述

输入框下面一行小字，写着还能写几个字；越接近上限，字和下面那条细线越往警示色偏。

要点不在显示数字，而在两件事：谁来截断，以及阈值放在哪一层。

截断交给浏览器。机制是 ==maxlength 让浏览器自己负责拒绝超出的输入，脚本只负责算剩余量==。脚本自己 `slice(0, 60)` 也能截，但它拦不住输入法正在拼的字、拦不住粘贴、也拦不住拖动文本进来；`maxlength` 是在值进入控件的那一刻生效的，覆盖所有输入路径。脚本只需要在 `input` 事件里读一次 `value.length`。

阈值不写在脚本里。机制是 ==把剩余比例写成一个自定义属性，用 color-mix 做连续插值，于是没有阈值、也没有类名==。常见写法是 `if (left < 10) el.classList.add('is-low')`，硬编码了一个数字，还多出一个状态类；改成把 `--fill` 交给 CSS，颜色在整段区间上平滑地从常态色插值到警示色，看起来是「压力在积攒」而不是「啪地一声变红」。同一条条宽也读这个变量，两者天然同步。

这样分完工，脚本只剩一行算术，视觉规则全部留在样式表里。想换成 200 上限、想把警示色换成橙色，都不用碰 JS。

## 代码

```html
<!-- @mechanism maxlength 是约束的唯一定义处，脚本从它反推剩余量 -->
<label class="cc">
  一句话介绍
  <textarea class="cc-input" maxlength="60" rows="2" placeholder="这个效果解决了什么"></textarea>
  <span class="cc-bar"><i></i></span>
  <span class="cc-count">还能写 <b class="cc-left">60</b> 字</span>
</label>
```

```css
.cc {
  /* @mechanism 载着剩余比例的容器，颜色与条宽都是它的下游 */
  --fill: 1;
  display: grid;
  gap: 7px;
  width: min(380px, 84vw);
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.cc-input {
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.35);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.55);
  font: 400 15px/1.6 system-ui, sans-serif;
  color: inherit;
  resize: none;
}

.cc-bar {
  height: 2px;
  border-radius: 2px;
  background: rgb(60 48 30 / 0.15);
  overflow: hidden;
}

.cc-bar > i {
  display: block;
  height: 100%;
  /* @mechanism 宽度直接由剩余比例算出，不需要脚本写 style */
  width: calc(var(--fill) * 100%);
  background: currentColor;
  transition: width 0.12s linear;
}

.cc-count {
  /* @mechanism 用 color-mix 让颜色随剩余量连续插值；比例越小时警示色权重越大，不必设阈值 */
  color: color-mix(in oklab, #b4462f calc((1 - var(--fill)) * 100%), #6b6355);
  font-variant-numeric: tabular-nums;
}
```

```js
const input = document.querySelector('.cc-input')
const left = document.querySelector('.cc-left')
const box = document.querySelector('.cc')

function sync() {
  // @mechanism 口径必须与 maxlength 一致：两边都按 UTF-16 码元数，emoji 才算得一样
  const remain = input.maxLength - input.value.length
  left.textContent = remain
  // @mechanism 只写比例，颜色与条宽由 CSS 从 --fill 推导
  box.style.setProperty('--fill', remain / input.maxLength)
}

input.addEventListener('input', sync)
sync()
```

## 边界

- 别用 `[...text].length` 去算长度。`maxlength` 按 UTF-16 码元数截断，一个 emoji 占两个码元，而码点数只算一个；两边口径一旦不同，就会出现「显示还能写 1 个字，却怎么也打不进去」。
- `maxlength` 只能被浏览器强制，一旦脚本绕开它直接赋值（`input.value = long`），它不会截断——约束是在用户输入路径上生效的。所以粘贴以外的程序化赋值要自己再检查一次。
- `color-mix` 的插值需要较新的引擎。老引擎上整条 `color` 声明会失效退回继承色，数字仍然正确，属于可接受的降级；想兜底就在前面补一条不依赖 `color-mix` 的固定色。
- 计数依赖 `input` 事件，而它会漏掉脚本改值、浏览器自动填充这类变化。自动填充进来的长文本可能让计数与实际不符，直到用户再敲一个字才对齐。
- `maxlength` 对 `type="number"` 无效，对 `<textarea>` 有效。别在数字输入框上期待它工作。

## 备注

- 「把连续量交给 CSS 插值」可以替掉一大批阈值判断：评分条的底色、库存条的告警、加载进度的颜色，凡是「越多越紧张」的界面都用得上。
- `aria-live="polite"` 会让读屏器把每次计数变化都念一遍，所以这里刻意没加；如果要把提示做成可播报的，改成只在跌到某个关键值时播报一次。
