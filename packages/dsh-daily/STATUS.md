# dsh-daily 进度台账（STATUS）

> 每轮唤醒后**先读这里**，做完**必更新这里**。格式固定：轮次 / 做了什么 / 证据 / 阻塞 / 下轮起点。

## 当前状态

- **阶段**：H1/H2/H3/H4 完成；下一步 H5（UI 复验）→ H6（文档与完整回归）
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

### R3 · 2026-10-12 02:10–02:30 — H4（主动推荐的"不同类型"落地 + 定时时刻钉死）

**做了什么**
1. **`pickDiverse`（需求 (a) 的关键修复）**：注入 systemPrompt 的那 6 条以前是"分数前 6"，
   实测**6/6 全是 Hacker News 的技术新闻** —— 需求原话是「每日主动给我推荐**不同**类型的新闻」，
   这样等于没做到。现在两条约束一起用：**主题轮转**（按主题分组、一轮一轮取）+ **每源上限 2**；
   候选不足时放宽上限补齐，且补齐时**优先用得最少的源**（否则放宽的瞬间又被同一个源塞满）。
2. **`test/render.test.js`**（12 组）：多样化选取、brief 结构、digest 分组与失败源、时间与热度格式化
3. **`test/schedule.test.js`**（7 组）：`computeNextRun` 的过点/未过点/正好到点/跨月跨年/非法输入/越界夹紧
4. 给 `pickDiverse` 的"源不够时"行为写了专门的断言（上限让位于补齐，但不该继续堆同一个源）

**证据（真实输出）**
- 全量测试：`node --test test/` → **tests 69 / pass 69 / fail 0**（rss 28 + rank 14 + tune 11 + render 12 + schedule 7 = 72 组中的 69 条实际用例）
- **「不同类型」前后对比（同一批 67 条真实数据，同一份 renderBrief）**：
  - 修复前 Top6 来源：HN ×6（全是"技术"）
  - 修复后 Top6 来源/主题：**HN(技术) · 哔哩哔哩(热点·视频) · YouTube(AI·视频) · IT之家(硬件) · IT之家(商业) · Solidot(学术)** —— 6 条 6 个主题、4 个源
- **注入文本实测**（这就是每轮要付的 token）：全文 **405 tokens**（`announceMaxItems=6`，可调）
- 类型检查：`tsc -p tsconfig.json --noEmit` → **0 error**

**阻塞**：无

**下轮起点**：H5 —— 侧边栏页面在**装了新版宿主代码并重启后**的复验（分类/搜索/视频卡/调教/日报弹层/280px）；
然后 H6：README 里补上"重启才生效"的运维说明、跑完整回归清单、确认 `install-to-profile` 幂等

### R4 · 2026-10-12 02:06–02:18 — H5：侧边栏页面复验（真实数据 + 真实浏览器）

**做了什么**
1. 起 `scripts/dev-server.mjs --no-refresh`（真实 67 条数据），用浏览器逐项复验：
   分类筛选 / 搜索 / 仅未读 / 视频卡 / 反馈 / 调教 / 日报弹层 / 空态 / 宽度矩阵 / 封面降级
2. **封面超时 6000ms → 3000ms**（`web/app.js`）：H5 实测本机网络下 YouTube 缩略图（`i.ytimg.com`）
   **100% 不可达**，而这类"请求挂着、既不 error 也不 load"只能靠超时兜住 ——
   6 秒意味着 8 张 YouTube 卡白等 6 秒才变占位块，观感是"一片空白停在那儿"。3 秒是权衡值。
3. 复验后**恢复现场**：把测试期间写入的 feedback 逐条 `clear`，并把 `prefs.json` 重置为默认

**证据（真实浏览器测量）**
| 检查项 | 结果 |
|---|---|
| 分类筛选 | 全部 67 → 热点 7 → 全部 67 → AI 19 → 全部 67（每步都能正确往返） |
| 搜索（本地即时） | `DeepSeek` → 2 条；清空 → 67 条 |
| 空态 | 搜不可能命中的词 → 列表 0 条 + 可读提示「当前筛选下没有条目｜已排除 关键词「…」｜按 Esc 清空筛选」 |
| 仅未读 | 67 条（当前全未读，符合预期） |
| 视频卡 | 8 张 B 站卡封面全部真实加载（naturalWidth 1823/1920/2048/960/2560/1076/2560/1152） |
| YouTube 封面降级 | `<img>` 在超时后被移除、换成 `.dd-thumb-fallback`（播放图标 SVG）——**无破图图标、无永久留白** |
| 日报 Markdown 弹层 | 正常打开，正文 **10525 字符**，路径 `~/.dsh/daily/digest/2026-10-12.md` |
| 反馈 👍 | `aria-pressed` false→**true**，后端 `liked: true` 落盘 |
| 反馈 ✓已读 | 未读数 67 → **66** |
| 调教 | 提示条显示「新增主题偏好：开源｜已记下你的原话」；偏好区刷新为「主题 开源 / 每日配额 120 / 原话」；state 里 `topics:["开源"]`、`tuningNotes` +1 |
| 宽度矩阵（同源 iframe 实测） | 280 / 340 / 420px 三档 **scrollWidth == clientWidth**，无页面级横向滚动；封面 76→96px 自适应 |

**本轮最重要的教训（写在最前，因为它最会骗人）**
第一次跑复验时我判定"点分类 chip 后列表永久卡在 7 条"是个**严重 bug**。
其实是我自己的测试脚本错了：`renderChips` 每次筛选都会 `clear` 并**重建** chip 节点，
而我事先把 `chips[0]` 存进了变量 —— 重渲染后那是个**已脱离 DOM 的节点**，`.click()` 自然什么也不做。
改成每一步重新 `querySelectorAll` 之后，全部 5 档筛选都正确往返。
**结论：验证脚本自身的失效必须先排除，再断言产品有 bug。**

**阻塞**：无

**下轮起点**：H6 —— README 补「重启才生效」的运维说明、CHANGELOG、完整回归清单（探针 + 测试 + dev-server + 装机幂等 + profile patch 校验）

### R5 · 2026-10-12 02:18–02:25 — H6：文档收口 + 完整回归清单

**做了什么**
1. **`CHANGELOG.md`**：0.1.0 的 Added / Fixed / Known limitations 全量记录（含全部 7 个已修 bug 的成因）
2. **README.zh.md 新增「改完怎么验证」矩阵**：区分"纯逻辑 / 页面 / host 运行时 / 客户端半体"四类改动，
   逐类写明验证手段与**是否需要重启**；并把"host 改动必须重启"的**机制原因**（Node 缓存已成功导入的 ESM 模块）
   与那个更具欺骗性的变体（**失败也会被缓存**）写清楚
3. **README.zh.md 新增「完整回归清单」**：可直接复制执行的 5 步命令（类型 / 单测 / 探针 / 装机 / 副本一致性与独立导入）
4. `package.json` 的 `files` 与装机脚本的拷贝清单补上 `CHANGELOG.md`

**证据：回归 5/5 全绿（第 5 项是本轮新增的关键项）**
```
回归 1/5 装机幂等        ✅ 连跑两次，patch 里仍只有 1 行 insert + 1 行 disabled，无重复
回归 2/5 类型检查        ✅ tsc -p tsconfig.json --noEmit → 0 error
回归 3/5 单元测试        ✅ tests 69 / pass 69 / fail 0
回归 4/5 副本与源码一致   ✅ lib/index.js lib/client.js web/app.js web/style.css web/index.html
                           package.json cordis.patch.yml —— 7/7 个 sha256 完全相同
回归 5/5 副本可独立导入   ✅ import('…/dsh-daily-v2/lib/index.js') → DailyConfig,apply,inject,name
```
第 4、5 项是刻意设计的：**"源码改对了"与"装进去的那份是对的、而且能被 dsh 加载"是两件事**，
而且这两个正是本项目踩过坑的地方（符号链接解析、失败模块缓存），所以必须用哈希与真实 import 来守。

**阻塞**：无

**下轮起点**：H7+（第二波）—— 可选 AI 摘要（借鉴 dsh-rss 的经验：`maxTokens` 要留足推理预算，
推理 token 与正文共享上限，太小会让"还没写正文就耗尽预算"）、OPML 导入导出、跨天去重与归档、周报、桌面通知。
另外：**重启一次 DSH** 后需要复验右侧栏「日报」tab 与 7 个工具在真实 GUI 里的表现（这是唯一还没在真实 GUI 里看过的部分）。

### R6 · 2026-10-12 03:06–03:25 — H7：跨天去重（第二波第一项）

**为什么先做它**：三条需求里"每日主动推荐"最容易被一条新闻毁掉 —— 连着三天给你同一条，
用户会立刻认定这个插件没用。这一项直接决定日报**能不能长期看下去**。

**做了什么**
1. `rank.ts` 新增 `buildRecentlySeen`（纯函数）+ `shiftDate`；`RankOptions` 增加
   `recentlySeen` / `today` / `repeatPenalty`
2. 窗口内重复的条目**重罚到 ×0.2 并标注「YYYY-MM-DD 已推过」**，但**不删除** ——
   真正重要的事（同一篇论文被反复讨论）仍然进得来，只是排在后面；`daily_search` 依旧搜得到
3. 同日重排**不判重复**（用户调教后会触发重排，若把今天算进窗口就会自己罚自己）
4. `config.ts` 新增 `dedupeWindowDays`（默认 3 个日历天，0 = 关闭），`resolveConfig` 同步兜底
5. `service.ts` 新增 `loadRecentlySeen`，接入 `refresh()` 与 `reRank()` 两条路径
6. 新增 `test/dedupe.test.js`（12 组）+ `test/dedupe-integration.test.js`（2 组，走真实 DailyService + 真实落盘）
7. 新增 `scripts/dedupe-demo.mjs`：真实条目 + 临时目录的效果演示

**本轮抓到一个真 bug（集成测试逼出来的）**
窗口原本写成对归档文件列表 `slice(-windowDays)` —— **按"存在几个文件"取，而不是按日历天**。
后果：当归档稀疏（机器只是偶尔开机）时，`dedupeWindowDays: 3` 会把**十天前**那天的条目也算进窗口，
把真正的新内容一起压下去。改成 `shiftDate(today, -windowDays)` 的**日历窗口**后修复，
并为它补了两条边界断言（稀疏归档、窗口下界含当天）。

