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

### 从 npm（推荐）

```bash
npm install @kpeace/dsh-daily
# 或在 DSH 里：dsh plugin add @kpeace/dsh-daily
```

已发布：`@kpeace/dsh-daily@0.1.0`（https://www.npmjs.com/package/@kpeace/dsh-daily）
—— 装完仍需**重启 DSH**（原因见下面「改完怎么验证」一节：客户端半体在启动时组装）。

> **关于名字**：包名为什么带 `@kpeace/` 前缀 —— 不带前缀的 `dsh-daily` 已被另一个 npm 账号
> （`dushaobindoudou`，描述写着 *name reserved; first release in development*）预留。
> 如果那是你自己的账号，用那个账号在仓库里跑 `npm publish` 就能发到 `dsh-daily` 这个名字上；
> 本包已把 `package.json` 的 `name` 与 `cordis.patch.yml` 的插入名保持一致，改回不带前缀只需同步改这两个地方。


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
| `youtubeRotateChannels` | `true` | 是否按 LRU 轮转抓 YouTube 频道（对抗免费镜像的 429） |
| `youtubeChannelsPerRefresh` | `3` | 每轮抓几个频道。>= 频道总数等价于全抓 |
| `youtubeFailureCooldownMinutes` | `20` | 频道连续失败后的退避基准分钟（按 2 的幂递增，封顶 8 倍） |
| `notifyEnabled` | `false` | 是否在**定时/启动**采集完成后弹一条 macOS 系统通知（手动刷新不弹）。默认关 |
| `notifyMaxTitles` | `3` | 通知正文里列几条标题 |

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
| `daily_project` | **写注册表**（use 时） | 列出 / 查看 / 切换项目（一个项目 = 一个工作目录） |
| `daily_profile` | **写盘**（profile.json） | 采集项目画像：技术栈 / 依赖 / 关键词 / README 摘录（绝不读敏感文件） |
| `daily_research` | **写盘**（research-plan.json） | 从画像生成调研检索词（AI 增强，失败自动降级为确定性种子） |
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

## 开发脚本的一个安全约定

```bash
npm run regression          # 构建 + 全部单测 —— **不写盘、不装机**
npm run regression:install  # 上面这些 + 装机 + 安装校验（会改 profile，显式才做）
```

**为什么把装机从 `regression` 里拆出来**：它曾经隐式包含 `install-to-profile`。
在"用户明确要求暂不安装"的时期，我跑一次 `npm run regression` 就把插件装回了他的 profile
—— 一个**名为"回归测试"的命令不应该有安装这种副作用**。所以默认那条做成纯只读，
装机必须显式写出来。

## 刷新语义：合并，不是覆盖

同一天多次刷新时，当天数据是**合并**的（按规范化 URL 去重后取并集再统一排序），不是覆盖。
这条语义有两个直接后果，都是能感觉到的：

- **定向刷新不会冲掉别的源**：`daily_refresh({ sources: ['hn'] })` 之后，
  当天别的源（arXiv / B站 / YouTube…）的条目仍然在
- **某个源临时失败也不会丢数据**：上午抓到的东西不会因为下午那次刷新里该源挂了而从列表消失

合并时**继承**两个字段：`firstSeenAt`（首次见到它的时间）与已有的 `aiSummary`
（避免同一天刷新两次就重新调用模型一次）。
源状态同样合并：本轮跑过的用新状态，没跑的沿用上一次。

## 项目（一个项目 = 一个工作目录）

这个插件正在从「日报」长成「**调研插件**」：日报回答"今天世界上发生了什么"，
调研回答"**这个项目**缺的那块知识在哪"。所以每一份偏好、每一天的索引、每一条反馈都**按项目隔离** ——
给 A 项目调的「多推 Rust」不会污染 B 项目。

```bash
# 模型侧
「切到 ~/DEV/my-app 这个项目」→ daily_project({ action: 'use', dir: '~/DEV/my-app' })
「有哪些项目」              → daily_project({ action: 'list' })
「现在在哪个项目」           → daily_project({ action: 'current' })
```

侧边栏顶部有**项目切换器**（下拉选择 + `＋` 用目录新增）。

