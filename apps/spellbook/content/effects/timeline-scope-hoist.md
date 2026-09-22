---
title: 把时间线提到上层
slug: timeline-scope-hoist
category: 动效
tags: [滚动驱动, 命名时间线, 作用域]
since: 2026-10
source: 机制来自 CSS Scroll-driven Animations 的 scroll-timeline-name 与 timeline-scope，自行实现
when: 侧栏里的指示条要反映内容区的滚动进度，但两者不在同一棵子树里
stage: grid
tier: candidate
---

## 描述

右边那条细线跟着左边的内容区一起长：滚动区在自己那块方框里，线在它外面，两者并不互为祖先。

机制是 ==scroll-timeline-name 给滚动容器起一个名字，timeline-scope 把这个名字提到共同祖先上，让别的分支也引用得到==。匿名的 `scroll()` 只能找「最近的**可滚动祖先**」——也就是说要用到某条时间线，动画元素必须待在那里面。命名时间线把这件事拆成两半：名字定义在滚动容器上（`scroll-timeline-name: --feed`），引用发生在别处（`animation-timeline: --feed`）。但名字的可见性仍然沿树传播：一个名字只对它自己所在的元素与后代可见，兄弟分支看不到。`timeline-scope: --feed` 就是在共同祖先上把这个名字重新声明一次，让祖先的整棵子树都能引用它——这是不动 DOM 结构就把时间线「提上一层」的唯一办法。

它同时解决了另一个方向的问题：被名字提上来的时间线可以是**子孙**滚动容器提供的那条，所以一条外层导航条也能跟着某个内层滚动区走，连祖先关系都不需要。之所以要给名字这套机制，是因为「谁驱动谁」在布局上和「谁包着谁」本来就不是一回事——用匿名时间线时你被迫把两者绑在一起，用命名时间线就分开了。

名字是任意 dashed-ident，自己起、长度不限；`animation-range` 决定把滚动范围的哪一段映射到 0→100%，示例用的是全范围。另有一处选择是把 `timeline-scope` 放在 `:root` 上做全局命名（省事，但重名风险跟着扩散），还是收在最近的共同祖先上只给它该管的子树。时长写 `auto` 或者干脆不写——进度就是滚动进度，写具体秒数就退回按时间播放了。

## 代码

```html
<div class="ts">
  <div class="ts-feed">
    <p>滚动区在这里。</p>
    <p>它有两条内容。</p>
    <p>再往下还有。</p>
    <p>右边那条线是它的进度。</p>
    <p>两边的 DOM 互不包含。</p>
    <p>滚到底，线正好走满。</p>
  </div>
  <div class="ts-meter"><i class="ts-fill"></i></div>
</div>
```

```css
.ts {
  /* @mechanism 把名字提到共同祖先：滚动区之外的兄弟分支也能引用这条时间线 */
  timeline-scope: --feed;
  display: flex;
  gap: 18px;
  align-items: flex-start;
}

.ts-feed {
  width: min(250px, 58vw);
  height: 200px;
  overflow-y: auto;
  padding: 12px 14px;
  border: 1px solid rgb(60 48 30 / 0.25);
  border-radius: 12px;
  background: rgb(255 255 255 / 0.55);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1b1710;
  /* @mechanism 命名时间线定义在滚动容器上，用途在别处 */
  scroll-timeline-name: --feed;
}

.ts-feed p {
  margin: 0 0 12px;
}

.ts-meter {
  width: 9px;
  height: 200px;
  border-radius: 999px;
  overflow: hidden;
  background: rgb(60 48 30 / 0.14);
}

.ts-fill {
  display: block;
  height: 100%;
  background: #b4462f;
  transform-origin: top center;
  /* @mechanism 引用上层提上来的名字；时长不写，进度就等于滚动进度 */
  animation: ts-grow linear both;
  animation-timeline: --feed;
}

@keyframes ts-grow {
  from {
    transform: scaleY(0);
  }
  to {
    transform: scaleY(1);
  }
}
```

## 边界

- 名字只是字符串：同名会互相覆盖（更靠后、更就近的定义胜出），表现是「指示条和滚动对不上」，不会有任何报错。取名字时带上用途前缀能少踩这个坑。
- 被定义时间线的容器必须**真的会滚动**（内容溢出）。内容刚好放得下时这条时间线不活跃，动画停在使用值上，看起来就是进度恒为 0——这类 bug 往往在内容变少之后才冒出来。
- `timeline-scope` 只改变可见性，凭空造不出时间线：名字得有定义者，而且定义者要在该祖先的子树里。
- `scroll-timeline` 绑的是容器自身的滚动距离（0 到最大可滚动距离），与 `view()` 绑「元素进出视口」不是一回事。两者都能命名，别把名字当成了「事件」。
- `animation-duration` 必须写成 `auto` 或不写。写了具体秒数就不再由滚动驱动，那是回退行为。
- 支持面新（Chromium 115+ 起才有 `scroll-timeline` 与 `timeline-scope`），写 candidate。不支持时时间线不成立，`duration: auto` 在时间轴下时长为零，结果是那条线静止不动——不报错，所以上线前建议包一层 `@supports (timeline-scope: --x)`。

## 备注

- `timeline-scope` 里可以写多个名字，一处声明就把好几条时间线提上一层：一条给刻度、一条给底色。
- 同一套「定义在 A，引用在 B」的写法也适用于 `animation-range`：进度条的 0% 不一定非得是容器顶部，从「内容滚过一半」起算也行。
