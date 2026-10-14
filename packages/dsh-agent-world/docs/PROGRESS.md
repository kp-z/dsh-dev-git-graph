# dsh-agent-world —— 轮次台账（PROGRESS）

> **这是每小时自动化轮次的交接文档。** 每轮开始先读这里，结束必须更新这里。
>
> 更新规则：
> 1. 在最上面加一条本轮记录（倒序，最新的在上）。
> 2. 记录必须包含：**做了什么 / 验证怎么跑的 / 下一轮从哪继续 / 假设 / 卡住的地方**。
> 3. 「下一轮从哪继续」要具体到文件与函数名，不要写"接着做 M1"。
> 4. 不要删历史记录。台账的价值就在于"三个月后还能看懂当时为什么这么做"。

---

## 环境备忘（每轮都会用到，先看这里）

```bash
cd packages/dsh-agent-world

# 首次 / 依赖缺失时：本包**独立安装**，不走根 workspace
#（根 `pnpm install` 目前被 packages/dsh-daily 的过期 RC 钉死，与本包无关，原因见本文件 R1 的「卡住」一节）
pnpm install --ignore-workspace --lockfile=false

# 之后所有 pnpm run 都要带这个环境变量，否则 pnpm 的 run 前依赖校验会去跑根 install 并失败。
# 这是**唯一的**可靠手段：包内的 .npmrc 写 `verify-deps-before-run=false` 不管用
#（pnpm 读的是 workspace 根的 .npmrc），而且 .npmrc 被仓库级 .gitignore 忽略、根本不会进版本库。
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run build
```

当前验证状态（R1 末）：`typecheck` 绿 · `test` 10/10 绿。

---

## R1 — 2026-10-14 · 立项、选型、骨架、世界模型

**本轮目标**：把项目立起来，并把「架构」这块最难的地方先定死（用户点名说架构是难点）。

### 做了什么

1. **勘察底座**：定位到参考实现 `@nanmicoder/dsh-agent-teams@0.1.23`
   （装在 `~/.dsh/profiles/web/node_modules/@nanmicoder/dsh-agent-teams`）。读出了它的骨架：
   - host 侧一层：`index.js`（注册 `agent_teams_*` 工具 + 系统提示词段落）、`state.js` / `members.js` /
     `scheduler.js` / `mailbox.js` / `tools.js`、`cordis.patch.yml`（bundle patch）。
   - 磁盘真相：`<workspace>/.agent-teams/<teamId>/`（`team.json` + `inbox/*.jsonl`）。
   - client 侧一层：`lib/client.js`，React，注入 DSH 的 slot。
   **本项目的「底座」= 这套语义（lead + durable members + 依赖感知任务 + 邮箱 + 调度器），
   不是它的代码。** 我们重写 host 侧，并把呈现层从 React 面板换成 3D 场景。

2. **技术选型（决策 D1）**：**three.js**，不用 Godot。完整对比在
   `docs/ARCHITECTURE.md` §1。一句话：Godot 要 wasm + JS interop + 编辑器流水线，
   three.js 直接就是同浏览器里的一个页面。Godot 被**推迟**（不是否决）——
   因为 §2 把渲染层做成了哑客户端，将来换引擎不用动业务。

3. **架构定稿**：`docs/ARCHITECTURE.md`（12 节 + 6 条决策记录）。核心是三条：
   - **server-authoritative**：模拟跑在 host，渲染层只画状态、只发意图；
   - **`tick` 是纯函数 + seeded PRNG**：确定性 ⇒ 可回放 bug、可无 mock 测试；
   - **capability 落位**：任务只声明"需要什么能力"，不硬绑工位 ⇒ 布局与编排解耦。