| 事实 | 说明 |
|---|---|
| 项目身份 | **归一化后的绝对路径**（`~`、相对路径、结尾斜杠、`..` 都归一到同一个身份） |
| 数据落点 | 默认项目 = **数据根目录本身**（老数据零迁移）；其它项目 = `<root>/projects/<slug>-<hash8>/` |
| 目录命名 | `slug` 给人看（`dsh-plugins`），`hash8` 保证唯一（不同父目录下的同名项目不会撞） |
| 注册表 | `<root>/projects.json`，记录当前项目与已知项目（**跨重启保留**） |
| 失效目录 | 项目目录被删/改名后，启动时**安全回落默认项目**，不会让插件打不开 |
| 隔离范围 | 偏好 / 反馈 / 每日索引 / 归档 / 轮转状态（各自的 `meta.json`）全部独立 |

**为什么要按目录隔离而不是一个全局配置**：调研的关键词高度依赖项目 ——
在写前端的仓库里想看到的是 UI 相关的进展，在写插件的仓库里想看到的是宿主 API 的变更。
一个全局配置只会在两个项目之间来回打架。

## 调研检索词（调研的入口）

画像回答"项目是什么"，检索词回答"**该去搜什么**"。`daily_research` 从画像推出这批词：

```bash
「给当前项目生成调研检索词」→ daily_research()        # force:true 可忽略缓存重算
```

真实输出（项目 = msim-front-react）：

```
[ai     ] react 19 迁移注意事项
[ai     ] zustand v5 破坏性变更
[ai     ] vite 6 环境变量约定
[keyword] <项目领域词> 最新进展
[dep    ] @ant-design/icons changelog release notes
[tech   ] TypeScript best practices
```

### 设计要点

| 决策 | 为什么 |
|---|---|
| **没有模型也要能用** | 检索词是整条链的入口；强依赖一次模型调用意味着超时/未配置/"点了没反应"就等于功能不可用。默认先给**确定性种子**（技术栈/依赖/领域词直接拼），AI 只做增强 |
| **AI 失败 = 降级，不是失败** | 超时、抛错、输出跑偏、流以 `reason.failure` 结束 —— 四种情况全部降级到种子，并把**真实原因**写进 `notes` 让用户看见 |
| **只认结构化输出** | 提示词要求 JSON 数组；模型回散文时**宁可降级**也不硬猜（单行"这里没有任何可用检索词"曾被当成一条检索词 —— 用户会拿到垃圾还不自知） |
| **缓存键是画像指纹** | 画像变了才重新生成；只靠时间会导致"项目没变却反复花模型调用" |
| **种子按"贴项目程度"排序** | 关键词 → 依赖 → 技术栈。合并会按条数截断，排在最后的先被砍；早先把关键词排最后，真实联调时它们**一条不剩** |
| **依赖按族去重** | 真实依赖表前几位常是 `@ant-design/icons / plots / pro-components`，取前 3 个等于用三次搜索问同一件事 |
| **过滤结构词** | 画像高频词里混着 `src / pages / context / tech / task.md` 这类任何项目都会高频的词；「context 最新进展」搜不出与项目有关的东西 |

> 当前的**瓶颈已经不在检索词逻辑，而在画像的关键词提取质量**：
> 真实项目抽出来的领域词仍偏弱（`experiment` / `portal` / `项目` / `目录`）。
> 下一轮该做的是让 README 的正文词汇权重高于 manifest 与目录名 —— README 才携带领域词表。

## 项目画像（调研的输入）

调研要回答"**这个项目**缺的那块知识在哪"，所以先得知道"这个项目是什么"。
`daily_profile` 从项目目录里抽出一小段画像 —— 它是「AI 生成检索词」的输入：

```bash
「给当前项目做个画像」→ daily_profile()            # 也可以用 verbose:true 看读了什么/跳过了什么
```

画像内容（真实输出，本插件自己的目录）：

```
项目：dsh-daily
工作目录：/Users/kp/DEV/dsh-plugins/packages/dsh-daily
技术栈：TypeScript（tsconfig.json）、Node.js（package.json）
主要依赖：@deepseek-ai/cordis, @deepseek-ai/dsh-tools, @deepseek-ai/schemastery, dsh-better-sidebar, typescript
关键词：dsh、node、项目、scripts、目录、youtube、日报、失败、插件、默认、deepseek-ai、数据、摘要、索引、频道…
顶层结构：CHANGELOG.md, PLAN.md, README.md, cordis.patch.yml, lib, package.json, scripts, src, test, tsconfig.json, web
README 摘录：…
（画像依据：读了 4 个文件 / 30.3KB；跳过 0 项，其中敏感文件 0 个）
```

