# 舞台渲染与空气墙 · 优化计划（R228 设计稿）

> 用户口径（2026-10-20）："优化舞台渲染里的**所有元素**和**空气墙**，给我一个优化计划，
> 利用现在的最佳时间来进行设计。"
>
> 时机说明：R227 刚把「nav / 碰撞体 / 深度」收拢成一份 `SceneSpace`。
> **这是做深度优化的最佳窗口**——再晚一点，任何新增实体都会重新长回三套数据。

---

## 零、目标（可判定，不靠感觉）

| 目标 | 判据 | 现状 |
|---|---|---|
| **走不进去** | `space.audit.slotsBlocked === 0`；`airWall.uncovered === 0`；每个 slot 从出生点**可达** | 半成品：nav 权威 + 补格，但未验收 |
| **前后对** | `occlusionAudit().anomalyCount === 0`；`overlayAudit()` 三层 `ordered: true` | 实体已按底边，覆盖层已排序；**未真机验** |
| **不闪不跳** | 10s 无输入：`camera()` 的 `zoom/scroll` 零变化；resize 后只收敛一次 | 用户报过"场景一直在跳"（未定位） |
| **加东西不改代码** | 新增站点/家具只加内容 + footprint；渲染器零改动 | 未做到：footprint 还没进内容契约 |
| **可被 AI 定位** | 一句症状 → `__agentWorldDebug.help()` 给出一条探针 → 一次调用拿到判据 | 已有 `help/snapshot/audit/explain`，缺可视化 |

---

## 一、现状基线（2026-10-20，R227 后）

| 项 | 读数 / 事实 |
|---|---|
| 地图 | 37×21 格，一格 2 世界单位 = 32px；`TILE_PX = 16` |
| 可走性 | 248 个 blocked 格 |
| 精细碰撞体 | 203 条（`office-colliders.json`） |
| 补格 | **不补**（R229 纠正：补整格会造看不见的墙）。nav 与几何差异 55 格，只报 `uncoveredCells` → 障碍 = **203** |
| 站点 | 24 个；slots 24 个；`slotsBlocked = 0`（其中 11 个**锚点**在 blocked 格——椅子本就在格子家具上，正常） |
| 图层 | 5 个 Phaser 容器：`ground → entities → notes → labels → bubbles`；DOM 覆盖层另有 dock/对话/控件 |
| 实体 | 角色 ~1–8、站点 24、椅子 24、墙条 + 地图矩形 ~160（R158 全量 186） |
| 渲染节奏 | 场景数据 **250ms** 更新一次（`setInterval(render, 250)`）；Phaser 自身 60fps 重绘 |
| 相机 | `zoom` 只由控件改；`applyCamera()` 每次 render 设 viewport/bounds/center |
| 已知缺口 | ① 站点 footprint 不在内容里；② 家具深度用 anchor，不是 footprint 底边；③ 无 air-wall 可视化；④ 无渲染性能门面；⑤ 相机跳动未定位 |

---

## 二、设计原则（先定，避免边做边改）

1. **一个几何事实只存一次，但两种职责分清**：`obstacles`=物理真相（美术几何），`nav`=路由网格（保守寻路）；渲染器、服务端、审计都从 `SceneSpace` 读，不各自 fetch。
2. **深度 = 底边**：任何实体（墙条、家具、椅子、角色）的 `depth` 必须由**它自己的底边**推出；覆盖层用固定深度带（`OVERLAY_DEPTHS`）。禁止"按类别给定值"。
3. **可读性优先于物理透视**：名字/气泡/工单行永远不被家具挡住（它们是"界面"不是"物体"），但要在文档里写死，避免下次被当 bug 修。
4. **内容声明几何**：新增会挡路的实体，必须同时给 footprint（占格）、base（底边）、slot（可站）；缺一项校验器报错。
5. **所有优化都要有读数**：改之前先加门面，不接受"看起来好多了"。
6. **AI 可定位**：症状 → 探针 → 判据，三步内完成；可视化是最后手段，门面是主路径。

---

