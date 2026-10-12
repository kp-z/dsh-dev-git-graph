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