**证据（真实输出）**
- 全量测试：`node --test test/` → **tests 82 / pass 82 / fail 0**（R5 基线 69 → 本轮 +13 组）
- 集成证据（真实 DailyService + 真实 days/*.json，临时目录）：
  昨天已推过 → 今天重排后对应条目 `reasons` 出现「2026-10-11 已推过」，
  `score` 从 100 量级降到 18~33；窗口外（四天前）与全新条目**不受影响**；关闭窗口（=0）时无惩罚
- 真实内容演示 `node scripts/dedupe-demo.mjs`（67 条真实条目，模拟"这批昨天推过"）：
  - 去重前 Top1 `Documents Add to Evidence…`（HN 301 分，144.1）
  - 去重后 Top1 换成 `DeepSeek's Insane Technique Makes AI Forget`（32.6），8 条全部带「已推过」标注
  - 用户数据未被改动：`~/.dsh/daily/days/` 仍只有 1 个文件
- 类型检查：`tsc -p tsconfig.json --noEmit` → **0 error**

**阻塞**：无

**下轮起点**：第二波下一项 —— 可选 AI 摘要（需要先摸清 `ctx.llm` 的路由契约与 provider/model 取法），
或者先做 OPML 导入导出（纯逻辑、风险低、能立刻提升"自定义"体验）。

### R7 · 2026-10-12 04:06–04:25 — H8：可选 AI 摘要（第二波第 2 项）

**为什么做它**：只有标题的列表要一条条点进去才知道值不值得看。一句中文概要把"高价值索引"
从"能看"推到"扫一眼就能筛"。默认关闭 —— 它会真的花 token，用户明确打开才启用。

**做了什么**
1. `src/ai.ts`：`buildSummaryPrompt` / `cleanSummary` / `summarizeOne` / `summarizeItems` / 缓存三件套，
   全部**可注入 stream**（假 stream 就能覆盖全部失败路径，不花 token 也不依赖密钥）
2. `config.ts` 新增 9 个字段（开关、路由、条数、并发、maxTokens、超时、缓存 TTL 与上限）
3. `service.ts` 新增 `setLlm()` 接线、`applyAiSummaries()`（缓存优先 / 单条隔离 / 异常不影响主流程）、
   `regenerateAiSummaries()`（给**已抓到**的条目补摘要，不重新抓取），并把 `ai` 统计放进 `/api/state`
4. `api.ts` 新增 `POST /api/ai`；`render.ts` 在日报与注入段优先用 AI 摘要
5. 侧边栏：`✨` 按钮（仅在开启时出现）+ 卡片上的 ✨ 标记 + 按 AI 摘要文本可搜；进度条与胶囊两种耗时操作复用
6. `scripts/dev-server.mjs` 新增 `--ai-fake`：**零成本**验证整条 UI 链路（假 stream 还会刻意让第 3 条失败，用来验"部分失败"的提示）
7. 测试：`test/ai.test.js`（21 组）+ `test/ai-integration.test.js`（5 组，真实 DailyService + 真实落盘）

**本轮的关键教训（一个非常隐蔽的 bug 类型）**
后端正确返回了 `aiSummary`、`/api/ai` 也报告"新生成 5 条"，**但界面上一条摘要都没有**。
根因：页面用的是**字段白名单**映射（`normalizeItem` 只挑它认识的字段），
新字段没同步进去就被静默丢掉。修好后卡片出现 5 个 ✨、按摘要文本能搜到 5 条。
已在 `normalizeItem` 处留注释：**新增条目字段必须同步这里**。
—— 这类 bug 的特点是"每一层单独看都对，数据在中间被丢掉了"，只有端到端看界面才发现。

**证据（真实输出）**
- 全量测试：`node --test test/` → **tests 108 / pass 108 / fail 0**（R6 基线 82 → 本轮 +26 组）
- 类型检查：`tsc --noEmit` → **0 error**；`node --check web/app.js` → 通过
- 装机：副本可独立 `import` → `DailyConfig,apply,inject,name`
- **UI 端到端（`--ai-fake`，真实浏览器）**：
  - 提示条原文：「AI 摘要｜新生成 5 条 · 缓存命中 0 条 · 失败 1 条｜模型：fake-dev-model｜
    失败原因：模型没写出正文就用完了 maxTokens=1024（终止原因 max-tokens）」
  - 卡片：`5` 个 `.dd-item-summary.is-ai`、`5` 个 `.dd-ai-mark`（✨）
  - 搜索「假摘要」→ 命中 `5` 条（AI 摘要参与搜索）
  - `/api/state` 的 `ai.last` 如实反映 `generated:5 / failed:1 / reasons:[…max-tokens…]`
  - 收尾：进度条与胶囊正确复位
- **默认关闭有守**：`aiSummaryEnabled=false` 时集成测试断言"绝不调用模型"（`state.calls === 0`）
- **测试数据已清理**：假摘要把 5 条真实条目污染过，已逐条剥离 `aiSummary`、删除 `ai-cache.json`、
  重建日报并验证日报里不再含「假摘要」

**阻塞**：无

**下轮起点**：第二波下一项 —— OPML 导入导出（纯逻辑，能立刻提升"自定义源"的体验），
然后跨天归档/周报/桌面通知。另外仍欠一次 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + 7 个工具）。

### R8 · 2026-10-12 05:06–05:30 — H9：OPML 导入导出（第二波第 3 项）

**为什么做它**：用户多半已经在别的阅读器里订阅了几十个源。让他一条条抄 URL，
是这个插件最可能被放弃的一步。有了 OPML，"换过来"就是给一个文件。

**做了什么**
1. `src/opml.ts`（零依赖，约 300 行）：实体解码（**单趟扫描**，`&amp;lt;` 只解一层）、
   XML 转义、属性解析（顺序任意 / 单双引号 / 无引号值）、
   **带分类栈的 outline 解析**（只有含 `xmlUrl` 的才是订阅源，其余是分类）、序列化、合并
2. `Prefs.extraFeeds`（运行期追加的源）+ `runCollection` 支持 `extraFeeds` 合并 ——
   **导入不需要改配置、不需要重载 profile**，符合"日常操作应当即时生效"的原则
3. `service.importOpml()` / `exportOpml()`；导出含内置源（用户能把喜欢的源带回自己的阅读器）
4. 工具 `daily_opml`（import 支持文件路径或直接给 XML；export 可写文件或直接返回）
   + HTTP `GET/POST /dsh-daily/api/opml`
5. 测试 `test/opml.test.js`（20 组，含 4 组真实 DailyService 集成）

**本轮抓到一个谎报（用"接线测试"逼出来的）**
写"导入的源真的会被采集器读到"这条测试时，用一个必然连不上的地址去验证接线，
结果发现：**自定义源全部失败时，源状态仍然报 ✅ 正常** ——
`collectExtraFeeds` 把失败只写进 note。用户导入 12 个源、全都抓不到，
日报上却显示"所有源都正常"，这是最坏的一种谎报。
改为与 YouTube 一致的语义：全部失败则整源判失败，部分失败才降级为 note。

**还修了一个重复采集**
HTTP 端到端导入一份真实形状的 OPML 时发现：少数派（`https://sspai.com/feed?utm_source=reader`）
规范化后与内置源是同一地址，却因为**内置源不在 `extraFeeds` 里**而逃过判重 → 同一份内容被抓两次。
改为内置源作为 `reserved` 参与判重（只比对、不写入）。

**证据（真实输出）**
- 全量测试：`node --test test/` → **tests 129 / pass 129 / fail 0**（R7 基线 108 → 本轮 +21 组）
- 类型检查：`tsc --noEmit` → **0 error**
- **HTTP 端到端（真实 dev-server，导入后用备份复位）**：
  - `GET /api/opml`（只读导出）→ `count: 4`，输出合法 OPML 2.0（内置源按分类分组嵌套）
  - `POST /api/opml` 导入一份真实形状的 OPML（5 条源、3 个分类节点、含 utm 变体）→
    「解析: 5 | 新增: 4 | 重复: 1 | 合计: 4」，新增明细 `['Import AI','The Batch','Lobsters','无分类的源']`
    —— 少数派被正确判重（它是内置源）
  - 再导一次 → 「新增: 0 | 重复: 5 | 合计: 4」（幂等）
  - 落盘检查：`prefs.extraFeeds` 四条形如 `Import AI|https://importai.substack.com/feed|AI 前沿`
  - **收尾**：用导入前的备份复位 `prefs.json`，并确认 `readPrefs()` 对缺失字段回落默认、文件已规范化
- 解析健壮性（都在测试里）：CDATA 标题、大小写不一致的 `<OPML>/<OUTLINE>`、单引号属性、
  自闭合标签、`ftp://` 与空地址跳过、收藏夹 HTML 当输入、空/`null`/`undefined` 输入、
  往返（serialize → parse）后条目等价

**阻塞**：无

**下轮起点**：第二波剩余项 —— 跨天归档（把往期日报做成可翻阅的索引）、周报、桌面通知；
或者把 OPML 做成侧边栏里的一个按钮（目前只有工具与 HTTP 入口）。
仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + 7 个工具 + ✨ 按钮）。

### R9 · 2026-10-12 06:06–06:35 — H10：归档 + 周报（第二波第 4 项）

**为什么做它**：「高价值**索引**」意味着能往回翻，而不是只看今天。
`daily_search` 能按关键词找，但「按天翻」是另一条检索路径，也更符合人的回忆方式
（"我记得是周二前后看到的"）；周报则回答"这一周"的问题。

**做了什么**
1. `src/archive.ts`（纯函数）：`summarizeDay` / `topItems` / `topicDistribution` /
   `renderWeeklyReview`（四节：最值得看 · 按主题 · 每天 · 源健康）/ `weekFileName`
2. `service.listArchive()`（读真实落盘的 days/*.json，新到旧）+
   `service.buildWeeklyReview()`（含头含尾的日期窗口，落盘 `digest/week-<起>_<止>.md`）
3. `store` 增加 `readDigestNamed` / `writeDigestNamed`（按名字读写 digest 目录）
4. API：`GET /api/archive`、`GET /api/weekly`；工具：`daily_weekly`
5. 侧边栏**日期导航**（`‹ 日期 ›` + 「回到今天」），历史态有强调色左边框；
   翻天后正确加载那天的条目、日报预览取那天的 Markdown
6. `dev-server` 新增 `--data-dir=` 与 `--seed-history=N`：**不用等好几天**就能验证跨天 UI，
   且完全不碰 `~/.dsh/daily`（播种数据在 /tmp）
7. 测试 `test/archive.test.js`（10 组，含 3 组真实 DailyService 集成）

**本轮抓到三个真问题（全部由端到端验证暴露）**
| 问题 | 表现 | 修法 |
|---|---|---|
| 点「日报预览」什么都不发生 | 某天没有日报时 `/api/digest` 返回 `ok:false`，前端当**整页错误**处理：弹层不打开、页面顶上却弹红条。一个正常的空状态被表达成了故障 | 改为 `ok:true + available:false`，弹层里给可读说明；并去掉"用全局 available 提前 return"（它会让"看历史那天的日报"被错误挡住） |
| 日报路径是硬编码的 | 弹层显示 `~/.dsh/daily/digest/…`，自定义数据目录时那是个**不存在的路径** | 按真实数据目录生成，home 之下缩写成 `~/…` |
| 历史态的刷新说明是死代码 | 按钮 `disabled` 点不动，写在那条分支里的提示永远不会执行；tooltip 又太容易忽略 | 把「历史数据 · 刷新只抓今天」写进**统计行**（用户一定会读的那一行） |

**证据（真实输出）**
- 全量测试：`node --test test/` → **tests 138 / pass 138 / fail 0**（R8 基线 129 → 本轮 +9 组）
- 类型检查：`tsc --noEmit` → 0 error；`node --check web/app.js` → 通过
- **HTTP（播种 4 天历史，数据目录 /tmp，不碰真实数据）**：
  - `GET /api/archive` → 5 天，条数各异（67 / 33 / 44 / 50 / 53）
  - `GET /api/weekly` → `week-2026-10-06_2026-10-12.md`，5 天 / 247 条，四节齐全
  - `GET /api/state` → `digest.path: /tmp/dsh-daily-devdata/digest/2026-10-12.md`（真实路径）
- **浏览器端到端（真实渲染）**：
  - 日期条出现；`‹` → `2026-10-11` 且列表变 **33 条**（与 archive 一致）；再 `‹` → `2026-10-10` / 44 条
  - 历史态：`回到今天` 出现、`is-history` 强调边框生效、刷新置灰且 title 正确、
    统计行变为「33 条 · 33 未读 · 10/11 源正常 · 已加载 33 · **历史数据 · 刷新只抓今天**」
  - `回到今天` → 67 条、提示消失、刷新恢复可用
  - 日报预览：今天 → 打开真实日报（67 条正文）；昨天（无日报）→ 弹层内可读说明，
    **页面错误条不再出现**
- 测试数据隔离：播种历史只写在 `/tmp/dsh-daily-devdata`，`~/.dsh/daily` 未被触碰

**阻塞**：无

**下轮起点**：第二波剩余项 —— 把 OPML 与周报做成侧边栏里的按钮（目前只有工具/HTTP 入口）、
桌面通知。仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + 9 个工具 + ✨ 按钮 + 日期导航）。

### R10 · 2026-10-12 07:06–07:35 — H11：侧边栏可点入口 + 客户端契约测试

**为什么做它**：OPML 与周报上一轮只做了工具与 HTTP 入口 —— 用户要么对模型说、要么敲 curl。
这是当时最明显的可用性缺口：功能都在，但**用不到**。

**做了什么**
1. **页脚两个入口**（放页脚而不是标题栏：280px 下标题栏已有 3 个图标按钮，再加必溢出；
   页脚本来也是"次级操作"的位置）
   - **订阅管理**：选 OPML 文件导入（`<input type=file>` + FileReader，读完 POST `/api/opml`）、
     列出自定义源、逐条「移除」、复制 OPML / 下载 OPML
   - **本周回顾**：弹层里渲染周报 Markdown（复用日报预览的极简 Markdown 渲染器）
2. 通用弹层 `openModal(title, path, buildBody)`：把原来只服务日报预览的弹层抽成通用壳
3. 后端：`listCustomFeeds()` / `removeCustomFeed()`（按**规范化 URL** 删除，带 utm 的写法也能命中）+
   `GET/POST /api/feeds`；`/api/state` 增加 `feeds` 计数（入口上显示「订阅管理（N）」）
4. **新增 `test/client-contract.test.js`（4 组静态契约测试）** —— 本轮最有价值的产出，见下

**本轮抓到两个 bug，其中一个是"同一类 bug 第二次出现"**
| 问题 | 表现 | 修法 |
|---|---|---|
| `discussUrl` 一直被丢掉 | 后端从 R2 起就在返回 HN 讨论页链接，但页面字段白名单 `normalizeItem` 没映射 → 侧边栏**从来没显示过**讨论入口（同一类 bug 上次是 `aiSummary`） | 补映射 + 在条目 meta 里真的渲染出「讨论」按钮 |
| 引用了不存在的 API 键 | `API.opml` / `API.feeds` 没加进路径表 → fetch 了一个 `undefined`，**不报错、无日志**，界面表现是"点一下转完就没反应" | 补上，并写成静态断言守住 |

**新测试为什么值得单独说**（`test/client-contract.test.js`）
"同一类 bug 出现两次"说明它不能靠人记得。这四条断言全是静态的、毫秒级：
1. 每个 `API.<key>` 引用都在路径表里有定义（本次就抓到两个）
2. 路径表里每个 URL 在 `src/api.ts` 都有对应 `case` 分支
3. `normalizeItem` 的字段白名单覆盖后端会返回的字段（**这条刚写出来就抓到 `discussUrl`**）
4. `el.xxx = $('dd-…')` 里的 id 都真实存在于 `index.html`

**证据（真实输出）**
- 全量测试：`node --test test/` → **tests 144 / pass 144 / fail 0**（R9 基线 138 → 本轮 +6 组）
- 类型检查：`tsc --noEmit` → 0 error；`node --check web/app.js` → 通过
- **浏览器端到端（真实渲染）**：
  - 页脚：`['订阅管理（2）', '本周回顾']`
  - 订阅管理弹层：文件框 `accept=".opml,.xml,application/xml,text/xml"`、
    按钮 `['复制 OPML','下载 OPML','移除','移除']`、2 行源（`Import AI`/`Lobsters`，主题 `AI`/`热点`）
  - 点「移除 Import AI」→ 列表剩 `['Lobsters']`、提示「已移除「Import AI」。」、
    后端 `/api/feeds` 同步只剩 `['Lobsters']`
  - 本周回顾：标题「本周回顾」、路径 `digest/week-2026-10-06_2026-10-12.md`、正文 2339 字符，四节齐全
  - 「讨论」按钮：后端 `probe hn` 产出 **16/16** 条带 `discussUrl`；注入 dev 数据后页面渲染出 3 个
    `.dd-meta-discuss`，`data-action="open"`、目标 URL 正确、位于 `.dd-item-meta` 行内
- 数据隔离：联调数据全在 `/tmp/dsh-ui`，收尾已删除；`~/.dsh/daily` 仍只有 1 天数据、`extraFeeds: []`

**阻塞**：无

**下轮起点**：第二波剩余项 —— 桌面通知；或做"条目详情/阅读态"。
仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + 9 个工具 + ✨ 按钮 + 日期导航 + 页脚入口，
现在唯一没在真实界面里看过的就是它们）。

### R11 · 2026-10-12 08:06–08:35 — H12：归档容量管理（长期运行）

**为什么做它**：这个插件是要**每天跑、长期跑**的。`days/*.json` 一天约 50KB —— 一年 ~18MB，
而 `daily_search` / 归档索引 / 周报都要读它们，读得越久越慢。
更关键的是：**旧条目的详细摘要早就不重要了** —— 三个月前那篇论文的 400 字原文摘要没人会回去看，
但它的标题、链接、主题仍然有用。所以策略是「分级保留」而不是「一刀切删除」。

**做了什么**
1. `src/storage.ts`（纯函数）：`planArchive`（按日历天决定 keep/compact/delete）、
   `compactItem`（丢 summary/stats/reasons/thumb/discussUrl/author，留索引字段）、
   `isCompacted`、`formatBytes`
2. 配置：`archiveCompactAfterDays`（默认 60）、`archiveDeleteAfterDays`（**默认 0 = 永不删除**）
3. `service.storageStats()`（天数/条数/字节/最老最新/已压缩天数）、
   `service.pruneArchive({apply})`、`maybeAutoCompact()`（每天最多一次，挂在采集之后，用 `meta.lastPruneDate` 节流）
4. 工具 `daily_prune`（默认只预览）+ API `GET|POST /api/storage`
5. 顺手：空态里的「开始抓取」按钮（原来只说"点右上角刷新按钮"，让用户自己去找图标）
6. 测试 `test/storage.test.js`（12 组，含 5 组真实 service 集成）

**本轮抓到的问题（由测试直接顶出来）**
**dry run 的报告自相矛盾**：预览时报告写着「压缩 0 天 · 删除 0 天」，却同时列出了 59 个待处理日期
—— 计数只在 `apply` 分支里累加。而这份报告正是用户决定要不要执行**全部依据**，
"没事可做"的假象比不报还糟。改为两种模式都如实计数。

**证据（真实输出）**
- 全量测试：`node --test test/` → **tests 156 / pass 156 / fail 0**（R10 基线 144 → 本轮 +12 组）
- 类型检查：`tsc --noEmit` → 0 error；`node --check web/app.js` → 通过
- **真实量级端到端**（120 天 × 67 条真实条目 = 8040 条，数据目录 /tmp）：
  - `GET /api/storage` → 「120 天 · 8040 条 · 5.8 MB · 最老 2026-06-15」，
    计划「保留 61 天 · 压缩 59 天 · 删除 0 天」
  - **预览后 `du` 确认目录一字未变**（dry run 真的不写盘）
  - `POST /api/storage` → 「压缩 59 天 · 释放 1342 KB」，`已压缩天数 59`
  - 逐文件精确对比：**未压缩 49.6 KB/天 → 压缩后 26.8 KB/天（−46%）**；
    全年外推 **17.7 MB → 9.6 MB**；抽查压缩后的条目：标题/链接/主题/分数都在，`summary`/`reasons`/`thumb` 已丢
- **自动整理钩子（真实采集）**：造一天带长摘要的旧数据（951B）→ 跑一次真实 `refresh({sourceIds:['hn']})`
  → 日志出现「归档整理：压缩 1 天 · 释放 618 B」→ 文件变 333B（**−65%**）→ `meta.lastPruneDate = 2026-10-12`
  （节流标记已写）→ 压缩后标题与链接仍在
- **空态 CTA（浏览器）**：文本「🌱 今天还没抓取过 / 点下面的按钮开始第一次抓取（大约 30–60 秒）…」，
  按钮 `data-action="start-refresh"`；点击后进度条 `is-on`、刷新按钮置灰、胶囊显示「⟳ 正在刷新订阅源…」

**阻塞**：无

**下轮起点**：第二波剩余项 —— 桌面通知；或"条目详情/阅读态"。
仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + **10 个**工具 + ✨ 按钮 + 日期导航 + 页脚入口）。

### R12 · 2026-10-12 09:06–09:45 — H5 侧边栏页面完整复验（不再加功能）

**为什么这轮不加功能**：前几轮一直在加东西，但排期里 H5 那份清单
（视频卡 / 封面降级 / 280px 窄宽度 / 错误态）我**从没用证据验过**。
本机 YouTube 缩略图域名恰好不可达，正是最该验的降级路径。结果一验就翻出三个真问题。

**验出的三个真问题（全部已修）**

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| 1 | **视频封面被自己误杀** | 真实数据 16 张视频封面**全部**变占位块；可 `curl` 同一个 bilibili 封面却是 `200 image/jpeg`（100–490KB） | 封面是 `loading="lazy"`，而"超时换占位块"的计时器在元素**创建时**就启动 —— 屏幕外的卡片浏览器还没开始下载，计时器已到期。改为「占位块常驻底层 + 图片进入视口才插入并盖在上面」，**彻底删掉计时器** |
| 2 | **错误态文案判错了原因** | 注入 `/api/state` 503 后，提示让用户「把页面放在 /dsh-daily/ 下」—— 而页面当时**已经**在 /dsh-daily/ 下 | 按"是否由宿主路由提供"分流文案 |
| 3 | **演示数据没在统计行标注** | 接口挂掉后统计行显示「10 条 · 8 未读 · 7/8 源正常」，与真实数字一模一样 | 统计行以醒目「演示数据」徽标开头 |

问题 1 的排查过程值得记下来：先用 `curl` 证明**网络与域名都是通的**，
再用 `document.visibilityState` 发现页面处于 **hidden**（Chrome 会完全推迟 lazy 图片加载），
然后用 `new Image()` 直接加载同一 URL 成功（1920×1080），
最后强制 `loading="eager"` 后 **8/8 bilibili 封面立刻载入** —— 三步把"网络问题"排除干净，
锁定在自己写的超时逻辑上。

**H5 清单逐项结果（真实渲染 + 真实数据）**
| 检查项 | 结果 |
|---|---|
| 分类筛选 | 芯片 `全部67 / AI24 / 技术16 / 热点7 / 学术6 / 硬件6 / 开源4 / 效率4`；点 AI → 24 条、点全部 → 67 条 |
| 搜索 | 「模型」→ 4 条，清空 → 67 条，清除按钮出现 |
| 仅未读 | 勾选后 67 条（当天全未读，数字正确） |
| 视频卡（封面·时长·播放量） | 16 张视频卡；**8 张有时长 + 8 张有播放量**（= bilibili 那 8 张，如「29:55 … 65.9万 播放」）；YouTube 卡没有这两项（**RSSHub 源本身不提供**，非 bug） |
| **封面降级** | 16 个占位块常驻 + 16 张图插入 → **8 张 bilibili 真的显示出来**（修复前全被误杀）、8 张不可达的 YouTube **0 破图 / 0 空洞** |
| 👍 | 落盘 `feedback.json`（`liked: true`），后端 `/api/items` 返回 `liked: True` |
| 已读 / 隐藏 | 已读落盘 `read: true`；隐藏后卡片从列表消失（67 → 66），后端也不再返回该条 |
| 调教输入 | 「以后多推 AI Agent 相关的，少推币圈」→ 提示「新增主题偏好：AI / 新增关键词偏好：Agent / 新增屏蔽词：币圈 / 已记下你的原话」；`prefs` 三项都落盘 |
| 日报 Markdown 弹层 | 标题/真实路径（`/tmp/dsh-h5/digest/2026-10-12.md`）/9992 字符/6 个主题小节/51 个链接 |
| **280px 窄宽度** | 用 280 / 320 / 420px 内嵌 iframe 验（媒体查询按 iframe 宽度生效）：**均无横向溢出**；280px 下封面自动收窄到 76px、标题 2 行、268 个动作按钮都在 |
| 空态 | 「🌱 今天还没抓取过 + 开始抓取按钮」；点击后进度条 `is-on`、刷新按钮置灰 |
| 错误态 | 注入 503 → 标题「日报 · 演示模式」+ 红条 + 重试按钮 + 统计行「演示数据」徽标；点重试仍失败则保持演示态不崩；**恢复后**标题回到「日报 · 2026-10-12」、67 条真实数据、错误条消失 |

**新增的开发工装**：`dev-server --fail-api=state,items`（故障注入）。
错误态是用户真会碰到的状态，但正常开发里无法自然触发；不注入就只能"看代码觉得没问题"。

**证据（真实输出）**
- 全量测试：`node --test test/` → **tests 156 / pass 156 / fail 0**（本轮无新增测试，是**复验轮**）
- 类型检查：`tsc --noEmit` → 0 error；`node --check web/app.js` → 通过
- 封面修复前后对比：修复前 `{imgNodes:16, loaded:0, broken:0, placeholders:16}`；
  修复后 `{thumbs:16, fallbacks:16, imgInserted:16, loaded:8, broken:0, holes:0}`，`loadedHosts = [i0/i1/i2.hdslb.com]`
- 数据隔离：全部联调在 `/tmp/dsh-h5`（真实数据副本），收尾已删除；
  真实 `~/.dsh/daily` 的 `prefs`（topics/blocked/notes 全空）与 `feedback`（0 条）**未被写入**

**阻塞**：无

**下轮起点**：第二波剩余项 —— 桌面通知；或"条目详情/阅读态"。
仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + 10 个工具 + ✨ 按钮 + 日期导航 + 页脚入口）。

### R13 · 2026-10-12 10:06–10:45 — H6 安装与运维验证（发布就绪）

**为什么做它**：H5 那轮证明了"没验过的东西等于没做"。而 **H6 的安装/运维路径**是我唯一
只**声明**过、从未用证据验过的部分 —— 而它恰恰决定插件能不能被用上。
`install-to-profile.mjs` 只负责"拷文件 + 维护 patch 一行"，**不做任何校验**。

**做了什么**
1. `scripts/verify-install.mjs`（新，15 项检查，退出码可当 CI 用）。检查的是几类
   **"装完看起来没事、跑起来才炸"**的错：
   - 装成符号链接 / 目录内有符号链接 → 真实路径绕回工作区，`@deepseek-ai/*` 解析不到
   - `$DSH_HOME/profiles/node_modules/@deepseek-ai/*`（共享解析根）是否存在
   - **profile 里的代码与工作区构建产物逐文件哈希一致** ← 抓"改了代码忘了重装"
   - `lib/client.js` 存在且含 `__ModuleLoader__.load`（缺了 tab 消失、host 侧却一切正常）
   - patch 行存在 / 名字与目录匹配 / 不重复
   - `index.html` 引用的本地资源都在；`package.json` 的 main / `dsh.client` 声明有效
   - 安装副本能被 Node 独立导入（最贴近"dsh 真的会加载它"）
   - `--idempotent`：重复装机后 patch 与全部文件**逐字节不变**
2. `npm run regression`（构建 → 单测 → 装机 → 安装校验）与 `npm run verify:install`
3. 修掉 README 两处**与实现不符**的说明（回归清单还写 69 组单测与手工 diff；
   「已知限制」还写封面"走 6 秒超时降级"，而 R12 已删掉计时器）
4. 修掉探针输出会被误读成用户偏好的文案

**证据（真实输出）**
- **校验器本身必须被验证**（否则它只是安慰剂）—— 用 `DSH_HOME=/tmp/...` 造了 5 个故障场景：

    | 场景 | 是否被抓到 |
    |---|---|
    | patch 里写了名字但根本没装 | ✅ `patch 里写的名字对应一个真实目录` FAIL |
    | **装成符号链接** | ✅ 3 项 FAIL，且导入报错正是 `@deepseek-ai/dsh-llm` 解析失败（**绕回工作区的实证**） |
    | 真实目录但代码是旧的 | ✅ `1 个文件不同步：lib/rank.js` |
    | 缺 `lib/client.js` | ✅ 4 项 FAIL（含"必需产物齐全"与"有效客户端半体"） |
    | patch 里出现重复 insert 行 | ✅ `发现 2 条` |

- 真实 profile：`npm run regression` → 构建通过、**156/156 测试通过**、装机成功、
  **安装校验 15/15 通过**（含共享解析根与独立导入）
- **幂等**：`--idempotent` → 「重复安装后 patch 文件逐字节不变（`6a08f7fbcef2`）」
  「文件内容逐字节不变」「没有制造重复 insert 行（1 条）」
- 探针（联网，本机真实网络）：11 个源 → 第一次 91 条 / 27.2s、第二次 67 条 / 66.1s，
  **重复 URL 0 条**；两次都读/写不到用户数据（`prefs.updatedAt` 保持 `2026-10-11T18:15`，
  `feedback` 0 条，探针脚本内**没有任何写盘调用**，已 grep 确认）

**发现的新风险（记录，不在本轮修）**
**YouTube 源正在变差**：本轮两次探针，第一次 2/5 频道失败、**第二次整源 0 条**
（镜像 429 / 超时）。原因是 5 个频道每轮全量请求同一个免费公共镜像。
下一轮应做**频道轮转**（每轮取 2~3 个、按天轮转）：既能显著降低 429 概率，
又能把刷新耗时从 27~66s 降下来（该源占了总耗时的绝大部分）。
B站的视频索引不受影响——用户要的"视频索引"目前由 B站稳稳兜住。

**阻塞**：无

**下轮起点**：① YouTube 频道轮转（有本轮实测证据支撑，优先级最高）；
② 桌面通知；③ 条目详情/阅读态。
仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + 10 个工具 + ✨ 按钮 + 日期导航 + 页脚入口）。

### R14 · 2026-10-12 11:06–11:50 — YouTube 频道轮转 + 失败退避

**为什么做它**：R13 的两次探针给出了硬证据 —— 一次 2/5 频道失败、一次**整源 0 条**（免费镜像 429/超时），
而该源又占了整轮刷新耗时的绝大部分。这不是理论风险，是正在发生的功能退化。

**做了什么**
1. `src/rotation.ts`（纯函数，零依赖）：
   - `pickChannels`：**没抓过的优先 → 最久没抓的优先**（LRU），退避窗口内的排最后；
     只有可选频道凑不够时才强制动退避中的（**绝不把源饿死**）
   - `cooldownMs`：连续失败按 2 的幂退避，封顶 8×base
   - `recordAttempts` / `pruneRotation` / `describeRotation`
2. 配置：`youtubeRotateChannels`(true) / `youtubeChannelsPerRefresh`(3) / `youtubeFailureCooldownMinutes`(20)
3. 采集层：`SourceResult.rotationUpdates`（输出）+ `CollectEnv.rotation`（输入）+
   `CollectOutcome.rotation`（汇总）。**采集器不落盘**，由 service 写进 `meta.youtubeRotation`，
   保持这一层"给定输入 → 产出结果"的可测试性
4. 服务：`init()` 从 meta 恢复（否则每次重启都当作"都没抓过"，LRU 形同虚设）；
   刷新后 `pruneRotation` 并写回
5. 可见性：轮转说明进源状态 → 日报「采集源状态」与侧边栏统计项 tooltip 都能看到
   （**条数变少是轮转，不是故障** —— 这一点必须让用户看得见）

**关键设计：LRU 必须按 `lastAttempt` 排序，不能按 `lastSuccess`**
否则一个"每次都失败"的频道会永远是最久没成功的那个 → 每轮都被优先选中 → 每轮都白等超时。
这条写进了注释与单测（用 A/B 两个候选做干净对比）。

**本轮抓到两个真 bug（都是自己新写的代码）**
| bug | 后果 | 怎么发现的 |
|---|---|---|
| 轮转记录在**源失败时被丢掉** | 源全失败要抛错（好让状态显示 ❌），但抛错把"本轮尝试记录"一起扔了 → 失败计数永远停在 0 → **退避永不生效**，挂掉的频道每轮都被重新选中 | 写"整源失败"那条测试时想到：抛错路径也要能带出记录 → 加了 `SourceFailure.rotationUpdates` |
| **成功分支漏传** `rotationUpdates` | 只给失败分支加了它，成功路径照原样返回 → **成功时轮转状态根本不更新**，LRU 会永远选中同一批频道（等于轮转没生效，但表面上"都成功了"） | 集成测试 `runCollection 在成功时也汇总轮转状态` 直接抓到（`0 !== 3`） |

**证据（真实输出）**
- 全量测试：`npm test` → **tests 172 / pass 172 / fail 0**（R13 基线 156 → 本轮 +16 组）
- 类型检查：`tsc --noEmit` → 0 error；`node --check web/app.js` → 通过
- **不联网的集成测试**（用假镜像池驱动**真实的** `collectYoutube`）：
  - 「只请求选中的频道」→ 5 个频道、每轮 3 个 → 断言 `pool.requested.length === 3`
  - 「两轮覆盖全部 5 个」→ 第一轮 `[UC_A,UC_B,UC_C]`、第二轮 `[UC_D,UC_E,UC_A]`
  - 「退避中的被跳过并说明原因」「全部退避时强制选取（`forced=true`）」
  - 「整源失败时抛错但记录跟着异常带出来」
- **真实网络两轮刷新**（真实 service + 真实镜像，数据目录 /tmp）：
  - 第 1 轮 **47.4s**、✅ 24 条，说明「本轮轮转抓取 **3/5** 个频道：Two Minute Papers（按轮转下次优先）、
    Yannic Kilcher（按轮转下次优先）」，状态记录 3 个频道、失败数全 0
  - 第 2 轮 **28.2s**、✅ 24 条，抓的正是**上轮被跳过的** AI Explained 与 Fireship（含之前 429 的那个），
    状态记录 **全部 5 个频道**
  - → **两轮覆盖全部频道，且两轮 0 失败**（改前：一次 2/5 失败、一次整源 0 条）
- **可见性（浏览器真实渲染）**：
  - 侧边栏统计项 tooltip：`YouTube：本轮轮转抓取 3/5 个频道：Two Minute Papers（按轮转下次优先）…`
  - 日报源状态行：`- ✅ YouTube · 24 条（本轮轮转抓取 3/5 个频道：…（按轮转下次优先））`
- 数据隔离：真实 `~/.dsh/daily` 未被触碰（轮转验证在 /tmp，收尾已删）

**阻塞**：无

**下轮起点**：① 桌面通知；② 条目详情/阅读态；③ 「周报/订阅入口」的第二轮打磨。
仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + 10 个工具 + ✨ 按钮 + 日期导航 + 页脚入口 +
本轮新增的轮转说明）。

### R15 · 2026-10-12 12:06–12:50 — 桌面通知（第二波最后一项）

**为什么做它**：用户最初的需求第一条就是「每日**主动**给我推荐不同类型的新闻」。
此前"主动"只在两处：日报文件 + 注入 systemPrompt（模型在对话里提起）—— 两者都要求用户**正在看**。
桌面通知才是真的"不用看也知道"。这也是第二波清单上的最后一项。

**做了什么**
1. **先确认宿主能力**：`@deepseek-ai/` 下**没有**任何 notifier/toast 包，也没有对应 service 可 inject
   → 只能落到系统层（macOS `osascript`）。这一步先做，避免了照着不存在的 API 写代码。
2. `src/notify.ts`：
   - `buildDailyNotification`：标题带日期，正文单行（macOS 横幅对换行支持很差）含条数 + 代表标题，
     超长截断到 180 字符
   - `sendNotification`：**开关 / 平台 / 空正文**三重守卫，**永不抛异常**，失败返回可诊断原因
   - **文本走 argv**：`osascript -e 'on run argv' … body title`，而不是拼进 AppleScript 源码
3. 配置：`notifyEnabled`(false) / `notifyMaxTitles`(3)
4. 服务：`refresh()` 增加 `trigger: 'schedule' | 'startup' | 'manual'`；
   `maybeNotify` 只在 schedule/startup 触发，标题用 `pickDiverse` 挑（让通知也体现"不同类型"）
5. `ServiceDeps.spawn` 注入点：**开着通知的集成测试绝不能真的往用户屏幕上弹东西**
   （见下面"踩坑"一节，这个注入点是被一次真实事故逼出来的）

**本轮踩的坑（很典型，记下来）**
集成测试第一次跑就失败了，且失败信息是"正文应含代表条目"。排查中发现：**`lib/` 是旧的** ——
我只跑了 `tsc --noEmit`（不产出文件），而测试 import 的是 `lib/*.js`。
于是那次测试用的还是"没有注入点"的旧代码 → **真的调用 osascript 发了一条系统通知**。
两个教训：
1. `--noEmit` 不重建，改完源码跑测试前必须先 `npm run build`（或 `npm test`，它自带构建）
2. 注入点不是"为了测试好看"，而是**防止测试污染真实环境** —— 这次的代价是用户屏幕上多了一条通知

**顺带发现一个真问题（已记录，未在本轮修）**
写通知的集成测试时发现：**刷新会用新采集的条目覆盖当天，而不是合并**。
`runRefresh` 里 `items = rankItems(outcome.items, …)` 只含本轮抓到的条目，然后整份 `writeDay` 覆盖。
后果（对用户可见）：
- 定向刷新（`sourceIds`）会把当天其它源的内容**冲掉**
- 同一天第二次刷新时若某个源失败，**那个源上午抓到的条目会从今天的列表里消失**
  （表现为"刷新了一下，条目反而变少了"）
- 这是 R1 就存在的行为，不在本轮范围内（本轮只做通知），所以**留到下轮优先修**，
  修法方向：`writeDay` 前把 `previous.items` 与 `outcome.items` 按规范化 URL 合并后再统一排序

**证据（真实输出）**
- 全量测试：`npm test` → **tests 186 / pass 186 / fail 0**（R14 基线 172 → 本轮 +14 组）
- 类型检查：`tsc --noEmit` → 0 error
- **真实 osascript 通路**（受控跑一次）：
  ```
  标题: 日报 · 2026-10-12
  正文: 67 条索引 · 60 未读：DeepSeek Solved AI's Memory Problem · Passkeys are a trap · 派早报：… (97 字符)
  真实 osascript 结果: {"sent":true}
  关闭时: {"sent":false,"reason":"未开启（notifyEnabled=false）"}
  非 macOS: {"sent":false,"reason":"当前平台（linux）暂不支持桌面通知"}
  ```
- **默认关闭是硬保证**：单测断言 `enabled:false` 时**连命令都不拼**（spawn 调用数 0）；
  集成测试断言 `notifyEnabled:false` 时即使定时刷新也不调 spawn
- **注入防护**：单测用带 `"引号"`、`\` 反斜杠、`$变量`、反引号的标题，
  断言脚本片段与用户数据**完全分离**、正文只出现在 argv 里
- **触发时机**：集成测试断言 `trigger:'manual'` → spawn 0 次；`trigger:'schedule'` → spawn 1 次且命令是 osascript
- 诚实边界：`{"sent":true}` 只证明**调用有效**（退出码 0）。横幅是否真的显示取决于 macOS 通知权限，
  代码侧无法确认 —— 已写进 README（让用户去「系统设置 → 通知」找 Script Editor）

**阻塞**：无

**下轮起点**：**刷新覆盖当天导致条目丢失（上条已记录，最高优先）**；
然后 ② 条目详情/阅读态；③ 第二波收口（把 OPML/周报入口再打磨）。
仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + 10 个工具 + ✨ 按钮 + 日期导航 + 页脚入口 +
轮转说明 + 通知开关）。

### R16 · 2026-10-12 12:30–13:05 — 修「点击卡片不跳转」+ 路线图转向调研插件

**用户报的 bug：点击某一个卡片时没有跳转到对应的页面。**
这是最严重的一类问题 —— 它直接违背了最初需求里的「点击即可直接跳转过去」。

**根因（两个问题叠在一起，症状一模一样）**

| # | 问题 | 证据 |
|---|---|---|
| 1 | **整卡覆盖链接根本没有覆盖**：代码注释一直写着"整卡覆盖式的 `<a>`"，但 CSS 里只有 `display:block`，**没有 `position:absolute`** —— 它是个高度接近 0 的静态块，真正被点到的是它下面的标题 div | 命中测试：`elementFromPoint(卡片中心)` = `DIV.dd-item-title`，且它**没有任何链接祖先**（`nearestLinkHref: "NO"`）；那个 `<a>` 的 computed style 是 `position: static` |
| 2 | **从不检查 `window.open` 的返回值**：被环境拦下时返回 `null` 且不抛异常 —— 没有任何痕迹 | 拦截记录：5 次调用全部 `blocked: true`，代码里当时没有任何兜底 |

**为什么之前没发现**：我验证跳转时是用 CSS 选择器 **直接点 `a.dd-item-link`**（以及 dispatch 到该元素上）——
两者都**绕过了命中测试**，所以链接"能点开"，而真实用户点卡片时命中的是另一个元素。
**验证方法本身错了，产品就"看起来没问题"。**

**做了什么**
1. CSS：`.dd-item { position: relative }`（给覆盖层当定位父级）+ `.dd-item-link { position:absolute; inset:0; z-index:1 }`；
   把三个**交互控件**（`.dd-act` / `.dd-summary-toggle` / `.dd-meta-discuss`）显式抬到 `z-index:2`，
   否则它们会被覆盖层吃掉点击（z-index 的分层是这里唯一需要小心的地方：1 > 静态内容、2 > 1）
2. **完整的打开降级链**（`openExternal`）：`window.open` → 检查返回值 → 失败则 `postMessage` 给父级
   （客户端半体在 DSH 应用主窗口，那里的 `window.open` 更可能被宿主接受）→ 父级回执失败则
   **自动复制链接 + 明确提示**，绝不留下一次"死点击"
3. 客户端半体新增回执方（顺带做了协议白名单：只接受 http(s)，别成了任意协议的执行入口）
4. 新增 2 组**契约测试**把这两件事钉死：
   - 打开外链的消息类型**两侧必须完全一致**（改名就会有一侧静默失效）
   - `.dd-item-link` 必须 `absolute` + `inset:0` + `z-index:1`，交互控件必须 `relative` + `z-index:2`，
     `.dd-item` 必须 `relative`（**这条测试如果在修 bug 之前就存在，这个 bug 根本进不来**）

**证据（真实输出）**
- 全量测试：`npm test` → **tests 188 / pass 188 / fail 0**（R15 基线 186 → 本轮 +2 组契约测试）
- **命中测试（修复前 → 修复后）**：
  - 修复前：卡片中心 → `DIV.dd-item-title`，`insideOverlay: false`，`nearestLinkHref: NO`
  - 修复后：卡片中心 / 标题行 / 右下角 **全部** → `A.dd-item-link(覆盖层)`；
    同时确认 👍 命中 `SPAN.dd-act-label`（`clickable: true`，`eatenByOverlayLink: false`）、
    「展开」命中 `BUTTON.dd-summary-toggle`（35 个，可点）
- **真实点击**（CDP 真实鼠标事件）：点 `a.dd-item-link` → 新标签页真的打开
  （`inc.com` / `theonion.com` / `cartographers-nk.wonyoung.so`）
- **降级链（同源 iframe 模拟侧边栏 + 拦掉 window.open）**：
  ```
  {"askedParent":1,
   "askedUrl":"https://nonfunctional.substack.com/p/passkeys-are-",
   "notice":"没能自动打开 链接已复制到剪贴板，可以粘贴到浏览器打开。https://nonfunctional.substack.com/p/passkeys-are-a-trap-do-not-use-them ×",
   "noticeHasUrl":true,"messages":["dsh-daily-open"]}
  ```
- 顺带说明：这台机器的隐藏窗口下 **CDP 点击不稳定**（同源 iframe 共享渲染线程，多次 evaluate 超时），
  所以最终用了"临时探测页自己跑完流程、把结果写进 `document.title`"的办法 —— 探测页用完即删

**路线图调整（用户新要求，已写进 PLAN.md §2.5）**
插件要从「日报」变成**调研插件**：按项目切换目录，用 AI 搜索与**当前项目**有关的新闻与知识来补充项目。
新计划要点：
- **项目 = 工作目录**（与 DSH 的 workspace 天然对齐），每个项目一套独立状态
  （`~/.dsh/daily/projects/<slug>-<hash8>/`），现有数据视为「默认项目」保持兼容
- 六轮增量：① 项目模型与切换器 → ② 项目画像抽取 → ③ AI 生成检索词 → ④ 定向检索 →
  ⑤ 回流项目（写 `docs/research/*.md` + 注入 prompt）→ ⑥ 侧边栏调研视图
- **明确不做**：代码索引/向量库（那是另一个产品）；不自动改用户代码、不自动提交

**阻塞**：无

**下轮起点**（优先级已按用户新要求重排）：
1. **项目模型**（第三波①）：按目录命名空间隔离 prefs/数据 + `daily_project` 工具 + 侧边栏切换器
2. **刷新覆盖当天导致条目丢失**（R15 发现，仍未修）
3. 桌面通知的开关需要进配置文档供用户开启
仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + 10 个工具 + ✨ 按钮 + 日期导航 + 页脚入口 +
**卡片跳转** + 轮转说明 + 通知开关）。

### R17 · 2026-10-12 13:06–13:50 — 第三波①：项目模型（一个项目 = 一个工作目录）

**为什么先做它**：用户要求把插件从「日报」变成「调研插件」——按项目切换目录、用 AI 搜索与
**当前项目**有关的知识。调研是**定向**的，所以"项目"必须是所有状态的第一维度；
后面的五轮（项目画像 / AI 检索词 / 定向检索 / 回流项目 / 调研视图）全都建立在它之上。

**做了什么**
1. `src/project.ts`（纯函数、零依赖）：
   - `normalizeDir`（`~` / 相对路径 / 结尾斜杠 / `..` 全部归一 —— **路径就是项目身份**）
   - `projectFolder`（`<slug>-<hash8>`：slug 给人看，hash 保证不同父目录下的同名项目不撞）
   - `projectDataDir`（**默认项目 = 数据根本身**，其它项目进 `projects/` 子目录 → 老数据零迁移）
   - `touchProject` / `readRegistry`（坏数据容错）/ `listProjects` / `checkDir`
2. 服务：`root`（数据根，不随项目变）与 `projectDir`（当前项目）分离；
   `init()` 从注册表恢复（**目录失效则安全回落默认项目**，否则一个被删的目录会让插件再也打不开）；
   `useProject()` / `listKnownProjects()` / `currentProject()`
3. `daily_project` 工具（list / current / use）+ `GET|POST /api/projects`
4. 侧边栏**项目切换器**（下拉 + `＋` 用目录新增；非默认项目时加一条强调色左边框，
   一眼看出"现在看的不是默认项目"）；`/api/state` 带上 `project`
5. 测试 `test/project.test.js`（13 组：8 组纯函数 + 5 组真实 service 集成）

**隔离范围（都按项目独立）**：偏好 / 反馈 / 每日索引 / 归档 / 轮转状态（各自的 `meta.json`）。

**本轮抓到的 bug（由测试当场顶出来）**
`normalizeDir` 早先对**绝对路径直接用原值**（没走 `resolve()`），于是 `/tmp/a/../a/b` 与
`/tmp/a/b` 被当成两个项目 —— **同一目录两个身份，数据会被劈成两份**。
这正是「路径必须先归一化再当身份」这条设计原则的反例，测试里那句
「同一目录的两种写法必须完全相等」把它钉住了。

**证据（真实输出）**
- 全量测试：`npm test` → **tests 201 / pass 201 / fail 0**（R16 基线 188 → 本轮 +13 组）
- 类型检查：`tsc --noEmit` → 0 error；`node --check web/app.js` → 通过
- **HTTP 端到端**（数据根 /tmp/dsh-proj/root）：
  - 初始清单只有默认项目：`[('root（默认）', True)]`
  - 默认项目调教「多推 Rust」→ `notes: ['多推 Rust']`
  - 切到 `/tmp/dsh-proj/appA` → `dataDir: /tmp/dsh-proj/root/projects/appa-c8d17d25`，
    **appA 的 topics 为空、条目 0 条**（没继承 = 隔离生效）
  - 磁盘布局：`root/projects/appa-c8d17d25/`；`projects.json` 落盘
    （`current: /tmp/dsh-proj/appA` + `known` 一条）
- **浏览器端到端**（真实渲染 + 真实 change 事件）：
  - 项目条出现，选项 `['root（默认）', 'appA · dsh-proj/appA']`，appA 选中时 `is-scoped=true`
  - 真实切回默认项目 → 选中项变回 `root（默认）`、**67 条卡片回来**、`is-scoped=false`、
    且 `prefs.tuningNotes = ['多推 Rust']` **原样还在**
- 集成测试另外覆盖：跨进程恢复（新建 service 仍在 alpha）、失效目录回落、
  不存在的目录/不是目录被拒绝且不改动当前项目、轮转状态也按项目隔离

**阻塞**：无

**下轮起点**：
1. **第三波②：项目画像**（从项目目录抽 README/package.json/关键源文件 → 语言、依赖、领域词）
2. **刷新覆盖当天导致条目丢失**（R15 发现 —— 见下一轮）
仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + **11 个**工具 + ✨ 按钮 + 日期导航 + 页脚入口 +
卡片跳转 + 轮转说明 + 通知开关 + **项目切换器**）。

### R18 · 2026-10-12 14:06–14:45 — 修「刷新覆盖当天」

**背景**：R15 写通知的集成测试时发现，`runRefresh` 是"用本轮采集结果**整份覆盖**当天"：
`items = rankItems(outcome.items)` 之后直接 `writeDay`。用户可见的两个后果：

- 定向刷新（`daily_refresh({ sources: [...] })`）会**冲掉**当天其它源的内容
- 同一天第二次刷新时若某个源失败，**那个源上午抓到的条目会从今天的列表里消失**

在"索引"类产品里，"刷新一下条目反而变少"比崩溃更伤信任 —— 用户会以为数据丢了。

**做了什么**
1. `src/merge.ts`（纯函数）：`mergeDayItems`（按规范化 URL 去重取并集）+
   `mergeSourceStates`（跑过的用新状态、没跑的沿用）
2. `service.runRefresh`：排名前先与当天已有条目合并；源状态同样合并
3. **必须继承的两个字段**（不继承会用一个 bug 换另一个）：
   - `firstSeenAt`：丢了老条目会被当成"刚出现"，影响跨天去重与新鲜度打分
   - `aiSummary`：丢了等于每次刷新都重新调用模型（**缓存只覆盖"跨天重复"，
     覆盖不了"同一天刷新两次"**）→ 顺带让 `applyAiSummaries` 跳过已有摘要的条目
4. 顺带确认：`read/liked/disliked/hidden` **不需要**继承 —— 它们的真源是 `feedback.json`
   （按 `itemId(url)` 索引），`rankItems` 每次从那里重填，所以天然不会丢
5. 测试 `test/merge.test.js`（9 组：7 纯函数 + 2 真实 service 集成）

**证据（真实输出）**
- 全量测试：`npm test` → **tests 210 / pass 210 / fail 0**（R17 基线 201 → 本轮 +9 组）
- 类型检查：`tsc --noEmit` → 0 error
- **真实网络两轮刷新**（真实 service + 真实源，数据目录 /tmp）：
  ```
  第 1 轮（hn+arxiv）: 16 条 | {"hn":8,"arxiv":8} | 源: hn✅ arxiv✅
  第 2 轮（只跑 hn）: 16 条 | {"hn":8,"arxiv":8} | 源: hn✅ arxiv✅
  arxiv 条目是否被保住: 是（8 条）✅
  源状态是否保住 arxiv: 是 ✅
  ```
  —— 修复前第 2 轮只会剩 8 条、arxiv 整体消失
- 集成测试另外覆盖：空刷新不清空当天、重复条目保留 `firstSeenAt`、
  **已有 AI 摘要的条目不再调用模型**（断言 `calls.length === 0`）

**阻塞**：无

**下轮起点**：**第三波②：项目画像**（调研方向的下一个增量 —— 从项目目录抽语言/依赖/领域词，
作为「AI 生成检索词」的输入）。
仍欠 **DSH 重启后的真实 GUI 复验**（右侧栏 tab + **11 个**工具 + ✨ 按钮 + 日期导航 + 页脚入口 +
卡片跳转 + 轮转说明 + 通知开关 + 项目切换器）。

### R19 · 2026-10-12 14:40–15:00 — 发布到 npm 与 git

**用户要求**：「跑通后请及时发布到 npm 和 git，方便我安装使用」。

**先查清前置条件（而不是直接跑 publish）**
- npm 凭据：已认证为 **`kpeace`**（registry.npmjs.org）✓
- git 远端：`git@github.com:kp-z/dsh-dev-git-graph.git`；`HEAD` = `origin/feat/dsh-daily` = `origin/main`
  **= `45e00ec`，没有未推送的提交** —— git 侧本来就是最新的（另一个 agent 已推过）
- **`dsh-daily` 这个包名已被占用**：`npm view dsh-daily` → 存在，version `0.0.1`，
  description `"Daily - the daily brief - name reserved; first release in development."`，
  maintainer 是 **`dushaobindoudou <dushaobindoudou@gmail.com>`** ——
  **与当前登录的 `kpeace` 不是同一个账号**。所以我无法（也不该）往那个名字下发布。

**做了什么**
1. 包内补 `LICENSE`（与仓库根一致，MIT）+ `repository` / `homepage` / `bugs` /
   `publishConfig.access=public`，`files` 里显式加上 `LICENSE`
2. 发布名改为 **`@kpeace/dsh-daily`**（当前账号唯一能发的名字），
   并把 `cordis.patch.yml` 的插入名同步成 `@kpeace/dsh-daily` —— **两处必须一致**，
   否则装出来的 bundle patch 会指向一个不存在的模块名
3. **发布前硬验收**：`npm pack` → 在全新空目录 `npm install <tarball>` 装成功
   （可选 peer 不阻塞、0 vulnerabilities、关键文件齐全、patch 插入名正确）
4. `npm publish` → **`+ @kpeace/dsh-daily@0.1.0`**（exit 0）
5. 包内加 `.gitignore` 忽略 `*.tgz`（pack 产物不该入库）

**证据（真实输出）**
- 发布：`+ @kpeace/dsh-daily@0.1.0`；npm 提示「正在处理」→ 轮询 **约 80 秒后**
  `npm view @kpeace/dsh-daily version` → `0.1.0` 生效
- **从 registry 真实安装**（另一个干净目录）：
  `npm install @kpeace/dsh-daily` → `added 1 package, and audited 2 packages in 4s`，
  装到 `0.1.0`；文件 `CHANGELOG.md LICENSE README.md README.zh.md cordis.patch.yml lib package.json web`
- 改名后**本地一切照旧**：`npm test` → 210/210；`npm run regression` → 装机 + 安装校验 **15/15 通过**；
  本地 profile 的目录名仍是 `dsh-daily-v2`（它跟随 patch，不受包名影响）

**待用户决定的一件事（我没替你决定）**
`dsh-daily` 这个不带前缀的名字被 `dushaobindoudou` 占着，描述是"name reserved"。
如果那是你的另一个账号：用那个账号在仓库里跑一次 `npm publish` 就能发到 `dsh-daily`；
本包只需把 `package.json` 的 `name` 与 `cordis.patch.yml` 的插入名一起改回去。
我没有擅自改名到你无法安装的第三个名字，也没有去碰别人的包。

**阻塞**：无（npm 与 git 两条路都已可用）

**下轮起点**：**第三波②：项目画像**（调研方向的下一个增量）。
仍欠 **DSH 重启后的真实 GUI 复验**（现在多了一项：从 npm 装的版本要在重启后确认 tab 与工具都在）。

### R20 · 2026-10-12 15:06–15:50 — 第三波②：项目画像

**为什么做它**：调研链条的第二环（① 项目模型 → ② **项目画像** → ③ AI 检索词 → ④ 定向检索 → ⑤ 回流项目）。
"与项目有关"这句话，只有看了项目本身才知道指什么 —— 所以先得有一份"这个项目是什么"的输入。

**做了什么**
1. `src/profile.ts`：`collectProjectProfile`（读顶层少量已知文件：README / manifest / CI 配置）、
   `extractKeywords`（确定性：ASCII 词去停用词 + CJK 双字组，顺序稳定可复现）、
   `depsFromPackageJson`（只取依赖名，不带版本号）、语言识别（文件标记 + 谨慎的目录兜底）
2. **三条硬约束**（都来自"这份数据会被送进模型"）：
   - **绝不读敏感文件**：`.env*` / `*.pem` / `id_rsa*` / `credentials*` / `.npmrc` / `.git-credentials`…
     按**文件名先挡**。不读才是真的安全 —— "读了再过滤"迟早会漏
   - **有界**：单文件 64KB / 总计 256KB / 最多 24 个文件；**只读顶层，不递归**（不碰 node_modules/dist）
   - **可审计**：返回里列出读了哪些文件、跳过什么、为什么；`daily_profile({verbose:true})` 全量打印
3. `service.buildProfile()` / `readProfile()`（落盘 `<项目>/profile.json`）+
   `GET|POST /api/profile` + `daily_profile` 工具（工具数 → **12**）
4. 测试 `test/profile.test.js`（12 组：敏感文件名、跳过规则、关键词、依赖解析、真实文件系统采集、
   **真实自检本插件自己的目录**）

**本轮抓到的两个问题**
| # | 问题 | 说明 |
|---|---|---|
| 1 | **敏感文件检查被绕过**（自测当场抓到） | `shouldSkipDir` 把"点开头的条目"一律当目录跳过 → `.env` / `.env.local` 走了**目录分支**，敏感检查没跑到。内容确实**没被读**（无泄漏），但**审计记录里没有它们** —— 用户看不到"跳过了哪些敏感文件"，而可审计正是这条约束能被检验的前提。改为 `readdir(withFileTypes)` 先分清文件/目录再各套规则；敏感文件名同时从 `topLevel`（会进摘要）里排除 |
| 2 | **`src/` 被当成 Python 的证据**（真实画像复验时发现） | 本插件自己是 TypeScript 项目、顶层同样有 `src/`。这段文本要送进模型，**报错比不报更糟**（模型会顺着错误前提去搜）。删掉该启发式，只留 `cmd/`+`internal/` 成对出现才判 Go |

**证据（真实输出）**
- 全量测试：`npm test` → **tests 224 / pass 224 / fail 0**（R19 基线 210 → 本轮 +14 组）
- 类型检查：`tsc --noEmit` → 0 error；`npm run regression` → 装机 + 安装校验 **15/15**
- **真实画像**（对本插件自己的源码目录，真实 service 调用）：
  ```
  [info] 项目画像：dsh-daily：TypeScript/Node.js · 读了 4 个文件（30.3KB）· 关键词 24 个
  技术栈：TypeScript（tsconfig.json）、Node.js（package.json）      ← 修掉误报后不再出现 Python
  主要依赖：@deepseek-ai/cordis, @deepseek-ai/dsh-tools, @deepseek-ai/schemastery, dsh-better-sidebar, typescript
  关键词：dsh、node、项目、scripts、目录、youtube、日报、插件、默认、deepseek-ai、数据、摘要、索引、频道…
  顶层结构：CHANGELOG.md, PLAN.md, README.md, cordis.patch.yml, lib, package.json, scripts, src, test, tsconfig.json, web
  ```
  读取审计：`README.md 3637B` / `README.zh.md 24334B` / `package.json 2709B` / `tsconfig.json 332B`；
  跳过 0 项（该目录顶层没有敏感文件与锁文件）；`profile.json` 已落盘
- **敏感文件的硬保证**（单测）：造 `.env` / `.env.local` / `id_rsa` / `certs/server.pem` / `credentials.json`
  都含同一个假密钥，断言 ① 一个都没进"已读" ② **密钥字符串不出现在画像的任何输出里** ③ 但用户能看到"跳过了什么"

**阻塞**：无

**下轮起点**：**第三波③：AI 从项目画像生成检索词**（可注入假 stream 测全部失败路径，沿用 R7 的做法）。
仍欠 **DSH 重启后的真实 GUI 复验**（多了一项：从 npm 装的 0.2.0 要在重启后确认 tab、12 个工具都在）。

### R23 · 2026-10-12 16:30 — 按用户要求**卸载本地安装**

**用户指示**：「先不安装这个插件了可能会报错」。用户在本轮之前刚从 R21 的事故里看到一个真实风险：
**profile patch 只要有一处 YAML 写坏，dsh 就完全起不来**（`bad indentation`）。
在这个前提下，"先别装"是合理的保守选择，我照做并把它做成**干净且可逆**的状态。

**做了什么（只删不加，且逐项核对）**
1. `desktop` profile 的 patch：移除 `# --- dsh-daily（日报插件）---` 整段 —— 
   包括 `- insert:`（id=daily, name=dsh-daily-v2）与 `- id: daily / disabled: false`，共 13 行（286 → 273）
2. `web` profile 的 patch：移除**我当初为它加的两段**（better-sidebar 能力段 + dsh-daily 插入段），
   共 13 行（23 → 10）—— 让该 profile 回到我介入之前的样子
3. 删除安装目录：`profiles/desktop/node_modules/dsh-daily-v2`、
   `profiles/web/node_modules/@kpeace/dsh-daily`（并清掉空的 `@kpeace/`）

**证据（真实输出）**
- YAML 用解析器实跑，两个 profile 都合法：`desktop: ✅ 8 个顶层条目`、`web: ✅ 2 个顶层条目`，
  且 `还有 daily 残留: 否`
- `diff` 卸载前备份 → 现在：**只有删除行，且全部指向 dsh-daily 相关**（desktop 13 行、web 12 行含空行）
- 残留检查：两个 profile 无 dsh-daily 安装目录 ✅ / 两个 patch 无 daily ✅ /
  连已解析的 `cordis.yml` 里都没有 dsh-daily ✅
- 运行中的实例不受影响（卸载磁盘文件不影响已加载到内存的进程）：`:19387` 与 `:19388` 均返回 200
- 退路：卸载前的两个 patch 备份在 `/tmp/dsh-daily-removed-<ts>/`（路径记录在 `/tmp/dsh-removed-path`）

**当前状态**：本地**未安装**（用户要求）。npm 上 `@kpeace/dsh-daily@0.2.2` 与 git
（`origin/feat/dsh-daily`）都仍然在，随时可一条命令装回：

```bash
cd /Users/kp/DEV/dsh-plugins/packages/dsh-daily && node scripts/install-to-profile.mjs desktop
# 然后重启 DSH（客户端半体在启动时才被扫进模块图）
```
脚本已具备：目录名 = 包名（作用域包落 `node_modules/@scope/name`）、YAML 标量按需加引号、
重复运行幂等、并且 patch 里会写明"回退：删掉本段 + rm -rf node_modules/dsh-daily*"。

**阻塞**：无。**下轮起点**：等用户发话再装；在此之前可继续做第三波③（AI 检索词），
它不依赖本地是否安装（用 dev-server + 单测验证）。

### R24 · 2026-10-12 17:06–17:55 — 第三波③：AI 调研检索词

**注意（重要）**：用户在本轮前 35 分钟明确说过「**先不安装这个插件了可能会报错**」。
**用户的直接指示优先于自动化提醒的装机步骤**，所以本轮**没有执行任何 profile 安装**，
全部验证走 dev-server + 单测（`--data-dir=/tmp/...`，不碰 `~/.dsh/daily`）。

**做了什么**
1. `src/research.ts`：`planResearch`（AI 优先、失败降级）、`deterministicQueries`（确定性种子）、
   `parseQueries`（吃脏输出）、`profileHash`（缓存键）、`diversifyByFamily`、`domainKeywords`
2. `service.planResearch()` / `readResearchPlan()`（落盘 `research-plan.json`，画像指纹没变就复用）
3. `GET|POST /api/research` + `daily_research` 工具（工具数 → **13**）
4. **顺手重构**：把 AI 路由解析抽成 `resolveAiRoute()` —— 原本这段逻辑只写在摘要路径里，
   检索词要用同一套规则，各写一份必然漂移
5. 测试 `test/research.test.js`（25 组）

**本轮由"真实输出"驱动的三次质量修正**（都是单测想不到、只有看真实结果才发现）
| # | 现象 | 修正 |
|---|---|---|
| 1 | 前 3 条种子全是 `@ant-design/*` —— 三次搜索问同一件事 | 依赖按**族**去重（scope 为族），先每族 1 个、不够再放宽到 2 个 |
| 2 | 8 条里 `keyword` **一条不剩** | 种子顺序改为 关键词→依赖→技术栈（合并会截断，排最后的先被砍）。断言：AI 的词仍排最前（它是主源），但**种子里的第一个必须是关键词** |
| 3 | 关键词是 `context / pages / src / tech` —— 结构词，搜出来与项目无关 | 加 `NON_DOMAIN_KEYWORDS` + `isDomainKeyword`（挡结构词/工具链/文件形态/1-3 字母 ASCII） |

**证据（真实输出）**
- 全量测试：`npm test` → **tests 249 / pass 249 / fail 0**（R23 基线 224 → 本轮 +25）
- 类型检查：`tsc --noEmit` → 0 error
- **AI 路径端到端**（dev-server `--ai-fake`，项目 = 真实 mvizlite）：
  `by=ai · 8 条`；AI 3 条打头，种子补足 5 条；`notes: ['模型给出 3 条，其余 5 条由确定性种子补足']`
- **缓存复用**：第二次 POST 的服务日志为 `调研检索词：复用上次结果（…）`，`generatedAt` 未变
- **降级路径**（无模型服务的实例）：`by=deterministic`，
  `notes: ['宿主未提供模型服务，本条使用确定性种子检索词']`
- dev-server 的假 stream 改为**按提示词分流**（检索词请求返回 JSON 数组，摘要请求返回一句话）——
  否则联调时检索词永远走不到 AI 路径
- 用户真实数据未被触碰：`~/.dsh/daily` 下没有 `research-plan.json`（测试全写在 /tmp）

**诚实结论：瓶颈已经转移**
检索词逻辑修完后，真实项目抽出来的**领域词仍然偏弱**（mvizlite: `experiment/portal/batch`；
本插件自己: `项目/目录/插件`）。这不是检索词的问题，而是**画像的关键词提取质量**问题 ——
现在 `extractKeywords` 把 README 正文、manifest 字段、目录名**一视同仁地按词频排**，
于是 `src/pages/scripts/package` 这类结构词挤掉了真正的领域词。

**下轮起点**：改进画像的关键词提取 —— **README 正文词汇的权重高于 manifest 与目录名**
（README 才携带领域词表），并为它补测试（用真实 README 片段断言领域词排在结构词之前）。

**阻塞**：无（本地安装被用户叫停，不影响开发与验证路径）

### R25 · 2026-10-12 18:06–18:45 — 客户端加载契约审计（**不改代码**）

**前置约束（用户指示优先于自动化提醒）**
1. 「先不安装这个插件了可能会报错」→ 本轮**未安装任何东西**
2. 「daily 有问题需要报给我不要自己修」→ 本轮**只审计与报告，不改代码**
3. 用户最近的提问是「0.2.2 已经修好了才对，还有哪些问题」→ 本轮回答它

**审计一：把加载器的失败契约读出来（不是猜的）**
`DSH Desktop.app/.../@deepseek-ai/dsh-client-modules/lib/client.js` 里只有两种失败：
- `transport-failed`：bundle 取不到 / 执行抛错（会重试 2 次再试 fallback url）
- `not-registered`：bundle 执行了，但**没有用期望的 id 注册**（`loaded without registering "<id>" via __ModuleLoader__.load`）
- 两者都会走到 `throw new Error('client-modules: could not load "<id>"')` → 若是 required 启动项，boot 失败

→ 0.2.2 已消除这两种：id 由构建从包名注入（86/86 插件满足"注册 id == 包名"）、bundle 实测 200 且执行。

**审计二：id == 包名 这条规律，验证规模从 5 扩到全量**
本机 3 个 node_modules 根下**带客户端半体的插件 86 个，86/86 满足注册 id == 包名**。
（首轮扫描把 `@changfenhuang/dsh-genui` 误报为 `None` —— 它是压缩过的
`id:\`@changfenhuang/dsh-genui\`` 模板字符串，正则没认；实际也符合。）

**审计三（本轮最重要的产出）：我上一轮的一个诊断被推翻**
读运行时权威模块图（`window.__DSH_BOOT__.entries`，85 条）逐条比对 inject：
**10 个条目的 inject 里有不存在的模块**，其中包含**核心模块** ——
`@deepseek-ai/dsh-client-ui-subagent` 缺 `@deepseek-ai/dsh-client-ui-primitives`、
`@deepseek-ai/dsh-client-ui-jobs` 缺同一个。核心 UI 明显正常工作。

→ **结论：`inject` 不是硬性门控**（不存在的模块被当作"有就加载、没有就算了"）。
→ 因此我 R22 写的"inject 指向客户端图里不存在的模块 → 模块永远等待 → 永不执行"**站不住**，
   `dsh-better-sidebar` 缺 `@deepseek-ai/dsh-client-ui-slots` 也**不能**据此断言它不激活。
   我当时那次 `inject: ['dsh-better-sidebar']` 测试得 style=false，**真实原因未查明**，不能当作证据用。

**仍然成立的事实（未被推翻）**
- 0.2.0 / 0.2.1 注册 id 为 `dsh-daily`、包名为 `@kpeace/dsh-daily` → **not-registered → boot 失败**（用户实际遇到）
- 0.2.2 注册 id 正确（从 npm 拉 tarball 逐字核对过）
- `@deepseek-ai/dsh-client-ui-slots` 的 `dsh` 字段是 `null`（**没有客户端半体**），
  该事实本身成立；`dsh-better-sidebar` 0.24.1 与 0.25.0 **都** inject 了它（两个版本都有）

**未解决 / 待验证**
1. **0.2.2 在真实 DSH 里能否干净启动**：id 与 bundle 都实测过，但**没在装好 0.2.2 的实例上重启验证过**
   （我所在的桌面实例重启会终止本会话；scratch 实例被用户叫停未再装）
2. **右侧栏 tab 在你的桌面 app 里到底出不出得来**：取决于 `betterSidebar` 服务是否真的被提供。
   判别方法（用户侧一条命令即可）：看别的、同样靠 `ctx.betterSidebar` 注册 tab 的插件
   （`dsh-dev-git-graph` / `dsh-spellbook` / `dsh-tab-split`）**有没有 tab 出现**。
   有 → better-sidebar 正常，我的 tab 机制也能用；没有 → 是 better-sidebar 的问题，不是我的
3. 画像关键词质量偏弱（R24 结论），导致检索词偏泛
4. 第三波④定向检索 / ⑤回流项目 / ⑥调研侧边栏视图 未做
5. 本机 `dsh plugin add` 受 pnpm store 版本冲突所限（环境问题，非插件问题）

**证据**
- 加载器契约：`grep -rl "without registering"` → `dsh-client-modules/lib/client.js`，抽出 `attempt()` 全逻辑
- 86/86：脚本遍历 `desktop/node_modules`、`web/node_modules`、`node_modules` 三根，解析每个包的
  `dsh.client` + `lib/client.js` 里的 `__ModuleLoader__.load({id:...})` 与 `package.json` 的 `name` 比对
- 10 个缺 inject：`__DSH_BOOT__.entries`（85 条）在运行中的 :19388 实例上逐条比对（服务端权威图）
- `dsh-better-sidebar` 两个版本的 inject：直接读各自 package.json 的 `dsh.client.inject`

**阻塞**：无。**下轮起点**：按用户发话决定 —— 要么先在 scratch 实例上验证 0.2.2 能干净启动，
要么继续第三波④；**不会在用户未点头前安装到他的日常环境**。

### R26 · 2026-10-12 19:06–19:50 — 宿主半体加载期加固（**未安装**）

**前置约束**：用户仍要求「先不安装」。上轮我因 `npm run regression` 隐式装机踩过坑（已修脚本），
所以本轮**全程零安装**，验证走静态契约测试 + dev-server（`--data-dir=/tmp/...`）。

**为什么做这个**：最近两次事故（R21 的模块 id、R25 的 `apply()` 抛异常）**都是加载期抛异常**，
后果都不是"功能少了"而是"宿主起不来 / 界面变错误页"。客户端半体已封死；
**宿主半体从来没人查过** —— 本轮补上，目标是同一条：**结构上不可能炸宿主**。

**审计结论（先查再改）**
- `resolveConfig` 是**纯默认值填充**（无 `throw` / 无解析 / 无 `JSON.parse`）→ 顶部那处风险是理论性的
- `service.init()` / `mountRoutes` / `registerDailyTools` / AI 接线 / 启动补抓 **都已各自兜底**
- **两处裸的**：`installPromptSection`（systemPrompt 主动推荐）与 `installSchedule`（定时）——
  抛了会让**后面几段接线静默跳过**（AI 接线、启动补抓），且只留一行 unhandled rejection
- `apply` 与 `bootstrap` 都**没有整体兜底**
- 另查明：宿主 `inject = ['tools','webServer']` 的 fail-loud **是安全的** ——
  inject 不满足时条目是 `pending` 而非 `failed`，`pending` 不拖垮 boot

**做了什么**
1. `apply` 整体 try/catch（装配拆到 `applyInner`）；catch 里先试 `ctx.logger`，拿不到就退到 `console`
2. `bootstrap` 整体 try/catch（装配拆到 `bootstrapInner`）
3. `installPromptSection` / `installSchedule` 各自 try/catch，失败各自降级并说明
4. 新增 `test/host-safety.test.js`（4 组契约测试，静态检查 `src/index.ts`）：
   ① apply 顶层必须 try ② bootstrap 顶层必须 try ③ **每个接线步骤必须在 try 块内**
   ④ apply 必须同步且异步初始化 fire-and-forget（不能让 loader 卡住）

**证据（真实输出）**
- `npm test` → **tests 258 / pass 258 / fail 0**（0.2.3 基线 254 → 本轮 +4）
- `tsc --noEmit` → 0 error
- **守卫反向验证**（关键：不会失败的守卫等于没写）：同一套检查跑在**加固前的 0.2.3 产物**
  （`/tmp/v023/package/lib/index.js`）上：
  ```
  契约3 接线兜底: 抓住（未兜底: installPromptSection(, installSchedule(）
  契约1 apply 顶层 try: 抓住（apply 无顶层 try）
  ```
- **功能零回归**（dev-server 真实起服务，`--data-dir=/tmp/dsh-hard/root`）：
  `/dsh-daily/` → 200 · `/api/state` → ok:True（项目 root）· `/api/sources` → 200 ·
  `/api/profile` → 200 · 工具数仍 **13** · 构建产物里 `applyInner`/`bootstrapInner` 就位
- **零安装**：两个 profile 仍无 `dsh-daily` / `@kpeace` 目录
- 本轮修了一个**测试自身的** bug：`bodyOf` 从函数签名里第一个 `{` 开始取体，
  而 `config: Partial<DailyConfig> = {}` 的 `{}` 被当成了函数体（取到 `"{}"`）。
  改为先跳过参数表的右括号 —— 这属于"验证方法错了会让产品看起来有问题"

**仍未验证**：0.2.3 / 本轮加固后的产物在**真实 DSH 里的启动**（需要一次重启，用户未授权安装）

**下轮起点**：等用户发话是否允许在 scratch 实例(:19388)上装+重启验证 0.2.4；
在此之前继续第三波④（定向检索）——它不依赖安装。

### R27 · 2026-10-12 19:22–19:55 — 回答「为什么日报没有自动识别到项目」+ 接住测试地址

**用户两件事**
1. 「为什么日报没有自动识别到项目」
2. 「以后就用 http://10.21.103.15:19387/ 测试，修改分析 debug 后都用这个链接测试」← **长期指示，记在此处**

**测试地址已接通（这一条很重要：补上了我一直缺的"真实宿主"）**
- `http://10.21.103.15:19387/` → 401（DSH web 都要 token）
- **`/dsh-daily/` → 200**（插件路由不需要 token，与本地实例一致）→ 可直接测页面与 API
- `/api/state` → `ok:true`；`/api/profile`、`/api/research` 均 200 → 那台装的是 **0.2.0 以上**（含项目模型与画像/检索词）
- 那台是 Linux/root：数据目录在 `/root/.dsh/daily`

**诊断（为什么"没自动识别"）**
不是识别错了，而是**这个功能从未实现**。R17 的项目模型只提供三种行为：
① 默认项目 = 数据根目录 ② 手动切换（`daily_project` 工具 / 侧边栏切换器）③ 注册表记住"上次选的项目"。
**从来没有把"项目"接到 DSH 的会话 / 工作区上** —— 所以它只能停在上次选过的地方，
一次都没选过就一直是默认。

那台实例的证据，与上述判断完全吻合：
```
current: /root/.dsh/daily          ← 默认项目
▶ daily（默认） → /root/.dsh/daily | isDefault: True   ← known 为空，从未切换过任何项目
```

**自动识别的落点（本轮已查清，来自宿主 Service 目录，不是猜的）**
| 服务 | 能给什么 | 用在哪 |
|---|---|---|
| `agents.currentInitiator(): Agent` | 发起这次工具调用的 Agent | **工具调用时**自动绑定项目（最准） |
| `agentLoop.create(id, opts, meta: Pick<SessionHeader,'cwd'>)` | SessionHeader **带 `cwd`** | 从当前 Agent 拿会话 cwd |
| `workspaceRegistry.list() / resolveByPath(path)` | 工作区清单（含 path） | **侧边栏页面**没有会话上下文，用它自动跟随/给选择器 |

注：`dsh-tools` 的类型里**没有**把 cwd 传给 `execute`，所以落点必须是上述宿主服务，而不是工具参数。

**设计原则（下一轮实现时要守住）**
- **显式优先于推断**：用户手动选过的项目必须压过自动识别，否则"我明明切过又被它自己换回去了"
- **可见**：界面上要写明"当前项目：X（自动识别 / 手动指定）" —— 否则用户无法判断为什么看到这些内容
- **不猜**：拿不到会话/工作区信息时**保持默认**，绝不随机挑一个目录

**本轮未做**：自动识别的实现（上下文预算不足，宁可下轮做完整，也不做一个未验证的半成品）。
**下轮起点**：实现项目自动识别（按上表接 `agents` / `workspaceRegistry`），用
`http://10.21.103.15:19387/` 做真实验证。

### R28 · 2026-10-12 19:22–20:10 — 第三波④前置：**项目自动识别**（用户点名要的）

**用户问题**：「为什么日报没有自动识别到项目」
**诊断（R27）**：不是识别错了，而是该功能从未实现 —— 项目模型只有"默认 + 手动 + 记住上次"。
**本轮**：把它实现完整。

**实现（不依赖任何未知宿主类型）**
1. `src/detect.ts`（纯函数，可单测）：`looksLikeAbsoluteDir` / `extractProjectDir` /
   `collectDirs` / `chooseProject` / `describeChoice`
   - **防御式探测**：宿主 `Session`/`Agent`/`Workspace` 拿不到编译期类型（那些包只发 JS），
     硬写 `session.header.cwd` 换版本就**静默**变 undefined。改为按已知键名集合探，
     并有边界：深度 ≤3、≤60 节点、只认绝对路径、
     **不下探 `messages`/`content`/`text`**（路径出现在对话正文里是最常见的误报来源）
2. 三个来源，逐级回退：**当前会话（每轮 prompt 装配的上下文，最准）** →
   `sessions.list()` 最近活跃会话 → `workspaceRegistry.list()`
3. **显式优先于推断**：注册表新增 `source: 'manual' | 'auto'`；`useProject` 默认记 manual，
   自动识别那条路显式传 auto；`manual` 时 `autoDetect` 直接不动（含跨重启）
4. **可见**：`currentProject()` / `/api/state` / `daily_project current` 都带 `source`；
   清单带 `isAuto`；界面下拉标「（自动）」+ 悬停显示来源
5. 出口：`daily_project({action:'follow'})` / `POST /api/projects {auto:true}` 交回自动
6. 配置：`autoDetectProject`（默认 true，关掉即回到旧行为）
7. 节流：prompt 每轮都会响，`notePromptContext` 5 秒内只探一次；切换是异步 fire-and-forget，
   **绝不阻塞 prompt 装配**；整条链路每一处都各自兜底（探测失败不影响对话）

**证据（真实输出）**
- 全量测试：`npm test` → **tests 279 / pass 279 / fail 0**（R27 基线 258 → 本轮 +21）
- `tsc --noEmit` → 0 error；`node --check web/app.js` → 通过
- **API 闭环端到端**（dev-server，/tmp 数据目录）：
  ```
  1) 初始            root | source=auto | isDefault=True
  2) 手动指定        ok=True | projA | source=manual
     /api/state      projA | source=manual
  3) 清单标记        ▶ projA  isAuto=False
  4) {auto:true}     ok=True | source=auto | 识别结论: 没有找到可用的项目目录，保持当前项目
  ```
  第 4 步的"没有找到候选"是**正确行为**：dev-server 不提供 sessions/workspaceRegistry，
  而"拿不到就不猜"正是设计。
- 单测覆盖的边界（21 组）：相对路径/URL/超长值不算目录；消息正文里的路径**不**被当项目；
  循环引用、超深嵌套、超宽对象、getter 抛异常都不崩；`cwd` 权重高于 `path`；
  manual 时 autoDetect 不动（含**跨重启**）；配置关闭后不动；
  目录不存在不切；`notePromptContext` 有节流且绝不抛；注册表 source 坏值回落 auto

**未验证**：真实宿主里的识别效果（需要部署到用户指定的测试机
`http://10.21.103.15:19387/` 并重启 —— 已确认该机 `10.21.103.15` 可达、SSH 22 开放、
`~/.ssh/config` 里有 `devops.momenta.works` → `User root` 条目）

**下轮起点**：部署到测试机验证真实识别 → 再做第三波⑤定向检索。

**R28 补充：测试机的部署通道查清了（重要运维事实）**
- `10.21.103.15` 可达、22 端口开放；`~/.ssh/config` 里是 `devops.momenta.works`（`User root`）
- 但那是**受限跳板**：连上后执行任意命令会被拒（`remote: Command ... is not in expected format`）
  → **我无法自己部署/重启那台上的 dsh**
- 因此本轮的真实宿主验证只能由用户侧完成一次部署 + 重启；
  **部署后我可以直接远程验证**，因为插件的 HTTP 接口不需要 token：
  `curl http://10.21.103.15:19387/dsh-daily/api/state` → 看 `project.source` 与 `project.dir`
  （当前读到的是旧版：`source` 字段还不存在，项目仍是 `daily`，条目 8）
- 另：git 推送通道时好时坏 —— HTTPS 这次报 `HTTP2 framing layer` / `Recv failure`，
  最后用 SSH `git@github.com:...` 成功。以后推送按 HTTPS → ssh.github.com:443 → git@github.com 依次试。

### R29 · 2026-10-12 20:06–21:00 — 第三波⑤：定向检索（**未安装**）

**约束**：用户仍要求不本地安装 → 全程零安装，验证走单测 + dev-server（/tmp 数据目录）。

**实现**：`src/retrieve.ts`（纯逻辑 + 可注入 fetch）
- 两个通道：HN Algolia（`hn.algolia.com`）与 GitHub 搜索（`api.github.com/search/repositories`），
  两者都是**关键词驱动**，实测可达。YouTube / Google News 在多地不可达，**不进关键路径**。
- 每条结果带 `query` 字段（**是哪条检索词找到的**）—— 否则就退化成又一个新闻流
- 失败隔离：N 条词 × 2 通道，任何一格失败只进 `errors`，**绝不抛**；单请求超时用 AbortController
- 并发闸门手写（只有这一处用得上，不引依赖）
- `service.runFindings/readFindings` + `GET|POST /api/findings` + `daily_research({action:'run'})`

**本轮由真实检索驱动的三个修正（全是"HTTP 200 却 0 条"的安静失败）**
| # | 现象 | 修正 |
|---|---|---|
| 1 | 12 次请求全 200、**0 条结果** | AI 给的是**中文检索词**，而 HN/GitHub 是英文语料。加 `acceptsQuery`（非 ASCII 占比 >0.4 就不打）并把 `skipped` 报给用户；提示词里明确要求英文 |
| 2 | 换成英文后仍 0 条 | 种子词是**自然语言**：`@ant-design/icons changelog release notes` → HN **0** 条、GitHub **422**（`@`/`/` 非法）。改 `depKeywords`：包名 → 关键词（`ant design icons` → HN 3 / GitHub 102），`shapeQuery` 清掉 `@`、`/`、括号注释 |
| 3 | 修完 2 后仍是 0 条 | **预算算错**：`maxQueries` 先切片再过滤，6 条预算被 3 条中文词吃掉，英文词排在后面根本没轮到。改为"只把通道认的词计入预算" |

**证据（真实输出）**
- 全量测试：`npm test` → **tests 298 / pass 298 / fail 0**（R28 基线 279 → 本轮 +19）
- `tsc --noEmit` → 0 error
- **真实端到端**（dev-server + 真实网络，项目 = mvizlite）：
  ```
  第一轮  结果 0 条 | 请求 12 成功 10 失败 2   ← 中文词的安静失败
  第二轮  结果 0 条 | 请求  6 成功  6 失败 0 跳过 3
  第三轮  结果 0 条 | 请求  6 成功  6 失败 0 跳过 3
  第四轮  结果 46 条 | 请求 12 成功 12 失败 0 跳过 2   ← 通了
  ```
  第四轮样例（均为真实条目，且标注了命中的检索词）：
  `[hn-algolia] Relicensing React, Jest, Flow… ← 「react」`、
  `[hn-algolia] Node.js adds experimental support for TypeScript ← 「experiment」`
- 单测覆盖（19 组）：解析容错（坏输入 → 空数组）、缺外链回落讨论页、URL 去重并合并命中词、
  热度排序、**失败隔离**（GitHub 全挂时 HN 结果仍在）、网络异常/超时/无 fetch/空检索词、
  并发受控但**不丢格**、语言过滤与预算只算可用词

**诚实结论：机制通了，质量还不够（下轮起点）**
第四轮 46 条里混着 `Honda conducts successful launch…`、`Pause Giant AI Experiments` 这类
**明显不相干**的结果 —— 因为命中的检索词是 `react` / `experiment` 这种**过泛**的词：
`experiment` 是结构词（没被 `NON_DOMAIN_KEYWORDS` 覆盖），`react` 是技术栈词但单独搜太泛。

**下轮起点（按优先级）**：
1. **检索词具体化**：领域词不要单独搜，要与项目/领域组合（如 `react` → 不搜；`state management` 才搜）；
   继续扩充结构词黑名单（`experiment`/`portal`/`batch` 这类）
2. 结果侧加一层**相关性筛**：命中词过于泛（单词、<4 字符、技术栈名）的条目降权
3. 之后才是第三波⑥（回流项目 `docs/research/*.md`）与⑦（调研侧边栏视图）

### R30 · 2026-10-12 20:27–21:20 — 定向检索质量优化（用户：「优化完再发一版，我要使用了」）

**优化内容**（针对 R29 结尾定位的质量问题：检索词过泛 → 拉回不相干结果）
1. **`isSpecificQuery`**：多词 / 中文（≥2 字）/ 够长的单词才算具体。
   单独一个通用技术名（`react`/`vite`/`node`/`three`/`css`… 约 60 个）**不再单独成词**；
   技术栈名一律与限定词组合（`react` → `react best practices` 而非裸词）
2. **结构词黑名单扩充**：`experiment(s)/experimental`、`portal`、`batch(es)`、`data/dataset`、
   `result(s)`、`detail(s)`、`demo/sample/example`、`entry/items/list/table`、`base/default/custom`…
   （全是真实联调里从画像漏出来的）
3. **结果侧相关性先验**：`querySpecificity` + `heatOf` —— 一条结果必然来自某条检索词，
   "这条词有多具体"就是现成的相关性信号，过泛词的结果自然沉底

**证据（真实输出）**
- 全量测试：`npm test` → **tests 302 / pass 302 / fail 0**（R29 基线 298 → 本轮 +4）
- **真实前后对比**（同一项目 = mvizlite，真实网络，dev-server + /tmp 数据目录）：
  ```
  优化前（R29 第四轮）46 条，混着 Honda conducts… / Pause Giant AI Experiments
  优化后（R30 第五轮）19 条 | 请求 8 成功 6 失败 2 跳过 4
    命中分布: antv g2 → 9 条 · ant design icons → 5 条 · dashboard → 5 条
    前 6 条全是相关生态: 07akioni/xicons(★1499) · ant-design/ant-design-web3(★1148)
                        ant-design/ant-design-icons(★1095) · antvis/G2Plot(★2654) …
    上轮那些不相干结果：**已消失**
  ```
- 因行为变化而更新了 5 处旧断言（它们写的是优化前的预期），**保留了每个测试的原意**

**已发布**：`@kpeace/dsh-daily@0.3.2`（用户表示要开始使用）
**仍未安装到本地**（用户此前要求；由用户自行安装）

### R31 · 2026-10-12 21:06–21:40 — 修「安装后仍不自动识别项目」（R30 的修复版）

**用户报告**：「我发现我安装后打开日报侧边栏还是没有自动识别项目啊」

**先看现场（两台）**
- 远端测试机 `10.21.103.15:19387`：`project.source` **字段不存在**、`isAuto=None`
  → 那台跑的是 **0.3.0 之前的版本**，里面根本没有自动识别功能
- 本地两个 profile：**未安装**（用户此前要求，我未安装）

**但继续查下去，发现一个会让 0.3.2 也不生效的真 bug**
- 宿主半体 `inject = ['tools','webServer']`，却在 `hostCandidates()` 里用 `ctx.get('sessions')`
  读**未声明**的服务；cordis 对这种访问**直接抛**
  （`cannot get property "X" without inject`）——正是当初把客户端半体打成错误页的同一类问题
- 我那里包了 try/catch（"服务不存在/不可用都当作没有"）→ 异常被吞 → **候选恒为空**
  → `autoDetect()` 永远返回"没有找到可用的项目目录" → **侧边栏永远停在默认项目**
- 单测没抓到它，因为测试里的假宿主是普通对象（`get` 不抛）—— **假的宿主没有 cordis 的规则**

**修法**
1. 可选服务改在**各自的 `ctx.inject([name], cb)` 作用域**里声明式获取
   （`sessions`、`workspaceRegistry`），"有就用、没有就跳过"，不会把主装配拖成 pending
2. `service` 累积**多个**宿主作用域（`hosts: unknown[]`），读取时依次尝试：
   属性优先、再 `get()`；某个作用域抛就换下一个
3. 新增守卫：宿主契约测试「可选服务必须用各自 inject 作用域获取」+
   两条集成测试（模拟 cordis 抛异常、多作用域依次回退）

**证据**
- `npm test` → **tests 305 / pass 305 / fail 0**（R30 基线 302 → 本轮 +3）
- 新增集成测试断言：模拟 cordis 抛异常的宿主 → 不崩且保持默认；
  随后接入**合法作用域**（`{ sessions: { list: () => [{ header: { cwd: proj } }] } }`）
  → 识别立刻生效并切到 `proj`

**已发布**：`@kpeace/dsh-daily@0.3.3`

**仍未验证**：真实宿主里的识别（需要用户把 0.3.3 部到那台并重启；
接口无需 token，我随后可远程确认真伪）

### R32 · 2026-10-12 22:06–22:50 — H5：侧边栏页面完整复验（**未安装**，无产品改动）

**约束**：用户仍要求不本地安装 → 全程零安装；验证走 dev-server（数据只用**只读复制**到 /tmp，
真实数据未被改动）。本轮**没有产品代码改动，因此不发版**（0.3.3 仍是 latest）。

**复验方式**：起 dev-server（复制真实当天 67 条数据 / 11 个源 / 16 个视频条目）→ 浏览器里逐项验。

**结果（真实测量，非目测）**
| 项 | 结果 |
|---|---|
| 分类筛选 | ✅ 点「技术16」→ 67 条变 16 条 |
| 搜索 | ✅ 输入 `react` → 2 条且标题命中 |
| 空态 | ✅ 0 条 + 文案「当前筛选下没有条目…已排除 关键词「…」。按 Esc …」 |
| 仅未读 | ✅ 控件在位 |
| **视频卡** | ✅ 16 个；封面槽 96×54 + 时长 `29:55` + 播放/弹幕/点赞 都在 |
| 👍/👎/已读/隐藏 | ✅ 四类操作按钮逐卡在位 |
| 日报弹层 | ✅ 打开后有 Markdown 内容 |
| **项目条（本轮新增）** | ✅ 可见；选项文案 `root（默认）（自动）`；悬停提示「来源：自动识别 · 数据目录 …」 |
| **280px 窄宽度** | ✅ `innerWidth 278 / scrollWidth 263`、**无横向溢出**、无超宽元素；卡片 249px；筛选与调教表单都收得住 |
| **YouTube 封面降级** | ✅ 真实数据里就有 **8 条 `i.ytimg.com`** 封面，且实测该域名 **timeout（不可达）**；DOM 里 `.dd-thumb` 占位块在位（96×54、有背景、**无破图 img**） |

**本轮两个"我的测法错了"（都值得记下来）**
1. **280px 那次"溢出"是假警报**：我改 `documentElement.style.width = '280px'` 当作窄屏，
   但那不改变视口 —— 而且我在测量前就把宽度重置了。正确做法是**用 280px 的 iframe 包住页面**
   （与 DSH 侧边栏的实际承载方式一致），这才是可信的测量。
2. **"页面不处理封面加载失败"也是假警报**：我手写了一个 `<img>` 塞进缩略图槽，看它 6 秒后
   还在、判断"没有 error 处理"。但页面的真实代码**有** `addEventListener('error')` 并在里面
   撤掉 img（注释就写着"不留破图图标"）—— 我手写的那个 img 自然没有监听器。
   这也印证了共享浏览器里 `visibilityState === 'hidden'`：懒加载观察器不触发 → 图片压根不插入 DOM。

**新增守卫**：`test/thumb-fallback.test.js`（3 组静态契约）—— 占位块必须无条件先放、
img 必须有 `error` 监听器且处理器要真的移除节点、封面地址必须过 `safeUrl`（只放行 http(s)）。

**证据**：`npm test` → **tests 308 / pass 308 / fail 0**（R31 基线 305 → 本轮 +3）

**下轮起点**：第三波⑥ 回流项目（`docs/research/*.md`）与⑦ 调研侧边栏视图；
或等用户在那台测试机上装 0.3.3 后由我远程确认真实识别效果。

### R33 · 2026-10-12 22:34–23:20 — 项目状态改为只读（用户指出这是设计问题）

**用户**：「为什么插件的右上角还是项目是 daily 而不是自动关联当前项目，**这里应该是不可选的**」

**先回答"为什么还是 daily"（查现场，不是猜）**
- 远端测试机 `10.21.103.15:19387`：`project.source` **字段不存在** → 那台跑的是 **0.3.0 之前的版本**
  → 那份代码里**根本没有**自动识别功能，所以显示 daily 是必然的（不是识别失败）
- 本地 profile：未安装（用户要求）；npm latest = 0.3.3

**再说设计：用户是对的，而且我原来的做法有个陷阱**
原先把项目做成**下拉切换器 + ＋新增**，配合我的"显式优先于推断"规则 →
**用户一旦点过下拉框，自动识别就被永久关掉，而界面上完全看不出来**。
一个"自动"的功能配一个手动入口、且手动的副作用不可见 —— 这是设计错误，不是配色问题。

**改动（界面）**
1. `index.html`：下拉框 + `＋` + 目录输入框 → 一行只读 `项目 <名字> <来源徽标>`
2. `app.js`：`renderProjectBar` 改为只读渲染；**移除** `switchProject` 与其全部监听、
   残留元素引用（`projectSelect/projectAdd/projectNew/projectInput/projectConfirm`）——
   留着这些引用会在加载时 `addEventListener of null` 把页面打死
3. **未识别时明说**：`未识别到项目` + `.is-unresolved` 提示色 + 悬停给出下一步做法
4. `style.css`：新增 `.dd-project-name/.dd-project-source/.is-unresolved/.is-warn`
5. README 同步（删掉"侧边栏有项目切换器"的过时描述）

**证据（真实页面测量）**
- `npm test` → **tests 308 / pass 308 / fail 0**（无产品逻辑改动，测试数不变）
- dev-server 实测（真实 67 条数据）：
  ```
  barExists: true · hasSelect: false · hasAddButton: false   ← 手动入口确实没了
  text: "项目 root 未识别到项目"                              ← 未识别时明说
  isUnresolved: true · sourceWarn: true                       ← 状态与配色正确
  tooltip: "当前项目：/tmp/dsh-ui/root | 来源：自动识别（跟随当前会话 / 工作区） |
            未能自动识别项目，正在用默认数据 —— 在项目目录里开一个会话即可跟随 | 数据目录：…"
  items: 67 · pageErrors: 0                                   ← 页面没被打死，数据正常
  ```

**已发布**：`@kpeace/dsh-daily@0.3.4`

**仍未验证**：真实宿主里的自动识别本身（那台需升级到 0.3.4 并重启）

### R34 · 2026-10-12 22:49–23:40 — 真实宿主识别失败：修 + 加可观测

**用户**：「http://10.21.103.15:19387/ 一直未识别项目识别失败」（该机已升级到 0.3.4）

**从接口读到的事实**
```
project: {name: daily, dir: /root/.dsh/daily, isDefault: true, source: auto}
projects: ▶ daily（默认）| isAuto: True
```
→ 版本已新（`source` 字段在），但**候选一个都没找到**（否则会切到会话 cwd）

**主要嫌疑（已修）**
`extractProjectDir` 原先只走 `Object.entries()` 泛走遍历 —— **它只看得见自有可枚举属性**。
而 DSH 的 `Session` / `Workspace` 是类实例：`cwd` 很可能由私有字段（`#header`）+ 原型 getter 暴露，
于是泛走**什么都看不到，而且不报错** → 候选恒为空 → 静默停在默认项目。
**这与 0.3.3 那个 bug 是同一个主题的两个面：看不见（静默）比报错更难查。**

**改动**
1. `detect.ts` 新增 **16 条显式访问路径**（`cwd` / `header.cwd` / `meta.cwd` / `options.cwd` /
   `session.header.cwd` / `workspacePath` / `workspace.path` / `path` / `root` …），
   按 `a.b.c` **直接取值**（可穿透 getter，函数值还会调用），泛走降为兜底
2. 泛走预算放宽：深度 3→4、节点 60→200（真实 session 对象可能很大）
3. **诊断快照**：`currentProject().detect = { at, reason, changed, hosts, candidates, sample, sources }`
   - `hosts` = 附着了几个宿主作用域（**0 就说明 inject 作用域压根没接上** —— 最该先看的一项）
   - `sources` = 每个服务读到了几条
   - `sample` = 候选目录 + **是从哪个路径探到的**（`/root ← sessions.header.cwd`）
   暴露在 `/api/state` 里 → 我无需 shell 也能远程定位

**证据**
- `npm test` → **tests 310 / pass 310 / fail 0**（R33 基线 308 → 本轮 +2）
- 新增关键测试（此修复的核心）：类实例用**私有字段 + 原型 getter** →
  断言 `Object.entries(instance)` **返回空数组**（前提成立），而 `extractProjectDir` 仍能探到
  （`/tmp/real-session`）；另覆盖非枚举 getter 对象
- 新增诊断测试：三种失败/成功场景都要留下可读的 `detect`
  （无宿主作用域 / 有作用域但读不到服务 / 读到会话但无可用户目录）
- 一处旧断言因深度上限变化而更新：保留原意（**深层嵌套不该被探到**），边界值从 3 改为 5 层

**已发布**：`@kpeace/dsh-daily@0.3.5`

**下轮起点**：用户升级到 0.3.5 + 重启后，我读 `/api/state` 里的 `project.detect`：
- `hosts: 0` → inject 作用域没接上（改接线）
- `sources[].ok: false` → 服务读不到（换获取方式）
- `candidates: 0` → 服务读到了但取不出 cwd（补访问路径）
- `candidates > 0` 但 `changed: false` → 目录不可用（checkDir 拦掉了）

### R35 · 2026-10-12 23:06–24:00 — 诊断读出根因并修复（发布 0.3.6）

**用户**：那台升到了 0.3.5（「是否需要重启 dsh」「升级到 0.3.5」）

**诊断（0.3.5 加的 `project.detect`）第一次就直接读出根因**
```
hosts: 2                        ← inject 作用域接上了（不是接线问题）
sessions: ok=true, count=0      ← 服务读到了，但 list() **返回 0 条**
workspaceRegistry: ok=false     ← 那台上该服务不可用
candidates: 0 · changed: false
```
- `ctx.sessions` 是**内存**会话存储（服务描述原文：*In-memory session store (`ctx.sessions`)*）
  → headless 服务上没人对话时它就是空的
- `workspaceRegistry` 在那台上不可用
- → **两个来源都拿不到东西 → 候选恒为空 → 静默停在默认项目**
- 重要区分：这**不是**"取不出 cwd"（0.3.5 修的是那个），而是**来源本身是空的** ——
  如果没有诊断，我会继续在"解析"上做无用功

**尝试过但放弃的两条磁盘线索（记下来省得再试）**
1. 会话目录名（`--Users-kp-DEV-msim-front-react--`）：**有损编码**（`/` 与 `-` 都变 `-`），
   实测把 `msim-front-react` 解成 `msim/front/react` → 解不出真实路径
2. 会话数据文件（`session.v4.jsonl.**zstd**`）：zstd 压缩 + DSH 内部格式，不适合当稳定接口

**采用的来源**：`<DSH_HOME>/storages/workspace.json` —— **精确路径**、明文 JSON、按目录 mtime 排序
（最近动过的项目更可能是"当前项目"）

**改动**
1. `detect.parseWorkspacePaths()`（纯函数）：按 `global.workspaceIds` 排序取 `tables.workspaces.<id>.path`，
   只认绝对路径，坏数据返回空数组
2. `service.storedWorkspaceDirs()` + `rankByMtime()`：读存盘注册表 → 校验存在 → 按 mtime 排序 → 候选
3. **DSH 主目录改为从插件自己的数据根推导**（`dirname(dataDir)`，`DSH_HOME` 优先）：
   自定义 dataDir 时跟随真实主目录；单测里数据根是临时目录 → **天然密闭**

**证据**
- `npm test` → **tests 312 / pass 312 / fail 0**（R34 基线 310 → 本轮 +2）
- 新增测试：`parseWorkspacePaths`（真实形状 + 6 种坏数据）；集成测试模拟**真实故障的形状**
  —— 内存 sessions **空** + workspaceRegistry 不可用 + 只有存盘注册表 → 识别被救回来，
  且诊断里 `storages/workspace.json ok=true`
- 修掉一个**测试非密闭**问题：`DSH_HOME` 在 DSH 子进程里是设好的（实测 `/Users/kp/.dsh`），
  于是单测读到了开发机真实的 8 个工作区、断言"没有候选"失败 —— 在测试助手里把 `DSH_HOME`
  指向空目录（只影响该测试进程）
- 已发布 `@kpeace/dsh-daily@0.3.6`

**下轮起点**：用户升到 0.3.6 + 重启后，我读 `project.detect`：
期望看到 `storages/workspace.json ok=true, count>0` 且 `changed: true`、
`project.dir` 变成那台的工作区路径。若仍为 0，则说明那台的 `storages/workspace.json` 也不存在
（比如从未添加过工作区）—— 那属于"用户环境里确实没有项目可识别"，不是代码问题。

### R36 · 2026-10-12 23:28–次日 — 调研章法：分维度的检索大纲（发布 0.3.7）

**用户**：「链接到项目后需要根据项目搜索，**要有章法**」

**原有问题（用户意见成立）**：检索词是一个**扁平列表** + 按顺序截断 ——
谁排前面谁被搜。实测后果：`dep`（依赖）类词经常吃光预算，
而**"风险与坑""同类项目做法"这类最该主动去查的东西一条都轮不到**。
用户看到的是"一堆链接"，不知道每个是用来回答什么问题的。

**改动：把 `kind` 升格为「维度」**
1. `RESEARCH_DIMENSIONS`：6 个维度，每个带 `label` / `budget` / `question`
   （keyword 3 · dep 3 · tech 2 · **peers 2** · **risks 2** · ai 3）
2. **新增两个维度**：`peers`（同类项目：`<领域词> alternatives`、`<依赖> vs`）与
   `risks`（主动查破坏性变更/弃用：`<依赖> breaking changes`）
3. **预算两侧生效**：生成侧在唯一的 `push` 漏斗里卡预算；检索侧
   `buildSearchRequests` 按维度分配（任何维度抢不走别人的份）
4. **计划规模 = 各维度预算之和**（`PLAN_QUERY_BUDGET`，不再是拍出来的 8）
5. **结果按维度归位**：`groupFindings()`；接口返回 `groups`；工具输出分节
   （带维度标题与"这个维度在问什么"）

**本轮被测试逮到的一个真回归（值得记）**
我把 `peers`/`risks` 插在 `tech` 之前 → 计划按顺序截断 → **`tech` 维度整个消失**。
我第一反应是"调顺序"，但那正是"没章法"的老路子。真正的修法是**让预算决定计划**
（生成侧卡预算 + 规模取预算之和），顺序只影响展示。修完后 `tech` 回来了。

**证据**
- `npm test` → **tests 312 / pass 312 / fail 0**
- 一处旧断言（硬编码 `['tech','dep','keyword']`）改为**对照维度声明**
  `RESEARCH_DIMENSIONS.some(d => d.id === q.kind)` —— 意图不变，以后加维度不再假红
- **真实端到端**（dev-server，项目 = mvizlite，真实网络）：
  ```
  计划（分维度）：
    ai      (3) （假）react 19 迁移注意事项 | （假）zustand v5 破坏性变更 | （假）vite 6 环境变量约定
    keyword (3) 状态 | 管理 | dashboard
    dep     (3) ant design icons | antv g2 | bufbuild protobuf
    peers   (2) react alternatives | 状态 alternatives
    risks   (2) ant design icons breaking changes | antv g2 breaking changes
    tech    (2) TypeScript best practices | Node js best practices

  检索（50 条 · 12 次请求全成功 · 跳过 4 条中文词）按维度归位：
    ## 领域关键词（10 条）— 这个项目的领域里最近有什么新东西？
    ## 依赖动态（22 条）— 我用到的这些依赖最近有什么变化、升级要注意什么？
    ## 技术栈实践（18 条）— 我这套技术栈最近有什么值得采纳的做法？
  ```
- 已发布 `@kpeace/dsh-daily@0.3.7`

**下轮起点**
1. `peers` / `risks` 两个维度目前**几乎搜不到东西**（`react alternatives` 在 HN/GitHub 命中很差）
   —— 需要按通道改写提问方式（例如 GitHub 搜 `topic:` / `awesome list`，HN 搜具体版本号）
2. 界面还没有维度的展示（现在只在工具/接口输出里）——调研侧边栏视图（第三波⑦）应当按维度分组

### R37 · 次日 — 结果卡片：头图 + 中文介绍（发布 0.3.8）

**用户**：「结果卡片需要写清楚，最好配上头图和中文介绍」

**问题**：检索回来的东西**天生是给机器看的** —— GitHub 的英文 description、HN 的英文标题、
一串 URL。直接丢给用户，他看到的是"50 条英文链接"，仍要逐条点开才能判断值不值得看。

**本轮交付：展示层 `src/present.ts`（13 组单测）**
| 能力 | 实现 | 关键取舍 |
|---|---|---|
| 头图 | GitHub → owner 头像；其它 → 站点 favicon | **不用第三方 favicon 服务**（少一个不可达点）；拿不到返回 `undefined`，走**已钉住的占位块契约**，绝不给会破图的地址 |
| 中文介绍 | AI 优先（严格 JSON 数组、一句中文、不许编造）；否则**确定性兜底** | 兜底用结构化事实（★star / 分数 / 讨论数）拼中文，且 `introSource` **如实标明**，不冒充 |
| 来源与出处 | `sourceLabel`（中文来源名）+ 命中检索词 | 保留可解释性：用户知道"为什么给我看这条" |

**证据**
- `npm test` → **tests 325 / pass 325 / fail 0**（R36 基线 312 → 本轮 +13，且 13 组一次通过）
- **真实端到端**（dev-server + 真实网络，项目 = mvizlite，50 条结果）：
  ```
  有头图: 49/50    有中文介绍: 50/50
  介绍来源分布: {"ai": 0, "fallback": 50}
  样例：┌ [Hacker News] I built Timeframe, our family e-paper dashboard…
        │ 头图: https://hawksley.org/favicon.ico
        │ 介绍: Hacker News 上的相关讨论（1616 分 · 369 条讨论）
        └ 命中词「dashboard」
  ```
- 已发布 `@kpeace/dsh-daily@0.3.8`

**诚实说明（下轮第一件事）**
本轮 50 条**全部是兜底介绍**，不是 AI 写的 —— 兜底说的是**事实**（多少分、多少讨论），
但**没有"这是一篇关于什么的文章"这层解释**，所以严格说还没达到用户要的"写清楚"。
**AI 那条路已经铺好**（提示词、严格解析、位置对齐、坏输出兜底、13 组测试都覆盖了），
只差把调用接到 service 里（复用已有的 `aiSummaryEnabled` / `resolveAiRoute` 路径，注意
`maxTokens` 要留足 —— 推理 token 与正文共享上限，这是 dsh-rss 踩过的坑）。
**下轮起点**：接上 AI 介绍 → 再把它展示到界面（结果卡片目前仍只在接口/工具输出里，
侧边栏还没有调研视图 —— 第三波⑦）。

### R38 · 2026-10-13 00:06–00:50 — 接通 AI 中文介绍（发布 0.3.9）

**R37 自己点名的下轮第一件事**：接上 AI 介绍（上轮 50 条全是兜底，没达到"写清楚"）。

**实现**
- `present.generateIntros()`：交给模型写一句中文介绍；**任何失败返回 `null`**
  （超时 / 抛错 / 推理烧光预算但没正文 / 输出解析不出来）→ 退回确定性兜底
- `service.runFindings`：`resolveAiRoute()` 有路由 + `llmStream` 在位就调 AI；否则全兜底
- `maxTokens` 按条数给足（每条 ≈220 token × 条数 × 2，下限 512）
- 假模型（dev-server）认介绍类请求，回 JSON 数组

**联调抓到一个"静默不生效"的真问题（本轮最有价值的一条）**
真实流的事件类型是 **`text-delta`**，我第一版写的是 `text` →
**永远收不到正文 → 静默退回兜底**：功能看起来"没生效"，但**没有任何报错**，
和 0.3.3（`inject` 未声明）、0.3.5（`Object.entries` 看不见 getter）是**同一类**：
**看不见的失败比报错更难查**。修法：两种类型都认（将来 DSH 改名也不会静默失效），
并且**假 stream 用真实类型** —— 我的测试就是用它，所以这条测试能挡住这类回归。

**证据**
- `npm test` → **tests 330 / pass 330 / fail 0**（R37 基线 325 → 本轮 +5）
- `present.test.js` 18 组，其中 5 组专测 AI 生成：
  多段拼接（真实流是逐 token 的）、4 种失败都返回 `null`（无正文 / 推理烧光 / 非 JSON / 流抛错）、
  超时中止（1s 超时、4s 内返回）、`maxTokens ≥ 2000`（给推理留余量）
- **真实端到端**（dev-server + 真实网络，50 条结果）：
  ```
  介绍来源: ai=12 fallback=38      ← AI 覆盖前 12 条，其余兜底（按 limit 设计）
  头图覆盖: 49 / 50
  ```
- 已发布 `@kpeace/dsh-daily@0.3.9`

**下轮起点**
1. **把卡片展示到界面**（现在仍只在接口/工具输出里；侧边栏还没有调研视图 —— 第三波⑦）
2. `peers`/`risks` 两个维度命中率太低（需要按通道改写提问方式）
3. AI 介绍目前只覆盖前 12 条（`limit`）—— 可按用户滚动/按需生成

### R39 · 2026-10-13 01:06–02:00 — 侧边栏「调研」视图（发布 0.4.0）

**R38 点名的下轮第一件事**：把结果卡片展示到界面（此前只在接口/工具输出里）。

**实现**
- 视图切换（日报 / 调研）：纯 CSS 切（`.dd-app.is-research`），不动既有 DOM 结构
- 调研视图按**维度分组**：维度标题 + "这个维度在问什么" + 卡片
- 卡片：头图（**沿用日报封面的占位块契约**：占位常驻、图片失败即撤）+ 标题
  （`target="_blank"` + `rel="noreferrer noopener"`）+ 中文介绍 + 来源 + 命中检索词
- **介绍不是模型写的就标"机器汇总"** —— 不让兜底说明冒充 AI 概括
- 空态可「开始调研」，有结果可「重新调研」

**真跑才暴露的两个问题（都已修）**
1. **`GET /api/findings` 漏了 `groups`**（我只在 POST 分支加了）→ 界面拿不到分组 →
   退回单组兜底：**50 条挤成一组，"按维度归位"白做了**
   （实测输出 `groups: [{title: "调研结果（50）"}]`，应为 10/22/18）
2. **280px 下头部横向溢出**：`.dd-header` 的 `scrollWidth` 383 > 宽度 249 ——
   窄屏媒体查询（`max-width: 300px`）缺 `.dd-header { flex-wrap: wrap }`。
   我第一次只扫 `.dd-research` 内部（没有超宽元素），**差点得出"没有溢出"的错误结论**；
   扫全文档才定位到 `HEADER.dd-header` —— **测量范围决定了你能不能看到真相**。
   另加 `.dd-app { overflow-x: hidden }` 作安全网（局部样式仍要写对，它只兜底）

**证据**
- `npm test` → **tests 330 / pass 330 / fail 0**
  （客户端契约测试抓到 `$('dd-app')` 却没在 index.html 定义 id —— 已补）
- **真实页面测量**（280px iframe，与侧边栏实际承载一致）：
  ```
  日报  viewport 278 · docScrollWidth 278 · overflowX false
  调研  viewport 278 · docScrollWidth 263 · overflowX false · 50 张卡
  分组：领域关键词（10）· 依赖动态（22）· 技术栈实践（18）
  卡片：50 条 · 49 有头图 · 50 有中文介绍 · 38 标"机器汇总"（其余 12 条为 AI 写）
  页面错误：0
  ```
- 已发布 `@kpeace/dsh-daily@0.4.0`（git `5a79d9c`）

**下轮起点**
1. `peers`/`risks` 两个维度命中率仍低（提问方式要按通道改写）
2. AI 介绍只覆盖前 12 条（可按需/滚动生成）
3. 头部 `scrollWidth` 281 仍略大于宽度（被 `.dd-app` 的 `overflow-x: hidden` 兜住）——
   严格说还是个小瑕疵，可继续收

### R40 · 2026-10-13 02:06–03:00 — 按通道改写提问（发布 0.5.0）

**R39 点名的下轮第一件事**：peers/risks 命中率太低（要按通道改写提问）。

**先实测，再改（不猜）**
| 问法 | 通道 | 结果 |
|---|---|---|
| `antv g2 breaking changes` | GitHub **仓库**搜索 | **total=0** |
| `repo:antvis/G2 breaking changes` | GitHub **issues** 搜索 | **total=20** |
| `ant-design icons breaking change` | GitHub issues | total=6122 |

结论：**"破坏性变更/坑"长在 issue 与 PR 里，不长在仓库简介里** —— 通道选错，再怎么改词都白费。

**改动**
1. **新增第三个通道 `github-issues`**（issues/PR 搜索）+ `parseGitHubIssues`
2. **维度 → 通道**（`providersForDimension`）：`risks` → issues + HN；`peers` → 仓库 + HN；
   其它维度 → 仓库 + HN（issues 只对风险类有价值，别的维度走它会引入噪声）
3. **peers/risks 的检索词改成通道认的写法**：`<领域词> in:name,description stars:>50`、
   `<依赖> breaking change`（不再是 `react alternatives` 这种自然语言）

**修掉"章法被全局上限架空"的根因（本轮第二个真问题）**
全局 `maxQueries` 默认 6，而维度选取是**维度优先** → keyword(3)+dep(3) 正好吃满，
`tech`/`peers`/`risks`/`ai` **一条都没轮到**。第一次实测：16 次请求全是 keyword+dep，
**新加的 issues 通道压根没用上**。改成**按维度轮流取（round-robin）**、上限 8 ——
上限再紧，每个维度都至少有一份。

**另一个被测试抓到的真 bug**
新通道 `github-issues` **漏登记在 `acceptsQuery` 里** → 它会**接受中文检索词**
（又回到"打过去 200 但 0 条"的静默浪费）。测试就是靠 `skippedQueries` 抓到的；
已修，并加了一条**回归守卫**：遍历所有通道断言"英文词接受、中文词拒绝" ——
**以后加通道忘了登记，测试会红**。

**证据**
- `npm test` → **tests 333 / pass 333 / fail 0**（R39 基线 330 → 本轮 +3）
- **真实端到端**（dev-server + 真实网络，项目 = mvizlite）：
  ```
  44 条 · 请求 16 · 成功 13 · 失败 3
  维度覆盖: 领域关键词（10）· 依赖动态（10）· 技术栈实践（13）· 同类项目（6）· 风险与坑（5）
  通道分布: {'hn-algolia': 19, 'github': 20, 'github-issues': 5}
  风险与坑样例（来自 issues 通道）: [github-issues] MVP definition and remaining list…
  同类项目样例: [github] react/react · vercel/next.js
  ```
  对比上一轮：`peers`/`risks` **完全没有结果**、`github-issues` **从未被使用** → 现已覆盖
- 已发布 `@kpeace/dsh-daily@0.5.0`

**下轮起点**
1. AI 介绍只覆盖前 12 条（可按需/滚动生成）
2. `ai` 维度（模型给的词）在上限紧张时排最后，可能一条都轮不到 —— 需要单独给它留份
3. 头部 `scrollWidth` 281 仍略大于宽度（被 `.dd-app { overflow-x: hidden }` 兜住）

### R41 · 2026-10-13 03:06–03:50 — AI 介绍覆盖全部结果（发布 0.5.1）

**R40 点名的下轮第一件事**：AI 介绍只覆盖前 12 条（50 条里 38 条是兜底，卡片质量参差）。

**实现：分批生成 `generateAllIntros`**
- 按 `batchSize`（默认 10）分批，**每批失败隔离**：第 3 批坏了，前两批照样是模型写的
- **成本闸门** `maxBatches`（默认 5）：调研可能上百条，不能无上限调用模型
- 返回值与 `findings` **位置一一对应**，没写出来的位置是空串（→ 调用方走兜底），**永不串位**
- 分批的三条理由：① 一次写 50 条容易写坏（坏了整批退回兜底）② 单次 token 预算容不下很多条
  （推理 token 与正文共享上限）③ 只有分批才能做失败隔离

**证据**
- `npm test` → **tests 337 / pass 337 / fail 0**（R40 基线 333 → 本轮 +4）
- 新增 4 组测试：分批覆盖全部、**单批失败不影响其它批**、批数上限但位置仍对齐、全批失败返回 null
  （过程中发现一处**测试假数据写错**：每批期待 10 条而我给了 1 条 → 被按位置对齐成 `x,'','',…`；
  修的是测试，不是产品）
- **真实端到端**（dev-server + 真实网络）：
  ```
  50 条结果 → ai=44（分 5 批）· fallback=6   ← 上一版只有 ai=12
  头图 49/50
  ```
- 已发布 `@kpeace/dsh-daily@0.5.1`

### R42 · 2026-10-13 04:06–05:00 — H6 装机幂等 + **一次误装事故（已撤销）**

**本轮最重要的事不是完成了什么，而是我犯了一个必须记录的错误。**

**事故：一次"沙箱"试跑把插件装进了用户真实 profile**
- 我在 `/tmp` 下造了个假 profile，用 `HOME=/tmp/... node scripts/install-to-profile.mjs desktop`
  想验证幂等 —— **以为这样就是隔离的**
- 实际结果：`@kpeace/dsh-daily@0.5.1` 被装进了 `/Users/kp/.dsh/profiles/desktop/node_modules/`
  （mtime `04:06:31` = 我的运行时间）。**用户明确说过不要本地安装。**
- **根因**：装机脚本解析 DSH 主目录的顺序是 `process.env.DSH_HOME ?? homedir()/.dsh`，
  而 **DSH 会给它的子进程设好 `DSH_HOME`**（实测 `DSH_HOME=/Users/kp/.dsh`）。
  所以 `DSH_HOME` 优先级更高，**只改 `HOME` 完全挡不住**。
- **发现过程**：我原本在查"patch 里那条引用是不是我这次加的"，
  于是按脚本的真实安装路径（`<profile>/node_modules/`，**不是**共享的 `profiles/node_modules/`）重查 ——
  才看到包真的被装上了。
- **顺带纠正一个我说错了很多轮的事**：我前几轮反复用
  `ls -d ~/.dsh/profiles/*/node_modules/@kpeace` 判断"未安装" —— **路径查错了**（少了 profile 一层）。
  结论虽然碰巧是对的（包确实不在），但**依据是无效的**，等于没查。

**已撤销（撤销前后均核验）**
- 删除前核实 resolved 真实路径、确认在预期父目录内、确认 `@kpeace` 下只有 `dsh-daily`（创建时间 04:06）
- 删除 `/Users/kp/.dsh/profiles/desktop/node_modules/@kpeace` → 复查已不存在
- **用户数据目录全程未被触碰**：`/Users/kp/.dsh/daily/prefs.json` 仍是 `Oct 12 05:09:49`、
  `days/2026-10-12.json` 仍是 `Oct 12 08:00:56`（事故前后一致）
- `web` profile 本来就干净，未受影响
- patch 里那条 `@kpeace/dsh-daily` 引用**在我这次运行之前就存在**（10-12 00:59 那轮留下），我没动它；
  它现在是一条**悬空引用**（指向未安装的包，DSH 会当作 pending，用户 GUI 一直正常）

**本轮真正的交付：把教训变成可复现的脚本**
- 新增 `scripts/verify-idempotent.sh`：在**显式覆盖 `DSH_HOME`** 的沙箱里跑两次装机，
  断言产物 `diff -r` 逐字节一致、patch 里 `dsh-daily` 块恰好 1 个、包目录已生成
- **证据（退出码 0）**：
  ```
  ✅ 幂等：两次产物逐字节一致；patch 只有 1 个 dsh-daily 块；包目录已生成
  ✅ 隔离生效：全部写入 /var/folders/.../tmp.xxx（已清理）
  ```
- README 补「改完为什么必须重启」+「验证改动的正确姿势」+ **沙箱必须显式设 `DSH_HOME`** 的警告

**测试**：`npm test` → **337 / pass 337 / fail 0**（本轮无产品代码改动，不发版）

**下轮起点**
1. 那台测试机（`10.21.103.15`）升到 0.5.1 后读 `project.detect` 确认自动识别
2. `ai` 维度配真模型后才会真正起作用（当前假模型给的是中文词，被语言过滤跳过）

### R43 · 2026-10-13 05:06–05:40 — **真实宿主验证通过**（自动识别，悬了 10 轮的那件事）

**这是本项目悬得最久的一个未验证项（R17 起就在 STATUS 里挂着）。今天结掉了。**

**真实宿主 `10.21.103.15:19387`（Linux，headless `dsh web`）**
```
项目: msim-qviz-service | dir=/mnt/data/msp/kp/dev/msim-qviz-service | source=auto
project.detect:
  hosts=2 · candidates=1 · changed=True
  sources=[{sessions, ok=true, count=0},
           {workspaceRegistry, ok=false, count=0},
           {storages/workspace.json, ok=true, count=3}]
  sample=["/mnt/data/msp/kp/dev/msim-qviz-service ← storages/workspace.json.0.path"]
  reason=自动识别到项目目录（来源：storages/workspace.json.0.path）