## 三、优化项（按域，P0 = 不做会继续错，P1 = 体验/扩展性，P2 = 打磨）

### A. 空气墙（Air wall）

| 编号 | 优先级 | 问题 | 做法 | 验收 | 成本 |
|---|---|---|---|---|---|
| A1 | **P0** | 站点/家具的 footprint 不在内容里，靠地图 walkable 兜底 | 内容 `stations` 增加 `footprint`（相对锚点的格矩形）与 `slot` 校验；`SceneSpace` 由内容 + 地图生成 | 新增一个挡路家具只改内容；`audit.slotsBlocked=0`；校验器拒绝缺字段 | M |
| A2 | **P0** | 手动移动是"格子级探针"（0.4 格），贴墙/过门洞发涩 | 改成**圆 vs 网格**（半径 0.35 格）+ 对角转角检查；按轴滑 | 贴墙走 5 秒不卡顿、不穿 1px；过 2 格门洞顺滑 | M |
| A3 | **P0** | 服务端 `clamp` 会吸附到格中心，最坏瞬移 1 格 | clamp 限制在 1 格内 + 取最近点（不是格中心）；超出则拒绝并记诊断 | `clamped` 事件距离 ≤ 1 格；拒绝有日志 | S |
| A4 | **P1** | 203 条精细矩形，尚未合并 | 合并共线/相邻矩形（只合并几何，不补格） | 静态体 < 150；`uncoveredCells` 不变 | M |
| A5 | **P1** | 站点只有 1 个 slot，多工位站点会抢 | 内容支持多 slot + 容量校验；调度按 slot 选空闲 | 4 人会议桌 4 人同时落位不重叠 | M |
| A6 | **P2** | 死角/不可达站点无人发现 | 内容校验加**连通性 flood fill**：每个 slot 必须从出生点可达 | 校验器对不可达 slot 报 error | S |

### B. 深度与遮挡

| 编号 | 优先级 | 问题 | 做法 | 验收 | 成本 |
|---|---|---|---|---|---|
| B1 | **P0** | 家具深度用 `anchor.z`，多格家具/带 dz 部件会偏 | 深度基准改 `SceneSpace.entities[].footprint.bottom`；部件按 `dz` 偏移 | `occlusionAudit` 对 props 也成立；多格桌前后关系正确 | S |
| B2 | **P1** | 椅子统一 `-8` 偏移，某些角度会压住角色 | 椅子按"是否塞在桌下"决定 bias（0 或 -8），由 footprint 与桌格关系推 | 椅子/桌子/角色 24 组前后逐一正确 | M |
| B3 | **P1** | 同 z 的对象排序不稳定（可能闪） | tie-break：`depth` 后按 `id` 哈希；`sort` 只在 base 变化时跑 | 静止 10s 无重排/闪烁；`sortCount` 可读 | S |
| B4 | **P1** | 覆盖层"永远在上"没有文字契约 | 写进 `OVERLAY_DEPTHS` + 审计；新增覆盖物必须登记深度带 | 新增标签类元素漏登记会被 `overlayAudit` 报 | S |
| B5 | **P2** | 墙条只有"整行"，斜角处接缝明显 | 墙条按 footprint 切分；接缝处补 1px 重叠 | 截图无缝隙；`occlusionAudit` 不变 | M |

### C. 元素（逐个）

