---
title: 在框内推镜
slug: object-view-box-crop
category: 图形
tags: [object-view-box, object-fit, transition, 图片, 悬停]
since: 2026-10
source: 机制来自 CSS Images Level 4 的 object-view-box，自行实现
when: 图片要从自己的框里推近、平移，像镜头一样，但不想套一层裁剪容器
stage: photo
tier: candidate
params:
  - { name: dur, label: 推镜用时, type: range, min: 0.2, max: 2, step: 0.1, default: 0.75, unit: s }
---

## 描述

鼠标移上去，画面在同一块地方里缓缓推近，视线偏向右下的山脊；元素占据的位置一点没变，旁边的文字也没被推动。

机制是 ==object-view-box 在替换元素里切出一块矩形当可见内容，剩下的部分再按 object-fit 映射回元素盒==。一张 `<img>` 内部其实有两层盒子：外层的元素盒由布局决定，内层的对象框是图片自己的坐标系。`object-fit` 只能决定「整张图怎么塞进这个盒子」，它拿不到「看这张图的哪一块」——所以以前的推镜要么套一层 `overflow: hidden` 的容器再缩放里面的图（多一层布局、多一个层叠上下文），要么预先裁好一张图。`object-view-box` 把对象框换成 `inset()` 指定的小矩形，缩放与平移就都成了同一个属性的变化：窗口收小就是推近，四边不等就是偏移。

关键在于它动的是**内部**的窗口，不是元素盒。所以它是可过渡的（示例里悬停缓慢推近），也不会连带动到旁边任何东西——没有新的层叠上下文、没有额外的定位祖先、没有需要同步的容器尺寸。反过来说，它也没有「更多像素」可看：窗口收得越小，剩下的内容被拉得越大，源图的分辨率就是清晰度的上限。

窗口的四个值、窗口用百分比还是像素、以及 `object-fit` 取哪一个，是这条咒语的全部旋钮。百分比会跟着元素盒一起缩放，响应式下省事；写像素就是固定大小的窗口，需要自己保证它不越界。`object-fit` 决定被切出来的那块怎么填回元素盒：`fill` 会拉伸变形，`cover` 保持比例、裁掉多余，通常要选后者。推镜做成缓入缓出的慢过渡比瞬间跳切自然得多，这也是它值得做成过渡而不是直接换值的原因。

## 代码

```html
<figure class="ovb">
  <img class="ovb-img" alt="夕阳下的山脊"
    src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20400%20250'%3E%3Cdefs%3E%3ClinearGradient%20id='s'%20x1='0'%20y1='0'%20x2='0'%20y2='1'%3E%3Cstop%20offset='0'%20stop-color='%232a1c4a'/%3E%3Cstop%20offset='.55'%20stop-color='%23a8536b'/%3E%3Cstop%20offset='1'%20stop-color='%23f0a05a'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width='400'%20height='250'%20fill='url(%23s)'/%3E%3Ccircle%20cx='300'%20cy='72'%20r='30'%20fill='%23ffd08a'/%3E%3Cpath%20d='M0%20200%20L120%20110%20L215%20200%20Z'%20fill='%2338e0c8'/%3E%3Cpath%20d='M150%20200%20L275%2095%20L400%20200%20Z'%20fill='%237c5cff'/%3E%3Crect%20y='200'%20width='400'%20height='50'%20fill='%23120d1f'/%3E%3C/svg%3E">
  <figcaption>悬停：在框内推近</figcaption>
</figure>
```

```css
.ovb {
  margin: 0;
  display: grid;
  justify-items: center;
  gap: 10px;
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #fff;
}

.ovb-img {
  display: block;
  width: min(340px, 84vw);
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 14px;
  box-shadow: 0 18px 40px rgb(0 0 0 / 0.4);
  /* @mechanism 窗口的四个值就是镜头：元素盒不动，只换「看哪一块」 */
  object-view-box: inset(0%);
  transition: object-view-box var(--dur, 0.75s) cubic-bezier(0.33, 1, 0.68, 1);
}

.ovb:hover .ovb-img {
  /* @mechanism 窗口收小就是推近，四边不等就是画面偏移 */
  object-view-box: inset(18% 10% 6% 22%);
}
```

## 边界

- 只对**替换内容**有效：`<img>`、`<video>` 的画面、被替换的盒子。普通元素的背景图不认这条属性，背景图的裁切还得靠 `background-size` / `background-position`。
- 它不改变元素盒，也不会替代一般的溢出控制：窗口外的内容被隐藏是这条属性的内部行为，但元素盒本身该有的 `overflow` 仍要自己写。
- 与 `object-position` 会叠加：一个决定「图怎么摆在盒子里」，一个决定「看图的哪一块」，同时写很容易越调越偏，通常只留一个。
- 窗口比元素盒还大时不会看到更多：多出来的部分没有像素可填，结果是内容被拉到边缘。
- 支持面窄（Chromium 104+ 起），写 candidate。不支持时整条声明被忽略，画面停在原样——这点比裁切类属性友好，不会切错位置。
- 与 `srcset` / `image-set()` 一起用时，浏览器挑中的源图分辨率不同，同一个窗口得到的清晰度也不同；推近看细节的场合要确认挑中的是高分图。

## 备注

- 同一套「只换窗口」的思路也适合视频封面与产品图：进页面时给一个全景窗口，悬停时推近到局部，全程不动布局。
