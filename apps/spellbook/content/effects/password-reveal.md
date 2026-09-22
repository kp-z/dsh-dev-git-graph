---
title: 密码可见切换
slug: password-reveal
category: 交互
tags: [表单, 密码, 选区]
since: 2026-10
source: 机制来自 DOM 的 HTMLInputElement.type 切换与 setSelectionRange，自行实现
when: 登录框边上要一个「显示密码」的小按钮，且切换后不能打断用户继续输入
stage: plain
tier: core
---

## 描述

密码框右侧一个眼睛按钮，点一下变明文，再点一下变回圆点；键盘焦点和光标位置都不丢。

看着像只是把 `type` 从 `password` 改成 `text`，但直接这么写，用户会发现每点一次按钮，光标就跳到文字末尾，接着打字是从头插入——因为换 `type` 会让浏览器重建输入元素的渲染状态，`selectionStart` 与 `selectionEnd` 一并归零。

机制是 ==切换 type 会丢掉光标与选区，所以要在切换后显式把两者还原==。先读下 `selectionStart` / `selectionEnd`，改完 `type` 再 `focus()` 并把选区写回去。少了这一步，输入到一半去确认一眼的体验就不成立了。

第二件事是别用「真假两个输入框」的替代方案。有些实现放一个隐藏的真实输入框和一个可见的假输入框，靠同步 `value` 显示明文——那样会丢掉浏览器的密码管理器集成、自动填充和输入法上下文。改 `type` 是在原元素上操作，这些一个都不丢。

按钮还有两个容易漏的性质：必须写 `type="button"`，否则它在表单里默认是提交按钮，点一下就提交；以及它的状态要用 `aria-pressed` 表达，读屏器才知道这是个可以按下去保持的开关，而不是一个动作。

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
  // @mechanism 先存下光标与选区，改完 type 它们就没了
  const start = input.selectionStart
  const end = input.selectionEnd
  const reveal = input.type === 'password'

  input.type = reveal ? 'text' : 'password'
  input.focus()
  // @mechanism 把选区写回去，否则用户接着打字会从末尾插入
  input.setSelectionRange(start, end)

  toggle.setAttribute('aria-pressed', String(reveal))
  toggle.textContent = reveal ? '隐藏' : '显示'
  toggle.setAttribute('aria-label', reveal ? '隐藏密码' : '显示密码')
})
```

## 边界

- `setSelectionRange` 只在支持选区的类型上可用。目标是 `type="email"` 或 `type="number"` 时它会直接抛 `InvalidStateError`——想在这类字段上做类似切换，得先包一层 try 或者干脆不做。
- 有些浏览器在 `type` 切换后会**重置**或截断已有内容（历史版本上 `value` 处理不一致）。切换前读一次 `value`、切换后确认还在，是廉价的自保。
- 明文状态会把密码暴露在屏幕上，也会被输入法记住候选。切回密码时若字段已失焦，一些浏览器会重新触发拼写检查的下划线——这是外观上的小噪音，不影响功能。
- 按钮漏写 `type="button"` 就是提交按钮。这个 bug 在只有密码框的表单里特别隐蔽：看起来一切正常，只是每次点眼睛都提交了一次。
- 浏览器自带的密码框里往往已经有一个平台自己的「显示密码」控件。两者同时出现会重复，通常要靠 `::-ms-reveal` 之类的私有伪元素把它藏掉。
- 按钮不能放进 `<label>` 里。`label` 只允许包一个可标记元素，多塞一个按钮进去会让「点标签聚焦输入框」和「点按钮切换」互相打架——点了按钮，焦点却跑到输入框上。

## 备注

- 「切换后把选区与焦点还原」这条经验适用于任何会改动元素渲染状态的属性变更，不只是 `type`。
- 把按钮的状态存在 `aria-pressed` 上而不是一个私有类名上，样式和无障碍就共用了同一份真相——这是本项目里反复出现的同一个取舍。
