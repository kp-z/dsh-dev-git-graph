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

当前验证状态（R3 末）：`typecheck` 绿 · `test` 49/49 绿。

---

## R3 — 2026-10-14 · 外部内容包：用户改内容就能改世界

**本轮目标**（M1.5-1/2/3/5）：让"内容可替换"从"改源码里的包"变成"往目录里放 JSON"。
这是 R2 那套机制的第一次真实兑现——**不写一行代码，换掉花名册**。

### 做了什么

1. **`src/content/load-files.ts`** —— 对**目录**的纯函数（不决定目录在哪，那由调用方定，
   这样测试能直接喂临时目录）：
   - `<rootDir>/<packId>/pack.json` 是清单，`<kind>.json` 是各库条目数组（缺文件 = 不提供该库，不是错误）。
   - 允许单对象写法（`scene.json` 只有一条时少写一层方括号）。
   - `scenes` 同时接受单数 `scene.json`。
   - 子目录没有 `pack.json` → 跳过 + 警告（报的是**哪个目录**）。
   - **有一个错就整包跳过**，不加载半成品，并明确说"已整体跳过"。
2. **`resolveContentRoot(contentDir, cwd)`** —— 路径解析策略**明确、不猜**：
   空 → 不用外部内容；绝对路径 → 原样；相对路径 → 相对 `process.cwd()`。
   最终解析出的绝对路径 + 理由会**原样打进日志**。
3. **报错定位到文件（M1.5-3）** —— 校验器给的 `where` 是按库分的（`stations/station.x.kind`），
   它不知道文件叫什么。所以按 `where` 首段反查该库实际用的文件名，统一前缀成
   `my-town/stations.json: stations/station.x.kind`。**定位到条目 id 而不是数组下标**——
   手写 JSON 里搜 id 比数第几个元素快得多。
4. **不认识的 `.json` 文件名一律警告并列出可用名**。`station.json`（单数）这种手滑，
   症状是"站点一个都没有"而报错什么都不说——那种问题能耗掉一小时。
5. **接进 `state.ts` + `index.ts`（M1.5-2）**：内置包在前、外部包在后（于是外部排到提供方链首），
   但**链首 ≠ 可以乱覆盖**：没声明 `overrides` 的撞 id 仍是错误。`allowImplicitOverride` 接上配置。
6. **`content/index.ts` 刻意不导出 `load-files.ts`**：它 import 了 `node:fs`，而 `content/index`
   是给浏览器侧 `web/` 也能 import 的入口，混进去 Vite 打包会当场炸。这条写进了文件头注释。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 49 / pass 49 / fail 0
```

32 → **49** 个测试。新增 17 个全部围绕外部内容，含 3 条**走完整插件入口的端到端**：

- **改内容就改世界**：临时目录放一个 `my-team` 包，显式覆盖 `rosters/roster.software-team`，
  于是 `createWorld` 出来的是 2 个人（"队长本人" + "唯一的工程师"）而不是默认的 8 个；
  `world.origin.packs` 记着 `['pack.default', 'pack.my-team']`。**没改一行代码。**
- **偷偷换掉会被拦**：同样的包，去掉 `overrides` → 装载报错，且世界退回内置的 8 人、名字仍是"工头阿金"。
- **走 `apply()` 的完整链路**：`apply(ctx, { contentDir: <绝对路径> })` → 工具读到的世界就是外部内容装出来的；
  日志里能原样看到"实际读取的外部内容目录：/tmp/..."。
- 目录不存在 → **只警告不报错**，插件照常可用，世界退回内置内容（不能因为用户还没建目录就崩）。

一个测试写窄了被实现纠正的记录：我原本断言报错要含 `stations[0]`（数组下标），
实现给的是 `stations/station.x.kind`（条目 id）。**实现是对的**——手写 JSON 里搜 id 比数下标有用得多，
改的是测试。

### 下一轮从哪继续

**M1.5-4：`agent_world_content` 工具**（`src/tools/content.ts`）。具体：

1. 用 `state.content` 列：已装载的包（`content.packIds` 与各包的 version）、每个库的条目数与条目 id。
2. 支持按 id 查**提供方链**（`content.providersOf(kind, id)`）——这是排查"为什么我的覆盖没生效"的入口。
3. 输出要能回答三个问题，这也是它的验收标准：
   · 到底装了哪些包？· 某个 id 现在生效的是哪个包提供的？· 外部目录是哪个、有没有被跳过？
4. 顺带把 `state.contentIssues` 全量列出（现在只有前 5 条进日志，工具里应当给全部）。
5. **注意**：它只读，不许写盘、不许联网，工具描述里要写明。

做完 M1.5-4 就可以进 **M2 模拟内核**（`src/sim/ready.ts` 起步）——那是整个项目技术上最硬的一块。
M1.5-6（相对路径的解析基准）建议**先别做**：`workspaceRegistry` 没有"当前 workspace"的概念，
需要先查清 session→workspace 的绑定从哪拿，否则就是猜；宁可先让它显式要绝对路径。

### 假设

- **相对 `contentDir` 按 `process.cwd()` 解析**（宿主进程的工作目录，通常就是 workspace）。
  没去猜"当前 session 的 workspace"：`workspaceRegistry` 只提供 `list()` 与 `resolveByPath()`，
  多工作区时任何自动挑选都是猜，而猜错的症状是"读到了另一个项目的包"，比"没读到"难查得多。
  需要精确指向就写绝对路径。这条作为 M1.5-6 排进队列。
- 一个目录 = 一个包；不支持一个目录放多个包。
- 库文件名固定为 `<kind>.json`（`scenes` 兼容单数）。**拼错会被警告而不是静默忽略**。

### 卡住 / 风险

- **JSON 里的路径仍然没有安全边界**：`ModelEntry.source.url` 现在可以是任意字符串。
  等 M4/M5 真的开始加载 GLB 时，必须限制成**包内相对路径**并禁 `http://` 与 `../`。
  这条在 R2 就记过一次，**本轮仍未处理**——因为还没有消费者，现在定规则是空谈；
  但 M4-8（资源台账）之前必须落地，否则就是一个"内容包能指向任意 URL"的口子。
