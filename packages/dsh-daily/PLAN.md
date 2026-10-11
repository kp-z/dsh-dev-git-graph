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

### 第二波（H7+，07:00 起，按需排期）
AI 摘要（可选，借鉴 dsh-rss 的 maxTokens 经验）、OPML 导入导出、跨天去重与归档、
周报、桌面通知（可复用 dsh-notifier）、更多视频源与 UP 主/频道订阅、发布 npm。

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