| 元素 | 现状 | 优化 | 优先级 |
|---|---|---|---|
| 地面 / 底图 | 平铺层 0/5 固定深度；1–4 拆矩形 | 检查 tile 相位与接缝；地图烘焙与矩形是否重复绘制 | P2 |
| 墙条 | 按行底边排序 | 与 B5 合并；检查角色贴墙时的"半身"观感 | P1 |
| 家具 / 站点 | 内容 `props` + 地图对象 | 深度走 footprint（B1）；去重"地图里也画了一遍"的家具 | P0/P2 |
| 椅子 | 24 把，`CHAIR_BIAS` | 按 B2 重算；与地图对象去重 | P1 |
| 角色 | 精灵 + 兜底矩形 | 脚下接触阴影（可选）；锚点统一 | P2 |
| 名字标签 | 深度 5，跟随头顶 | 已被家具挡住的问题不存在（刻意）；检查与任务行错位 | P1 |
| 工单行 | 深度 4，错位布局 | 与名字的排序由 `OVERLAY_DEPTHS` 钉住；长标题截断 | P1 |
| 纸条 | 深度 4，飞行插值 | 定义"从手到桌"的轨迹；与标签的层级关系 | P2 |
| 气泡 | 深度 1000，9-slice + 尾巴 | 边缘夹取（不出舞台）、多气泡堆叠策略 | P1 |
| 选中环 | `sprite.depth - 0.01` | 与椅子/桌子重叠时可见性；改用 ground.overlay | P2 |
| DOM 覆盖层 | dock / 对话 / 控件 | 与 canvas 的层级已固定；只需检查缩放时是否遮挡交互 | P2 |

### D. 相机与布局

| 编号 | 优先级 | 问题 | 做法 | 验收 | 成本 |
|---|---|---|---|---|---|
| D1 | **P0** | 用户报"场景一直在跳"，原因未定位 | 加 `cameraAudit()`：每 250ms 采样 zoom/scroll/viewport；`__agentWorldDebug.snapshot()` 带 10s 轨迹 | 无输入 10s 内零漂移；有输入时只有一次收敛 | S |
| D2 | **P0** | `applyCamera()` 每 render 都 `setBounds`/`centerOn`，可能与跟随/zoom 缓动打架 | 只在 viewport/bounds 变化时设；`centerOn` 仅在非跟随且未手动平移时 | 缩放动画不再被下一帧覆盖；drag 不被拽回 | S |
| D3 | **P1** | dock 拖动改宽度 → 舞台 resize → 相机重算 | ResizeObserver 去抖 100ms；整数 zoom 吸附；布局持久化 | 拖 dock 时不闪；松手后一次适配 | M |

### E. 性能

| 编号 | 优先级 | 指标 | 做法 | 验收 |
|---|---|---|---|---|
| E1 | **P0** | 没有渲染基准 | `__agentWorldPhaser.benchmark(n)`：render ms、sort ms、draw calls、texture 数 | 有基线数字，进 README/验收 |
| E2 | P1 | 每 render 重建 Map/数组（`drawProps` 等） | 复用缓冲；按 plan 指纹只重建变化的部分 | render p95 < 8ms（1080p 集显） |
| E3 | P1 | 258 静态体 + 每帧碰撞 | 合并（A4）；只在需要时 `collider` 挂/摘 | 物理步 < 2ms |
| E4 | P2 | 贴图/文字每帧更新 | 文本只在变化时 `setText`；纹理按需释放 | 无持续 GC 尖峰 |

### F. 内容与契约

| 编号 | 优先级 | 内容 | 验收 |
|---|---|---|---|
| F1 | **P0** | `stage.space` 契约登记（nav/obstacles/entities/audit） | 进 `CONTRACTS` 目录；`test/contracts` 通过 |
| F2 | **P0** | 内容校验：footprint/base/slot 必填 + slot 可达 | 坏内容直接 error，不进世界 |
| F3 | P1 | 新实体模板（文档 + 示例） | 照抄模板就能加一张桌子 |

### G. 调试与 AI

| 编号 | 优先级 | 内容 | 验收 |
|---|---|---|---|
| G1 | **P0** | `?debug=walls`：叠加层画 nav blocked / obstacles（fine 绿、cell 红）/ slots / entity id | 肉眼能看出"这一格为什么不能走" |
| G2 | **P0** | `__agentWorldDebug.check()`：一次跑全部不变量并返回 pass/fail | 一条命令回答"现在有没有问题" |
| G3 | P1 | `explain(id)` 扩展：可达性、最近 slot、深度排序邻居 | 站点问题一次定位 |
| G4 | P1 | `freeze()`：暂停 render 用于逐帧检查 | 检查时不跳 |
| G5 | P2 | 截图回归（固定 zoom/seed，pixel diff） | 视觉改动有基线 |

---

## 四、分期（建议顺序）