- 外部内容的**热重载**没有：改了 JSON 要重开世界才生效（`content` 在 `apply` 时装载一次）。
  是否要 watch 到 M3-2（runtime）再定，现在不做。
- M1.5-6 的调研成本未知，已单独拆成一条任务，避免它把别的事堵住。

### 本轮产出

- 新增：`src/content/load-files.ts`、`test/external-pack.test.js`
- 修改：`src/state.ts`（接受 `externalRoot`）、`src/index.ts`（解析并记录内容目录）、
  `docs/BACKLOG.md`、`docs/CONTENT.md`、`README.md`
- 测试从 32 → 49

---

## R2 — 2026-10-14 · 内容库层：机制与内容分离

**本轮目标**（用户反馈驱动）："应该按照一个游戏的模式设计，模型库、动作库、任务库、场景库等等都要整理好解耦好，方便替换升级和切换。"

R1 的架构里"内容"和"代码"是**混着**的——地段坐标、站点布局、配色全硬编码在 `src/domain/constants.ts` 里。
本轮把这层拆出来，并把"方便替换"从一句愿望变成**有强制力的机制**。

### 做了什么

1. **十个内容库**（`src/content/kinds.ts`）分两层：
   - **语义库**（host 权威）：`districts` 地块 / `stations` 站点 / `scenes` 场景 / `rosters` 角色 / `tasks` 任务
   - **表现库**（web 权威）：`models` 模型 / `actions` 动作 / `skins` 皮肤 / `sounds` 音效 / `themes` 主题
   两层共享同一套 id 契约与同一个注册表实现（决策 D13）——拆成两套机制就会开始漂移。

2. **"方便替换"的机制化**（这是本轮真正的产出，也是三条新决策）：
   - **稳定 id**：代码引用 `action.walk`，永远不引用 `walk.fbx`（D10）。
   - **提供方链 + 回退**：同一个 id 可被多个包提供，链首生效，其余留作回退；
     `resolve(kind, id, prefer)` 只**排序**不裁剪，所以"优先"永不导致条目丢失（D12）。
   - **覆盖必须显式**：撞 id 但没在清单 `overrides` 里声明 → 报错，且**原条目保持不变**（D11）。
     理由："悄悄换掉内容"是最难查的一类问题——世界看起来一切正常，只是某个站点变成了别的东西。

3. **校验器**（`src/content/validate.ts` + `registry.validate()`）：抓的是 **tsc 抓不到、
   运行时又难定位**的错误。单包查条目形状/枚举/依赖环/lead 数量；跨包查引用完整性
   （站点→地块、场景→站点/花名册/主题、配色→皮肤 token）与**动作覆盖度**
   （某个 `AgentState` 没动作 ⇒ 角色会僵在上一帧）。报错文案一律给"可用取值有哪些"（D15）。

4. **内置内容包** `pack.default`（`src/content/packs/default.ts`）：4 地块 / 10 站点 /
   8 人花名册 / 2 条工作流（`task.software-feature` 7 步 DAG、`task.quick-fix` 3 步）/
   皮肤（10 色调色板 + 职业色 + 站点色）/ 7 个动作 / 1 个主题。**表现层全是程序化几何**，
   所以现在零外部资产、零许可风险、零加载时间。

