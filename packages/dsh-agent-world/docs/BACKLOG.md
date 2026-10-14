# dsh-agent-world —— 轮次任务队列（BACKLOG）

> **每小时的自动化轮次从这里取任务。**
> 规则：
> 1. 只取**最上面**的 `ready` 任务；一次轮次取 1–2 个，做完为止，不要贪。
> 2. 有依赖（`blocked by`）的任务不许提前做，把依赖做完再动。
> 3. 做完把任务移到 `docs/PROGRESS.md`，并把状态写清（完成 / 部分完成 / 卡住 + 卡在哪）。
> 4. 每轮**必须**留下可验证的产出：要么代码 + 测试，要么文档 + 决策记录。**不接受"只讨论不落地"**。
> 5. 缺信息不要停下来等人：按最合理的假设推进，把假设写进 PROGRESS 的「假设」一栏。

状态图例：`ready` 可开工 · `blocked` 等依赖 · `done` 已完成

---

## M0 — 骨架

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M0-1 | done | 包骨架 + 分支隔离 + 架构文档 | `package.json` `tsconfig.json` `cordis.patch.yml` `docs/ARCHITECTURE.md` | — |
| M0-2 | done | `src/` 最小可编译闭环：config schema + 入口 + 1 个只读工具 | `src/index.ts` `src/config.ts` `src/tools/status.ts`；`pnpm typecheck` 绿 | M0-1 |
| M0-3 | done | `test/` 跑起来：`node --test` + 一个冒烟测试 | `test/smoke.test.js`；`pnpm test` 绿 | M0-2 |

## M1 — 世界模型与模拟内核（**本项目的技术核心**）

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M1-1 | done | 定义世界模型类型：World/District/Station/Agent/Task/Message/WorldEvent + 状态机常量 | `src/domain/types.ts` `src/domain/constants.ts` | M0-1 |
| M1-2 | done | 纯函数世界构造：`createWorld(seed, opts)`，含默认小镇布局（4 地段 / ~10 站点） | `src/domain/create.ts` + 测试 | M1-1 |
| M1-3 | done | seeded PRNG + 确定性工具 | `src/domain/rng.ts` + 测试（同 seed 同序列） | M1-1 |
| M1-4 | ready | `step(world, dt, commands)` 纯函数 + 固定 tick 顺序（ingest→scheduler→movement→interaction→mailbox→emit） | `src/sim/step.ts` | M1-2 M1-3 |
| M1-5 | ready | 依赖求值：`blockedBy` 全 done ⇒ `pending→ready`（唯一实现点） | `src/sim/ready.ts` + 测试 | M1-1 |
| M1-6 | ready | 调度器：idle agent 原子 claim 一个 ready task，按 capability 选站 | `src/sim/scheduler.ts` + 测试 | M1-4 M1-5 |
| M1-7 | ready | 移动：agent 沿路径走向站点，到站切换 working | `src/sim/movement.ts` + 测试 | M1-4 |
| M1-8 | ready | 邮箱：消息投递 + 事件产出 | `src/sim/mailbox.ts` + 测试 | M1-4 |
| M1-9 | ready | **确定性验收测试**：同 seed 跑 1000 tick，两次结果逐字节一致 | `test/determinism.test.js` | M1-4 |

## M2 — 落盘与 HTTP/SSE

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M2-1 | blocked | 磁盘真相：`world.json` + 事件追加 `events.jsonl`，原子写 | `src/store/worldStore.ts` | M1-1 |
| M2-2 | blocked | 世界运行时：tick 循环 + 订阅广播 + pause/resume | `src/runtime.ts` | M1-4 M2-1 |
| M2-3 | blocked | HTTP：`GET /api/world` 快照 + `POST /api/command` | `src/routes/api.ts` | M2-2 |
| M2-4 | blocked | SSE：`GET /api/events`，带单调 `seq`，客户端 gap 自愈 | `src/routes/events.ts` | M2-2 |
| M2-5 | blocked | 面板静态服务 `/agent-world/*`（含 MIME 白名单 + 路径穿越防护） | `src/panel.ts` | M2-2 |

