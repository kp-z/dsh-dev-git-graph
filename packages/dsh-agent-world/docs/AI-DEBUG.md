# AI 调试手册（Debug for humans & models）· R227

> 目标：拿到一句模糊反馈（"人怎么站到桌子上了？"），能在**一次查询**内定位到该看的字段，
> 而不是重新翻一遍 2600 行的渲染器。

---

## 一、入口

打开面板时带上 `?debug=1`（嵌入视图同样适用）：

```
http://127.0.0.1:3080/agent-world/?debug=1
http://127.0.0.1:3080/agent-world/?debug=1&walls=1   # 叠加几何视图
```

`walls=1` 会把三层直接画出来：**红色半透明格 = nav 说不能走；绿色描边 = 精细几何障碍
（物理真相）；蓝框 = 站点占地；青点 = 可站吸附点**。判断错位的唯一标准：
绿色框应该贴着看得见的墙/桌子，跑到地板上就是错位。也可运行时开关：
`__agentWorldPhaser.setWallsDebug(true)`。

它会把所有 `__agentWorld*` 门面挂到 `window` 上。**门面全空**（一个都没有）时先别查业务：
那是 ES 模块图断了，几乎总是 profile 缺新文件 → 跑 `node scripts/sync-profile.mjs`。

---

## 二、总入口：`__agentWorldDebug`

| 调用 | 返回什么 | 什么时候用 |
|---|---|---|
| `.help()` | **症状 → 探针**对照表（数据） | 拿到一句反馈，先查该跑哪条 |
| `.snapshot()` | 构建号、world（tick/agents/tasks）、scene（props/actors/space 审计）、runtime 诊断、连接状态、**已挂门面列表** | 先确认"世界在跑、场景有东西、门面在" |
| `.audit()` | `space` / `airWall` / `occlusion` / `overlay` 四份审计 | 任何"看起来不对"的第一站 |
| `.explain(id)` | 站点/角色的：占地格是否 blocked、`base`（深度基准）、哪些吸附点不可走 | "这个人/这个桌子位置怪" |
| `.ysort(on)` | 底边可视层开关（同 `?ysort=1`）；返回当前状态 | 判断谁该挡谁，配合 `audit().occlusion.pairAnomalies` |

一句 One-liner：

```js
> __agentWorldDebug.help()
> __agentWorldDebug.audit()
> __agentWorldDebug.explain('station.seat-02')
```

---

## 三、症状 → 探针（与 `help()` 同一份数据）

| 症状 | 探针 | 判据 |
|---|---|---|
| 角色能走上墙 / 上桌子 | `audit().airWall` | `artCells` = 按美术占位补的整格（画面上确实有家具）；`slotsBlocked` 必须为 0 |
| 遮挡关系不对 | `__agentWorldDebug.audit().occlusion` + `__agentWorldDebug.ysort(true)` | `anomalyCount` 与 `pairAnomalyCount` 都为 0；底边线（青=角色/橙=家具/绿=椅子）更靠下者应在前面 |
| 站点 / 角色位置怪 | `explain(id)` | `footprintBlocked` 是否符合预期；`slotsBlocked` 必须为空 |
| 场景比例一直跳 / 镜头不对 | `__agentWorldScene2d.camera()` + `viewState()` | `zoom` 是否整数档、`scroll` 是否稳定 |
| 世界不动 / 数据不更新 | `snapshot()` | `world.tick` 是否推进、`paused`、`diagnostics.errors` |
| 页面白屏 / 门面全空 | `snapshot().facades` | 长度为 0 → 模块图断，先同步 profile |
| 看板数据不对 | `__agentWorldBoard.stats()` | 与 `world.tasks` 对照（口径只有一处） |

---

## 四、空间模型：三份数据已合成一份

`SceneSpace`（`src/scene/space.ts`，随快照 `scene.space` 下发）：

```text
obstacles        物理真相：按美术 alpha 算的碰撞矩形（客户端 Arcade 用）
nav.blocked      路由网格：服务端 A* 用，保守，可以比视觉更严
entities[].base  深度基准（底边世界 z）+ slots（必须在 nav 可走格）
audit            自检读数（uncoveredCells 只报差异，不补格）
```

关键不变量（任何一条破了都算 bug）：

1. `audit.slotsBlocked === 0` —— 吸附点必须落在 nav 可走格；
2. `obstacles` 只来自精细几何（**不补整格**）；`uncoveredCells` 只是差异计数，
   出现它不代表要修，代表 nav 与美术本来就不完全一致（office 当前 55）；
3. 每个可渲染实体的 `depth` 必须能由它的底边 Y 解释（`occlusionAudit`）；
4. 覆盖层按 `OVERLAY_DEPTHS` 排序（`overlayAudit`）。

渲染器**不再自己 fetch `*-colliders.json`**；服务端把空间算好，客户端只执行。

---

## 五、AI 改代码时的检查清单

1. 新增会挡路的实体 → 确认它进了**精细几何**（美术 alpha / collider rects）；只写 nav 不够——物理真相是几何；
2. 新增站点 → 跑 `explain(id)`，确认 `slotsBlocked` 为空；
3. 改深度/排序 → 跑 `occlusionAudit()` + `overlayAudit()`，必须全 0 / ordered；
4. 改手动操控 → 必须走 `navBlockedAtPixel`（客户端）+ `moveAgent` 的服务端夹回，不能只加物理体；
5. 改完跑：`pnpm run build && pnpm test`（当前 **750+ / 750+**），再刷新真机看 `audit()`。

---

## 六、为什么不是"再加一个 debug 面板"

面板会被关掉、会被遮挡、截图也不可搜索。**门面是数据**：可以复制、可以断言、可以被 AI
一次调用拿走。UI 只在需要"看"的时候存在，定位靠门面。