5. **重构分层**（决策 D10 的落地）：
   ```
   domain/   世界模型（类型、数值调参、几何、摘要、随机源）——不认识"内容"
      ↑
   content/  类型、校验、注册表、内置包、实例化
      ↑
   world/    createWorld（内容 → World）
   ```
   - `src/domain/create.ts` 删除，拆成 `src/content/instantiate.ts`（内容 → 对象，两层之间**唯一**的翻译层）
     + `src/world/create.ts`（装配）。
   - `src/domain/constants.ts` 只剩**数值调参**；`DEFAULT_DISTRICTS` / `DEFAULT_STATIONS` /
     `AGENT_PALETTE` / `ROLE_COLOR` 全部搬到内容包。
   - `Task` 新增 `key` / `set` / `estimateTicks`；`World` 新增 `origin`（场景 + 内容包 + 任务集），
     没有它就没法"用同样的内容重开一局"。

6. **`docs/CONTENT.md`**：十个库规范、包的写法、**三种操作**（新增内容 / 替换升级 / 切换提供方）、
   校验规则表、命名规范、一个完整的 Kenney 替换示例、常见错误对照表。

7. `src/index.ts` 加了内容问题的**软失败**：内容有 error 时不让它拖垮插件加载
   （插件树加载失败会让整个 dsh 起不来，代价远大于"世界暂时建不出来"），
   改为打日志 + `agent_world_status` 里列出细节。照 dsh-daily 的既有做法。

### 验证

```bash
cd packages/dsh-agent-world
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run typecheck   # 绿
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm test            # tests 32 / pass 32 / fail 0
```

从 10 个测试涨到 **32 个**。新增的 22 个里，**18 个专门钉住内容层机制**，每条都对应一个真实会踩的坑：

- 撞 id 没声明 overrides → 报错**且原条目不变**；声明了就生效**且旧提供方留在链上可回退**
- `resolve(prefer)` 只排序不裁剪（prefer 里写个不相干的包，条目不能丢）
- `allowImplicitOverride` 打开时只警告
- 站点引用不存在的地块 / 场景引用不存在的站点 / 皮肤 token 不存在 → 都在加载时报错
- **某个 AgentState 没有动作 → 报错**（这条最值钱：换动作库时漏一个状态，会在测试里红，而不是在画面上看到角色僵住）
- 任务依赖成环 → 报错并打印完整环路；依赖指向集合外 → 报错并列出可用 key
- `schemaVersion` 不匹配 → 明确拒绝；包依赖缺失/成环 → 报错
- 拓扑序：故意把依赖方放在前面传入，装载顺序仍正确
- `relativeTo` 坐标解析正确（**所有站点都必须落在小镇范围内**——坐标解析错了最典型的症状就是跑到地图外）
- 连派两个任务集，跨集合 id 不撞且依赖不串

### 下一轮从哪继续

**M1.5-1：外部内容包加载器**（`src/content/load-files.ts`）。具体：

1. 读 `<workspace>/<contentDir>/<packId>/` 下的 `pack.json` + 各库 `.json`（缺哪个文件 = 不提供那个库，不是错误）。
2. **错误信息里必须带文件路径**（M1.5-3）——否则用户不知道去哪个文件改。这是外部内容与内置内容最大的体验差别。
3. 接进 `src/state.ts`：内置包 + 外部包一起 `loadAll`，`allowImplicitOverride` 接上配置（配置项已就位）。
4. M1.5-5 是验收：临时 workspace 里放一个外部包顶掉小镇布局，`createWorld` 出来的世界确实变了。

之后就是 M2 模拟内核（`src/sim/ready.ts` 起步），那是整个项目技术上最硬的一块。

### 假设

- **内置内容编译进代码、外部内容走文件系统**（决策 D14）。这是被本仓库的硬链接副本坑逼出来的：
  `file:` 依赖装进 profile 时新增文件**不会**被同步（`docs/DEVELOPMENT.md` §7），
  而插件树加载失败会让整个 dsh 起不来。所以内置走 TS 常量（不新增文件），外部走文件系统（用户自己放的）。
- **包是替换与升级的单位**，不支持"只覆盖一条而不整包"（BACKLOG 待决问题 5）。想要细粒度就新建一个包。
- 表现库在 host 侧可能完全不存在（面板没打开、只跑 headless），所以跨包校验里
  "场景引用的主题""皮肤 token"这类检查**只在对应库非空时才跑**。

