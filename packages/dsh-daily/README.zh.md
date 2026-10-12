# dsh-daily · 日报

> DSH 插件：**每日主动推荐**多类型新闻，可用**自然语言调教**推荐偏好，提供含**网页 / YouTube / 哔哩哔哩视频**的高价值索引，
> 并在右侧栏以**常驻网页**呈现，点条目直接跳转。

## 它解决什么

| 需求 | 实现 |
|---|---|
| (a) 每日主动推荐不同类型的新闻 | 每天定时抓取 + 按主题分组生成日报；紧凑摘要注入 `systemPrompt`，模型会**自己**提起今天有什么值得看的 |
| (b) 可自定义调教 | 右侧栏一个输入框，或直接对模型说「以后每天多推 AI Agent 相关的，少推币圈」→ 落盘偏好并**立即重排** |
| (c) 高价值索引（网页 + YouTube + 哔哩哔哩） | 11 个源、跨源评分（新鲜度 × 源权重 × 主题命中 × 关键词 × 热度信号）、两段式去重；视频条目带封面·时长·播放量 |
| 展示形式 | 右侧栏「日报」tab，常驻网页；分类筛选 / 搜索 / 仅未读 / 👍👎 / 已读 / 隐藏 / 日报 Markdown 预览 / **按天翻阅** / 页脚「订阅管理」与「本周回顾」 |

## 采集源（按本机实测可达性筛选）

| 源 | 类型 | 本机可达 |
|---|---|---|
| Hacker News（经 hnrss） | 网页 | ✅ |
| arXiv（cs.AI / cs.CL / cs.LG / cs.CV） | 网页·学术 | ✅ |
| GitHub Search API（近 30 天新建、star 最高） | 网页·开源 | ✅ |
| **YouTube**（RSSHub 镜像池） | 视频 | ⚠️ 仅镜像可用，会抖动 |
| 哔哩哔哩·热门 / 排行榜 | 视频 | ✅（排行榜偶发 `-352` 风控） |
| 少数派 / IT之家 / Solidot / 阮一峰 | 网页 | ✅ |
| 自定义 RSS（配置项 `extraFeeds`） | 网页 | 取决于地址 |

> 直连 YouTube 官方 feed、Invidious、Piped、Google News、HuggingFace、GitHub Trending HTML 在本机网络下**全部超时**，
> 所以 YouTube 走 RSSHub 镜像池，GitHub 走 Search API，英文社区热度走 HN。这不是偷懒，是实测结论。

## 安装

```bash
# 1. 编译（本包依赖已在本工作区备好，直接编译即可）
cd packages/dsh-daily
./node_modules/typescript/bin/tsc -p tsconfig.json && node scripts/copy-assets.mjs

# 2. 装进 profile（**真实目录**，不要用 link:，原因见下）
node scripts/install-to-profile.mjs desktop

# 3. 重启 DSH（或让插件管理器重建 include:daily 这个 entry）
```

### 为什么不用 `dsh plugin add link:`（重要，踩过的坑）

dsh 的插件解析根是 `$DSH_HOME/profiles/node_modules` —— 里面 `@deepseek-ai/*` 全部是指向 dsh 安装目录的符号链接，
插件里 `import { defineTool } from '@deepseek-ai/dsh-tools'` 就靠这条链解析。

而 Node 的模块解析默认取**符号链接的真实路径**：插件被 `link:` 进 profile 后，真实路径落在工作区，
向上查找永远走不到 `$DSH_HOME/profiles/node_modules`，导入直接失败：

```
Cannot find package '@deepseek-ai/dsh-tools'
```

所以必须装成**真实目录**（`scripts/install-to-profile.mjs` 已处理，且会幂等地补上 profile 用户层 patch 的那一行 insert）。

**第二个坑**：Node 会缓存**失败的模块实例化**。如果你先踩了第一个坑（导入失败），之后即使改对了，
同一个模块 URL 仍会一直报 `failed to import` —— 需要换目录名（改变 URL）或重启 DSH。

