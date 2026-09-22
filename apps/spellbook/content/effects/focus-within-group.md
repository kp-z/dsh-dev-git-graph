---
title: 整块区域跟随焦点
slug: focus-within-group
category: 交互
tags: [focus, 表单, 容器, 焦点]
since: 2026-09
source: 机制来自 CSS Selectors 的 :focus-within，自行实现
when: 焦点落在框里的某个输入项时，整块区域都该有提示
stage: plain
tier: core
---

## 描述

Tab 进某个输入框时，整块表单区一起亮起边框，用户一眼知道自己在哪一块。

机制是 ==:focus-within 匹配「内部有元素获得焦点」的容器==。它是 `:has(:focus)` 的专用版，但出现更早、支持更广、语义更明确。用它给整行、整张卡片、整块表单一个统一的聚焦提示。

键盘用户的定位感主要就靠这类整体反馈建立。

## 代码

```html
<div class="fw">
  <div class="fw-group">
    <label class="fw-label">第一组</label>
    <input class="fw-input" placeholder="点我或 Tab 到我" />
  </div>
  <div class="fw-group">
    <label class="fw-label">第二组</label>
    <input class="fw-input" placeholder="整组会一起亮" />
  </div>
</div>
```

```css
.fw {
  display: grid;
  gap: 12px;
  width: min(360px, 82vw);
}

.fw-group {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid rgb(60 48 30 / 0.26);
  background: rgb(255 255 255 / 0.42);
  transition: border-color 0.2s, box-shadow 0.2s;
}

/* @mechanism 容器内的元素获得焦点时，容器本身匹配 */
.fw-group:focus-within {
  border-color: #b4462f;
  box-shadow: 0 0 0 3px rgb(180 70 47 / 0.14);
}

.fw-label {
  font: 500 12px/1 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.6);
}

.fw-input {
  padding: 9px 11px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.7);
  font: 400 15px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}
```

## 边界

- 嵌套容器会**同时**匹配：外层分组与内层分组都亮起来。需要显式把外层关掉，否则会看到两圈边框叠着。
- 它分不出键盘与鼠标——鼠标点进输入框同样会匹配。要只在键盘操作时提示，得用 `:has(:focus-visible)`。
- 它不会把焦点「移」到容器上，只是样式。焦点始终在内部那个可聚焦元素上。
- 容器本身若不可聚焦，它只反映内部状态——键盘用户跳过整组时不会有任何提示，这是它的正常表现。
- 它比 `:has()` 可靠得多（支持面更广、语义更专一）。能用 `:focus-within` 表达的意图就别用 `:has()`。

## 备注

- 配 `:has(:focus-visible)` 可以做到「鼠标点不亮、Tab 进来才亮」，是更讲究的一层。
- 把提示做成整体变化（边框 + 外圈）而不是只改输入框本身，定位感会强很多。
