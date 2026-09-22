---
title: 中西混排的断行策略
slug: word-break-mixed-script
category: 排版
tags: [断行, 中西混排, 标点]
since: 2026-10
source: 机制来自 CSS Text 的 word-break / overflow-wrap / line-break 三者分工，自行实现
when: 一段中英混排的正文里夹着长 URL 或长英文单词，断得不好看或撑破了容器
stage: plain
tier: core
---

## 描述

中文可以在任意字之间换行，英文单词不行，长 URL 更不行——同一段文字里有三种断行需求，得用三个属性分头交代。

机制是 ==`word-break` 管「哪儿允许断」、`overflow-wrap` 管「实在不行时怎么办」、`line-break` 管「标点能不能留在行尾」==。三者不是同一个开关的三个档位，混用会互相打架：`word-break: break-all` 会让英文单词在任意字母处断开（对纯中文没问题，对混排就是灾难），而 `overflow-wrap: anywhere` 平时不拆词、只在**装不下时**才拆——这才是混排正文要的。

长 URL 是这里的关键案例：它不带空格，算作一个「词」。不开 `overflow-wrap` 时它会直接撑破容器；开了之后它会在最后一刻被拆开，其他词照常不动。`line-break: strict` 再补一层：不让「。」「、」这类标点掉到行首。

## 代码

```html
<p class="mixed">
  中文正常断行，English words should not be broken，长地址
  https://example.com/some/very/long/path/that/never/ends/anywhere 也不会撑破容器。
</p>
```

```css
.mixed {
  max-width: 30em;
  padding: 14px;
  border: 1px solid #d8cfc0;
  font: 400 15px/1.8 system-ui, sans-serif;
  /* @mechanism 只在装不下时才拆词，平时不碰英文单词 */
  overflow-wrap: anywhere;
  /* @mechanism 标点避头尾：不让逗号句号掉到行首 */
  line-break: strict;
  /* @mechanism 保持默认的 normal 断行规则，中文按字断、英文按词断 */
  word-break: normal;
}
```

## 边界

- `word-break: break-all` 是最常见的误用。它在纯中文段落上看着没问题，一旦混进英文，`design` 会变成 `desi` / `gn` 两行——**而且只在这一个词上出错**，很容易被当成孤例而查不到根因。混排正文该用 `overflow-wrap`。
- `overflow-wrap: anywhere` 与 `break-word` 的差别在**是否参与最小内容宽度计算**：`anywhere` 会让 `min-content` 变成单个字符宽，`break-word` 不会。放在 flex 或 grid 项里时，这一条决定了容器能不能被压缩到比 URL 更窄。
- `hyphens: auto` 对中文完全无效。中文的断行规则来自 `line-break`，两者管的是不同语种，同时写不会冲突但只对各自的语种生效。
- `line-break: strict` 只约束标点，不负责「孤字成行」（一行只剩一个字）。那要靠 `<br>`、`text-wrap: pretty` 或手工调整，CSS 没有通用的禁孤行开关。
- 表格与 `white-space: nowrap` 的单元格不受 `overflow-wrap` 影响——`nowrap` 优先。表格里撑破容器的长 URL 要先撤掉 `nowrap`。
