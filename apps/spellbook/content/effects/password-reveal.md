---
title: 密码可见切换
slug: password-reveal
category: 交互
tags: [表单, 密码, 焦点]
since: 2026-10
source: 机制来自 DOM 的 HTMLInputElement.type 切换与 setSelectionRange，自行实现
when: 登录框边上要一个「显示密码」的小按钮，且切换后不能打断用户继续输入
stage: plain
tier: core
---

## 描述

密码框右侧一个眼睛按钮，点一下变明文，再点一下变回圆点，键盘焦点与光标位置都不丢。

看着像只是把 `type` 从 `password` 改成 `text`，但真正要处理的是焦点：用户是**点按钮**来切换的，那一下点击之后焦点落在按钮上，输入框已经失焦。不把它交还回去，用户接着打字就什么也打不进去。

机制是 ==切换明文与密文是在同一个 input 上改 type，值、自动填充与密码管理器集成因此原样保留==。另一种常见做法是放一个隐藏的真实输入框、再放一个可见的假输入框去显示明文，靠同步 `value` 撑起两块状态——那样会丢掉浏览器的密码管理器集成与输入法上下文，还得自己维护两份必须一致的真相。改 `type` 只是在同一个元素上换一种呈现，值不搬家。

光标与选区是第三件事，而它没有看上去那么确定：切换后各引擎的处理并不一致，实测 Chrome 会连带保留，但不该指望这一点。代价只有一行 `setSelectionRange`，顺手把读到的选区写回去，是消除引擎差异最省心的做法。

按钮本身还有两个容易漏的性质：必须写 `type="button"`，否则它在表单里默认是提交按钮，点一下眼睛就提交了；以及它的状态要用 `aria-pressed` 表达，读屏器才知道这是个可以按下去保持的开关，而不是一次性动作。

## 代码

```html
<!-- @mechanism 真实输入框始终只有一个，明文与圆点只是它的两种 type -->
<div class="pw">
  <label for="pw-1">密码</label>
  <span class="pw-row">
    <input class="pw-input" id="pw-1" type="password" value="hunter2-secret" autocomplete="current-password" />
    <button class="pw-toggle" type="button" aria-pressed="false" aria-label="显示密码">显示</button>
  </span>
</div>
```

```css
.pw {
  display: grid;
  gap: 7px;
  width: min(340px, 84vw);
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.pw-row {
  display: flex;
  gap: 8px;
}

.pw-input {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.35);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.55);
  font: 400 15px/1.4 system-ui, sans-serif;
  color: inherit;
}

.pw-toggle {
  padding: 0 14px;
  border: 1px solid rgb(60 48 30 / 0.35);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.55);
  font: 400 13px/1 system-ui, sans-serif;
  color: inherit;
  cursor: pointer;
}

/* @mechanism 按下状态由 aria-pressed 驱动，脚本不必再切类名 */
.pw-toggle[aria-pressed="true"] {
  border-color: #b4462f;
  background: rgb(180 70 47 / 0.1);
  color: #b4462f;
}

.pw-toggle:focus-visible {
  outline: 2px solid #b4462f;
  outline-offset: 2px;
}
```

```js
const input = document.querySelector('.pw-input')
const toggle = document.querySelector('.pw-toggle')

toggle.addEventListener('click', () => {
  // @mechanism 先读下光标与选区，切换后各引擎给的位置并不一致
  const start = input.selectionStart
  const end = input.selectionEnd
  const reveal = input.type === 'password'

  // @mechanism 同一个元素改 type，值不搬家，明文只是它的另一种呈现
  input.type = reveal ? 'text' : 'password'
  // @mechanism 点按钮后焦点在按钮上，交还给输入框，用户才能接着打字
  input.focus()
  // @mechanism 把选区写回读到的位置，换来跨引擎一致的光标
  input.setSelectionRange(start, end)

  toggle.setAttribute('aria-pressed', String(reveal))
  toggle.textContent = reveal ? '隐藏' : '显示'
  toggle.setAttribute('aria-label', reveal ? '隐藏密码' : '显示密码')
})
```

## 边界

- `focus()` 不能省。用户点的是按钮，那一下之后 `document.activeElement` 就是按钮；不交还焦点，用户接着敲的字不会进入密码框，看起来像输入框坏了。
- `setSelectionRange` 只在支持选区的类型上可用。目标是 `type="email"` 或 `type="number"` 时它会直接抛 `InvalidStateError`——想在这类字段上做类似切换，得先包一层判断或者干脆不做。
- 实测当前 Chrome 在切换 `type` 时会保留 `value` 与选区，但这是引擎行为，不是规范保证的动作。别把「切换后光标还该在原处」当成浏览器会替你做的事，写一行还原才是稳的。
- 明文状态会把密码暴露在屏幕上，也可能被输入法的候选与剪贴板记录带走。这是一次主动的信息暴露，产品上通常要配一个自动切回或短暂显示的策略。
- 按钮漏写 `type="button"` 就是提交按钮。这个 bug 在只有密码框的表单里特别隐蔽：看起来一切正常，只是每次点眼睛都提交了一次。
- 浏览器自带的密码框里往往已经有一个平台自己的「显示密码」控件。两者同时出现会重复，通常要靠 `::-ms-reveal` 之类的私有伪元素把它藏掉。
- 按钮不能放进 `<label>` 里。`label` 只允许包一个可标记元素，多塞一个按钮进去会让「点标签聚焦输入框」和「点按钮切换」互相打架——点了按钮，焦点却跑到输入框上。

## 备注

- 「先把状态写进元素自己的属性，样式再去读它」在这个库里反复出现：`aria-pressed`、`:checked`、`indeterminate` 都是同一个思路。
- 把按钮的文案与 `aria-label` 一起改掉，是因为读屏器念的是 `aria-label`，而视力用户看的是文字；只改一个，另一群用户就会听到「显示密码」却看到「隐藏」。
