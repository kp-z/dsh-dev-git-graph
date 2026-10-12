# dsh-daily 日报插件 · 开发计划（按小时）

> 起点：2026-10-12 00:45 (+08:00)｜第一波 6 小时：**H1 01:00 → H6 07:00**
> 节奏：每小时由自动化任务唤醒一次 Agent，完成当小时增量 → 自测 → 提交 → 更新 STATUS.md。
> 每个小时结束必须留下**可回退的 commit**与**可验证的证据**（命令 + 输出）。

## 0. 目标与验收（Definition of Done）

三条硬需求，缺一不算完成：

| 需求 | 验收方式 |
|---|---|
| (a) 每日主动推荐不同类型新闻 | 新会话里模型无需用户提问即能说出「今日日报」要点；`~/.dsh/daily/digest/<date>.md` 按主题分组存在 |
| (b) 可自定义调教 | 对模型说「以后每天多推 AI Agent 相关」→ 偏好落盘 → 次日/立即刷新后排序真的变了（附前后对比） |
| (c) 高价值索引（网页 + YouTube + 哔哩哔哩） | 索引里同时存在 `http(s)` 网页、YouTube 视频、B 站视频；每条带来源、时间、热度信号 |
| 展示：侧边栏网页、点击直跳 | DSH 右侧栏出现「日报」tab，页面为常驻网页；点条目在新标签/浏览器打开目标 URL |

## 1. 架构（一次定死，避免返工）

```
packages/dsh-daily/
├─ src/
│  ├─ index.ts          host 入口：装配 store/collect/rank/api/tools/schedule/prompt
│  ├─ config.ts         schemastery 配置（含默认值兜底）
│  ├─ store.ts          ~/.dsh/daily 下的 JSON 持久化（原子写 + 读写锁）
│  ├─ types.ts          Item / Prefs / Source 统一模型
│  ├─ collect/
│  │   ├─ index.ts      采集编排：并发、超时、单源失败隔离、降级标注
│  │   ├─ http.ts       带超时/UA/重试/退避的 fetch
│  │   ├─ rss.ts        零依赖 RSS2.0 + Atom 解析器
│  │   └─ sources/      hn.ts arxiv.ts bilibili.ts youtube.ts github.ts rsslist.ts(中媒) mirror.ts(RSSHub 镜像池)
│  ├─ rank.ts           评分：新鲜度 × 源权重 × 主题命中 × 热度信号 + 去重
│  ├─ tune.ts           自然语言调教 → 偏好变更（本地规则优先，可选 LLM）
│  ├─ digest.ts         日报 Markdown 生成 + 落盘
│  ├─ prompt.ts         systemPrompt 段落注入（主动推荐）
│  ├─ schedule.ts       每日定时（默认 08:00）+ 启动补生成
│  ├─ api.ts            /dsh-daily/api/* HTTP 接口
│  └─ tools.ts          defineTool 工具集
├─ web/                 侧边栏网页（自持 HTML/CSS/JS）
├─ src/client.js        右侧栏 tab 注册（betterSidebar.registerTab）
├─ test/                node --test 单测
├─ cordis.patch.yml
├─ README.md / README.zh.md
├─ PLAN.md / STATUS.md
```

**关键约束**：host 半体**零运行时依赖**；网页从 host 路由前缀直出，不走第二套渲染器；
重活（抓取/评分/存储）全在 host，浏览器只做展示与交互。

## 2. 逐小时计划

### H1（01:00–02:00）骨架贯通
- 脚手架 `packages/dsh-daily`；`cordis.patch.yml`；package.json 的 `dsh.bundle.patch`
- host：`webServer` 前缀路由 `/dsh-daily/`（静态）+ `/dsh-daily/api/state`
- client：`betterSidebar.registerTab({id:'daily'})` → iframe 载入 `/dsh-daily/`
- 单源端到端：arXiv + 少数派 RSS → 存盘 → 页面列出条目、点击可跳转
- **验收**：重启 DSH 后右侧栏出现「日报」tab，页面里是**真实条目**而非占位

