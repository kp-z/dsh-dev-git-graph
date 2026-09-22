---
title: 按自定义属性换样式
slug: container-style-query
category: 布局
tags: [style-query, container-query, custom-property, 卡片]
since: 2026-10
source: 机制来自 CSS Containment 规范的 @container style() 查询，自行实现
when: 一个组件要按它所在区域的「密度」「主题」换样式，又不想给每种组合都加一个类
stage: grid
tier: candidate
---

## 描述

组件本身没有任何修饰类，样式却跟着它所在的那块区域变——因为被查询的不是宽度，是那块区域身上的一个自定义属性。

机制是 ==@container 的 style() 查询读的是容器上的自定义属性值，而不是它的尺寸==。这跟 `container-type: inline-size` 的宽度查询是两回事：宽度查询要先给容器加尺寸收容（子元素从此不参与父级的内在尺寸），而 `style()` 要的只是一个容器身份——`container-type: normal` 配 `container-name` 就够，代价小得多。

于是同一个卡片放进「紧凑」区和「宽松」区，各自长出自己的内边距、字号与行高，而卡片自己的选择器里一条变体都没写。整块区域的密度由外层一个属性控制，越权修改卡片完全不必。

## 代码

```html
<section class="theme" style="--density: compact">
  <article class="card-body">
    <h3>票据摘要</h3>
    <p>这块的密度是外层给的，卡片自己没有选择器。</p>
  </article>
</section>

<section class="theme" style="--density: roomy">
  <article class="card-body">
    <h3>票据摘要</h3>
    <p>同一段 HTML，换了个容器属性就换了版式。</p>
  </article>
</section>
```

```css
.theme {
  /* @mechanism style() 要的是容器身份而不是尺寸收容，normal 就够 */
  container-name: theme;
  container-type: normal;
  max-width: 320px;
  padding: 12px;
  background: rgb(255 255 255 / 0.5);
  border: 1px solid rgb(60 48 30 / 0.25);
}

.card-body {
  padding: 10px 12px;
  font-family: system-ui, sans-serif;
  color: #1c1a17;
}

.card-body p {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.6;
}

/* @mechanism 查询的是容器身上那个自定义属性的值，不是它的宽度 */
@container theme style(--density: compact) {
  .card-body {
    padding-block: 6px;
    font-size: 13px;
  }

  .card-body h3 {
    margin: 0;
    font-size: 15px;
  }
}

@container theme style(--density: roomy) {
  .card-body h3 {
    margin: 0 0 4px;
    font-size: 21px;
    letter-spacing: -0.01em;
  }

  .card-body p {
    font-size: 15px;
    line-height: 1.75;
  }
}
```

## 边界

- `style()` 只能查**自定义属性**，普通属性（`color`、`padding`）查不到，写了也不匹配——现象是「规则明明对，就是不生效」。
- 匹配是**值相等**，且按 token 序列比对，不做数值计算。`--density: 12px` 和 `--density: 12.0px` 不是同一个值，所以没法做「大于 12px 就用大字」这类判断。
- 容器名不能省。省掉容器名时浏览器会往上找最近的那个容器，中途遇到别人声明的容器就会拦下来，结果取决于祖先顺序。
- 要同时做宽度查询就得写 `container-type: inline-size`，那样才付出尺寸收容的代价；只做样式查询时别再顺手加上，否则组件的内在尺寸不再影响祖先。
- 容器元素自己不受 `@container` 规则影响（容器不是它自己的后代），最外层的 `.theme` 想跟着变形得另写。
- 查询求值跟随自定义属性的继承。`--density` 若写在 `:root` 上，会一路继承到每个容器，所有区域都变成同一个值——看着像「查询失效」，实际是属性传下去了。

## 备注

- 同一套写法还能承载「暗色/亮色」「圆角等级」「高对比」这些跨组件的形态开关，一个区域一个值。
- 与 `@media (prefers-*)` 配合时，媒体查询决定区域属性、样式查询把属性分发给组件，职责分得很干净。
