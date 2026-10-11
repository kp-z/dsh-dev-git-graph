# 日报插件·竞品侦察报告

> 结论先行：**社区已有近亲（`@hyzyn/dsh-rss`），但三条硬需求里有两条它没覆盖**——
> 常驻侧边栏网页（它只有一个弹窗入口）、自然语言调教（它只有表单配置）、
> YouTube/B 站视频索引（它只做 RSS 文本）。所以自研 `dsh-daily` 仍然必要，
> 且可以直接借鉴它踩过的坑。

侦察时间：2026-10-12 00:45 (+08:00)

## 1. 侦察范围与方法

| 通道 | 手段 | 结果 |
|---|---|---|
| 本工作区 | `packages/*` 全量扫描 + 关键词检索（news/rss/digest/日报/新闻/feed） | 无同类包（现有 8 个包：agent-mode / git-graph / ios-skin / mermaid-comm / spellbook / tab-split / contract-butler / example-tool） |
| 本机 profile | `plugin_manager list_bundles`（35 个 bundle）+ `~/.dsh/profiles/desktop/package.json` | 已装 26 个依赖，**无新闻类插件** |
| 社区插件市场 | `@linxin666/dsh-client-ui-community-plugins@0.4.6` 的 `community.json`（dsh-market.com 与 Workshop 商店的唯一数据源），**132 条插件**，全量关键词筛 | 命中 1 个直接近亲 + 3 个相邻能力 |
| npm registry | `registry.npmjs.org/-/v1/search` | 社区市场已覆盖，未发现遗漏 |

> 注：本机 `web_search` 的 DeepSeek endpoint 返回 401（key 失效），本次侦察改走 npm registry 直连 +
> 社区索引 JSON，结论不受影响。`web_search` 修复方式见 README 末尾。

## 2. 命中的候选

### 2.1 直接近亲：`@hyzyn/dsh-rss` v0.4.7（作者 hyzyn）

> RSS / 新闻聚合：订阅多个 RSS/Atom 源，每天自动汇总一篇「今日值得读」并注入 systemPrompt 供模型直接引用。

| 能力 | 是否具备 | 说明 |
|---|---|---|
| 每日自动汇总 | ✅ | 默认 `08:00`，启动补生成 |
| 注入 systemPrompt（≈主动推荐） | ✅ | 模型可直接引用当天 digest |
| 可自定义 | ⚠️ 表单为主 | 设置卡片勾选/增删源、分类、OPML 导入导出；**没有对话式调教** |
| 侧边栏展示 | ⚠️ 弹窗 | 「新建会话」下方的快捷入口 → 弹窗列表；**不是常驻网页 tab** |
| 点击跳转 | ✅ | 弹窗内条目 + 「查看更多」直达来源 |
| 视频索引 | ❌ | 纯 RSS 文本条目，无 YouTube/B 站视频卡与热度信号 |
| 高价值排序 | ⚠️ 弱 | 按时间倒序 + 去重；无跨源热度评分 |
| 依赖 | 零依赖解析 RSS2.0/Atom | 可借鉴 |
| 可选 AI 摘要 | ✅（默认关） | 按条缓存 30 天；踩坑：`maxTokens` 要留足推理预算（200→7 条成功 / 4096→20 条全成功） |

**值得直接抄的三条经验**：①零依赖手写 RSS/Atom 解析；②digest 注入 systemPrompt 的做法；
③界面「分区块更新」避免焦点/滚动丢失。

### 2.2 相邻能力

- **`dsh-linkdigest`**（jcaiagent7143-ui）：小红书/抖音/TikTok/YouTube/X 链接 → 带时间戳转写、OCR、逐图描述。**托管 MCP 服务，无需本地浏览器/登录**——是"用 YouTube 链接但不用直连 YouTube"的一条可行路径。
- **`dsh-industry-research`**（PerryLink）：行业与公司研究包，含**公开源政策与新闻跟踪** + 可审计研究报告。是"高价值索引"的另一种形态（研究向，非每日推荐）。
- **`dsh-research-report`**（PerryLink）：内容寻址证据台账 + 版本化封存报告。若后续要做"日报可追溯"可借其思路。

