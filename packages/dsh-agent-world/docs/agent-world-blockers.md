# Agent World 阻塞与待验证项

更新时间：2026-10-27

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