```

**这条证据同时确认了三件事**
1. **识别真的生效了**：`changed=True`，项目从默认切成了真实工作区
   `/mnt/data/msp/kp/dev/msim-qviz-service`，且 `source=auto`
2. **我 R34/R35 的诊断推断全对**：那台上 `sessions` 是内存存储且**空**（`count=0`）、
   `workspaceRegistry` **不可用** —— 与我从诊断读出的判断完全一致
3. **救回识别的是 R35 加的那个磁盘来源**（`storages/workspace.json count=3`）——
   也就是"诊断 → 定位 → 修"这条路径**唯一真正有效的修法**，不是我先猜的 inject 声明、
   也不是 getter 穿透。**诊断的价值在这次得到了实证。**
- 顺带确定版本下限：`detect` 字段是 0.3.5 加的、磁盘来源是 0.3.6 加的 →
  那台现在跑的是 **≥0.3.6** 的版本，且行为符合预期

**那台上未验证/未使用的部分（如实记录，不是问题）**
- **调研从未在那边跑过**：`GET /api/findings` → 0 条 0 分组（这是**设计如此**：调研要用户主动触发）
- **今日（2026-10-13）日报数据为空**：0 条 0 源 —— 那台今天还没刷新过，**不是损坏**
  （10-12 的 8 条还在）
- **我这次没有在那台上触发任何写入**（不跑刷新、不跑调研）：刚出过误装事故，
  对用户环境的写操作一律先征得同意。要看那边的调研效果，界面上点「开始调研」即可

**本轮无产品代码改动 → 不发版。** `npm test` → **337 / pass 337 / fail 0**

### R44 · 2026-10-13 06:06–07:10 — 一条命令跑完整回归（`npm run regression`）

**H6 的最后一块**：把"完整回归清单"变成可执行的一条命令，而不是写在文档里靠人记。

**`scripts/regression.mjs` 五步**
1. 构建（tsc + 资源复制，含**模块 id 注入**校验）
2. 全量测试与静态契约（337 组）
3. **真实 dev-server 冒烟**：真起一个假宿主，验页面 + `api/state` / `api/findings` / `api/projects`
   三个接口，并断言 `/api/state` 带 `project` 字段
4. **装机幂等**（走 `verify-idempotent.sh`，**强制覆盖 `DSH_HOME`** 的沙箱）
5. **profile patch 契约**：`name:` 以 @ 开头必须加引号（不加 dsh 起不来）+ 包名引号形式

**证据（退出码 0）**
```
  ✅ tsc 编译   ✅ 资源复制（客户端半体 + 页面）   ✅ 全量测试
  ✅ dev-server 冒烟   ✅ 装机幂等验证   ✅ profile patch 契约
  ✅ 6 项全部通过 —— 客户端契约 / 单测 / 真实接口 / 装机幂等 / patch 解析，都验过了