## 3. 缺口清单（= 本项目要做的）

| # | 缺口 | 对应需求 |
|---|---|---|
| G1 | 侧边栏**常驻网页 tab**（不是弹窗），条目点击直跳 | 需求 2 |
| G2 | **对话式调教**：自然语言改偏好（"我现在每天要 AI 新闻"） | 需求 1(b) |
| G3 | **视频索引**：YouTube + 哔哩哔哩，带封面/时长/作者/热度 | 需求 1(c) |
| G4 | **跨源高价值评分**：新鲜度 × 源权重 × 主题命中 × 热度信号（HN 分、B 站播放、GitHub star） | 需求 1(c) |
| G5 | **主动推荐**：不只是注入上下文，而是每日主动推送到会话 | 需求 1(a) |

## 4. 关键网络事实（本机实测，决定采集层设计）

本机无系统代理（`scutil --proxy` 全 0），属境内直连环境。实测：

| 数据源 | 可达性 | 备注 |
|---|---|---|
| Hacker News Firebase API | ✅ 200 / 1.2s | `topstories.json` |
| hnrss.org（HN RSS） | ✅ 200 / 4.7s | 带分数与评论数，比官方 API 更好用 |
| arXiv API（**https**） | ✅ 200 / 2.5s | `http://` 会 301 |
| 少数派 `sspai.com/feed` | ✅ 200 | |
| 阮一峰 `ruanyifeng.com/blog/atom.xml` | ✅ 200 / 1.1s | |
| Solidot `solidot.org/index.rss` | ✅ 200 | |
| IT之家 `ithome.com/rss/` | ✅ 200 | |
| 36氪 `36kr.com/feed` | ⚠️ 返回 HTML 非 feed | 官方 feed 已反爬，需换第三方路由 |
| 哔哩哔哩 热门 `popular` API | ✅ 200 | 无需签名 |
| 哔哩哔哩 排行 `ranking/v2?rid=0` | ✅ 200 / 166KB | 偶发 `-352` 风控，需重试+退避 |
| 哔哩哔哩 视频详情 `view?bvid=` | ✅ 200 | 取封面/时长/UP主/播放量 |
| 哔哩哔哩 用户投稿 `space/arc/search` | ⚠️ `-799` 限流 | 需 wbi 签名，改用镜像或热门源 |
| GitHub Search API | ✅ 200 / 0.8s | 可做"新晋 AI 热库" |
| **RSSHub 公共镜像池** | ⚠️ 仅 1/8 可用 | ✅ **`rsshub.ktachibana.party`** 实测返回 YouTube 频道 feed（"Two Minute Papers" 真实条目）；`rsshub.liumingye.cn` 返回欢迎页；其余超时/502/无法解析 |
| YouTube 官方 feed | ❌ 超时 | 必须走镜像 |
| Invidious / Piped 公共实例 | ❌ 超时 | |
| Google News RSS | ❌ 超时 | |
| HuggingFace `api/daily_papers` | ❌ Connection reset | |
| GitHub Trending HTML | ❌ 超时 | 改用 Search API |
| 百度热搜 `top.baidu.com/api/board` | ✅ 200 | 可选"泛热点"源 |
| 微博热搜 API | ⚠️ 403 | |

**设计结论**：采集层必须是**镜像池 + 健康检查 + 故障转移 + 降级标注**，而不是写死单一地址。
YouTube 只走 RSSHub 镜像池；不可达时日报里显式标注"该源本次失败"（不静默丢源）。
B 站走官方 API（可达性最好），用户投稿类需求再补镜像路径。

## 5. 决策

自研 `packages/dsh-daily`（包名 `dsh-daily`，entry id `daily`），
技术路线：**host 侧零运行时依赖采集/评分/存储 + 右侧栏 iframe 自持网页**（复用本工作区
`dsh-spellbook` 已验证的 `betterSidebar.registerTab` + `webServer.register` 前缀路由范式）。

同时把 `@hyzyn/dsh-rss` 保留为**可选数据源**：若用户已装它，`dsh-daily` 可直接读
`~/.dsh/rss-digest/latest.json` 复用其结果，避免重复抓取。