另：本机 `dsh plugin add` / 插件市场的 `install_bundle` 会因 profile 的 pnpm store 版本冲突失败
（node_modules 由 store v10 链接，当前 pnpm 想用 v11），要求整树重装 —— 代价太大，所以走上面的脚本。

## 配置

配置项走 profile 的插件配置（`Config` schema，`src/config.ts`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `dataDir` | `~/.dsh/daily` | 数据目录 |
| `dailyTime` | `08:00` | 每天几点抓取并生成日报 |
| `announceToAgent` | `true` | 是否把日报摘要注入 systemPrompt（= 主动推荐） |
| `announceMaxItems` | `6` | 注入几条标题（每轮都要付的 token，别贪） |
| `autoRefreshOnStart` | `true` | 启动时若今天没数据就补抓 |
| `refreshIntervalMinutes` | `0` | 额外周期抓取，0 = 关 |
| `requestTimeoutMs` / `concurrency` | `12000` / `6` | 单请求超时 / 并发上限 |
| `maxItemsPerSource` / `dailyQuota` | `8` / `120` | 每源与全天的条数上限 |
| `dedupeWindowDays` | `3` | **跨天去重窗口**（日历天）。窗口内推过的条目重罚到 ×0.2 并标注「X 月 X 日已推过」——但仍留在索引里，`daily_search` 搜得到。0 = 关闭 |
| `rsshubMirrors` | 3 个镜像 | 按顺序探测，成功优先 |
| `youtubeChannels` | 5 个 AI/技术频道 | 格式 `名称\|频道ID或@handle\|主题` |
| `extraFeeds` | `[]` | 额外 RSS，格式 `名称\|URL\|主题` |
| `enabledSources` | `[]`（全部） | 只启用哪些内置源 |
| `aiSummaryEnabled` | `false` | **可选 AI 摘要**（默认关）。打开后给当天前 N 条生成一句中文摘要，侧边栏与日报都显示 |
| `aiSummaryProvider` / `aiSummaryModel` | 空 | 模型路由。**两者必须成对**；都留空则跟随宿主默认模型；只填一个视为未配置（不猜） |
| `aiSummaryMaxItems` / `aiSummaryConcurrency` | `20` / `3` | 摘要几条 / 并发几路 |
| `aiSummaryMaxTokens` | `1024` | 单次上限。**别调太小** —— 推理 token 与正文共享它 |
| `aiSummaryTimeoutMs` | `20000` | 单条超时 |
| `aiSummaryCacheTtlDays` / `aiSummaryCacheMax` | `30` / `500` | 摘要缓存有效期与条数上限（同一新闻跨天重复时不重复付钱） |
| `archiveCompactAfterDays` | `60` | 超过这些天的归档压成索引（丢摘要/热度，保留标题/链接/主题/分数）。0 = 不压缩 |
| `archiveDeleteAfterDays` | `0` | 超过这些天的归档**整组删除**。**默认 0 = 永不删除**；要开就设成比上一条更大的值 |

**用户偏好**（主题 / 关键词权重 / 屏蔽词 / 源权重 / 每日上限）落在 `~/.dsh/daily/prefs.json`，
由右侧栏页面和 `daily_tune` 工具改写 —— 不走插件配置，因为改配置会触发 profile 重载。

## 模型工具

| 工具 | 副作用 | 说明 |
|---|---|---|
| `daily_brief` | 只读 | 今日日报（按主题分组、带链接与推荐理由） |
| `daily_digest` | 只读（缺则生成） | 完整 Markdown 日报 |
| `daily_search` | 只读 | 在最近 N 天索引里检索 |
| `daily_sources` | 只读 | 源清单与最近一轮状态（排查「为什么没有 YouTube 条目」先看它） |
| `daily_tune` | **写盘 + 重排** | 自然语言调教 |
| `daily_opml` | **写盘**（import）/ 可选写文件（export） | 导入 / 导出 OPML 订阅列表 |
| `daily_weekly` | **写盘** | 生成周报（跨天汇总：最值得看 / 主题分布 / 每天条数 / 源健康） |
| `daily_prune` | 默认**只读**（`apply:true` 才写盘） | 看归档占用；压缩/清理旧归档 |
| `daily_feedback` | **写盘** | like / dislike / read / hide |
| `daily_refresh` | **联网 + 写盘** | 立刻抓一轮（5~20 秒） |

