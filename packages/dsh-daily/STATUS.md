# dsh-daily 进度台账（STATUS）

> 每轮唤醒后**先读这里**，做完**必更新这里**。格式固定：轮次 / 做了什么 / 证据 / 阻塞 / 下轮起点。

## 当前状态

- **阶段**：H1 完成并在运行中的宿主验证通过；**H2 已收尾、H3 已交付**；下一步 H4（验证主动推荐真的被模型提起）→ H5 → H6
- **负责人**：主 Agent（用户授予完全权限，自治推进；用户明确要求**不要反复确认、不要提问**）
- **自动化**：`schedule-ce16b3fe-2262-4f86-9a93-023e8de5aee7`（每小时一轮开发）
- **时间锚点**：2026-10-12 02:10 (+08:00)
- **目标 id**：goal-1980db41-f9fa-4117-9295-1cd41ac285cc

### ⚠️ 运维事实（每个轮次都要记住）

**host 侧的代码改动对已经运行的 dsh 进程无效。** Node 会缓存**已成功导入**的 ESM 模块，
`plugin_manager set_plugin` 的 enable 切换只是重建 fiber，不会重新读盘。
所以：改完 host 代码 → 必须重启 dsh 才能看到效果；`npm test` 与探针脚本不受影响（它们是新进程）。
另外客户端半体（右侧栏 tab）本来就要重启才会被 `clientModules` 扫进图里。

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

### R2 · 2026-10-12 01:10–02:10 — H2 收尾 + H3（测试与效果证据）

**做了什么**
1. **YouTube 时长归一化**（`normalizeDuration`）：`PT12M34S` / 纯秒数 `754` / `12:34` 三种写法统一成 `mm:ss`，认不出来就返回 undefined（宁可不显示也不要显示错的）
2. **HN 讨论链接**：新增 `RawItem.discussUrl`，从 hnrss 的 `Comments URL` 抠出 HN 讨论页，日报里以 `· [讨论](url)` 呈现
3. **镜像池预热**（`MirrorPool.warmUp`）：**并行**探一遍所有镜像、按延迟排序，把"发现哪些镜像活着"的成本从**每频道一份**降到**整轮一份**
4. **rank / tune 单元测试**：`test/rank.test.js`（14 组）+ `test/tune.test.js`（11 组），从 `lib/` 导入（测的就是发布产物）；`package.json` 的 `test` 改为先 tsc 再断言
5. **调教效果对照器** `scripts/tune-demo.mjs`：真实数据上的调教前/后 Top10 对比 + 升降摘要 + Top10 重合度
6. **装机脚本跟随 patch 名**：`install-to-profile.mjs` 现在会读 patch 里已有的 `name`，避免调试换名后重启时装到另一份目录

**H3 修掉的三个真问题（都是测试逼出来的）**
| 问题 | 症状 | 修法 |
|---|---|---|
| `normalizeUrl` 只看整串末尾去尾斜杠 | `/x/?id=7` 与 `/x?id=7` 不会去重（带查询参数时去重直接失效） | 尾斜杠去在 **pathname** 上 |
| 合并提示被评分覆盖 | 同一件事被多源报道合并后，`理由` 数组被评分整段重写，"另有 X 报道"凭空消失 | 合并说明带外收集（`mergeNotes`），评分后再拼到 reasons 最前 |
| 标题相似度用字符 3-gram | 「OpenAI releases a new reasoning model」vs「…new reasoning model」（插入/删除一个词）只算 **0.31**，真正该合并的一对合不了 | 改成词级 `max(Jaccard, containment)`，containment 仅在一侧 ≥4 词时启用（防短标题被吞）；阈值 0.8 |

**证据（真实输出）**
- 全量测试：`node --test test/` → **tests 52 / pass 52 / fail 0**
  （其中 rss 28 组来自子代理，rank 14 组 + tune 11 组本轮新增）
- **镜像预热提速（实测）**：`node scripts/probe-sources.mjs youtube`
  —— 预热前整轮 39.8~50s、YouTube 单源 39.8s；预热后 **YouTube 单源 24 条 / 7732ms**
- **调教真的改排序（实测）**：`node scripts/tune-demo.mjs`，67 条真实数据，
  调教句「以后每天多推 AI Agent 相关的，少推币圈」→ 主题 AI + 关键词 Agent + 屏蔽币圈
  - 调教前 Top3：HN 气候报道(技术) / Terence Tao Math 2.0(技术) / README 实验(技术)
  - 调教后 Top3：**DeepSeek's Insane Technique(YouTube·AI)** / 苹果 HomeView(IT之家·AI) / HN 气候报道
  - 升幅最大：`DeepSeek's Insane Technique` 14→**1**、`苹果 HomeView` 21→**2**、`AI 削弱意志力` 32→10
  - 跌出前十：B 站两个热点视频 9→13、10→14；`Valen's Memory Safety` 8→11
  - **Top10 重合度 7/10**
- 类型检查：`tsc -p tsconfig.json --noEmit` → **0 error**
- 装机：`node scripts/install-to-profile.mjs desktop` → `…/node_modules/dsh-daily-v2`（跟随 patch 名）

**阻塞**：无

**下轮起点**：H4 —— 验证 systemPrompt 的主动推荐真的会让模型在**新会话**里主动提起今日日报；核对 `computeNextRun('08:00')` 的下一次触发时刻；然后 H5 的 UI 复验
