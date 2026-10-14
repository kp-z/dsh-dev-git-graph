# dsh-agent-world

> 把多智能体协作搬进一座**可视化 3D 小镇**：每个真实 subagent 是一个会走动的角色，
> 每件任务是一张可被拾取的工单，每次调度是一次空间上的移动与协作。

底座沿用 [`@nanmicoder/dsh-agent-teams`](https://github.com/NanmiCoder/dsh-agent-teams) 的语义
（lead 领队 + durable members + 依赖感知任务 + 邮箱 + 调度器），
但**呈现层从 React 面板换成 three.js 的 3D 场景**。

**状态：R2（骨架 + 内容库层）。** 模拟循环、HTTP/SSE、3D 场景都还没写——
完整队列见 [`docs/BACKLOG.md`](docs/BACKLOG.md)，进度台账见 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

设计上它**按游戏的结构组织**：代码是机制，内容是数据。模型库、动作库、任务库、场景库等
**十个内容库**各管一件事，用稳定 id 互相引用，可整包替换 / 升级 / 切换，代码一行不动。
详见 [`docs/CONTENT.md`](docs/CONTENT.md)。

---

## 现在能干什么

装到 profile 后，模型可以调用两个工具：

| 工具 | 副作用 | 说明 |
|---|---|---|
| `agent_world_open` | **会丢弃当前世界并重建**（当前只在内存） | 按内容包建一座小镇：4 地块 / 10 站点 / 8 角色 |
| `agent_world_status` | 无（只读） | 世界摘要 + 花名册 + 工单板 + **内容来源** |

「花名册」长这样：

```
· 工头阿金（lead）待命 @ 广场 · 手头：—
· 小蓝（工程师）待命 @ 广场 · 手头：—
```

3D 场景还没接上，所以现在看不到小镇——见下方路线图。

## 设计（先读这个再读代码）

* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) —— **架构定稿**。
  技术选型（为什么是 three.js 不是 Godot）、三层架构、世界模型、模拟循环的确定性要求、
  渲染层分层与性能预算、同步协议、与真实 subagent 的桥、里程碑、决策记录。
* [`docs/CONTENT.md`](docs/CONTENT.md) —— **内容库规范**。十个库各装什么、条目长什么样、
  内容包怎么写、三种操作（新增 / 替换 / 切换）、校验规则、一个完整的资产替换示例、常见错误对照表。
* [`docs/ASSETS.md`](docs/ASSETS.md) —— **资产、库与美术方向**（一手来源核验，2026-10-14）。
  推荐的 CC0 资产包、角色动画三方案对比、three.js 生态库版本与许可、许可红线、
  `VENDOR.md` 台账模板、相机/光照/调色板配方与性能预算。
* [`docs/BACKLOG.md`](docs/BACKLOG.md) —— 轮次任务队列（每小时的自动化轮次从这里取活）。
* [`docs/PROGRESS.md`](docs/PROGRESS.md) —— 轮次台账（每轮必须更新）。

四条不能违背的原则：

1. **server-authoritative** —— 模拟跑在 host，渲染层只画状态、只发意图。面板关掉世界照跑。
2. **代码是机制，内容是数据** —— 凡可替换的东西一律进内容库；代码里**禁止**字面量的资产名、
   剪辑名、任务文案、配色值。判据：问自己"这东西会不会有人想换掉"。
   覆盖别人的条目必须**显式**声明 `overrides`，否则报错且原条目不变。
3. **`tick` 是纯函数 + seeded PRNG** —— 确定性 ⇒ 可回放 bug、可无 mock 测试。
   模拟层**禁止** `Math.random()` 与 `Date.now()`。
4. **capability 落位** —— 任务只声明"需要什么能力"（`code` / `review` / `compute`…），
   不硬绑工位 ⇒ 小镇布局与任务编排解耦。

分层依赖**单向向上**，不许出现环：