4. **代码骨架 + 世界模型（M0-1…M0-3, M1-1…M1-3）**：
   ```
   src/config.ts              schemastery 配置 + resolveConfig 兜底
   src/state.ts               插件态：内存世界 + ensureWorld/resetWorld
   src/index.ts               入口：name/inject/apply
   src/tools/world.ts         agent_world_status（只读）+ agent_world_open（写）
   src/domain/types.ts        世界模型全部类型 + 两个状态机
   src/domain/constants.ts    默认小镇布局（4 地段 / 10 站点）+ 配色 + 调参
   src/domain/rng.ts          mulberry32 seeded PRNG
   src/domain/create.ts       createWorld()（纯函数）
   src/domain/geometry.ts     距离/转向/到站 slot 吸附
   src/domain/summary.ts      世界摘要 + 花名册 + 工单板文本（三处共用同一口径）
   src/domain/index.ts        领域层出口（web/ 以后直接 import 这份，不复制）
   test/smoke.test.js         10 个测试
   ```

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test
# → tests 10 / pass 10 / fail 0
```

测试覆盖：导出契约（`name`/`inject`/`apply`）、**`apply(ctx, undefined)` 不崩**
（Loader 在 patch 没写 config 时就是给 undefined，schema default 不会自动填——本仓库最容易崩的一条路径）、
`createWorld` 同 seed 逐字段一致 / 不同 seed 分叉、小镇结构完整性（每个站点的 district 与 slot 都存在）、
`maxAgents` 硬上限、`summarize` 口径与数组真实内容一致、PRNG 序列可复现且不退化。

### 下一轮从哪继续

**M1-4：`src/sim/step.ts` 的纯函数 tick。** 具体：

1. 先写 `src/sim/ready.ts`（M1-5，先做它因为调度器依赖它）：唯一实现点是
   「所有 `blockedBy` 的 task 都 `done` ⇒ `pending` 变 `ready`」。
2. 再写 `src/domain/commands.ts`：命令类型联合（`pause` / `resume` / `reset` / `dispatch` / `hire`），
   这是 `step()` 的第三个参数。
3. 然后 `src/sim/step.ts`，严格按 §4.1 的六段顺序：
   `ingest → scheduler → movement → interaction → mailbox → emit`。
   注意：**模拟层禁止 `Math.random()` / `Date.now()`**，随机一律走传入的 `Rng`。
4. 每写一个 sim 模块，立刻在 `test/` 加一个测试。M1-9 是收口：
   `test/determinism.test.js` 跑 1000 tick，两次结果逐字节一致。

### 假设（没问人，按最合理的定了）

- 一个 workspace 一个活跃世界 + 历史归档（BACKLOG 待决问题 2）。
- 角色数上限默认 24（`MAX_AGENTS`），M4 实测后再调。
- 小镇是 16×16 单位、原点在中心、四象限四地段（`TOWN_HALF = 8`）。
- 面板用宿主 HTTP 路由吐出的**独立页面**，不塞进宿主 client bundle（决策 D3）。
  理由：避免与宿主 React/three 版本冲突，且 Vite HMR 迭代快。

### 卡住 / 风险

1. **根 workspace 的 `pnpm install` 是坏的**（不是本包引起的）：
   `packages/dsh-daily` 声明了 `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-invariants` /
   `@deepseek-ai/dsh-session` 的 `>=0.1.2 <0.2.0-0` 范围，而公共 registry 上这些包只有
   `0.0.1-rc.1`（latest）/ `next: 0.2.0-rc.2` / `alpha: …`，范围内无匹配；
   根 `pnpm-lock.yaml` 停在 2026-09-22 的旧解析结果（有 3000+ 行未提交改动，**不是本轮改的**，
   mtime 未变）。`pnpm-lock.yaml` 本轮**没有被我修改**，也没提交。
   → 本包因此独立安装并关掉 run 前校验（见上方环境备忘）。**没有去修它**：
   那属于 dsh-daily 的依赖维护，且用户当时在 `feat/dsh-daily` 分支上有未提交改动，不该我碰。
2. `docs/ARCHITECTURE.md` §5.4 的美术方向目前是**设计**，还没有任何真实资产。
   资产落地在 M3-5 / M7-3，届时必须有 `web/public/assets/VENDOR.md`（URL + 许可 + sha256）。
3. 面板入口位置（右侧栏常驻 vs 新 view tab）与音效是否要做，都留到 M5 再决（BACKLOG 待决问题）。

### 本轮产出

- 分支：`feat/dsh-agent-world`（从 `feat/dsh-daily` 的 HEAD 切出；**没有**动那个分支上的未提交改动）
- 新增包：`packages/dsh-agent-world/`
- 文档：`docs/ARCHITECTURE.md`、`docs/BACKLOG.md`、本文件、`README.md`
