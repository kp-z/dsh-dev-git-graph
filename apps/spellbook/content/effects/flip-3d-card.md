---
title: 3D 翻转卡片
slug: flip-3d-card
category: 动效
tags: [3d, transform, transition, 卡片, 悬停]
since: 2026-09
source: 机制来自 CSS Transforms 的 preserve-3d 与 backface-visibility，自行实现
when: 卡片正反面切换要有真实的翻面感，不是交叉淡入
stage: grid
tier: core
---

## 描述

卡片翻转过去，露出背面的内容——看到的是同一张卡在旋转，不是两块图叠着淡出淡入。

机制要三件事一起：==容器给 perspective 造出透视、内层用 preserve-3d 保住 3D 空间、每一面用 backface-visibility: hidden 让背朝自己时不画==。少了 `preserve-3d`，子元素会被压回平面，两个面就会重叠在一起。

`rotateY` 本身只是把元素压扁；「翻过去」是透视加深度共同给的。

## 代码

```html
<div class="fc">
  <div class="fc-inner">
    <div class="fc-face fc-front">
      <b>正面</b>
      <span>指针移上去</span>
    </div>
    <div class="fc-face fc-back">
      <b>背面</b>
      <span>它转过来了</span>
    </div>
  </div>
</div>
```

```css
.fc {
  /* @mechanism 透视必须在外层容器上 */
  perspective: 900px;
  width: 190px;
  height: 190px;
}

.fc-inner {
  position: relative;
  width: 100%;
  height: 100%;
  /* @mechanism 保住子元素的 3D 空间，否则两面会被压平重叠 */
  transform-style: preserve-3d;
  transition: transform 0.62s cubic-bezier(0.4, 0.2, 0.2, 1);
}

.fc:hover .fc-inner {
  transform: rotateY(180deg);
}

.fc-face {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  /* @mechanism 背朝自己时不绘制 */
  backface-visibility: hidden;
  border: 1px solid rgb(60 48 30 / 0.3);
  font: 400 13px/1.6 system-ui, sans-serif;
}

.fc-face b {
  font-size: 19px;
}

.fc-front {
  background: #efe9dd;
  color: #1c1a17;
}

.fc-back {
  /* @mechanism 背面要预先转过去，否则它本来就朝外 */
  transform: rotateY(180deg);
  background: #7c5cff;
  color: #f6f2ff;
}
```

## 边界

- `perspective` 必须写在外层容器上。写在参与旋转的元素自己身上，看到的是「压扁」而不是「转过去」。
- `transform-style: preserve-3d` 缺了的话两个面会被压平并重叠，看到的是两块内容糊在一起。
- `backface-visibility: hidden` 缺了的话背面元素会以镜像显示，看到反着的字。
- 背面那一面必须预先 `rotateY(180deg)`，否则两面的初始朝向相同，翻过去看到的还是正面。
- `preserve-3d` 会被 `overflow: hidden`、`filter`、`opacity` 小于 1 打断——它们强制创建层叠上下文并把 3D 压平。这是最难查的一类「翻转忽然不转了」。
- 两个面都要 `position: absolute` 并且父级 `position: relative`，否则高度得靠写死。

## 备注

- `cubic-bezier` 在中间段更慢一点，翻面会显得有实体重量。线性过渡像在滑屏。
- 把 `rotateY` 换成 `rotateX` 就是上下翻，换成两个轴组合就是斜翻——机制完全一样。