```
domain/（世界模型，不认识内容） ← content/（内容库与注册表） ← world/（装配：createWorld）
```

## 路线图

| 阶段 | 内容 |
|---|---|
| **M0** ✅ | 骨架 + 世界模型类型 + 工具 + 测试 |
| **M1** ✅ | **内容库层**：十个库的类型与校验、注册表（提供方链 / 显式覆盖）、内置内容包 |
| **M1.5** | 外部内容包 ✅（`contentDir` 指过去即生效）；剩下 `agent_world_content` 诊断工具 |
| M2 | 模拟内核：`step()` 纯函数 tick、依赖求值、调度器、移动、邮箱、确定性验收 |
| M3 | 落盘（`world.json`）+ HTTP 快照 + SSE 事件流（带 `seq` gap 自愈） |
| M4 | three.js 场景：小镇、站点、相机、光照（消费 `themes`/`skins`/`districts`/`stations` 库） |
| M5 | 角色、网格寻路、动画状态机（消费 `models`/`actions` 库；换 Kenney CC0 资产作验收） |
| M6 | HUD：任务板 / 花名册 / 时间线 / 控制条 |
| M7 | Bridge：接真实 subagent |
| M8 | 打磨：美术 / 音效 / 后处理 / 性能降级 / 第二个主题包 |
| M9 | 打包 / 文档 / 发布 |

## 开发

```bash
cd packages/dsh-agent-world

# 本包**独立安装**，不走根 workspace。
# 原因：根 `pnpm install` 被 packages/dsh-daily 的过期 RC 版本钉死（与本包无关），
# 详见 docs/PROGRESS.md 的 R1「卡住」一节。
pnpm install --ignore-workspace --lockfile=false

# 所有 pnpm run 都要带这个环境变量，否则 run 前的依赖校验会去跑根 install 并失败。
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run build
```

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `worldName` | `Agent World` | 默认世界名（也是 seed 来源：同名同场景 ⇒ 同一座小镇） |
| `scene` | `scene.default-town` | 默认用哪个场景（`scenes` 库的 id）。**换它 = 换一座小镇，代码不动** |
| `contentDir` | 空 | 外部内容包目录。留空 = 只用内置内容；绝对路径原样用；相对路径按宿主工作目录解析。实际路径会打进日志 |
| `allowImplicitOverride` | `false` | 是否允许外部包隐式覆盖同 id 条目。默认关——"覆盖必须显式"是护栏 |
| `tickMs` | `100` | 逻辑 tick 间隔。渲染层做插值，所以 10Hz 足够 |
| `autoStart` | `true` | 插件加载后是否自动推进模拟 |
| `maxAgents` | `24` | 同屏角色上限（性能预算的一部分） |
| `stateDir` | `.agent-world` | 世界状态落盘目录（`<workspace>/<stateDir>/`）。M3 开始使用 |
| `routePrefix` | `/agent-world` | 面板与 API 的路由前缀。M3 开始使用 |

## 目录

```
src/content/  内容库层：kinds（十个库的类型）/ validate / registry / instantiate / packs（内置包）
src/domain/   世界模型（纯逻辑：类型 / 数值调参 / rng / geometry / summary）——不认识"内容"
src/world/    装配：createWorld（内容 → World）+ 后续的 sim/
src/sim/      模拟内核（M2，还没写）
src/tools/    agent_world_* 工具
src/config.ts 配置 + resolveConfig 兜底
src/state.ts  插件态（内容注册表 + 当前世界）
web/          3D 面板（M4，还没写）—— Vite + three.js，独立构建，产物进 lib/web/
docs/         ARCHITECTURE / CONTENT / ASSETS / BACKLOG / PROGRESS
test/         node --test
```

## 许可

MIT。所有第三方美术资产只用 CC0/public domain，并逐个登记在
`web/public/assets/VENDOR.md`（来源 URL + 许可 + sha256），许可原文一并入库。
运行期**不依赖任何 CDN**。
