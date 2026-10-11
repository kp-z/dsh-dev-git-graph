# dsh-daily · 日报

> DSH 插件：**每日主动推荐**多类型新闻，可用**自然语言调教**推荐偏好，提供含**网页 / YouTube / 哔哩哔哩视频**的高价值索引，
> 并在右侧栏以**常驻网页**呈现，点条目直接跳转。

## 它解决什么

| 需求 | 实现 |
|---|---|
| (a) 每日主动推荐不同类型的新闻 | 每天定时抓取 + 按主题分组生成日报；紧凑摘要注入 `systemPrompt`，模型会**自己**提起今天有什么值得看的 |
| (b) 可自定义调教 | 右侧栏一个输入框，或直接对模型说「以后每天多推 AI Agent 相关的，少推币圈」→ 落盘偏好并**立即重排** |
| (c) 高价值索引（网页 + YouTube + 哔哩哔哩） | 11 个源、跨源评分（新鲜度 × 源权重 × 主题命中 × 关键词 × 热度信号）、两段式去重；视频条目带封面·时长·播放量 |
| 展示形式 | 右侧栏「日报」tab，常驻网页；分类筛选 / 搜索 / 仅未读 / 👍👎 / 已读 / 隐藏 / 日报 Markdown 预览 |

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
| `daily_feedback` | **写盘** | like / dislike / read / hide |
| `daily_refresh` | **联网 + 写盘** | 立刻抓一轮（5~20 秒） |

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
./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit   # 类型
npm test                                                       # 单测（当前 69 组）
node scripts/probe-sources.mjs                                 # 真实采集（联网，约 8~40s）
node scripts/install-to-profile.mjs desktop                    # 装机（幂等，可重复跑）
# 装机副本与源码逐文件比对 + 副本可独立导入（模拟 dsh 加载）
for f in lib/index.js web/app.js package.json cordis.patch.yml; do
  diff <(shasum -a 256 "$f") <(shasum -a 256 "/Users/kp/.dsh/profiles/desktop/node_modules/dsh-daily-v2/$f") >/dev/null \
    && echo "✅ $f" || echo "❌ $f"
done
node -e "import('/Users/kp/.dsh/profiles/desktop/node_modules/dsh-daily-v2/lib/index.js').then(m=>console.log('✅ import ok',Object.keys(m)))"
```

小贴士：**验证脚本自身也会失效**。H5 复验时我一度以为"点分类 chip 后列表永久卡住"，
其实是我的脚本把 chip 节点存进了变量，而 `renderChips` 每次筛选都会重建节点 ——
点的是已脱离 DOM 的旧节点。**先排除验证方法本身的错，再断言产品有 bug。**

## 已知限制

- **YouTube 封面在本机网络下不可达**（`i.ytimg.com` 被墙）：条目仍然正确（标题/链接/频道/时间），封面会走页面内置的 6 秒超时降级成纯色占位块。
- YouTube 依赖第三方 RSSHub 镜像，镜像会 429/503；失败时该源在日报里**显式标注**，不影响其它源。
- 哔哩哔哩排行榜偶发 `-352` 风控（已退避重试，仍可能失败）。
- 侧边栏 tab 需要 DSH 重启后才会出现：客户端半体在启动时组装，不像 host 路由可以实时挂载。

## 计划与进度

- 开发计划：`PLAN.md`（按小时的第一波 6 小时节奏）
- 进度台账：`STATUS.md`（每轮必更新）
- 竞品侦察：`../../docs/DAILY-PLUGIN-RECON.md`