## 可选 AI 摘要（默认关闭）

只有标题的列表要一条条点进去才知道值不值得看；打开摘要后每条带一句中文概要，扫一眼就能筛。
侧边栏右上角会出现 **✨ 按钮**，随时给**已抓到的**当天条目补摘要，不必等第二天。

打开方式（profile 的插件配置）：

```yaml
aiSummaryEnabled: true
aiSummaryProvider: ''   # 留空则跟随宿主默认模型；要固定就两者都填
aiSummaryModel: ''
```

三条从实测里来的经验（都写进了代码注释与测试）：

- **`aiSummaryMaxTokens` 别调小**。推理 token 与正文**共享**这个上限：设 200 时 20 条里只有 7 条成功，
  1024 时 12 条，4096 时 20 条全成功。撞上限的条目不会静默变空摘要 —— 失败原因里会写明
  「模型没写出正文就用完了 maxTokens=…（终止原因 max-tokens）」。
- **单条失败必须隔离**。20 条挂 1 条，另外 19 条照常出；失败条数与原因会出现在提示条里。
- **按条目缓存**。跨天重复的新闻命中缓存直接复用，不重复花钱。

失败面都被测试钉住了：超时、空输出、`max-tokens`、`error`/`aborted`、流中途抛错、
没有 `finish` 事件、宿主没有 `llm` 服务、只填了一半的路由、缓存过期与超量淘汰。

## 导入自己的订阅（OPML）

你多半已经在别的阅读器里订阅了几十个源 —— 一条条抄 URL 是这个插件最可能被放弃的一步。
直接给它一个 OPML 文件：

> 「把这个文件里的订阅导进来：`~/Downloads/subscriptions.opml`」

或者直接调用 `daily_opml({ action: 'import', path: '…' })`。行为：

- **按 URL 去重**（`?utm_source=` 这类参数会先被规范化掉，绕不过去）
- **内置源也参与判重**：你的 OPML 里若有少数派 / IT之家 / Solidot / 阮一峰的源，会被跳过 ——
  它们已经在抓了，重复加入只会让同一份内容被抓两次
- **已有条目不覆盖**：你手动改过的名字比 OPML 里的更可信
- **即时生效**：写进 `prefs.extraFeeds`，下一次刷新就抓，**不需要改配置、不需要重载 profile**
- 返回可核对的明细：解析出几条、新增几条、重复几条、跳过几条

反向也支持：`daily_opml({ action: 'export' })` 把**内置源 + 自定义源**导出成 OPML，
可以带回你自己的阅读器。

## 往回翻：归档与周报

「高价值**索引**」意味着能往回翻，而不是只看今天。两条路径：

- **按天翻**：侧边栏标题下方有一条日期导航（`‹ 2026-10-12 ›` + 「回到今天」）。
  只在存在多天归档时才出现。翻到历史那天时：统计行会显示「历史数据 · 刷新只抓今天」，
  刷新按钮置灰（抓取总会写进当天），日报预览会取**那一天**的 Markdown。
- **按关键词找**：直接问模型「上周有没有关于 xxx 的东西」，它会调 `daily_search`。

**周报**：对模型说「生成本周周报」，或 `daily_weekly({ days: 7 })`。落盘到
`~/.dsh/daily/digest/week-<起>_<止>.md`，包含四节：

| 小节 | 回答什么问题 |
|---|---|
| 本周最值得看 | 这周最好的东西是什么（跨天全局排序） |
| 按主题 | 我这周的注意力花在哪个方向（含每主题的代表条目与占比） |
| 每天 | 哪天信息量大、**哪天断了**（条数骤降通常意味着采集出问题） |
| 采集源 | 哪几个源失败了（避免"某周少了 YouTube"被悄悄吞掉） |

