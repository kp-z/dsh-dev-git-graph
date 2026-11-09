# dsh-ios-skin 主题可行性评估

对照官方 `@deepseek-ai/dsh-client-ui-theme` 0.1.5-rc.2 的规范与实际代码，审查 `docs/ios-glass-demo.html`
演示的那套设计能否在真实 DSH 上落地。**证据来自随应用发布的主题包与官方前端 CSS，不是跑起来实测。**

## 一、规范给出的扩展面

| 能力 | 契约 | 出处 |
|---|---|---|
| 注册主题 | `register({ id })`；`id` 不能是 `system`，重复 id 抛错；返回卸载函数 | `lib/client.js` |
| 覆盖 token | `overrideTokens(source, tokens)`；按 source 叠层，返回卸载函数 | `lib/client.js` |
| token 取值形状 | 必须是 `{ light, dark }` 成对字符串；传裸字符串**抛 TypeError** | `validateOverrides` |
| 颜色权威 | token 样式表是颜色值的唯一权威；设计系统缺的值有意不补 | `README.zh.md` |
| 圆角 | `@supports (corner-shape:superellipse(1.5)){*,:before,:after{corner-shape:var(--dsw-corner-shape)}}` | `corner-shape.css` |
| 正圆例外 | `border-radius:50%` 与胶囊半径必须与 `corner-shape:round` 配对，否则被超椭圆压变形 | `README.zh.md` |
| 滚动条 | `--dsh-scrollbar-thumb` / `-hover`；高层级表面重绑为 l2；`transparent` 合法；WebKit 与 Firefox 两条互斥路径 | `README.zh.md` |
| 第三方主题持久化 | 注册的主题 id 只存在于进程内，**不跨内置 settings schema** | `README.zh.md` |

## 二、逐项可行性

| 演示里的设计 | 落地机制 | 判定 |
|---|---|---|
| 纯色画布 | `--dsw-alias-bg-base` 覆盖 | 可行，规范内 |
| 半透明玻璃面 | `backdrop-filter` + `--dsw-mask-blur` | 可行，但 blur 值是自己写的，非 token 驱动 |
| 统一 14px 圆角 | 直接设 `border-radius` | **可行但有回归**，见问题 1 |
| 圆角渲染为超椭圆 | 官方已用通配选择器全局套用，无需自己做 | 可行，免费得到 |
| 发丝描边与 iOS 阴影 | `--dsw-elevation-stroke-color` / `--dsw-elevation-panel` / `--dsw-elevation-prominent` | 可行，**这正是规范推荐的语义 token** |
| 深色配色 | token 分浅深两套 | 可行 |
| 顶栏保持平面 | `[class*='_header']` | **脆弱**，见问题 3 |
| 桌面壳毛玻璃联动 | `.dshDesktopSidebarSurface` / `body[data-dsh-desktop-mode]` | **脆弱**，同上 |
| 可读性下限 | `pre` `code` `input` 等元素选择器 | 可行，依赖面最小 |
| 滚动条微调 | 重设 `--dsh-scrollbar-thumb` 等 | 可行，与规范约定一致 |

## 三、确认的问题

### 问题 1（必然回归）：统一圆角会把官方的真圆控件压成方角

官方 `index-DPX2bQLO.css` 里 4 条 `border-radius:50%` 规则**全部**配了 `corner-shape:round`（4/4），
说明官方刻意维持这些正圆。而本插件有一条

    body.dsh-ios-skin :is(button,[role='button'],[role='tab'],[role='menuitem']){border-radius:var(--dsh-ios-radius)}

特异性高于官方，会把圆形图标按钮、发送键这类正圆控件重写成 14px 超椭圆。
修法：圆角统一只作用于容器类表面，**不再对 button/tab/menuitem 设圆角**，保留官方正圆。

### 问题 2（迁移即报错）：14 个 token 只有浅色取值

浅色块 101 个 token，深色块 87 个，差集 14 个：

    --dsw-font-family  --dsw-mask-blur  --dsw-hovercard-bg  --dsw-alias-border-inverted
    --dsw-alias-markdown-code-segment-unselected  --dsw-elevation-stroke-color
    --dsw-elevation-stroke  --dsw-elevation-panel  --dsw-elevation-prominent  --dsw-elevation-soft
    --dsw-shadow-lv1  --dsw-shadow-lv1-blur  --dsw-shadow-lv2  --dsw-shadow-lv3

这些恰好是**与配色无关**的项（字体、阴影与 elevation 配方、遮罩模糊），靠 `--dsh-ios-*` 间接引用也能在两套主题下正确取值。
但 `validateOverrides` 要求逐 token 给 `{light, dark}` 对，直接迁到 `overrideTokens` 会抛 TypeError。
迁法：把这 14 个的值在深色块里重复一遍（值相同也要各写一次）。

### 问题 3（架构性）：材质层依赖 hash 后的内部类名

`[class*='_header']`、`[class*='_panelList']`、`.dshDesktopSidebarSurface` 都是构建产物或内部实现，
不属于规范扩展面。官方任一版本改了组件名或 hash 规则，这一层就会静默失效——**不报错，只是玻璃消失**。
这是当前设计里最大的长期风险，也是"只画不接管"的代价。

### 问题 4（产品性）：主题无法成为持久化的用户偏好

规范明确：注册的第三方主题 id 是进程内扩展，不跨内置 settings schema。
所以本插件无法出现在「通用 → 外观」的下拉里被持久选择；
它只能是"装上就生效"的覆盖层，或者另做一个设置项自己持久化。

## 四、建议的迁移

1. **token 层改用 `ctx.theme.overrideTokens`**：受校验、可叠加、卸载即还原，且不再靠特异性压官方。
   需要 14 个 token 补齐深色取值。代价是插件要声明对 theme 服务的依赖（缺服务时需降级而不是崩）。
2. **材质层保留为样式表，但明确标注为脆弱契约**：加一条启动自检——若一个都没匹配上，说明官方类名变了，
   应在控制台明确报警，而不是静默失效。
3. **去掉对 button/tab/menuitem 的圆角覆盖**，修掉问题 1。
4. **不追求的**：把主题做成可持久选择的内置外观项（规范不允许）。

## 五、结论

演示的**视觉目标可行**：纯色画布、毛玻璃面、统一超椭圆圆角、发丝描边、深浅两套配色，全都能在真实 DSH 上实现，
其中圆角统一与 elevation 描边恰好是规范推荐的语义 token 路径。

但**当前实现方式有一处必然回归（问题 1）和一处架构脆弱点（问题 3）**，另有一处迁移障碍（问题 2）。
按第四节改完之后，这套设计是成立且合规的。