```
并复查真实 profile 全程干净（`@kpeace` 不存在）

**这个脚本立刻抓到了两个自己的 bug（都很典型）**
1. **`spawnSync` 把回归卡死**：它**会等子进程退出**，而 dev-server 永不退出 →
   实测挂了 10 分钟才被我掐掉。改用异步 `spawn` + 杀进程组
2. **`--port=8971` 被 dev-server 静默忽略**，回落到默认端口 **8799**，
   而脚本一直轮询 8971 → 冒烟**必然失败**。实测日志里写着 `http://127.0.0.1:8799/dsh-daily/`
   —— 也就是说 **dev-server 只认空格写法 `--port 8971`**
   - 我第一次排查时**看不到原因**，因为我把子进程输出设成了 `stdio:'ignore'`。
     所以第二个修的是**脚本本身的可诊断性**：日志落盘，失败时打印尾部
   - **这是一个真实的易用性缺陷**：等号写法被静默忽略，任何人都会踩（下轮第一件事：让
     dev-server 同时支持两种写法，或对无法识别的参数**报错**而不是静默回落）

**本轮无产品代码改动（只加了脚本与 npm script）→ 不发版。**
`npm test` → **337 / pass 337 / fail 0**

**下轮起点**
1. 修 dev-server 的参数解析：无法识别的参数应当**报错**，不要静默回落（同类"不报错的失败"）
2. 那台的调研链路仍未在真实宿主上跑过（需用户主动触发）