### H2（02:00–03:00）多源采集层
- 零依赖 RSS/Atom 解析器（RSS2.0 / Atom / RDF 容错）
- 源适配器：HN(hnrss+Firebase)、arXiv、哔哩哔哩(popular/ranking/view)、
  YouTube(RSSHub 镜像池)、GitHub Search、IT之家/少数派/Solidot/阮一峰
- **RSSHub 镜像池**：健康检查 + 故障转移 + 结果缓存（实测仅 `rsshub.ktachibana.party` 可用）
- 统一 Item 模型 + 去重（URL 规范化 + 标题归一化 + 相似度）
- **验收**：一次 refresh ≥8 源、≥80 条；重复 URL 数为 0；单源失败不影响整体且被标注

### H3（03:00–04:00）高价值排序 + 自然语言调教
- 评分引擎：新鲜度半衰期衰减、源权重、主题/关键词命中、屏蔽词、热度信号归一
- 偏好档案 `prefs.json`：topics / keywordWeights / blocked / sourceWeights / dailyQuota
- `tune.ts`：自然语言 → 偏好变更（本地规则：主题词抽取、增删、权重调整；可选 LLM 兜底）
- 反馈学习：👍/👎/已读 → 权重调整并持久化
- **验收**：同批条目在「调教成 AI 优先」前后 Top10 显著变化，附前后对比证据

### H4（04:00–05:00）日报生成 + 主动推荐 + 定时
- `digest.ts`：按主题分组 Markdown（标题/来源/时间/一句话价值点/链接），落 `~/.dsh/daily/digest/`
- `prompt.ts`：紧凑摘要注入 systemPrompt（未读优先、Top N），使模型**主动**提起
- `schedule.ts`：每日定时（默认 08:00）+ 启动补生成 + 抓取完成后刷新注入
- `daily_brief` 工具
- **验收**：新会话问「今天有什么值得看的」模型直接给出来自日报的真实条目

### H5（05:00–06:00）侧边栏网页打磨
- 主题跟随（`?theme=` 首屏 + `postMessage` 热切，避免重载）
- 分类 chips / 搜索 / 未读已读 / 视频卡（封面·时长·作者·播放量）/ 👍👎 / 调教输入框 / 手动刷新
- 空态·加载态·错误态·响应式；键盘可达
- **验收**：明暗切换不重载；筛选/搜索/反馈即时生效并持久化

### H6（06:00–07:00）收口与验证
- 工具集完整：`daily_brief` / `daily_search` / `daily_tune` / `daily_sources` / `daily_feedback` / `daily_refresh`
- 单测：RSS/Atom 解析、去重、评分、调教解析、镜像池故障转移
- `pnpm typecheck` + `pnpm build` + `pnpm sync:web:check` 全绿
- 装入 desktop profile → 重启 → 端到端复验；README/CHANGELOG；本计划打勾
- **验收**：全链路在真实 GUI 里跑通，证据留档

### 第二波（H7+，07:00 起，按需排期）—— **已完成**
AI 摘要（可选）✅、OPML 导入导出 ✅、跨天去重（R6）与归档容量（R9/R11）✅、
周报 ✅、桌面通知 ✅、YouTube 频道轮转 ✅。
（发布 npm 未做：本机 `pnpm install` 受 peer 解析限制，暂时只走 profile 真实目录安装。）

## 2.5 第三波（H16+）：从「日报」变成「**调研插件**」

> 用户 2026-10-12 的新要求（原话）：
> 「之后，它需要变成一个调研插件：在 DSH 里面，你可以根据当前项目切换不同的目录，
>   只用 AI 搜索和当前项目有关的新闻和知识，来补充当前项目。」

### 2.5.1 目标与判断

日报是**通用**的（今天世界上发生了什么）；调研是**定向**的（这个项目缺的那块知识在哪）。
两者共用同一套采集/去重/排序/归档底座，差别在三处：

| 维度 | 日报（现状） | 调研（目标） |
|---|---|---|
| 关注什么 | 全局热点 + 用户声明的主题 | **当前项目目录**里的代码/文档所指向的技术与问题 |
| 谁决定查什么 | 内置源 + 主题关键词 | **AI 从项目上下文生成检索词**，再由人确认/调整 |
| 产出到哪 | 侧边栏列表 + 日报 md | 还要**回到项目里**（写 `docs/research/*.md`、注入 prompt，供后续开发参考） |

