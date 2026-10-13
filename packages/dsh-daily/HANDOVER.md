# dsh-daily 交接与使用说明

> 当前版本 **0.5.1**（npm latest）· 单测 **345/345** · `npm run regression` **6/6**
> 逐轮证据（每轮的真实命令与输出）在 [STATUS.md](STATUS.md)。

## 一、它现在能做什么

| 能力 | 怎么用 |
|---|---|
| **日报**：多源采集 + 排序 + 推荐理由 | 侧边栏「日报」视图；可分类筛选 / 搜索 / 仅未读 / 👍👎 / 隐藏 |
| **调教**：一句话改偏好 | 直接在「调教推荐偏好」输入框写人话（"多推 AI、少推币圈"） |
| **项目跟随**：跟着当前会话/工作区自动切项目 | 自动，无需设置。界面只**显示**当前项目与来源（不提供手动选择） |
| **调研**：按当前项目去 HN/GitHub 定向检索 | 侧边栏「调研」视图 →「开始调研」；结果按**维度**分组 |
| **结果卡片**：头图 + 中文介绍 | 卡片带头图、来源、命中的检索词；介绍不是模型写的会标「机器汇总」 |
| **工具**：13 个 `daily_*` 工具 | 给 Agent 用（读日报 / 刷新 / 调教 / 调研 / 周报 / 订阅管理…） |
| **接口**：17 个 HTTP 分支 | 无需 token，例如 `GET /dsh-daily/api/state` |

## 二、安装

```bash
npm install @kpeace/dsh-daily        # 或 dsh plugin add @kpeace/dsh-daily
cd packages/dsh-daily && node scripts/install-to-profile.mjs desktop   # 本地源码安装
```

**装完必须重启 dsh**（原因见下）。装机脚本会：① 把包放进 `<profile>/node_modules/`
（**真实目录**，不是符号链接 —— 符号链接会让 `@deepseek-ai/*` 解析不到）
② 在 `cordis.patch.yml` 里加一段 `name: "@kpeace/dsh-daily"`（**必须带引号**，
否则 YAML 解析失败、dsh 起不来）。

## 三、为什么改完必须重启

DSH 宿主半体是 Node ESM 模块，**加载成功后会被缓存**。所以改 `src/` 后
`plugin_manager` 的 enable 开关不会重读盘；客户端半体（右侧栏 tab）本来就在启动时扫进模块图。

**不重启也能验证的三条路**（都用了很久了）：
1. `npm test` —— 345 组，含客户端/宿主静态契约
2. `npm run regression` —— 一条命令验完六个交付面（见下）
3. `node scripts/dev-server.mjs --port 8799 --data-dir=/tmp/x --no-refresh --ai-fake`
   —— 起一个独立的假宿主，页面在 `http://127.0.0.1:8799/dsh-daily/`

## 四、验证手段（各自守什么）

| 手段 | 守什么 |
|---|---|
| `npm test` | 逻辑 + **静态契约**：模块 id = 包名、`inject` 声明齐全、`apply` 包 try/catch、封面失败不许破图 |
| `npm run regression` | 构建 / 单测 / **真实 dev-server 冒烟** / **装机幂等（强制隔离 DSH_HOME）** / patch 引号契约 |
| `curl .../api/state` | 线上状态：`counts`、`sources`、**`project.detect`（识别为什么生没生效）** |
| dev-server 联调 | 页面的真实行为（筛选/搜索/弹层/窄屏/封面降级） |

## 五、已验证 / 未验证（如实）

**已在真实宿主验证过**
- **项目自动识别**：`10.21.103.15`（Linux headless）实测切到真实工作区，
  `source=auto`、`changed=true`；诊断显示来源是 `storages/workspace.json`（3 个候选）
- 装机幂等、patch 引号、模块 id 注入（都在 `npm run regression` 里）

**未在真实宿主验证过**
- **调研链路**（`POST /api/findings`）：那台上从未跑过（设计上要用户主动触发）；
  它在本地 dev-server + 真实网络上跑通过（56 条结果、5 个维度、50 条 AI 介绍）
- 侧边栏「调研」视图在真实 GUI 里的观感（只在 dev-server 的 280px iframe 里量过）

## 六、已知缺口（不粉饰）

1. **AI 中文介绍依赖模型**：有模型路由时才写，否则用"机器汇总"兜底（内容偏事实、缺解释）
2. **`ai` 检索维度**要有真模型才起作用（假模型给的是中文词，会被英文语料通道过滤掉）
3. 侧边栏头部在 280px 下 `scrollWidth` 仍略大于容器（被 `.dd-app { overflow-x: hidden }` 兜住，无可见横向滚动）
4. 本地 desktop profile 的 `cordis.patch.yml` 里有一条**悬空引用**
   （`# --- dsh-daily ---` 那段指向未安装的包，DSH 当作 pending）。
   要清掉就删那 4 行（第 275–278 行附近），删前建议先备份该文件。

## 七、这个项目反复踩到的一类坑：**不报错的失败**

以下七个都**不会报错**，只是静默地不工作 —— 每一个都是靠"真跑一遍"才发现的：

| # | 表现 | 真相 |
|---|---|---|
| 1 | 界面整页白 | 客户端模块 `id` ≠ 包名 → `loaded without registering` |
| 2 | 界面整页白 | `ctx.get('slots')` 未声明 → cordis 抛 → 条目 `failed` |
| 3 | 项目识别不动 | `ctx.get('sessions')` 未声明 → 抛 → 被兜底吞掉 → 候选恒为空 |
| 4 | 项目识别不动 | `Object.entries` **看不见**类实例的原型 getter → 探不到 `cwd` |
| 5 | 项目识别不动 | 内存会话存储**是空的**（headless 无人对话）→ 没有东西可取 |
| 6 | 卡片没有 AI 介绍 | 真实流事件类型是 `text-delta`，我写成 `text` → 永远收不到正文 |
| 7 | 回归冒烟总失败 | dev-server **静默忽略** `--port=N`，回落到默认端口 |

**所以这个项目的规矩**：① 每加一个工具，先问"它失败时我能不能看见原因"
② 假数据必须跟着**真实协议**走（假 stream 用 `text-delta`、假宿主守 cordis 规则）
③ 验证脚本要在**真实环境**里跑一遍，而不只是跑单测。
