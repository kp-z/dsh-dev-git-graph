# dsh-agent-world

> 把多智能体协作搬进一座**可视化 3D 小镇**：每个真实 subagent 是一个会走动的角色，
> 每件任务是一张可被拾取的工单，每次调度是一次空间上的移动与协作。

底座沿用 [`@nanmicoder/dsh-agent-teams`](https://github.com/NanmiCoder/dsh-agent-teams) 的语义
（lead 领队 + durable members + 依赖感知任务 + 邮箱 + 调度器），
但**呈现层从 React 面板换成 three.js 的 3D 场景**。

**状态：R1（脚手架 + 世界模型）。** 模拟循环、HTTP/SSE、3D 场景都还没写——
完整队列见 [`docs/BACKLOG.md`](docs/BACKLOG.md)，进度台账见 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

---

## 现在能干什么

装到 profile 后，模型可以调用两个工具：

| 工具 | 副作用 | 说明 |
|---|---|---|
| `agent_world_open` | **会丢弃当前世界并重建**（当前只在内存） | 建一座默认小镇：4 地段 / 10 站点 / 8 角色 |
| `agent_world_status` | 无（只读） | 世界摘要 + 花名册 + 工单板 |

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
* [`docs/ASSETS.md`](docs/ASSETS.md) —— **资产、库与美术方向**（一手来源核验，2026-10-14）。
  推荐的 CC0 资产包、角色动画三方案对比、three.js 生态库版本与许可、许可红线、
  `VENDOR.md` 台账模板、相机/光照/调色板配方与性能预算。
* [`docs/BACKLOG.md`](docs/BACKLOG.md) —— 轮次任务队列（每小时的自动化轮次从这里取活）。
* [`docs/PROGRESS.md`](docs/PROGRESS.md) —— 轮次台账（每轮必须更新）。

三条不能违背的原则：

1. **server-authoritative** —— 模拟跑在 host，渲染层只画状态、只发意图。面板关掉世界照跑。
2. **`tick` 是纯函数 + seeded PRNG** —— 确定性 ⇒ 可回放 bug、可无 mock 测试。
   模拟层**禁止** `Math.random()` 与 `Date.now()`。
3. **capability 落位** —— 任务只声明"需要什么能力"（`code` / `review` / `compute`…），
   不硬绑工位 ⇒ 小镇布局与任务编排解耦。

## 路线图

| 阶段 | 内容 |
|---|---|
| **M0** ✅ | 骨架 + 世界模型类型 + 工具 + 测试 |
| M1 | 模拟内核：`step()` 纯函数 tick、依赖求值、调度器、移动、邮箱、确定性验收 |
| M2 | 落盘（`world.json`）+ HTTP 快照 + SSE 事件流（带 `seq` gap 自愈） |
| M3 | three.js 场景：小镇、站点、相机、光照 |
| M4 | 角色、网格寻路、动画状态机 |
| M5 | HUD：任务板 / 花名册 / 时间线 / 控制条 |
| M6 | Bridge：接真实 subagent |
| M7 | 打磨（美术 / 音效 / 后处理 / 性能降级）与发布 |

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
| `stateDir` | `.agent-world` | 世界状态落盘目录（`<workspace>/<stateDir>/`）。M2 开始使用 |
| `tickMs` | `100` | 逻辑 tick 间隔。渲染层做插值，所以 10Hz 足够 |
| `autoStart` | `true` | 插件加载后是否自动推进模拟 |
| `maxAgents` | `24` | 同屏角色上限（性能预算的一部分） |
| `worldName` | `Agent World` | 默认世界名（也是 seed 来源：同名 ⇒ 同一座小镇） |
| `routePrefix` | `/agent-world` | 面板与 API 的路由前缀。M2 开始使用 |

## 目录

```
src/domain/   世界模型（纯逻辑：类型 / 常量 / rng / createWorld / geometry / summary）
src/sim/      模拟内核（M1，还没写）
src/tools/    agent_world_* 工具
src/config.ts 配置 + resolveConfig 兜底
src/state.ts  插件态
web/          3D 面板（M3，还没写）—— Vite + three.js，独立构建，产物进 lib/web/
docs/         ARCHITECTURE / ASSETS / BACKLOG / PROGRESS
test/         node --test
```

## 许可

MIT。所有第三方美术资产只用 CC0/public domain，并逐个登记在
`web/public/assets/VENDOR.md`（来源 URL + 许可 + sha256），许可原文一并入库。
运行期**不依赖任何 CDN**。