## 长期运行：归档容量

这个插件是要**每天跑、长期跑**的。`days/*.json` 一天约 50KB —— 一年 ~18MB，
而且 `daily_search` / 归档索引 / 周报都要读它们。所以有分级保留：

| 归档年龄 | 处理 | 保留什么 |
|---|---|---|
| 最近 60 天（`archiveCompactAfterDays`） | 完整保留 | 摘要、热度、推荐理由、封面 |
| 更早 | **压缩成索引** | 标题 / 链接 / 主题 / 来源 / 分数 / 已读状态 / AI 摘要 |
| 更早且显式开启删除（`archiveDeleteAfterDays`，默认 0） | 整天删除 | 数据文件与那天的日报一起删 |

**实测压缩效果**（本机真实数据，120 天 × 67 条）：

```
未压缩：49.6 KB/天  →  压缩后：26.8 KB/天   （-46%）
全年外推：17.7 MB   →  9.6 MB
```

为什么**默认不删除**：数据不可再生，一个「自动清理」的默认值不该由插件替用户决定。
压缩是安全的（只丢详情、不丢索引），删除必须由你显式开启。

整理**自动进行**（每天最多一次，挂在采集完成之后，你不需要管）；也可以手动：

> 「看看日报数据占了多少地方」→ `daily_prune`（默认只预览、不写盘）
> 「把旧归档压缩一下」→ `daily_prune({ apply: true })`

### 联调脚本（`scripts/dev-server.mjs`）

不进 dsh 也能把界面跑起来，且**不会碰你的真实数据**：

```bash
node scripts/dev-server.mjs \
  --data-dir=/tmp/dsh-demo \   # 用临时数据目录（默认 ~/.dsh/daily）
  --seed-history=4 \           # 把今天的数据复制成过去 4 天，用来验跨天界面
  --ai-fake \                  # 打开 AI 摘要并注入假 stream（不花 token）
  --fail-api=state \           # 让指定接口返回 503，用来验错误态
  --no-refresh                 # 启动时不抓取
```

`--fail-api` 这类**故障注入**开关是有意做的：错误态（红条文案、能否重试、会不会卡死）
是用户真会碰到的状态，但正常开发流程里几乎无法自然触发 —— 不注入就只能靠"看代码觉得没问题"。

## 数据与文件

```
~/.dsh/daily/
├── prefs.json            # 用户偏好（调教的落点）
├── feedback.json         # 反馈（跨天累积，用于学习）
├── meta.json             # 最近刷新 / 镜像健康度
├── days/YYYY-MM-DD.json  # 当天的全部条目与源状态
└── digest/YYYY-MM-DD.md  # 生成的日报 Markdown
```

## 开发

```bash
node scripts/probe-sources.mjs          # 真实采集探针（不落盘）
node scripts/probe-sources.mjs hn youtube
node scripts/dev-server.mjs --port 8799 # 不开 DSH 联调页面与接口
node scripts/tune-demo.mjs "以后多推开源" # 调教前/后 Top10 对照
npm test                                # tsc 构建 + node --test（基线 69 组全绿）
```

`scripts/dev-server.mjs` 把**同一个** `mountRoutes` 挂到裸 http server 上，所以 UI 迭代不需要装进 profile。

### 改完怎么验证（**重要**，这条决定你多久能看见效果）

| 你改了什么 | 怎么验证 | 要重启 DSH 吗 |
|---|---|---|
| `src/collect/*`、`src/rank.ts`、`src/tune.ts`、`src/render.ts` 等纯逻辑 | `npm test` + `node scripts/probe-sources.mjs` / `tune-demo.mjs` | 不需要（新进程） |
| `web/*`（页面） | `dev-server.mjs` 起页面，浏览器刷新 | 不需要（路由直出静态文件，`no-store`） |
| `src/api.ts`、`src/tools.ts`、`src/prompt.ts`、`src/schedule.ts`（host 运行时行为） | 只能 `dev-server.mjs` 验接口；工具与注入要看真实会话 | **需要** |
| `src/client.js`（右侧栏 tab） | 只能在真实 GUI 里看 | **需要**（客户端半体启动时组装） |