| 阶段 | 内容 | 产出 | 估时 |
|---|---|---|---|
| **Phase 0 · 验收与止血** | 真机跑通 space；`cameraAudit`；B1（footprint 底边）；`check()` | 四个审计全绿 + 相机轨迹证据 | 0.5–1 天 |
| **Phase 1 · 几何契约** | A1 footprint 进内容；F1/F2 校验；A2/A3 移动手感；G1 可视化 | "加一张桌子只改内容" | 1–1.5 天 |
| **Phase 2 · 渲染与性能** | B2/B3/B5；A4 合并；E1/E2 基准与优化；D2/D3 相机 | render < 8ms、静态体 < 200、相机不跳 | 1–1.5 天 |
| **Phase 3 · 元素打磨** | C 组逐个（气泡/纸条/选中环/标签）；G3/G4/G5 | 视觉验收清单全过 | 1–2 天 |

**依赖**：Phase 0 的相机证据决定 D2 的做法；Phase 1 的 footprint 是 B1/B2 与 F2 的前提；
Phase 2 的基准必须在 Phase 1 之后（否则量到的是几何变更前的数）。

---

## 五、验收指标（进 CI / 门面）

| 指标 | 门槛 | 探针 |
|---|---|---|
| `airWall.uncovered` | 0 | `__agentWorldPhaser.airWallAudit()` |
| `space.audit.slotsBlocked` | 0 | 同上 / `__agentWorldDebug.audit().space` |
| slot 可达率 | 100% | `__agentWorldDebug.check()` |
| `occlusion.anomalyCount` | 0 | `__agentWorldPhaser.occlusionAudit()` |
| `overlay` 三层 | `ordered: true`、`anomalyCount: 0` | `__agentWorldPhaser.overlayAudit()` |
| 相机漂移（10s 无输入） | `Δzoom = 0`、`Δscroll = 0` | `__agentWorldDebug.snapshot().cameraTrace` |
| render p95 | < 8ms @1080p 集显 | `__agentWorldPhaser.benchmark(120)` |
| 静态体 | < 200 | `airWallAudit().obstacles` |
| 全量测试 | 全绿 | `pnpm test` |

---

## 六、风险与不做的事

**风险**

1. **footprint 与地图 walkable 冲突**：内容声明的 footprint 可能和烘焙地图不一致 → 先做"只读审计"（只报差异），下一版再让 footprint 参与生成。
2. **深度改基准会动画面**：B1 会影响所有家具的前后关系 → 先加 `occlusionAudit` 对 props 的检查，再改，逐张截图对比。
3. **相机修复容易回归缩放/跟随**：D2 必须配 `cameraAudit` 与三条既有验收（缩放档、跟随、复位）。
4. **新 web 文件 = profile 断链**：G1 若新增文件，必须同时跑 `sync-profile.mjs --fix`，否则白屏。
5. **性能优化过早**：没有 E1 基线之前不做 E2/E3，否则就是凭感觉。

**不做**

- 不重写渲染器/换引擎；继续 Phaser。
- 不做 3D、骨骼动画、粒子。
- 不做 tilemap 重构（底图烘焙保留；B5 只在墙条层面切分）。
- 不为"视觉完美"引入外部物理引擎；Arcade 够用。
- 不做与"能不能走/谁在前"无关的装饰性优化。

---

## 七、与契约体系的映射

| 契约 id | 本计划中的落点 |
|---|---|
| `stage.channel` | B4 深度带、C 组覆盖层 |
| `stage.action.catalog` | 与渲染优化无关（舞台动作 A 批另行推进） |
| `stage.perf` | E1/E2 基准 |
| `stage.asset.fallback` | C 组兜底（缺模型 → 矩形） |
| `stage.input` | A2/A3 手动移动 |
| `world.write.discipline` | 只读：本计划不新增写者 |
| 新增 `stage.space` | A1/A4/B1/F1（nav + obstacles + entities + audit） |
| 新增 `stage.camera` 审计 | D1/D2 |

> 本计划只动**表现与几何**，不改模拟内核；任何需要改 `sim/` 的项都单独立项。