### 2.5.2 核心设计：项目 = 目录

- **一个「项目」就是一个工作目录**（这与 DSH 的 workspace 概念天然对齐）。
- 每个项目一套独立状态，按目录路径归一化后命名空间化：
  `~/.dsh/daily/projects/<slug>-<hash8>/`，内含自己的 `prefs.json` / `days/` / `digest/` / `feedback.json`。
  现有 `~/.dsh/daily/*` 视为「默认项目」，保持向后兼容。
- 「当前项目」来源（按优先级）：工具参数显式指定 → 会话的 workspace 目录 → 插件进程 cwd → 默认项目。
- 侧边栏顶部加**项目切换器**（显示当前项目名 + 最近目录列表），切换时整页数据随之切换。

### 2.5.3 分轮次落地（每轮一个可验证增量）

| 轮次 | 增量 | 验收方式 |
|---|---|---|
| R16+① | **项目模型**：按目录命名空间隔离 prefs/数据；`daily_project` 工具（列出/切换/查看当前）；侧边栏项目切换器 | 单测：两个目录互不串数据；真实 GUI 切换后列表变化；旧数据仍可读 |
| R16+② | **上下文抽取**：从项目目录读 README/package.json/关键源文件（限字节数、跳过 node_modules/.git），产出"项目画像"（语言、依赖、领域词） | 单测：对真实本仓库目录抽取；断言体积上限与敏感文件跳过 |
| R16+③ | **AI 生成检索词**：项目画像 → 检索词 + 主题（可注入假 stream 测试，沿用 R7 的做法） | 单测覆盖各种模型输出形态；真实调用留一次留档 |
| R16+④ | **定向检索**：把检索词投到已有源（HN/arXiv/GitHub/B站/YouTube）+ 关键词命中过滤；结果标注"为什么与项目有关" | 集成测试：给定画像 → 结果非空且相关性可解释 |
| R16+⑤ | **回流项目**：`daily_research` 工具产出 `docs/research/<date>-<topic>.md`（含引用链接与摘要），并把要点注入 systemPrompt 供后续开发参考 | 真实写盘 + 内容抽查；文件不进 git（由用户决定是否提交） |
| R16+⑥ | 侧边栏「项目/调研」视图：按项目分组、显示"未读的调研线索"、一键生成 | 浏览器端到端（含 280px） |

### 2.5.4 明确不做

- 不做代码索引/RAG 向量库：那是另一个产品；本项目只做"把与项目相关的外部信息**找回来并解释清楚**"。
- 不自动改用户代码、不自动提交：只产出 md 与提示，是否采纳由用户决定。

## 3. 风险与对策

| 风险 | 对策 |
|---|---|
| YouTube/Google News 直连不通（已实测） | RSSHub 镜像池 + 健康检查 + 故障转移；失败源在日报里显式标注 |
| 镜像池随时可能全挂 | 多镜像探测脚本 + 用户可配镜像；无镜像时该源降级而非整体失败 |
| B 站风控（`-352`/`-799`） | 退避重试 + 限速；只走无需签名接口（popular/ranking/view） |
| 侧边栏 tab 与 `dsh-better-sidebar` 版本耦合 | 契约缺失时静默降级（不影响插件加载），并在 README 标注依赖 |
| 新增文件不进 profile 硬链接副本 | 每次 build 后必跑 `pnpm sync:web`；`sync:web:check` 当门禁 |
| 长时间自治跑偏 | 每小时唤醒必须读 PLAN + STATUS，写明"本轮做什么/做完的验证证据" |

## 4. 每小时唤醒的固定动作

1. 读 `PLAN.md` + `STATUS.md`，确认当前小时与上轮遗留
2. 只做当小时增量（不越界重写他人产物）
3. 自测：`pnpm --filter dsh-daily typecheck` + 相关单测 + 关键路径手测
4. `pnpm build && pnpm sync:web`，重启验证（若涉及运行时）
5. `git add packages/dsh-daily docs/DAILY-PLUGIN-RECON.md` → commit（信息含 H 编号）
6. 更新 `STATUS.md`：本轮完成 / 证据 / 阻塞 / 下轮起点
7. 若阻塞 ≥3 轮同一原因 → 回报用户，不空转
