# 任务完成度评估 · 知识库

> 用途：给 Insight 卡片的「评估口径」提供依据。只收**能用本地数据算出来**的指标，
> 不能从任务与对话记录里算出来的（比如心率、主观疲劳）一律不列。

## 1. 流程度量（Kanban / 排队论）

| 概念 | 定义 | 在本插件里怎么算 |
| --- | --- | --- |
| WIP | 同时在做的任务数 | `started && !done` 的任务数 |
| 吞吐 Throughput | 单位时间完成的任务数 | 每天 `completedAt` 落在当天的任务数 |
| 周期时间 Cycle Time | 单个任务从开工到完成的时长 | `completedAt - startedAt`，取中位数与 85 分位 |
| 利特尔法则 | `平均周期时间 = 平均 WIP ÷ 平均吞吐` | 用来做「预测」：按当前 WIP 与吞吐推算还要几天做完 |

结论用法：**WIP 越高，单个任务耗时越长**（Little's Law 是线性关系）。所以「同时开了 9 条」不是勤奋，是让每条都变慢。
[Little's Law 与 WIP 限制](https://www.resumelens.org/blog/kanban/wip-limits-and-littles-law) ·
[Little's Law 公式与周期时间](https://agility-at-scale.com/principles/littles-law/) ·
[Kanban 里的 Little's Law](https://getnave.com/blog/kanban-littles-law/)

## 2. 切换成本（认知科学）

- 多任务切换会显著增加完成时间，任务越复杂切换成本越高；
  简单切换只有几百毫秒，但频繁叠加可以吃掉约 **40%** 的有效工作时间
  （[APA: Multitasking — switching costs](https://www.apa.org/topics/research/multitasking)）。
- 数字工作者每天在应用间切换接近 1200 次，每周约 4 小时用于「重新找回上下文」
  （[HBR 2022 Toggle Tax](https://hbr.org/2022/08/how-much-time-and-energy-do-we-waste-toggling-between-applications)）。
- 切换后平均约 9.5 分钟才能恢复到有效工作状态
  （[Qatalog × Cornell Workgeist 报告](https://assets.qatalog.com/language.work/qatalog-2021-workgeist-report.pdf)）。

结论用法：**单日「活跃任务数」越多、任务切换次数越高，切换税越重**。
本插件用「当日活跃任务数」与「同日推进的任务数」作为切换税代理指标，超过阈值时提示收敛。

## 3. 计划误区（Planning Fallacy）

人对任务耗时的估计系统性偏低（Kahneman & Tversky）。可用本地数据校准：
把「开工 → 完成」的实际中位周期，和你自己的口头预期（任务截止日）对比，周期性提示偏差。

结论用法：Insight 里给「周期中位数 / 85 分位」，而不是给「预计完成时间」——后者是猜测，前者是事实。

## 4. 里程碑（Milestone）视角

- 里程碑不是任务：它衡量「阶段是否达成」，适合看**累计完成曲线**与**剩余量**。
- 常用判据：剩余任务数相对累计速率的斜率（burndown 的斜率）为正 → 在收敛；为负 → 在发散。

结论用法：Insight 的折线图展示「累计完成」与「在跑 WIP」，两条线反向说明在收敛，同向说明在堆活。

## 5. 完成偏好（Completion Bias）

人对「短任务」有天然的完成偏好（完成感强、反馈快），于是长任务被反复推迟。
用本地数据能观察到：**编号小 / 开工早但一直没完成的任务** 就是被偏好的反例。
Insight 的推荐排序里给这类任务加权（停滞越久权重越高）。

## 6. 这份知识库约束了什么

1. 只用本地可得数据：时间戳、状态、会话活动、文档产出、评论次数。
2. 不做心理测评式的判断（不猜情绪、不打性格分）。
3. 指标给区间与分位数，不给伪精确的单点预测。
4. 所有结论必须能回溯到某条任务或某个时间点（Insight 的每条问题都带 taskNo 与证据）。