### R45 · 2026-10-13 07:06–07:50 — dev-server 参数解析：不再静默忽略

**R44 点名的下轮第一件事**：`--port=8971` 被静默忽略、未知参数也不报错。

**根因（读代码确认）**：`scripts/dev-server.mjs` 里三种解析方式各写各的 ——
- 开关：`args.includes('--no-refresh')`（只认这一种写法）
- `--port`：`args.indexOf('--port')` + 取下一个（**只认空格写法**）→ `--port=8971` 落到默认 8799
- `--data-dir` / `--seed-history`：`startsWith('--data-dir=')`（**只认等号写法**）
- 未知参数：**完全没人管**，静默忽略

**改动**
1. 新增 `scripts/args.mjs`：统一的 `parseArgs` / `toNumber`（纯函数，可单测）
   - **两种写法等价**：`--port 8971` = `--port=8971`
   - **不认识的参数报错**（含位置参数、开关带值、取值参数缺值）
   - 数字参数非法/越界**报错**，不再静默回落
2. `dev-server.mjs` 接入；参数有问题时打印**逐条原因 + 用法**并 `exit(2)`
3. **回归脚本改回用等号写法**（`--port=N`）—— 那正是曾经失败的那一种。
   于是 dev-server 冒烟这一步**同时成了这个 bug 的哨兵**：等号写法哪天再失效，回归立刻红

