---
title: 多层动画叠加
slug: animation-composition-accumulate
category: 动效
tags: [animation-composition, keyframes, transform, 容器, 自动]
since: 2026-10
source: 机制来自 CSS Animations Level 2 的 animation-composition，自行实现
when: 元素身上有两条动画改同一个属性，后一条把前一条整个顶掉了
stage: grid
tier: core
params:
  - { name: dur, label: 一个来回, type: range, min: 1, max: 5, step: 0.2, default: 2.6, unit: s }
---

## 描述

方块一边横向来回飘、一边上下浮动，走出一个不断变化的八字轨迹——这是两条各自独立的动画同时生效的结果。

机制是 ==animation-composition: accumulate 让第二层的值累加到第一层已经算出的值上，而不是整份替换它==。默认的合成方式是 `replace`：同一属性上多条动画同时生效时，`animation-name` 列表里靠后的那条把前面那条的结果**整份覆盖**（不是取平均，也不是按权重混合）。所以「元素本来在飘 + 悬停时再浮一下」这种写法一重叠就只剩一条在动。改成 accumulate 之后，两层都留下：同为 `translate` 就是向量相加，同为 `rotate` 就是角度相加；遇到不同类型的函数（一个 `translateX`、一个 `translateY`）会退化成串接——也就是矩阵相乘，视觉效果仍然是两层同时成立。

值得先记住的是这件事发生在哪一层：合算是**动画与动画之间**的。一条动画内部的关键帧之间一直是常规插值，跟这条属性无关；`@keyframes` 写多少帧都不需要它。真正需要它的是「一个效果由两个独立的运动叠加而成」的场合——飘动叠加呼吸、旋转叠加抖动、悬停叠加常驻。

每条动画的合成方式可以各不相同，因为 `animation-composition` 和 `animation-name` 一样是逐项对应的列表，所以完全可以只让第二层累加、第一层保持 replace。两条动画的周期是主要的设计变量：取互质的时长（示例里 2.6 秒与 3.38 秒）轨迹不会很快重复，取相同周期会退化成一条来回的直线——那反而看不出两层在叠加。缓动则建议都用 `ease-in-out` 一类对称曲线，否则两个方向的观感会打架。

## 代码

```html
<div class="ac">
  <input class="ac-switch" id="ac-on" type="checkbox" checked>
  <label class="ac-label" for="ac-on">叠加两层动画</label>
  <div class="ac-field">
    <i class="ac-dot"></i>
  </div>
</div>
```

```css
.ac {
  font: 400 14px/1 system-ui, sans-serif;
  color: #1b1710;
}

.ac-switch {
  margin-right: 6px;
}

.ac-label {
  display: inline-block;
  margin-bottom: 12px;
}

.ac-field {
  display: grid;
  place-items: center;
  width: min(320px, 80vw);
  height: 200px;
  border: 1px solid rgb(60 48 30 / 0.25);
  border-radius: 16px;
  background:
    linear-gradient(to right, rgb(60 48 30 / 0.09) 1px, transparent 1px) 0 0 / 40px 40px,
    linear-gradient(to bottom, rgb(60 48 30 / 0.09) 1px, transparent 1px) 0 0 / 40px 40px,
    rgb(255 255 255 / 0.45);
}

.ac-dot {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: #b4462f;
  /* @mechanism 两层动画都改 transform：默认的 replace 会让后一层把前一层吃掉 */
  animation:
    ac-drift var(--dur, 2.6s) ease-in-out infinite alternate,
    ac-bob calc(var(--dur, 2.6s) * 1.3) ease-in-out infinite alternate;
  /* @mechanism accumulate：第二层的值累加到第一层的结果上，两层同时成立 */
  animation-composition: accumulate, accumulate;
}

/* 取消勾选做对照：合成方式回到 replace，横向那层整个消失，只剩上下浮动 */
.ac-switch:not(:checked) ~ .ac-field .ac-dot {
  animation-composition: replace, replace;
}

@keyframes ac-drift {
  from {
    transform: translateX(-72px);
  }
  to {
    transform: translateX(72px);
  }
}

@keyframes ac-bob {
  from {
    transform: translateY(-46px);
  }
  to {
    transform: translateY(46px);
  }
}
```

## 边界

- `replace` 是初始值，也是这里唯一要改掉的东西。忘了写 `animation-composition` 不会报错也不会有警告，只是第二条动画看起来「把第一条吃了」——排查时先数一数有几条动画在改同一个属性。
- 元素自己的 `transform` 也会被算进去：基值不为 `none` 时，accumulate 是累加到它上面。想要精确控制就把基值清干净。
- 数值相加只在**同类型**的 transform 函数之间发生。`translateX` 与 `translateY` 名字不同，走的是串接（矩阵相乘）；结果符合直觉，但别把「相加」当成对所有组合都成立的承诺。
- 它对「无界量」友好，对 0–1 之间的量不友好：两条动画都改 `opacity` 时数值是直接相加并截断到 1 的，稍微一叠就饱和成不透明，这类属性上叠加没有意义。
- 只与动画之间有关。CSS 过渡与动画在同一属性上相遇时不走这套合算规则，不要把两者混在一起指望出第三种效果。
- 支持面已经不窄（Chromium 112+ / Safari 16+ / Firefox 115+），但旧引擎上会退化成 replace：静默丢掉一层运动，画面「还动」，只是不对。

## 备注

- 这块元素叠两个动画的写法本身是另一条咒语，那条里有一条规矩：两组动画不能碰同一个属性。这一条正是那条规矩的解药——碰上了，就有 accumulate 让它们共存。
- 同一个属性的多条动画还可以用 `add` 串接。想在「相加」与「拼接」之间选，就看你要的是「同样的运动叠一份」还是「两种变换乘在一起」。
