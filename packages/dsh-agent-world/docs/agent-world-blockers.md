# Agent World 阻塞与待验证项

更新时间：2026-10-27

## 已结案

- 11 个 desk anchor 落在不可走格 → 已用 `nearestWalkable` 修正，`office-layout.test.js` 锁定。
- `taskAccentOf is not defined` → 已改为 `statusColor()`，截图复核无报错。
- hire 只计数不落世界 → 已落世界并广播 `agent.hired`，新 agent 有贴图/动画。
- 占位精灵永不升级 → 无有效纹理即重建，新 hire 动画正常。
- 步行 0.06/tick 太慢 → 0.18，场景流程可在合理时间推进。

## 1. 官方 projection 成员重名

3082 当前官方 roster 返回 `captain / Ann / Ann`（meta 显示 3 人），两个 Ann 是不同成员但同名。
面板已以官方 projection 为唯一真相，不再混入 world.agents；同名展示是官方数据本身的问题。
下一步：由 game prompt 让 subagent 使用不同的游戏角色名，或在 projection 层做 displayName。

## 2. 多 agent 动作 / 椅子 / 空间交互未闭环

`actorTrace` 已能读：位置、物理速度、移动目标、深度、绑定椅子、动画、纹理。
3082 测试世界只有 captain；hire 现在会真正落世界并广播 `agent.hired`，可构造多 agent 世界。
下一步：让 3 个以上 agent 同时接任务，连续采 `actorTrace`，确认：
- 不在沿路径移动时状态仍为 idle；
- `seat` 非空且工作期间不变；
- 目标与速度不来回翻转。

## 3. 独立页会话写句柄

`/agent-world/` 独立页必须带 `?session=<id>`；若同一会话已在 GUI 打开，prompt 会报
`already owned by an active write handle`。正确用法是从会话内的 Agent World 面板对话。

## 4. 任务数量限制

`maxAgents` / `maxLiveSessions` 默认已改为 0 = 不限制；若 profile 显式配置正数仍会生效。

## 5. 慢速寻路被误认为漂移（2026-10-27 实测）

agent-5 接 task-4 后去 `station.seat-02`：world `position` 每 tick 前进 0.06 格，
对应屏幕约 `0.06 × 16px × 10Hz = 9.6px/s`。跨房间路径 500px 需要 ~50s，
期间 `actorTrace.seat` 必然为 null（还没到站），动画为 `walk-*`。
这不是漂移；要确认“到站坐椅子”必须等 `state` 变 `working` 后再采 `seat`。

## R450–R453：位置/遮挡/穿墙

已修：
- 工作吸附从“最近椅子”改为 `station.slots` 精确坐点（多座位按槽分配）。
- 家具 depth 从站点 anchor 改为精灵真实底边，与角色同一规则。
- 客户端只允许**首次生成**瞬移落位；后续跳变交给物理，避免 `body.reset` 绕过 collider。
- `aw-probe --check` 增加 `physicsAudit`（只对墙面美术求交）。
- `aw-lab` 增加 path blocked 格审计。

仍待观察：
- 客户端按服务端位置插值，绕过墙角时可能“视觉上切角”；需要客户端按 path waypoint 行走，而不是只追当前点。
