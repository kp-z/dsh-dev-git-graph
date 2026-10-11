# dsh-daily 进度台账（STATUS）

> 每轮唤醒后**先读这里**，做完**必更新这里**。格式固定：轮次 / 做了什么 / 证据 / 阻塞 / 下轮起点。

## 当前状态

- **阶段**：H1 完成并**已在运行中的宿主验证通过**；下一步按 PLAN 进 H2 收尾 → H3
- **负责人**：主 Agent（用户授予完全权限，自治推进）
- **自动化**：`schedule-ce16b3fe-2262-4f86-9a93-023e8de5aee7`（每小时一轮开发）
- **时间锚点**：2026-10-12 01:06 (+08:00)
- **目标 id**：goal-1980db41-f9fa-4117-9295-1cd41ac285cc

## 轮次记录

### R0 · 2026-10-12 00:45 — 侦察与立项

**做了什么**
- 三通道侦察是否已有同类插件：本工作区 `packages/*`、本机 profile 35 个 bundle、社区插件索引 `community.json`（132 条，dsh-market.com 的唯一数据源）
- 实测 20+ 个候选数据源的可达性，确定采集层必须走镜像池
- 产出竞品报告 `docs/DAILY-PLUGIN-RECON.md`、本插件计划 `PLAN.md`、本台账

**证据**
- 竞品命中：`@hyzyn/dsh-rss@0.4.7`（近亲，但无侧栏常驻网页/无对话式调教/无视频索引）
- 网络实测：HN / arXiv(https) / 少数派 / 阮一峰 / Solidot / IT之家 / B站(popular·ranking·view) / GitHub API 均 ✅；
  YouTube 官方、Invidious、Piped、Google News、HuggingFace、GitHub Trending HTML 均 ❌；
  RSSHub 公共镜像 8 个里**仅 `rsshub.ktachibana.party` 可用**

**阻塞**：无

### R1 · 2026-10-12 00:45–01:06 — H1：骨架贯通（并顺带做完了 H2/H3/H4 主体）

**做了什么**
1. **采集层**：零依赖 RSS2.0/Atom/RDF 解析器（子代理交付，28 组断言）+ 11 个源适配器
   （HN / arXiv / GitHub Search / YouTube 经 RSSHub 镜像池 / B站热门 / B站排行 / 少数派 / IT之家 / Solidot / 阮一峰 / 自定义 RSS）
   + 镜像池（健康度持久化 + 成功优先排序 + 失败原因聚合）+ 单源失败隔离
2. **排序引擎**（`rank.ts`）：URL 规范化去重 → 标题相似度合并 → 关键词分类 → 乘法评分
   （新鲜度半衰期 × 源权重 × 主题命中 × 关键词 × 热度信号）→ 每源配额；每条都带**可解释理由**
3. **自然语言调教**（`tune.ts`）：纯函数解析「以后每天多推 AI Agent 相关的，少推币圈」→ 主题/关键词/屏蔽词/源权重/配额，落盘 prefs 并**立即重排**
4. **日报与主动推荐**：`render.ts` 生成按主题分组的 Markdown；`prompt.ts` 把紧凑摘要注入 systemPrompt（默认 6 条，缓存求值，因为 section 的 text 必须同步）
5. **定时**：`schedule.ts` 自串链 setTimeout（每天 08:00，非 24h 间隔，天然纠正漂移）
6. **HTTP + 侧边栏**：`/dsh-daily/` 直出网页 + `/dsh-daily/api/*`；`betterSidebar.registerTab` 注册「日报」tab（iframe，主题双通道）
7. **网页**（子代理交付）：分类 chips / 搜索 / 仅未读 / 视频卡（封面·时长·播放量）/ 👍👎✓隐藏 / 调教输入 / 刷新浮层（绝对定位不推版）/ 明暗主题 / 280–420px 自适应
8. **7 个模型工具** + 装机脚本 + 三个开发脚本（probe / dev-server / install-to-profile）

**证据（真实输出）**
- 采集探针 `node scripts/probe-sources.mjs`：**11 个源、107 条原始条目、50038ms**，去重自检 **重复 URL 0 条**
- 解析器单测：`node --test test/` → **tests 28 / pass 28 / fail 0**
- 类型检查：`tsc -p tsconfig.json --noEmit` → **0 error**
- 宿主路由（运行中的 19387 实例，实时挂载）：`GET /dsh-daily/` → **200**，`GET /dsh-daily/api/state` → 200 且返回 67 条真实数据
- 宿主工具注册（子代理用 cordis Inspect 独立复核）：`daily_*` **7/7 已注册**，并实调 `daily_sources` 返回真实源状态
- 装机：`scripts/install-to-profile.mjs desktop` → `~/.dsh/profiles/desktop/node_modules/dsh-daily-v2`
- commit：`1c205f6 dsh-daily：日报插件 H1 骨架贯通`

**本轮踩到并解决的两个真坑（写进 README，避免复现）**
1. **`link:` 装法在这个宿主上必坏**：dsh 的插件解析根是 `$DSH_HOME/profiles/node_modules`（里面 `@deepseek-ai/*` 全是指向 dsh 安装目录的符号链接），
   而 Node 解析取**真实路径** —— 符号链接会让真实路径落回工作区，绕过这条链，报
   `Cannot find package '@deepseek-ai/dsh-tools'`。**必须装成真实目录**（装机脚本已处理）。
2. **Node 会缓存失败的模块实例化**：第一次 `enable` 时因为坑 1 触发 SyntaxError，之后即使把安装改成正确的真实目录，
   同一个模块 URL 仍然一直报 `failed to import`。换目录名（改 URL）后立刻 `applied`。**遇到这种情况就换名或重启**。

**阻塞**：无（`bilibili-ranking` 偶发 B 站 `-352` 风控、YouTube 镜像 429/503 —— 均已被单源失败隔离兜住，不阻塞）

**下轮起点**：H2 收尾（YouTube 时长归一化 / HN 讨论链接 / 封面降级）→ H3（rank 与 tune 的单测 + 调教前后 Top10 对比证据）
