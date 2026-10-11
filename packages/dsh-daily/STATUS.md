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