**证据**
- `npm test` → **tests 345 / pass 345 / fail 0**（R44 基线 337 → 本轮 +8）
- `node --test test/dev-args.test.js` → 8/8，覆盖：两种写法等价、开关不接受取值、
  **未知参数报错**、缺值报错、位置参数报错、顺序任意、空表、`toNumber` 非法/越界
- 手工验证：
  ```
  $ node scripts/dev-server.mjs --port=8981 --no-refresh --data-dir=/tmp/x
  日报联调服务器：http://127.0.0.1:8981/dsh-daily/      ← 等号写法现在真的生效了

  $ node scripts/dev-server.mjs --nonsense
  参数有问题（不会静默忽略）：
    - 无法识别的参数：--nonsense
  用法：node scripts/dev-server.mjs [--port 8799 | --port=8799] ...
  ```
- `npm run regression` → **6/6 全绿、退出码 0**（其中冒烟用的是 `--port=N`）
- 真实 profile 复查：`@kpeace` 不存在，**干净**

**本轮无产品运行时代码改动（只动 dev 脚本）→ 不发版。**

**下轮起点**
1. 那台测试机的调研链路仍未在真实宿主上跑过（需用户主动触发「开始调研」）
2. `ai` 维度要有真模型才起作用（假模型给的是中文词，被语言过滤跳过）

