# CHANGELOG

本文件记录 dsh-daily 的每个可交付版本。开发期的**逐轮记录**在 [STATUS.md](STATUS.md)（每轮必带真实命令与输出）。

## 0.1.0 — 2026-10-12

首个版本：H1–H5 全部落地，宿主侧已在运行中的 dsh 实例验证通过。

### Added

**采集层（11 个源，单源失败隔离）**
- Hacker News（经 hnrss，带分数与**讨论页链接**）、arXiv（cs.AI/CL/LG/CV）、
  GitHub Search API（近 30 天新建、star 最高）、YouTube（RSSHub 镜像池）、
  哔哩哔哩·热门 / 哔哩哔哩·排行榜、少数派 / IT之家 / Solidot / 阮一峰、以及任意自定义 RSS
- 零运行时依赖的 RSS 2.0 / Atom 1.0 / RSS 1.0(RDF) 解析器（28 组断言、6 个真实样本）
- RSSHub **镜像池**：健康度跨轮持久化、成功镜像优先、失败原因逐条聚合；
  采集前**并行预热**按延迟排序（YouTube 单源 39.8s → 7.7s）

**排序与调教**
- 去重两段式：URL 规范化精确合并 → 标题相似度合并（词级 `max(Jaccard, containment)`，阈值 0.8）
- 评分：新鲜度半衰期 × 源权重 × 主题命中 × 关键词 × 平台热度信号（HN 分 / star / 播放量），
  **每条都带可解释的推荐理由**
- 自然语言调教：主题 / 关键词 / 屏蔽词 / 来源权重 / 每日配额，落盘后**立即重排当天**
- 反馈学习：👍 / 👎 / 已读 / 隐藏，跨天累积

**日报与主动推荐**
- 按主题分组的 Markdown 日报 → `~/.dsh/daily/digest/YYYY-MM-DD.md`
- 紧凑摘要注入 `systemPrompt`（默认 6 条、实测 405 tokens），让模型**自己**提起今天值得看的
- `pickDiverse` 保证「推荐**不同**类型」：主题轮转 + 每源上限 2（修复前 6/6 全是 HN 技术新闻）
- 每日 `08:00` 定时 + 启动补抓；`computeNextRun` 用自串链 setTimeout，天然纠正漂移

**展示与接口**
- 右侧栏「日报」tab（`betterSidebar.registerTab` + iframe），常驻网页
- 网页：分类筛选 / 搜索 / 仅未读 / 视频卡（封面·时长·播放量）/ 👍👎✓隐藏 / 调教输入 /
  刷新浮层（绝对定位不推版）/ 日报 Markdown 弹层 / 空态 / 错误态 / 明暗主题 / 280–420px 自适应
- HTTP：`/dsh-daily/` 直出网页 + `/dsh-daily/api/*`（state / items / feedback / tune / refresh / digest）
- 7 个模型工具：`daily_brief` `daily_digest` `daily_search` `daily_sources`（只读）、
  `daily_tune` `daily_feedback` `daily_refresh`（写盘/联网）

**开发工具**
- `scripts/probe-sources.mjs`：真实采集探针（不落盘），可指定源
- `scripts/dev-server.mjs`：不开 dsh 就联调页面与接口
- `scripts/tune-demo.mjs`：调教前/后 Top10 对照 + 升降摘要 + 重合度
- `scripts/install-to-profile.mjs`：真实目录安装（绕开 `link:` 的解析陷阱），幂等

### Fixed

- `normalizeUrl` 只在整串末尾去尾斜杠 → 带查询参数时 `/x/?id=7` 与 `/x?id=7` 不去重
- 多源合并提示「另有 X 报道」被评分阶段整段重写 `reasons` 冲掉
- 标题相似度用字符 3-gram，插入/删除一个词只算 0.31，真正该合并的报道合不了
- `web/style.css` 缺 `[hidden] { display: none !important }`，
  导致 `.dd-error{display:flex}` 压过 `hidden` —— 页面一进去就先显示"出错了"
- `/api/digest` 默认日期用了 `toISOString()`（UTC），凌晨 0–8 点会串到昨天
- `probe-sources.mjs` 显式传源名不生效，实际会跑全部源
- 封面超时 6000ms → 3000ms（本机 YouTube 缩略图 100% 不可达，不该白等 6 秒）

### Known limitations

- 直连 YouTube 官方 feed、Invidious、Piped、Google News、HuggingFace、GitHub Trending HTML
  在本机网络下**全部超时**（已实测），因此 YouTube 只能走第三方 RSSHub 镜像，会抖动
- YouTube 封面（`i.ytimg.com`）在本机不可达 → 降级为纯色占位块（不是破图）
- 哔哩哔哩排行榜偶发 `-352` 风控（已退避重试，仍可能失败）
- **host 侧代码改动需要重启 dsh 才在真实 GUI 里生效**（Node 缓存已成功导入的 ESM 模块）；
  客户端半体（右侧栏 tab）本来就要重启才被 `clientModules` 扫进图
- 官方 `dsh plugin add` / 插件市场 `install_bundle` 在本机会因 profile 的 pnpm store 版本冲突失败，
  故走 `scripts/install-to-profile.mjs`
