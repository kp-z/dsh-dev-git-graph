# 参考项目：`elit3-gg/openclaw-office`

用户指出（R59）："`elit3-gg/openclaw-office` 可以参考"。
本文是**读过代码之后**的结论，不是介绍。仓库 22MB，`src/` 32,302 行 TypeScript。

## 它是什么

> OpenClaw Office 是 [OpenClaw](https://github.com/openclaw/openclaw) 多智能体系统的可视化前端。
> **核心隐喻：Agent = 数字员工 | 办公室 = Agent 运行时 | 工位 = Session | 会议室 = 协作上下文**

产品命题和我们的**几乎一样**（把 AI 协作具象成办公室，点小人物对话、看他干活）。
所以值得读——但**值得学的地方和我们最初以为的不是同一处**。

## ⚠️ 渲染/美术：**不要学它**（它就是"自己造轮子"的典型）

| | openclaw-office | 我们 |
|---|---|---|
| 家具怎么来的 | **手画**：`office-2d/pixi/OfficeWorld.ts`（1,680 行）用 Pixi 绘图原语画；另有 `office-2d/furniture/` 六个 React SVG 组件（Desk/Chair/MeetingTable/Sofa/Plant/CoffeeCup） | **339 件真像素图**（内容库 `pack.model.microverse`） |
| 场景代码里的硬编码色值 | **154 个**（109 个 `0x` + 45 个 `#hex`） | **2 个** |
| 美术资产文件 | `public/` 下 **0 张 png** | 339 家具 + 8 角色 + 2 地图 |

它是**用代码把办公室画出来**的：`DESK_WOOD` / `CHAIR_BASE` / `SOFA_PRIMARY` / `FLOOR_MEETING`…
几十个常量，一张桌子是若干个矩形。**加一件家具就要改代码**，而我们加一件只要在内容库里加一行。
这正是 D53 那条判据说的情况："换个游戏项目也要重写一遍的东西，不该是我们的代码。"

**我们的方向（真实资产 + 内容库）在这块是对的，继续走。** 用户那句"少自己创建引擎"针对的是
**引擎**（改用 Phaser，D53），不是"回到手画美术"。

## ✅ 行为/氛围：**这里它领先我们，值得学**

### 1. 待机微行为（`lib/idle-behaviors.ts`，179 行）
角色坐在工位时**不是静止的**，会随机进出这些短状态（带平滑过渡）：
`seated` 呼吸 / `typing` 急促敲键盘 / `lookAround` 左右张望 / `stretch` 起身伸懒腰 /
`sip` 前倾喝咖啡 / `think` 后靠思考。
**我们现在的角色在工位上就是静止的**——这是"显得像活人"最便宜的一招。

### 2. 昼夜节奏（`lib/ambient-cycle.ts`，340 行）
**1 真实分钟 = 1 办公小时**（12 分钟走完 8:00–20:00）。日程：
上午最忙 → 午休人走光 → 下午平稳 → 傍晚陆续"下班"（逐个淡出）→ 夜里灯变暗、只剩一两个加班 →
非办公时段极暗、偶发活动。
**我们没有时间概念**（只有 tick）。
⚠️ **他们用了 `Date.now()`，我们的红线禁止**（`src/sim`/`domain`/`content` 不许）。
所以要采用的话必须**由 tick 推导**——好处是重放同一局会得到同样的"一天"。

### 3. 其它可借鉴的模块
| 文件 | 干什么 | 我们的对应 |
|---|---|---|
| `lib/position-allocator.ts`（213） | 栅格 + **运行时占用集** + 按 id 稳定哈希取位 | 我们的 `hangouts.ts`（静态避让）。**它的占用集是动态的**，能处理"位子被别人占了" |
| `lib/movement-animator.ts`（162） | 移动插值 | 我们的 `stepToward` |
| `lib/roaming-manager.ts`（191）+ `casual-roaming.ts`（163） | 闲逛 | **我们没有**（只有"走到落点站着"） |
| `lib/office-activities.ts`（868） | 活动目录（喝咖啡/去会议室/…） | **我们没有** |
| `lib/agent-dialogue.ts`（894） | 对话 | 我们的 `src/bridge/` + 对话 UI |

### 4. 一处技术选型值得注意
**它 2D 用的是 `pixi.js`（不是 Phaser）**，3D 用 `@react-three/fiber`。
我们是 Pixi → **Phaser**（D53）。两条路都成立：它的办公室是"代码画的"，Pixi 够用；
我们要放**大量真实精灵**，Phaser 的场景/动画/瓦片/输入更省事。
**不因为"别人用 Pixi"就回退**——判据仍是 D53 那条。

## 结论：学什么、不学什么

**不学**：渲染与家具（手画 + 154 个硬编码色值）。
**学**：`idle-behaviors`（待机微行为）、`ambient-cycle`（昼夜节奏，改成 tick 驱动）、
`roaming-manager` + `office-activities`（闲逛与活动）、`position-allocator` 的**动态占用集**思路。

已记为 BACKLOG：**M14-1**（待机微行为）、**M14-2**（tick 驱动的昼夜节奏）、**M14-3**（闲逛）、
**M14-4**（站位动态占用）。