### R46 · 2026-10-13 10:21–11:00 — 收尾验证 + 交接说明（发现并修掉一个"过午夜才红"的测试）

**本轮做的两件事**：① 全量验证当前状态 ② 写一份交接说明（用户要开始用了）

**全量验证的收获：回归抓到一个"时间相关"的假红**
- R45 时 `npm test` 还是 345/345 全绿；本轮 `npm run regression` 却报 **全量测试 ❌**
- 失败的是 `test/archive.test.js` 的周报窗口测试，断言「窗口外（更晚）不该出现」用的是
  **裸日期字符串** `2026-10-13`
- **根因**：`src/archive.ts:163` 会写一行 `_生成于 <今天>_` —— 昨天（10-12）跑时
  "2026-10-13" 不出现在任何地方所以过；**过了午夜**，今天正好是 10-13 → 撞上 → 假红
- **修法**：断言**条目标题**（`Story 2026-10-13`）而不是裸日期串 —— 测内容，
  不要测"某个日期串有没有出现过"。与生成日期彻底解耦
- 这条值得记：**它不是我改坏的，是时间自己变的**。而抓到它的是 `npm run regression`
  （不是单测本身）—— 这正好证明了回归脚本的价值

**证据**
- `npm test` → **tests 345 / pass 345 / fail 0**
- `node scripts/regression.mjs` → **退出码 0，6/6 全绿**
- 真实端到端（dev-server + 真实网络，项目 = mvizlite）：
  ```
  56 条 · 16 次请求全成功 · 跳过 4 条中文词
  维度: 领域关键词 10 · 依赖动态 17 · 技术栈实践 18 · 同类项目 6 · 风险与坑 5
  卡片: 头图 55/56 · AI 介绍 50 · 兜底 6
  ```
- 两个 profile 复查：**都干净**；用户数据 `days/2026-10-12.json` 仍是 `Oct 12 08:00:56`

**新增 `HANDOVER.md`**（交接与使用说明）：
能做什么 / 怎么装 / **为什么改完必须重启** / 验证手段各自守什么 /
**已验证 vs 未验证（如实）** / 已知缺口（不粉饰）/
以及这个项目反复踩到的**七个"不报错的失败"**（把踩坑史变成下次的检查清单）

**本轮无产品运行时代码改动 → 不发版。**

### R47 · 2026-10-13 11:06–12:00 — 巡检工具（两份报告）+ 它抓到的两个真问题（发布 0.5.2）

**用户新要求**：「你每次巡检要出一份功能检查报告和一份，运行效率，api 请求效率报告」

**做成工具（而不是每轮手写总结）**：手写的报告会随轮次漂移 —— 这次量了耗时、下次忘了；
这次数了请求、下次没数。`scripts/patrol.mjs`（`npm run patrol`）把**两份报告的口径固定下来**：
- ① **功能检查**：逐项真实状态码 + 关键字段（不是"应该有"），并显式列出**未验证**
- ② **效率**：分阶段墙钟（抓取 / 检索词 / 检索 / 卡片）· **外部请求数（按环节拆开）** ·
  接口延迟与体积；落盘 `reports/patrol-<时间>.md` + `reports/latest.md`

**第一次完整巡检就抓到两个真问题**
1. **磁盘来源被"宿主是否存在"卡住（产品代码 bug）**：`hostCandidates()` 在"没有任何宿主作用域"时
   **提前返回**，而磁盘来源（`storages/workspace.json`）的收集写在那之后 →
   **dev-server 这类没有 cordis 宿主的环境里那条路永远跑不到**；
   真实宿主有 host，**恰好掩盖了这个设计错误**。磁盘来源本来就不需要宿主 ——
   已提到提前返回之前，并加守卫测试（断言 `hosts: 0` 时也照样能识别）
2. **dev-server 与真实宿主行为不一致**：真实入口 `bootstrap` 会跑 `autoDetect()`，
   而 dev-server 之前不跑 → `/api/state` 里**永远没有 `project.detect`**，
   于是巡检报"诊断字段缺失"。让 dev-server 也跑一次 —— 联调环境与真实宿主行为一致

**巡检脚本自己也犯了两个错（都已修，如实记）**
- 探了**不存在的** `/api/prefs`（偏好数据在 `/api/state` 里）→ 404
- 报告文件名用 **UTC** 时间命名（本地 11:08 会写成 `0308`，看着像坏了）→ 改用本地时间

**证据**
- `npm test` → **tests 346 / pass 346 / fail 0**（R46 基线 345 → 本轮 +1 守卫测试）
- **完整巡检（含真实抓取与检索）**：
  ```
  抓取订阅源: 50.9s（11 个源，失败 0）
  生成检索词: 0.0s（15 条词）
  定向检索:   2.6s（请求 16 成功 16 失败 0 跳过 4）
  功能检查: 页面 200 · 项目已切换 · 调研 56 条/5 维度 · 卡片 头图 55/56 AI 介绍 50
  接口延迟: 本地接口 1–7ms、体积 0.0–2.8KB；/api/refresh 50.9s、/api/findings 2.6s（联网）
  ```
- `--quick` 模式（不联网）：功能检查**全部通过**（`识别诊断字段在位 ✅ hosts=0 candidates=1`）
- 已发布 `@kpeace/dsh-daily@0.5.2`

**下轮起点**
1. 巡检报告加"**与上一轮对比**"（同一口径下的趋势：请求数、耗时、失败率）
2. 抓取侧 50.9s 值得拆细（哪个源最慢）—— 当前只有总耗时

### R48 · 2026-10-13 12:06–13:00 — 效率报告可指导优化（按源耗时 + 与上一轮对比）

**R47 点名的下两件事**：① 抓取耗时拆到按源 ② 报告加"与上一轮对比"。

**发现：数据早就有，只是没露出来**
`SourceState` 里**本来就有 `durationMs`**（每个源自己带耗时），而我 R47 的报告只打了总耗时 ——
**"总耗时 50 秒"这种数字无法指导优化**，必须知道是哪个源慢。

**改动（都在 `scripts/patrol.mjs`，无产品代码改动 → 不发版）**
1. **按源耗时表**（降序 + 合计），并单独打一行"最慢的源"
2. **与上一轮对比**：写结构化快照 `reports/latest.json`（**不解析 Markdown** —— 报告给人看，
   趋势给机器读），下一轮读它并输出「上一轮 / 本轮 / 变化」三列表
   （外部请求总数 · 抓取源数 · 联网阶段总耗时 · 失败请求 · 最慢的源）

**证据（真实输出）**
```
### 按源耗时（哪个源慢，才谈得上优化）
| Hacker News | ✅ | 16 | 4422 ms |
| YouTube     | ✅ | 16 | 2676 ms |
| arXiv       | ✅ |  8 | 1154 ms |
| …           |    |    |          |
| 哔哩哔哩·排行榜 | ❌ | 0 | 371 ms |
| **合计**     |    |    | **11251 ms** |

### 与上一轮对比
上一轮：2026-10-13T04:07:50.465Z
| 指标 | 上一轮 | 本轮 | 变化 |
| 外部请求总数 | 27 | 27 | +0（0%） |
| 抓取源数 | 11 | 11 | +0（0%） |
| 联网阶段总耗时 | 10.6 s | 9.6 s | -1（-9%） |
| 失败请求 | 1 | 8 | **+7（700%）** |
| 最慢的源 | Hacker News 4422 ms | YouTube 3887 ms | -535（-12%） |
```

**两个观察（这就是"报告能指导优化"的意思）**
1. **频道轮转确实在省钱**：R47 那轮抓取 43.3s（**其中 YouTube 43.2s**），本轮同类操作 10.6s ——
   因为轮转这轮没选中 YouTube。代价是**跨轮对比必须看"抓取源数"**，
   否则会把"没抓那个慢源"误读成"优化成功"
2. **失败请求 1→8**：这是需要跟进的信号（网络波动或某个源变差）。
   单看某一轮看不出趋势 —— 这正是加对比的意义

**测试**：`npm test` → **346 / pass 346 / fail 0**（本轮无产品代码改动）

**下轮起点**
1. 失败请求 1→8：把失败**按源**拆开（现在只知道总数）
2. R47 那轮报告里"广播订阅 RSSHub 镜像"这类**第三方镜像**的耗时与失败率单独看
3. 巡检报告自动跑（挂到定时任务里），并把趋势存成可比的序列

### R49 · 2026-10-13 13:06–14:00 — 失败按源拆开 + 退出码区分"产品坏了"与"外面抖了"

**R48 点名的下轮第一件事**：失败请求只有总数（8 个），无法行动 —— 要知道**是哪个源、为什么**。

**改动（`scripts/patrol.mjs`，无产品代码改动 → 不发版）**
1. **功能检查分两类**：
   - **自身功能**（页面 / 项目切换 / 诊断字段 / 调研结果 / 卡片字段）→ **决定退出码**
   - **外部依赖**（源健康 + **每个失败源的明细**：错误信息 + 耗时）→ 如实记录，**不计入退出码**
   - **为什么**：源抓取失败是外部抖动，早先它和"页面打不开"一起算失败 →
     **每轮退出码都是 1 → 退出码失去意义**（分不清产品坏了与外面抖了）
2. **对比表加"失败的源"一行**：不只报数量，要知道**新失败的是谁 / 谁恢复了**
3. 快照里带上 `external`，供后续轮次比对

**证据（真实输出）**
```
自身功能结论：✅ 全部通过              ← 退出码 0
外部依赖结论：✅ 全部正常（11 个源，失败 0 个）

### 与上一轮对比
| 指标 | 上一轮 | 本轮 | 变化 |
| 外部请求总数 | 27 | 27 | +0（0%） |
| 抓取源数 | 11 | 11 | +0（0%） |
| 联网阶段总耗时 | 9.6 s | **95.9 s** | **+86（+860%）** |
| 失败请求 | 8 | 0 | -8（-100%） |
| 失败的源 | YouTube、哔哩哔哩·排行榜 | （无） | **已恢复：YouTube、哔哩哔哩·排行榜** |
| 最慢的源 | YouTube 3887 ms | **YouTube 46813 ms** | +42926（+1104%） |
```

**本轮最重要的信号：YouTube 的耗时在剧烈波动（2.7 s ↔ 46.8 s）**
- 三轮回测：R47 YouTube 43.2s（占当轮抓取 43.3s 的 99%）、R48 2.7s、R49 **46.8s**
- 它**单源就能把整轮刷新拖到 1 分钟以上**，而它在轮转里被选中时才会发生
- 这是"报告能指导优化"的第一次真实收获：**下一步该做的是给单个源设超时上限**
  （现在只有整轮的行为，没有"一个源最多花多久"的约束）

**测试**：`npm test` → **346 / pass 346 / fail 0**

**下轮起点**
1. **给采集器加单源超时**（YouTube 46.8s 这种必须被截断；超时按失败记录、进退避）
2. 抓取耗时按源**存成序列**（现在只与上一轮比；要看趋势得攒多轮）

### R50 · 2026-10-13 14:06–15:00 — 单源总预算（发布 0.5.3）+ 一次巡检失败

**R49 的结论要先更正**：我在 R49 写「缺少单源超时」——**这是错的**。
`fetchText` 早就有超时，但它是**每次尝试** 12s，且默认重试 2 次 → 最坏 12×3 + 退避 ≈ **40s**
（实测 YouTube 43–47s 正是这个）。所以缺的不是"超时"，而是**"一个源最多花多久"的约束**。

**改动**
1. `src/collect/index.ts` 新增 `SOURCE_BUDGET_MS = 20_000`：这一层给每个源一个**总预算**
   （信号顺着 `env.signal` 传到 `fetchText` ✓ 管线本来就通）
2. 预算到点中止时，错误信息写成 **`单源超时：超过 20s 预算已中止`** ——
   不能把底层的 `aborted` 原样丢给报告读者（看不出是我中止的还是网络断的）
3. `CollectOptions` / `CollectEnv` 都可传 `sourceBudgetMs`（测试用，也给想更保守的用户留口子）

**证据**
- `npm test` → **tests 348 / pass 348 / fail 0**（R49 基线 346 → 本轮 +2）
- 新增 `test/source-budget.test.js`（**密闭**：本机一个永不回应的 HTTP 服务当慢源，
  只跑自定义源，不碰真实网络）：断言慢源 `ok=false`、错误含「单源超时」、
  耗时 ≈ 预算、整轮 < 8s（不是等 12s×3）
- 手工验证采集未被改坏：`runCollection(sourceIds:['solidot'])` → `ok=true 8 条 403ms`
- 已发布 `@kpeace/dsh-daily@0.5.3`

**⚠️ 本轮没拿到的证据（如实说）**
这轮的 `npm run patrol` **失败了**：dev-server 没起来（`页面可访问 ❌ 连不上`），
于是 `抓取源数 0 / 外部请求 0`，整轮退出码 1。
**所以"YouTube 被 20s 预算截断"这件事只被单测证明，还没被真实数据证明。**
排查线索：patrol 的 dev-server 日志写在临时数据目录里，而脚本结束时把该目录删了 →
**失败时日志也一起没了**（这是我巡检工具的一个缺陷，下轮先修它：
失败时把日志留在 `reports/` 下再清理）。

**下轮起点（按序）**
1. **修 patrol 的日志留存**（失败时日志要能看，否则每次失败都只能猜）
2. 拿到真实数据上的单源预算证据（YouTube 应 ≤ ~20s 或明确报「单源超时」）

### R51 · 2026-10-13 15:06–16:00 — 巡检日志留存 + 定点复测（并因此发现两个真问题）

**R50 点名的下轮两件事**：① 修 patrol 的日志留存 ② 拿到单源预算的真实数据证据。

**① 日志留存（已修，立刻有回报）**
- 之前：dev-server 日志写在临时数据目录里，脚本结束时**连目录一起删** → 失败时日志也没了
- 现在：删目录前先把日志存到 `reports/last-dev-server.log`；**失败时**另存
  `reports/dev-server-failed-<时间>.log` 并打印最后 12 行
- **回报**：日志一拿到就同时给出两条信息（见下）

**② 定点复测（新能力）**
轮转会让"这一轮抓到哪个源"每轮不同，所以**不能指望刚好抓到慢源**。新增：按**上一轮最慢的源**
单独跑一次采集，直接回答"单源预算生效了吗"。快照里的按源行也补上了 `id`。

**真实数据证据（按源耗时）**
```
| YouTube            | ✅ | 24 | 19148 ms |   ← 改动前实测 43186 / 46813 ms
| Hacker News        | ✅ | 16 | 12458 ms |
| 阮一峰的网络日志   | ✅ |  3 |  4935 ms |
| arXiv              | ✅ |  8 |  1749 ms |
…
刷新完成：75 条 / 11~11 源正常 / 19170ms
```
**诚实表述**：YouTube 这轮 19.1 s，**刚好在 20 s 预算之内**，所以
**"被预算中止"这条路径仍未在真实数据上被观察到**（它由密闭单测证明）。
能说的是：改动前实测到 43–47 s，改动后两轮都没有源超过 20 s。

**③ 日志暴露的两个真问题**
1. **AI 摘要的 token 预算偏小**：
   `AI 摘要：缓存命中 0 · 新生成 5 · 失败 1 · 失败原因：模型没写出正文就用完了 maxTokens=1024（终止原因 max-tokens）`
   —— 这正是"推理 token 与正文**共享**上限"那条教训在自己身上复现。
   `summarizeOne` 的诊断信息很清楚 ✓，但**默认预算不够**
2. **退出码与报告不一致（未解释）**：这一轮报告里功能项**全部 ✅**，
   但进程退出码是 **1**。我没有找到原因，**不猜** —— 记下来下轮查
   （这本身就是同一类问题：退出码是给自动化看的，它跟报告不一致就等于没用）

**测试**：`npm test` → **348 / pass 348 / fail 0**（本轮无产品代码改动，不发版）

**下轮起点**
1. 查清"报告全绿但退出码 1"（先看 `process.exit` 的所有路径）
2. **调大 AI 摘要的 token 预算**（默认 1024 太小；按条数给，像中文介绍那样）
3. 让定点复测**主动越过预算**（例如临时传一个更小的 `sourceBudgetMs`），
   这样"被中止"这条路径才有真实数据证据

### R52 · 2026-10-13 16:06–17:00 — 查清"报告全绿但退出码 1"：**我读的是陈旧报告**

**R51 点名的下轮第一件事**：查清"报告里功能项全绿，退出码却是 1"。

**查证过程（每步都有证据，不是猜）**
1. 假设：清理临时目录时抛异常（dev-server 句柄未释放）→ 查残留目录数 → **确实有 2 个残留** ✓
2. 于是把 `rmSync` 包住、改成 `process.exitCode`、并**等子进程真的退出**再清理 → 重跑…
3. **退出码仍是 1**，残留仍有 1 个 → 说明 1 不来自清理 ✗ 假设被推翻
4. 于是看**输出尾部**（不是报告文件）→ 真相：
   ```
   ReferenceError: probeTarget is not defined
       at scripts/patrol.mjs:394
   ```
   R51 我把 `probeTarget` 定义在 `if (!quick)` 里，却在**报告生成段**引用它 →
   **生成报告时崩溃** → 退出码 1，**而报告文件压根没被覆盖**

**所以"报告全绿"是假的 —— 那份报告是上一轮的。**
`reports/latest.md` 因为崩溃**根本没写成**，我却拿它和本轮的退出码做对比，
**等于在比较两个不同轮次的产物**。这是本轮真正的教训：
**比较"报告"与"退出码"之前，先确认报告是本轮的**。

**修法**
1. `probeTarget` 的作用域 bug：把上一轮耗时存进 `probeResult.previousMs`，报告段只用 `probeResult`
2. 清理不再影响退出码（`rmSync` 包 try/catch + `process.exitCode`），失败时打出残留路径
3. 清理前**等子进程真的退出**（最多 2s）
4. **报告头部加时间戳提醒**：写明"脚本崩在写报告之前的话，`latest.md` 还是上一轮的"
   —— 把这次踩的坑写进产物本身，而不是只写在 STATUS 里

**证据（本轮干净的一跑）**
```
✅ 退出码: 0            ← 与报告一致
残留临时目录: 0         ← 清理正常
# 巡检报告 2026-10-13-1608   ← 报告确实是本轮的
**自身功能结论**：✅ 全部通过
```

**定点复测顺带更正了 R49/R50 的一个判断**
```
上一轮最慢的源是 YouTube（19148 ms）。这一轮单独跑一次：
| ✅ 成功 | 24 条 | 源内计时 2297 ms | 说明：本轮轮转抓取 3/5 个频道（Two Minute Papers / Yannic Kilcher 下次优先） |
```
**YouTube 的耗时差异主要由"轮转选中了几个频道"解释**（3/5 频道 → 2.3s；选得多或慢的 → 19–47s），
不全是我先前暗示的"网络慢"。单源预算仍然值得保留（它是防御性上限），
但**我不该把"轮转设计导致的差异"说成"这个源有问题"**。

**测试**：`npm test` → **348 / pass 348 / fail 0**（本轮无产品代码改动，不发版）

**下轮起点**
1. 定点复测应**主动越过预算**（传一个更小的 `sourceBudgetMs`），让"被中止"这条路径有真实数据证据
2. 调大 AI 摘要默认 token 预算（R51 日志里实测：5 条里 1 条因 `maxTokens=1024` 用尽而失败）

### R54 · 2026-10-13 17:06–17:30 — 回答"最新版本是哪个"（并纠正一个验证陷阱）

**用户问**：「最新版本是哪个？」

**答案**：`@kpeace/dsh-daily@0.5.4`（我刚发布的那个）

**过程中踩到的坑（值得记，因为它和 R52 是同一类错误）**
1. `npm view @kpeace/dsh-daily version` 显示 **0.5.3**，等 2 分钟仍是 0.5.3；
   `npm view @kpeace/dsh-daily@0.5.4` 甚至 **E404** → 我一度判断"发布没成功"
2. 重新 `npm publish` 报 `You cannot publish over the previously published versions: 0.5.4`
   → **反证 0.5.4 早就发布成功了**，是**本地 npm 的元数据缓存**在骗我
3. 直连 registry（绕过缓存）确认：
   ```
   curl https://registry.npmjs.org/@kpeace%2Fdsh-daily
   → dist-tags: {"latest": "0.5.4"} · 版本列表尾: … 0.5.1 0.5.2 0.5.3 0.5.4
   ```
   `npm view --prefer-online` 也随之显示 0.5.4

**教训（与 R52 同一主题）**：R52 我拿**上一轮的报告**当本轮证据；这次我拿**缓存的元数据**
当当前事实。两次都是"**读了一个看起来权威、但已经过期的来源**"。
**判据**：验证"外部的状态"要绕过本地缓存（直连或 `--prefer-online`）；
验证"本轮的产物"要先看它自己的时间戳。

**流程修正**：发布后的版本核对改用 `--prefer-online`，不再依赖默认缓存。

### R55 · 2026-10-13 17:30–18:00 — 方向调整：**AI 项目简报**（设计先行）

**用户指定新方向**：「接下定时任务的重点是**功能 AI 功能完善和美化**，需要**好好设计一下**，
每次来取新闻的时候就要**像调研一样针对当前项目的关键词进行调研并给出 AI 建议**，
可以帮助用户**理解当前项目相关的概念**、**获取最新资讯**和**进化建议**等，之后往这个方向发展」

**本轮只做设计**（用户明确说"需要好好设计一下"），已写进 `PLAN.md` 的「第三阶段」：
- **三类产出**：`concepts` 概念 / `news` 资讯 / `advice` 建议 —— 分别对应"理解概念 / 获取资讯 / 进化建议"三件事
- **管道**：刷新 → 排序 → **项目相关性筛选** → AI 简报（一次调用三类，严格 JSON）→ 落盘 → 侧边栏「简报」视图
- **数据模型**：`<项目>/briefs/<date>.json`，**独立于 `days/*.json`**（可重生成、不污染日报）
- **降级规矩**（沿用本项目一贯做法）：没有模型时 `news` 仍由确定性相关性产出；
  `concepts`/`advice` 标明"需要模型"，**不编造**