### 三条硬约束（都来自「这份数据会被送进模型」这个事实）

| 约束 | 做法 |
|---|---|
| **绝不读敏感文件** | `.env*`、`*.pem`、`id_rsa*`、`credentials*`、`.npmrc`、`.git-credentials`… 按**文件名先挡**。不读才是真的安全——「读了再过滤」迟早会漏 |
| **有界** | 单文件 64KB / 总计 256KB / 最多 24 个文件；只读**顶层**的少量已知文件（README、manifest、CI 配置），不做递归遍历 |
| **可审计** | 返回里明确列出**读了哪些文件、跳过什么、为什么**。用户有权知道插件为了「了解项目」到底看了什么 |

`daily_profile({ verbose: true })` 会把完整清单打出来。画像落盘在
`<项目数据目录>/profile.json`（只读顶层、不递归，也不会因为目录里有几 G 的构建产物而变慢）。

## 桌面通知（macOS，默认关闭）

「每日**主动**推荐」最字面的形态：采集完成后弹一条系统通知，不用打开任何东西也能知道今天有什么。

```yaml
notifyEnabled: true
notifyMaxTitles: 3
```

通知长这样：

```
日报 · 2026-10-12
67 条索引 · 60 未读：DeepSeek Solved AI's Memory Problem · Passkeys are a trap · 派早报：…
```

三条设计原则：

- **默认关闭，且只在"定时/启动"时弹**。手动刷新（点按钮、调工具）不弹 ——
  那时你本来就在看着界面，再弹一条纯属噪音。这是"通知很烦"最常见的来源。
- **标题用 `pickDiverse` 挑**（主题轮转 + 每源上限），否则三条标题很可能全来自同一个源 ——
  而"推荐**不同**类型"正是你最初的诉求。
- **文本走 argv，不拼进 AppleScript 源码**。新闻标题里出现引号/反斜杠/换行是常态，
  拼接字符串总会有漏网的（而那种 bug 的表现是"脚本报错、通知不出现"，很难查）。

**已知边界**：宿主**没有**任何通知服务（`@deepseek-ai/` 下没有 notifier/toast 包），
所以只能落到系统层（`osascript`）。实测 `osascript` 返回 0（调用有效），
但**横幅是否真的显示取决于 macOS 的通知权限**——这我无法从代码侧确认。
如果你开了开关却没看到通知，去「系统设置 → 通知」里找一个叫 **Script Editor** 的条目并允许通知。
非 macOS 平台会安全跳过（日志里写明原因）。

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
- YouTube 依赖第三方 RSSHub 镜像，镜像会 429/503。**默认按 LRU 轮转抓取**（每轮 3/5 个频道，
  按 2 的幂退避连续失败的频道）—— 这是为了对抗镜像限流：改成轮转前实测出现
  「一次 2/5 频道失败、一次整源 0 条」，改成轮转后连续两轮 **0 失败**。
  **不会漏内容**：RSS 返回的是频道最近 ~15 条投稿而非"今天的投稿"，
  5 个频道每轮抓 3 个 ≈ 两天覆盖一轮。
  本轮没抓的频道会写进源状态（例：`✅ YouTube · 24 条（本轮轮转抓取 3/5 个频道：…（按轮转下次优先））`），
  日报的「采集源状态」与侧边栏统计项的 tooltip 都能看到 —— **条数变少是轮转，不是故障**。
  要回到"每轮全抓"就设 `youtubeRotateChannels: false`。B站的视频索引不受影响。
- 哔哩哔哩排行榜偶发 `-352` 风控（已退避重试，仍可能失败）。
- 侧边栏 tab 需要 DSH 重启后才会出现：客户端半体在启动时组装，不像 host 路由可以实时挂载。

## 计划与进度

**下一站：从「日报」变成「调研插件」**（按用户 2026-10-12 的新要求）
—— 按项目切换目录，用 AI 搜索与**当前项目**有关的新闻与知识来补充项目。
项目 = 工作目录（与 DSH 的 workspace 对齐），每个项目一套独立状态。
六轮增量与"明确不做"的范围见 `PLAN.md` §2.5。

- 开发计划：`PLAN.md`（按小时的第一波 6 小时节奏）
- 进度台账：`STATUS.md`（每轮必更新）
- 竞品侦察：`../../docs/DAILY-PLUGIN-RECON.md`
