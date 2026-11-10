# 借鉴的 UI 风格：Claude Manager（仓库 `kp-z/Claudeadventure`）

> 用户口径：**只借鉴 UI 风格，不借鉴功能**。参考项目克隆在本机 `/Users/kp/DEV/Claudeadventure`
> （项目内部自称 Claude Manager v4.2.0，Figma Make 导出）。本文件是「从它身上提取的风格语言 +
> 落到 DSH 插件时的换算规则」，不是功能对照表。

## 1. 提取到的风格（都带出处）

| 维度 | 参考项目怎么做的 | 出处 |
| --- | --- | --- |
| 卡片（核心） | `bg-white/5` + `border-white/10` + `backdrop-blur-md` + `rounded-2xl`(16px) + `p-6` + `shadow-xl`：**深色玻璃拟态** | `src/app/components/ui-shared.tsx:12-27`（GlassCard） |
| 悬停 | `whileHover={{ y: -5, scale: 1.01 }}`、`hover:border-white/20`、`transition-all duration-300`；叠一层 `from-blue-500/5 to-purple-500/5` 渐变淡入 | 同上 `:15-24` |
| 层级 | 用**白色透明度**分层（5% / 10%，边框 5% / 10%），不是灰阶堆叠 | 全仓统计：`bg-white/5` 173 次、`border-white/10` 149 次、`bg-white/10` 71 次 |
| 圆角 | `rounded-full` 106 次 / `lg`8px 132 / `xl`12px 230 / `2xl`16px 44；基底 `--radius: 0.625rem`(10px) | 组件统计 + `src/styles/theme.css:31` |
| 间距 | `gap-2/3/4`（8/12/16px）、`p-2/3/4/6`（8/12/16/24px）；卡片内边距偏大（`p-6` 87 次） | 组件统计 |
| 字号 | 正文密集用小号：`text-sm` 266 次、`text-xs` 235 次；标题 `text-xl` 等 | 组件统计 |
| 字体 | Inter（UI）/ JetBrains Mono（代码） | `src/styles/fonts.css:1` |
| 动效 | 入场 `opacity 0→1 + y 20→0`；hover `scale 1.05`；宽度展开；过渡 300ms | `motion` 用法统计（`initial/animate/whileHover`） |
| 语义色 | blue/purple/green/gray 500 各带 20/40/60% 透明度做光晕与描边；图表 5 色 | `src/styles/theme.css:44-64`、`:28-30`（chart-1..5） |
| 主题体系 | shadcn 口径的 token 组 + `.dark` 覆盖（oklch 无色相灰阶） | `src/styles/theme.css:3-95` |

## 2. 落到 DSH 插件时的换算规则（硬约束）

DSH 官方插件实践要求插件 UI **像宿主**：只消费 `--dsw-alias-*` 令牌，字面量颜色只用于 artwork。
而参考项目的玻璃感大量依赖 `rgba(255,255,255,.05)`、`rgba(59,130,246,.2)` 这类字面量。
**换算办法：用 `color-mix(in oklab, <宿主令牌> X%, transparent)` 复刻同样的透明度分层**——
零字面量颜色，宿主明暗两套仍然跟着走（我们自己的测试也在钉这条红线）。

| 参考项目的写法 | 我们的等价写法（只用宿主令牌） |
| --- | --- |
| `bg-white/5` | `color-mix(in oklab, var(--dsw-alias-bg-layer-1) 92%, transparent)` |
| `border-white/10` | `1px solid color-mix(in oklab, var(--dsw-alias-border-l1) 65%, transparent)` |
| `shadow-xl` | `0 8px 24px color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent)` |
| hover 渐变 `from-blue-500/5 to-purple-500/5` | `linear-gradient(135deg, color-mix(in oklab, var(--dsw-alias-brand-primary) 6%, transparent), transparent 72%)` |
| rarity/状态光晕 `rgba(34,197,94,.4)` | `color-mix(in oklab, var(--dsw-alias-state-success-primary) 35%, transparent)` |
| `backdrop-blur-md` | `backdrop-filter: blur(12px)`（不涉及颜色，直接用） |
| `rounded-2xl` / `--radius: .625rem` | 卡片 12px、容器 10px、胶囊 999px |
| `whileHover={{ y:-5, scale:1.01 }}` | CSS `transition: 300ms cubic-bezier(.2,.8,.2,1)` + `transform: translateY(-3px) scale(1.01)`，并尊重 `prefers-reduced-motion` |
| `text-sm` / `text-xs` 密度 | 正文 12px、次级 11px、标题 13px/600（跟宿主列表页同量级，不要放大） |

## 3. 明确不抄的

- Cinzel 游戏字体与 `claude-adventure-mode` 的「全部 cursor:pointer」。
- 稀有度光晕（common/rare/epic/legendary）——那是游戏化语义，不是我们的状态模型。
- 具体色相（blue/purple）不硬编码：只保留「一层品牌色 + 一层状态色」的搭配方式。
- MUI / Radix / Tailwind 组件与其依赖：不引入插件包（会把它的调色板与体积带进来）。