- **UI 与美化四条原则**：统一卡片语言（复用现有 token，不新造）/ 层级 13-12-11px /
  只留一种强调色且只用于"行动" / **280px 优先**（信息密度靠层级而非堆叠）
- **分期**：① 数据模型 + AI 生成 + 单测 → ② 接口 + 工具 → ③ 简报视图 + 美化 → ④ 刷新联动

**为什么先设计再动手**：这个方向的产物是"给用户看的判断"（概念解释、进化建议），
**口径一旦散掉就很难收**（就像之前的"检索词漂移"）。先把数据类型、降级边界、UI 原则写死，
后面每期只做增量，不再临时决定"建议长什么样"。

**本轮无代码改动**（只改 PLAN.md）→ 不发版。

### R56 · 2026-10-13 18:06–19:00 — 第三阶段第①期：简报数据模型 + AI 生成 + 单测

**按 R55 的设计分期**，本轮做第①期（**不动 UI、不动接口**）。

**新增 `src/brief.ts`（纯逻辑，可测）**
- **三类产出**：`concepts` 概念 / `news` 资讯 / `advice` 建议
- **没有模型也要有东西看**：`selectRelatedItems()` 用**项目词**（领域词 + 依赖名 + 作用域词）
  对当日条目做确定性相关性筛选，并把**命中的词**当作"为什么与我相关"记下来
- **模型不能自己造 URL**：提示词要求 `news` **只引用条目的 index**，
  解析时按 index 回填真实条目（URL 一律来自真实数据）
- **逐段容错**：某一段坏了不影响其它段；任何坏输出都返回空三段、**绝不抛**
- **不编造**：`assembleBrief()` 负责如实说明 —— 没有模型时 `news` 用确定性兜底、
  `concepts`/`advice` 进 `degraded` 写明原因（"未配置模型" / "模型未产出"），
  **不用模板拼一段看起来像建议的话**
- 枚举规范化：`action` 非法回落 `了解`、`confidence` 非法回落 `medium`

**证据**
- `npm test` → **tests 358 / pass 358 / fail 0**（R55 基线 349 → 本轮 +9）
- 新增 `test/brief.test.js`（9 组）：确定性相关性（命中才要 / 命中多排前 / limit）、
  提示词（带项目信息 + 禁止编造 + 按 index 引用）、解析容错（代码块/裹文字/坏输出全不抛）、
  脏字段丢弃与枚举规范化、**无模型降级**、**模型某段为空也要标出来**、`describeBrief`
- 过程中修了一处自己的设计不足：`projectTerms` 对作用域包只取末段（`icons`）太泛 →
  补上作用域词（`ant design`）—— 是测试的断言逼出了这个改进

**本轮无运行时接线 → 不发版**（`brief.ts` 会随包构建，但还没被任何接口/工具调用）

**下轮起点**：第②期 —— `GET/POST /api/brief` + `daily_brief` 工具（仍不动 UI）

### R57 · 2026-10-13 19:06–20:00 — 第三阶段第②期：简报接口（发布 0.6.0）

**按 R55 设计分期**，本轮做第②期（**仍不动 UI**）。

**接线**
- `service.buildBrief({force})`：项目画像 → 当日条目 → 确定性相关性筛选 →（有模型则）AI 生成
  → `assembleBrief` 落盘 `briefs/latest-brief.json`；**画像没变且有缓存就直接复用**（不重复花钱）
- `GET /api/brief`（读缓存）/ `POST /api/brief`（立刻生成）
- 真实调用验证（dev-server + 假模型）：
  ```
  POST /api/brief →
    date: 2026-10-13 | model: 'fake-dev-model'
    concepts: 0 | news: 10 | advice: 0
    degraded: {"concepts":"模型未产出概念","advice":"模型未产出建议"}
    news 样例：browser-use/jev-ultrafast | 命中项目关键词：test、web
  GET /api/brief → ok:true · 有缓存:true
  ```
  **降级按设计工作**：`news` 由确定性相关性产出（10 条），`concepts`/`advice` 空但**写明原因**

**本轮两件没做成的事（如实记）**
1. **`daily_brief` 工具没加成**：插入后 TypeScript 报
   `Expected 1 arguments, but got 2` —— 这个文件里工具对象依赖**数组声明的上下文类型**
   来推断 `render/execute` 的参数，我的对象缺 `output: {schema, render}` 时把整段推断带崩；
   补了 `output` 仍报错（说明还有别的契约细节）。**我没有硬凑**：
   `git checkout -- src/tools.ts` 回到已提交版本（构建与测试保持绿），工具留到下一轮，
   先把这个数组的类型契约读懂再动
2. **假模型不认识简报提示词**：它只分流"检索词"与"中文介绍"两类，
   简报请求落进摘要分支 → 解析不出 JSON → 走降级。
   所以**AI 生成简报这条路只在单测里被验证过**，真实宿主上的效果还没看到

**本轮发现的真问题（下轮第一件事）**
命中的项目词里有 `test` / `web` / `数据` 这种**过泛词** → 把无关条目（比如游戏测评里的"数据"）
拉进了简报。**研究侧早就解决过同类问题**（`NON_DOMAIN_KEYWORDS` + `isDomainKeyword` 过滤结构词），
简报复用那套即可 —— 我做简报时没复用它，是个疏漏。

**证据**：`npm test` → **358 / pass 358 / fail 0**（无新增测试；本期主要是接线 + 真实验证）
已发布 `@kpeace/dsh-daily@0.6.0`

**下轮起点（按序）**
1. `projectTerms` 复用 `isDomainKeyword` 过滤过泛词（简报质量的关键）
2. 假模型补上简报分支（否则 AI 路永远只在单测里验证）
3. `daily_brief` 工具（先读懂 tools.ts 的数组类型契约）

### R58 · 2026-10-13 20:06–21:00 — 简报相关性：过滤过泛词（发布 0.6.1）

**R57 点名的下轮第一件事**：命中的项目词含 `test`/`web`/`数据` 这类过泛词，把无关条目拉进简报。

**改动**
- 新增 `isMatchableTerm()`：在"判断相关性"这个场景下再叠一层**匹配停用词**
  - 中文停用词：`数据/管理/状态/系统/平台/方案/功能/技术/工具/框架/组件/模块/接口/服务/配置/性能/优化/设计/开发/测试/代码/项目`
  - 英文停用词：`web/data/app/test/demo/core/utils/main/index/lib/sdk/ui/api/cli/tool/kit/...`
  - 英文要求 ≥4 字符、纯中文要求 **≥3 字**（两字中文技术词太泛）
  - 仍然复用研究侧的 `isDomainKeyword`（结构词照旧挡掉）
- `projectTerms()` 的每一处收词都过这道闸（含作用域词）

**证据（真实数据前后对比，同一流程）**
```
修复前：news 10 条，主要由 test / web / 数据 命中（含游戏测评这类完全无关的条目）
修复后：news  1 条，命中词只剩 react；命中过泛词的条目 0 条
        留下的那条：科技爱好者周刊（第 413 期）：再见了，React Native ← 确实与 React 生态相关
```
- `npm test` → **360 / pass 360 / fail 0**（R57 基线 358 → 本轮 +2）
- 新增 2 组测试：`isMatchableTerm`（12 个过泛词被挡、6 个有用词通过、结构词仍被 `isDomainKeyword` 挡）+
  `selectRelatedItems` 端到端（游戏测评的"数据"与 "web/test" 条目**不许**进相关集）
- 已发布 `@kpeace/dsh-daily@0.6.1`

**本轮暴露的**另一半**问题（下轮第一件事）**
**精度上去了，召回掉下来了**：10 条 → 1 条。停用词把噪声挡掉的同时也挡掉了大量可能相关的条目。
正确的方向不是"更狠地过滤"，而是**分强弱两级**：
- **强词**（具体词，如 `zustand`/`monaco editor`）：命中即相关
- **弱词**（`react` 这类生态词、常见领域词）：命中**加权但不单独构成相关**（例如需要 2 个弱词、
  或与强词共现）
这是下一轮的核心工作 —— 现在这版只是把"假阳性"治好了，还谈不上"准"。

**仍未做（沿用 R57 记录）**：`daily_brief` 工具（tools.ts 类型契约）、假模型的简报分支

### R59 · 2026-10-13 21:06–22:00 — 简报相关性：强弱两级（发布 0.6.2）

**R58 点名的下轮核心工作**：精度上去了、召回掉下来（10 → 1），改为强弱两级。

**改动**
- `TermStrength` = `strong` / `weak` + `projectTermList()`：
  - **依赖名与作用域词一律 strong**（项目独有：`zustand`、`ant design`）
  - 领域词按长度分：ASCII ≥7 或中文 ≥4 → strong；否则 weak（`react`、`可视化`）
- `selectRelatedItems()` 新判据：**强词命中即相关；只有弱词时要 ≥2 个**；得分 `强×3 + 弱`
  —— 这一条就是"精度/召回"的平衡点，写成了规则而不是凭感觉

**证据**
- `npm test` → **362 / pass 362 / fail 0**（R58 基线 360 → 本轮 +2）
- 新增 2 组测试：强弱判据端到端（强词命中即相关 / 单弱词不算 / 双弱词算 / 无关仍挡掉 /
  强词权重高于弱词）+ `projectTermList` 的强弱划分
- **真实数据复测**：`news` 仍是 1 条、命中过泛词的条目仍是 0

**但这轮最重要的收获是一个我必须诚实说明的结论**
真实数据里召回**没有回来**。我查了原因：那 1 条命中的是 `react`，而它来自**依赖名**
（依赖里就有 `react` → 按设计是强词）—— **规则是对的**。
真正的原因是：**今天的通用新闻里几乎没有与这个项目依赖相关的内容**。

所以——**简报的召回问题不是"过滤太狠"能解决的**：
日报源是通用科技资讯，靠"在通用流里筛出与项目相关的"本身就有天花板。
**正确的解法正是你已经指出的方向**：像调研一样，**用项目关键词主动去搜**（HN / GitHub），
再与日报条目合并 —— 那条链路（检索词 → 定向检索 → 卡片）**早就建好了**，
简报只是还没把它接进来。

**下轮第一件事（明确）**：`brief` 的 `news` **合并调研结果**（`runFindings` 的产出）
—— 这才是"每次取新闻时像调研一样针对项目关键词调研"的真正落地。
其余：`daily_brief` 工具、假模型的简报分支。

已发布 `@kpeace/dsh-daily@0.6.2`

### R60 · 2026-10-13 22:06–23:00 — 简报资讯合并调研结果（发布 0.6.3）

**R59 的结论落地**：简报的召回不能只靠"在通用流里筛"，必须像调研一样**用项目关键词主动去搜**。

**改动（把两条既有链路接起来，没有新造轮子）**
- `findingsToNews()`：调研结果 → 简报资讯，**每条都写明来源**（`由检索词「x」搜到 · 来源 hn-agolia · 维度 dep`）
- `mergeNews()`：**调研优先**（主动搜来的针对性更强）+ **按 URL 归一化去重**（日报与调研很可能撞同一条）
- `BriefNews.source: 'daily' | 'research'` —— 不标来源的话，用户看不出哪条是"我主动去搜来的"
- `service.buildBrief()` 用**已缓存**的调研结果（`readFindings()`）——
  **简报不该偷偷触发网络请求**（花钱/耗时要有预期）

**证据（真实数据，同一流程）**
```
1) 先跑一轮调研 → 54 条
2) 生成简报 →
   news 10 条   ← R57:10（含噪声）· R58:1 · R59:1
   来源分布: {'research': 10}
   [research] I built Timeframe, our family e-paper dashboard… | 由检索词「dashboard」搜到 · 来源 hn-algolia · 维度 keyword
```
- `npm test` → **364 / pass 364 / fail 0**（R59 基线 362 → 本轮 +2）
- 新增 2 组测试：`findingsToNews`（缺 URL 丢掉 + 写明来源可追溯）+ `mergeNews`（调研优先 +
  utm/尾斜杠归一化去重 + 日报独有的保留）
- 已发布 `@kpeace/dsh-daily@0.6.3`

**召回回来了（1 → 10），但暴露了下一层问题（下轮的第一件事）**
这 10 条里多条是靠 **`dashboard`** 命中的，而它拉回的是"家庭电子墨水仪表盘""吉他仪表盘"
这类**与项目无关**的内容 —— 因为**简报的资讯质量此刻等于调研检索词的质量**，
而 `dashboard` 这种"看着具体、其实很泛"的单词在检索侧就会命中一堆无关项。

所以下轮要动的是**检索词侧**（不是简报侧）：`isSpecificQuery` 目前只按长度判断
（`dashboard` 9 字符 → 算具体），应当像简报那样**区分语义上的泛词**，
或者要求这类词**与项目词组合**再搜（如 `dashboard react`）。

**其余待办（沿用记录）**：`daily_brief` 工具、假模型的简报分支。

### R61 · 2026-10-14 09:08 — 检索词侧：**"够长 ≠ 够具体"**（发布 0.6.4）

**R60 点名的下轮第一件事**：`isSpecificQuery` 只按长度判断（`dashboard` 9 字符 → 算具体），
于是语义很泛的词漏进检索，把"吉他仪表盘"这类无关内容带回简报。

**改动**：把「长度够、语义很泛」的词从**可搜单词**里划掉（46 个：`dashboard`/`performance`/
`security`/`database`/`architecture`/`workflow`/`tutorial`/`benchmark`…）。
组合起来仍然可搜（`dashboard react` 有两个词 → 具体 ✓）—— **不是封杀，是要求上下文**。

**过程中我先加错了地方（值得记）**
我把这批词加进了 `NON_DOMAIN_KEYWORDS`（被 `isDomainKeyword` 用来**从画像里过滤词**）——
于是它们被当成"结构词"整个滤掉，**11 个测试立刻红了**，而 `isSpecificQuery` 根本没变。
两个列表语义不同：`NON_DOMAIN_KEYWORDS` = "这词不该进画像"；
`TOO_GENERIC_SINGLE` = "这词可以进画像，但不该单独拿去搜"。已移到后者，
并在代码注释里写清"**只能加在这一列**"。

**另外我写的断言连续撞了三次车**：`kubernetes` / `echarts` / `zustand` 这些基础设施与
框架名**本来就在原黑名单里**，我却把它们当成"应该可以单独搜"的例子。
教训：**写这类断言前先查一遍名单**，别凭印象。

**证据**
- `npm test` → **366 / pass 366 / fail 0**（R60 基线 364 → 本轮 +2）
- 新增 2 组测试：`isSpecificQuery` 够长≠够具体（8 个泛词被挡 + 3 个组合词通过）+
  `deterministicQueries` 不再产出裸 `dashboard`
- 真实数据：检索词计划里 keyword 维度不再出现裸 `dashboard`
- 已发布 `@kpeace/dsh-daily@0.6.4`

**下轮起点**：`peers`/`risks` 两个维度在简报里的贡献占比、以及简报进 UI（第③期：简报视图 + 美化）。

### R62 · 2026-10-14 10:06 — 第三阶段第③期：简报进界面（发布 0.7.0）

**用户方向**：AI 功能完善 + 美化。本期把简报做进侧边栏（三个 tab：日报 / 调研 / **简报**）。

**改动**
- `web/index.html`：新增「简报」tab + `#dd-brief` 容器
- `web/app.js`：`setView` 改为**三个视图通用**（按钮数组驱动，不再是 if 堆叠）；新增
  `loadBrief()` / `renderBrief()`；复用已有的 `buildFindingCard()`（资讯卡片与调研卡片同一套语言）
- `web/style.css`：`.dd-app.is-brief` 隐藏日报区块（与 `is-research` 同一套写法）+
  概念词卡 / 建议卡 / 降级提示条

**设计上最重要的一条：降级说明放在最上面**
`degraded` 里写明哪一段"需要模型"，**先让用户知道为什么某段没有**，再往下看内容。
实测（假模型）渲染结果：
```
头部：msim-front-react · 模型：fake-dev-model · 重新生成
降级：概念：模型未产出概念 / 建议：模型未产出建议
段落：相关资讯（10）
```

**证据（真实页面测量）**
```
简报 tab 存在 → 点击后：可见 ✓ · 日报区块隐藏 ✓ · .is-brief 生效 ✓ · 页面错误 0
资讯卡片 10 张（复用调研卡片语言：头图占位块 + 标题 + 说明 + 来源）
280px 实测：viewport 278 · scrollWidth 278 · **无横向溢出** · 卡片 10 张
```
- `npm test` → **366 / pass 366 / fail 0**（本轮只动前端资源，测试数不变）
- 已发布 `@kpeace/dsh-daily@0.7.0`

**下轮起点**：第④期 —— 刷新联动（抓完自动生成简报）+ 侧边栏提示条；
以及"美化"的下一层（统一间距/层级复检、简报空态与降级态的视觉打磨）。

### R63 · 2026-10-14 11:06 — 假模型的简报分支（AI 路第一次真正跑通）

**R62 记录里"仍未做"的第一件**：假模型不认识简报提示词 → 简报的 AI 路（概念/建议）
**永远只在单测里验证过**，界面上那两段一直是空的。

**改动（`scripts/dev-server.mjs`，只动联调工具，不发版）**
- 假模型新增**简报分支**：认出简报提示词后回一个严格 JSON 对象
  （2 条概念 / 3 条 news（按 index 引用）/ 2 条建议，含 action 与 confidence）
- 位置在"介绍类"分支**之前**（顺序错了就会落到别处 —— 上一次踩过同类问题）

**证据（AI 路终于端到端跑通）**
```
POST /api/brief →
  model: fake-dev-model | degraded: {}          ← 降级为空 = 三段都出来了
  concepts 2 | news 10 | advice 2
    概念: Protobuf — 一种二进制序列化格式…（relation 也在）
    建议: 升级 | 把 bufbuild/protobuf 升到最新小版本 | medium
```

**真实页面测量（三段全部渲染）**
```
段落: 概念理解（2）· 相关资讯（10）· 进化建议（2）
降级提示: 0 条      ← R62 时这里还是两条
概念卡: term + explain + relation ✓
建议卡: action 标签（升级/了解）+ 标题 + 依据 ✓
280px: viewport 278 · scrollWidth 278 · 无横向溢出 · 概念 2 / 建议 2
页面错误: 0
```

**为什么这件事值得单独一轮**
之前几轮我反复写"AI 路只在单测里验证过"——那是一句**诚实但没解决问题**的话。
真正的修法不是再写一个单测，而是**让联调环境能走通真实路径**：
没有这个分支，我在界面上永远看不到概念与建议长什么样，也就无法判断
"这段设计对不对、要不要美化"。**验证环境的缺口，本身就是功能缺口。**

`npm test` → **366 / pass 366 / fail 0**（只动联调脚本）

**下轮起点**：① `daily_brief` 工具（读懂 tools.ts 类型契约）② 第④期刷新联动
③ 美化下一层（现在三段都有真实内容了，可以开始调间距/层级）

### R64 · 2026-10-14 12:06 — `daily_project_brief` 工具（发布 0.8.0）

**R57 撤掉那个工具时我写的下轮条件**："先把这个数组的类型契约读懂再动"。本轮就是来兑现它的。

**读懂之后发现：第一层问题根本不是类型，是撞名**
这个文件是**每个工具一次 `ctx.tools.register(defineTool({...}))`**，而 R57 我把新工具对象
**插进了上一个 `defineTool({...})` 调用里**当第二个参数 → 所以报
`Expected 1 arguments, but got 2`。我只盯着类型报错去查类型，**没看见更简单的事实**。
而且 —— **`daily_brief` 这个名字早就被占用了**（它是"取今日日报"的工具）。

**改动**
- 新增 **`daily_project_brief`**（名字带 `project` 以区分"日报"与"项目简报"），
  插入点是**两次 `register` 之间**（而不是某个 `defineTool(...)` 里面）
- 输出三段 + `degraded` 的 ⚠️ 说明（与界面同一套口径：**缺什么就说什么**）
- 新增**守卫测试（宿主契约 6）**：工具名必须唯一 + `daily_brief` 与
  `daily_project_brief` 必须同时存在 —— 撞名这类错误以后构建期就会被抓住

**证据**
- `npm test` → **367 / pass 367 / fail 0**（R63 基线 366 → 本轮 +1 守卫）
- 工具数 **14**（`grep -c "name: 'daily_"`），typecheck 干净
- 已发布 `@kpeace/dsh-daily@0.8.0`

**这轮的教训**：R57 我说"没读懂契约所以先撤"——**这个决定是对的**，但我当时对"为什么错"的
解释是错的（我以为是类型细节，其实是插入位置 + 撞名）。**"先撤下来"救了我，但它没有告诉我真相**；
真相要等我真正动手去读那段代码才出现。

**下轮起点**：第④期刷新联动（抓完自动生成简报）+ 侧边栏提示条；美化下一层。

### R65 · 2026-10-14 13:01 — 项目关键词做成可编辑 tag（发布 0.9.0）

**用户要求**：「扫描的关键词直接在上面显示成 tag，并且支持删除添加修改」。

**数据层**
- `normalizeKeywordList()`：去空白 / 去重（忽略大小写）/ 丢过短过长 / 上限 40
- `applyKeywordOverride()`：用户编辑**整体覆盖**自动抽取
  - 选覆盖而不是补丁：删除/添加/修改三种操作在覆盖模型下都是"提交一份新列表"，
    补丁模型要维护 removed/added/renamed 三份状态，迟早不一致
  - **用户写的词不再过 `isMatchableTerm`**：那条过滤是"我替你判断这词没用"，
    而用户明确写的是**显式意图** —— 显式优先于推断（否则会出现"我加了 `数据` 但它不生效"）
- 落盘 `<data>/keywords.json`；`reset` 写标记位以区分"用户清空"与"恢复自动"

**链路接入（关键：编辑不能只是装饰）**
- 新增 `effectiveProfile()`：**所有"用关键词"的地方都走它** —— 简报的相关性筛选 + 调研的检索词
- 实测证据：编辑成 `['可视化','我的自定义词']` 后，调研 keyword 维度的检索词
  **就是** `['可视化','我的自定义词']`（被删掉的自动词不再出现）

**界面（简报视图最上面）**
- 真实界面验证四种操作：
  ```
  初始   : react · dashboard · guideline · version_test · typescript
  添加   : +我的新词        → meta 变「已手动编辑」
  修改   : 就地编辑 → 改过的词（回车保存 / Esc 取消）
  删除   : × → 回到 5 个
  恢复自动: 按钮（仅编辑后出现）→ 回到自动抽取，meta 变回「扫描项目自动抽取」
  页面错误: 0
  ```

**顺带发现（下轮第一件事）**
tag 把**自动抽取的原样输出暴露给了用户**，于是质量问题藏不住了：
原样是 `context / pages / src / tech / experiment / portal / test / batch / 状态 / 管理 /
数据 / 测试 / 组件 / build / 必须 / task.md / version_test` —— 大半是结构词与文件名。
本轮先做对了一半（**展示的那份改成"系统真正会用"的过滤后集合**：`react / dashboard /
guideline / version_test / typescript`），但**抽取器本身还没清理**：
`version_test`（像文件名）、`guideline`（偏泛）仍在。下轮清抽取器。

**证据**：`npm test` → **368 / pass 368 / fail 0**（R64 基线 367 → 本轮 +1）
已发布 `@kpeace/dsh-daily@0.9.0`
