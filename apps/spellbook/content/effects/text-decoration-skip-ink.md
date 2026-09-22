---
title: 下划线让开字母的降部
slug: text-decoration-skip-ink
category: 排版
tags: [下划线, 字体度量, 细节]
since: 2026-10
source: 机制来自 CSS Text Decoration 的 text-decoration-skip-ink，自行实现
when: 正文里的下划线穿过 g、y、p 的尾巴，看着糊成一团
stage: plain
tier: core
---

## 描述

一条下划线穿过 `g`、`y`、`p`、`q` 这些字母的尾巴时，在尾巴处断开一下，绕过它再继续。

机制是 ==跳过降部（descender）不是把线剪断，而是让线在字形占据的空间处让路==。浏览器知道每个字形的轮廓，`text-decoration-skip-ink: auto`（默认值）让它在下划线与降部相交处留缺口。这也是它与「手工给某个字母换颜色」的根本差别——那个办法会在需要时把线也一起染色，而且改一个字母就要改一处标记。

这个细节的意义在于**下划线是否读得清**。断不开时，`g` 的圈与尾巴会和线连成一块墨，尤其是在小字号、细字体上，`page` 与 `poge` 会开始难分。而它同时保住了「线是连续的」这个视觉信号：缺口很窄，不会让人误以为下划线在那里结束了。

## 代码

```html
<p class="prose">
  图中 <a href="#">page 与 goy</a> 这类带降部的词，下划线要绕着尾巴走，
  而 <a href="#">AVATAR</a> 这种没有降部的词，线就是一条完整的直线。
</p>
```

```css
.prose {
  max-width: 30em;
  font: 400 17px/1.9 Georgia, "Songti SC", serif;
}

.prose a {
  color: #7a3b2e;
  /* @mechanism 让线在字形降部处断开，而不是压在尾巴上 */
  text-decoration-skip-ink: auto;
  /* @mechanism 线离字面远一点，缺口看起来才是「绕开」而不是「被切掉」 */
  text-underline-offset: 0.18em;
  text-decoration-thickness: 1px;
}

.prose a.no-skip {
  /* @mechanism 关掉之后线会压在 g 的尾巴上，正好用来对比 */
  text-decoration-skip-ink: none;
}
```

## 边界

- 断口是**沿字形轮廓**让出的，所以同一段文字里每个词的下划线缺口形状都不同。有人会以为这是「线画歪了」或「渲染 bug」——它就是这么设计的。
- 断口大小与字号无关，是字体度量与描边宽度共同决定的。细线下缺口很小看不出来，`text-decoration-thickness: 3px` 这种粗线会让缺口变成明显的缺口，`g` 底下像少了一块。
- 只对**有降部的字形**有效。全大写的文字、数字、以及中文都不会产生缺口——所以这条在中文正文里几乎看不出差别。别拿一段纯中文去验证它是否生效。
- 它只作用于 `text-decoration` 画出来的线，对 `border-bottom`、`background-image` 画的下划线、或 `::after` 画的一条 `div` 全都无效。手写的下划线不会让路，这也是它们看起来比原生下划线「粗糙」的原因。
- 缺口处的空白是背景色，不是透明。下划线压在图片或渐变上时，缺口会露出一小块背景，若背景是渐变，会看起来像线的中间被擦掉了。