### 卡住 / 风险

- **M5 是这个设计唯一的真实验证点**：到目前为止"换一套角色只改模型库+动作库"还是**推理**，
  没被跑过。到 M5-6 必须拿出证据：加了 `pack.kenney-mini` 之后 `pnpm test` 仍全绿、模拟内核零改动。
  在那之前不要把这条当成已验证的事实。
- 外部内容包的**安全边界**没定义：JSON 里将来若出现 `url` 字段（模型/音效），
  要不要限制只能读包内相对路径、禁 `http://` 与 `../`？→ 留到 M1.5-1 一并处理，倾向于**默认禁网络**。
- 注册表的提供方链目前**没有持久化**：世界落盘（M3-1）时只存 `origin.packs`，
  恢复时靠"用同样的包按同样顺序装载"重建链。如果用户换了包集合，旧存档的渲染表现会变——
  这是可接受的（内容升级本来就该改变表现），但要在 M3-1 里把 `origin.packs` 的版本一并存下来，
  好让"这局是用哪个版本的内容玩的"可查。

### 本轮产出

- 新增：`src/content/{kinds,validate,registry,instantiate,index}.ts`、`src/content/packs/default.ts`、
  `src/world/create.ts`、`test/content.test.js`、`docs/CONTENT.md`
- 删除：`src/domain/create.ts`（拆成上面两个）
- 重写：`src/domain/constants.ts`（只剩数值）、`src/domain/index.ts`、`src/state.ts`、
  `src/tools/world.ts`、`src/index.ts`、`src/config.ts`、`test/smoke.test.js`
- 文档：`ARCHITECTURE.md`（§2.1/§2.2 新增、§3 实体表、§9 里程碑重排、§10 目录、§12 加 D10–D15）、
  `BACKLOG.md`（全量重排）、`README.md`

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

### 补充（同日）：资产 / 库调研已落地成文档

派了一个后台调研去把 M3/M7 的美术与依赖问题一次问清（一手来源核验，含真的把资产 zip 与 GLB
拉下来解析），结果收到后**没有让它烂在对话里**，全部折进了文档：

- 新增 [`docs/ASSETS.md`](ASSETS.md)：推荐的 CC0 资产包（含实测体积）、角色动画三方案对比、
  three.js 生态库版本与许可、10 条许可红线、`VENDOR.md` 台账模板、美术配方（相机/光照/调色板/性能预算）。
- `ARCHITECTURE.md`：§5.3 性能预算按调研**收紧**（300k 面 → ≤100k，150 draw call → ≤60，
  新增贴图 ≤512² 与首屏载荷 ≤5 MB）；§5.4 重写成具体配方并指向 ASSETS.md；
  §11 补两条风险（资产许可、peer 上限）；§12 新增 **D7/D8/D9** 三条决策。
- `BACKLOG.md`：M3-1/M3-3/M3-5/M4-2/M7-3 全部改成**可执行的具体项**（原本只是"落地美术方向"这种空话）。

三条本轮新定的决策（都已进 §12）：

- **D7 面板用纯 three.js，不引 `@react-three/fiber`**：R3F 系库全部只支持 React 19，
  引它等于把面板绑死在某个 React 大版本上；而 §5.2 的分层本来就是「model 出插值状态 →
  scene 每帧命令式同步」，React 的 diff 在这层不是价值而是开销。HUD 也走原生 DOM。
- **D8 角色用 Kenney Mini Characters**：单角色 247 kB vs KayKit 3.5 MB，我们 ≤24 个同屏差 14 倍。
- **D9 只有 CC0/public domain 的字节可以进 git**：禁 Mixamo 派生文件、CC-BY 资产、Sketchfab、
  Quaternius。**这条最值得记住**：Mixamo 的 Adobe FAQ 只授权"在项目里使用"，**没授权再分发
  剪辑文件本身**（而且中国区和 Enterprise/Federated 账号根本用不了，外部贡献者无法复现）；
  Quaternius 2026-08-28 起换成 QAL v1.0，§3(a) 禁止再分发资产本身，**但各包页面仍挂着 CC0 徽章**——
  这是个真陷阱。官方条款页在本机被 IP 拦（403），Mixamo 再分发问题**仍标注为未核验**，
  已写进 ASSETS.md §7 待复核。

### 本轮产出

- 分支：`feat/dsh-agent-world`（从 `feat/dsh-daily` 的 HEAD 切出；**没有**动那个分支上的未提交改动）
- 新增包：`packages/dsh-agent-world/`
- 文档：`docs/ARCHITECTURE.md`、`docs/BACKLOG.md`、本文件、`README.md`
