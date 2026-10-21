/**
 * world 域契约（11 条）。
 *
 * 世界内核：tick 顺序、确定性、暂停、写者纪律。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const WORLD_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "world.tick.order",
    version: 1,
    stability: "frozen",
    kind: "behavior",
    owner: "world",
    summary: "每 tick 固定**九段**：ingest → scheduler → movement → idle → interaction → comms → mailbox → recovery → emit；顺序是语义",
    verify: "test/sim.test.js",
  },
  {
    id: "world.step.pure",
    version: 1,
    stability: "frozen",
    kind: "behavior",
    owner: "world",
    summary: "`step(world, commands)` 不碰 IO、不吃 `dt`、就地改并返回同一引用",
    verify: "test/determinism.test.js",
  },
  {
    id: "world.determinism",
    version: 1,
    stability: "frozen",
    kind: "behavior",
    owner: "world",
    summary: "同 seed + 同命令序列 ⇒ 逐字节同世界；禁 `Date.now()` / `Math.random()`",
    verify: "test/determinism.test.js",
  },
  {
    id: "world.state.machine",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "world",
    summary: "角色 7 态；每个状态**只有一个主人**（谁负责离开它），不许布尔堆叠",
    verify: "test/sim.test.js",
  },
  {
    id: "world.pause",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "world",
    summary: "暂停只停推进，仍收命令；恢复后不补跑",
    verify: "test/sim.test.js",
  },
  {
    id: "world.speed",
    version: 1,
    stability: "experimental",
    kind: "behavior",
    owner: "world",
    summary: "倍速只改编排层节奏，不改模拟结果；**当前 runtime 未消费 `setSpeed`，属契约债**（实现前必须报错而不是静默）",
    verify: "planned:P0",
  },
  {
    id: "world.reset",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "world",
    summary: "重开一局 = 用内容重新装配 + `world.reset` 事件；旧世界先落盘；seq 水位线重置",
    verify: "test/sim.test.js",
  },
  {
    id: "world.write.discipline",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "world",
    summary: "非 `step` 写者（open/dispatch/syncSubagents/recovery）必须发\"客户端能重建\"的补偿事件",
    verify: "planned:P0",
  },
  {
    id: "world.time",
    version: 1,
    stability: "frozen",
    kind: "behavior",
    owner: "world",
    summary: "tick ↔ ms 只在编排层换算；世界文件里不写墙上时间",
    verify: "test/reconcile.test.js",
  },
  {
    id: "world.reaction.matrix",
    version: 1,
    stability: "experimental",
    kind: "behavior",
    owner: "world",
    summary: "行为反应的默认动作 / 超时 / 幂等 / 可解释（见 §五之二）",
    verify: "planned:P0",
  },
  {
    id: "world.readonly.projection",
    version: 1,
    stability: "frozen",
    kind: "behavior",
    owner: "world",
    summary: "世界是 DSH 团队的**只读投影**，不许反向改团队",
    verify: "test/client-plugin.test.js",
  },
]
