# 画框素材

缩略图与图版外面那圈框，来自本目录的 `rule-frame.png`，由 `border-image` 以九宫格穿上。

## rule-frame.png —— 双细线

| 项 | 内容 |
|---|---|
| 尺寸 | 96 × 96，RGBA |
| 切片 | **32**（必须与 CSS 里 `border-image` 的 slice 一致） |
| 生成脚本 | `scripts/make-frame.mjs`（零依赖，`node scripts/make-frame.mjs`） |

几何：素材是切片的 3 倍，九宫格九块都是 32×32，中间那块 `border-image` 不会绘制。
每一像素的「深度」取它到最近边的距离，两条线落在深度 **0–4** 和 **8–12**，
中间 4–8 压一道底色当缝。于是线宽与线距都是**边框宽度的固定比例**：
缩略图 13px 框上是两道约 1.6px 的金线夹一道 1.6px 的缝，图版 30px 框上是约 3.8px。

## 为什么最后是双细线

这是试错之后的结果，不是第一选择——把过程留下，免得下次又从头绕一遍。

一开始的想法是「找一只现成的欧式花框来用」，理由是装饰要像印上去的、不像发光出来的。
试过的都栽在同一个物理限制上：**边条在缩略图上只有 13px 深，花纹细过一个像素就糊成锯齿。**
把边框加宽到花纹看得清时，花框又压过了内容本身。

| 试过的 | 出处 / 许可 | 为什么没用 |
|---|---|---|
| Lustro 002 卷草花框 | [Commons](https://commons.wikimedia.org/wiki/File:Lustro_002.svg)，CC0 | 四边连续的卷草与玫瑰结，13px 上糊成一排细齿；用户评为「过于复杂」 |
| Typographic frames — Ostell 1848 | [Commons](https://commons.wikimedia.org/wiki/File:Typographic_frames_-_Ostell_1848.svg)，公共领域 | 1848 年活字样本里的真花框。取中段当边块、沿边垫空拉开间距后能读清，但仍然「很丑」 |
| Ornate Frame Line Art 等 Openclipart 线描框 | Openclipart，CC0 | 墨迹率只有 5–11%，在 13px 上几乎消失 |
| RPGUI golden border | Zlib | 16 位像素游戏的对话框描边，放在暗黑哥特的书里像《我的世界》 |

结论：**13px 的框上不该有花纹。** 古书里的整版插图本来也大多只用双细线锁边——
朴素、像印上去的，而且没有任何会随缩放坏掉的细节。花框的候选素材已从仓库删掉，
出处记在上表里，需要时可以按链接重新取。

## 用法

```css
/* 缩略图 */
border: 13px solid transparent;
border-image: url('../frames/rule-frame.png') 32 / 13px repeat;

/* 图版：同一张素材，边框更宽，线跟着变粗 */
border: 30px solid transparent;
border-image: url('../frames/rule-frame.png') 32 / 30px repeat;
```

窄屏断点（≤860px）只改边框宽度（缩略图 9px、图版 18px），slice 不动。

两处都**不写 `border-radius`**：边框是方的，圆角会把角上的线切掉。
这是全书唯一不用 `--radius` 的地方，是刻意的例外，不是漏改。