## M3 — 3D 场景（three.js）

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M3-1 | blocked | `web/` Vite + three.js 脚手架，能渲染一个空场景 | `web/` + `pnpm --filter dsh-agent-world build:web` | M0-1 |
| M3-2 | blocked | 相机：斜俯视 isometric + orbit/缩放/平移 | `web/src/scene/camera.ts` | M3-1 |
| M3-3 | blocked | 光照与配色：1 方向光 + 半球光 + 雾；落地 §5.4 的美术方向 | `web/src/scene/lighting.ts` `palette.ts` | M3-1 |
| M3-4 | blocked | 小镇布局渲染：地段地面 + 站点几何（先用程序化几何体，不依赖外部模型） | `web/src/scene/town.ts` | M3-3 |
| M3-5 | blocked | 资源管线 + `VENDOR.md` 登记规范 | `web/public/assets/VENDOR.md` | M3-1 |

## M4 — 角色与动画

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M4-1 | blocked | 角色实体：程序化低模角色（胶囊/方块人），带配色 | `web/src/actors/avatar.ts` | M3-4 |
| M4-2 | blocked | 网格寻路 A*（小镇网格由站点布局生成） | `web/src/actors/navmesh.ts` + 测试 | M3-4 |
| M4-3 | blocked | 动画状态机：idle/walk/work/talk/celebrate 的纯程序化动画 | `web/src/actors/animator.ts` | M4-1 |
| M4-4 | blocked | 每帧同步：`model/` 的插值状态 → 场景对象 | `web/src/model/worldModel.ts` | M4-1 M2-4 |

## M5 — HUD

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M5-1 | blocked | 任务板：工单列表 + 状态色 + 依赖连线 | `web/src/ui/taskBoard.ts` | M2-4 |
| M5-2 | blocked | 花名册：谁在哪、在干什么、用什么模型 | `web/src/ui/roster.ts` | M2-4 |
| M5-3 | blocked | 事件时间线 | `web/src/ui/timeline.ts` | M2-4 |
| M5-4 | blocked | 控制条：pause/resume/reset/speed | `web/src/ui/controls.ts` | M2-3 |

## M6 — 接真实 subagent

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M6-1 | blocked | Bridge：单一映射表落地（§8） | `src/bridge/mapping.ts` `src/bridge/observe.ts` | M2-2 |
| M6-2 | blocked | `agent_world_hire` / `agent_world_report` 工具 | `src/tools/*.ts` | M6-1 |
| M6-3 | blocked | 端到端：真派一个成员 → 场景里出现角色并干活 | 演示脚本 | M6-2 M4-4 |

## M7 — 打磨与发布

| # | 状态 | 任务 | 产出 | 依赖 |
|---|---|---|---|---|
| M7-1 | blocked | 性能降级四级（§5.3） | `web/src/scene/perf.ts` | M4-4 |
| M7-2 | blocked | 音效（CC0）+ bloom 后处理（可选开） | `web/` | M7-1 |
| M7-3 | blocked | 真实免费资产替换程序化几何 | `web/public/assets/` + VENDOR.md | M3-5 |
| M7-4 | blocked | README / 安装脚本 / 发布到 profile | `README.md` `scripts/` | M6-3 |

---

## 待决问题（轮到再说，不要现在卡住）

1. 面板入口放哪：右侧栏常驻（`betterSidebar`）还是新开一个 view tab？（M5 决定）
2. 一个 workspace 是否允许多个世界并存？（当前假设：一个 workspace 一个活跃世界 + 历史归档）
3. 角色数上限是多少才既好看又不掉帧？（M4 实测后定，当前假设 24）
4. 是否要音效？（默认做，但可关）