**为什么 host 改动必须重启**：Node 会缓存**已成功导入**的 ESM 模块，
`plugin_manager set_plugin` 的 enable 切换只是重建 fiber、不会重新读盘。
（顺带一个更具欺骗性的现象：如果某个模块 URL 第一次导入**失败**过，
那个失败也会被缓存，修好之后同名目录仍一直报 `failed to import` —— 换目录名或重启才能解开。）

### 完整回归清单（每次收口跑一遍）

```bash
cd packages/dsh-daily
npm run regression     # 构建 → 单测（当前 156 组）→ 装机 → 逐文件校验安装（15 项）
npm run verify:install # 只跑安装校验；额外验证重复装机幂等（--idempotent）
npm run probe          # 真实采集（联网，约 8~70s；不读也不写你的数据）
```

`npm run regression` 里的安装校验（`scripts/verify-install.mjs`）检查的是几类
**"装完看起来没事、跑起来才炸"**的错：

| 检查 | 不检查会怎样 |
|---|---|
| 装的是**真实目录**、目录内无符号链接 | 符号链接让真实路径落回工作区 → `@deepseek-ai/*` 解析不到 → 插件导入直接失败 |
| `$DSH_HOME/profiles/node_modules/@deepseek-ai/*` 存在 | 同上，解析链的根 |
| profile 里的代码与工作区构建产物**逐文件一致** | **改了代码忘了重装** —— 你会对着新代码查半天，而跑的一直是旧的（最容易犯、最难发现） |
| `lib/client.js` 存在且含 `__ModuleLoader__.load` | 右侧栏 tab 消失，而 host 侧一切正常 |
| patch 里 `insert` 行存在、名字与目录匹配、不重复 | 文件都在，但 profile 根本不加载它 |
| `index.html` 引用的本地资源都在 | 页面白屏或样式丢失 |
| 安装副本能被 Node 独立导入 | 最贴近"dsh 真的会加载它"的验证 |

脚本会对每个场景分别报原因（例如解析失败时会说清是「符号链接绕回工作区」还是「共享 node_modules 缺失」，
因为这两者的修法完全不同）。

小贴士：**验证脚本自身也会失效**。H5 复验时我一度以为"点分类 chip 后列表永久卡住"，
其实是我的脚本把 chip 节点存进了变量，而 `renderChips` 每次筛选都会重建节点 ——
点的是已脱离 DOM 的旧节点。**先排除验证方法本身的错，再断言产品有 bug。**

## 已知限制

- **YouTube 封面在本机网络下不可达**（`i.ytimg.com` 被墙）：条目仍然正确（标题/链接/频道/时间），
  封面显示为纯色占位块。实现上是「**占位块常驻底层 + 图片进入视口才插入并盖在上面**」，
  所以不存在"超时误杀"——挂住的请求只是永远盖不上来而已（详见 CHANGELOG 里 R12 那一条）。
- YouTube 依赖第三方 RSSHub 镜像，镜像会 429/503，**实测有一次整源 0 条**；
  失败时该源在日报与页脚里**显式标注**，不影响其它源。B站的视频索引不受影响。
- 哔哩哔哩排行榜偶发 `-352` 风控（已退避重试，仍可能失败）。
- 侧边栏 tab 需要 DSH 重启后才会出现：客户端半体在启动时组装，不像 host 路由可以实时挂载。

## 计划与进度

- 开发计划：`PLAN.md`（按小时的第一波 6 小时节奏）
- 进度台账：`STATUS.md`（每轮必更新）
- 竞品侦察：`../../docs/DAILY-PLUGIN-RECON.md`
