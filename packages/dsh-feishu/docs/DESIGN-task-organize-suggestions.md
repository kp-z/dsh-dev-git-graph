# 任务整理建议：关系识别 + 里程碑/阶段（需求对齐稿）

> 一句话：**把「猜前后序」从标题前缀换成 AI 语义识别，产出可确认的整理建议单**——
> 关系（前置/后置/来源）与里程碑/阶段都先进建议态，人确认一条才落库一条。
>
> 状态：**设计稿，未实现**。本稿只定义口径、接口与边界；改代码前先改这里。

## 1. 为什么不走「前缀推断」

最初的直觉是：同一个 workspace 里新建的任务都带前缀（除第一个），按前缀就能串出前后序。用本机真实的 48 条任务（`~/.dsh/dsh-feishu/state.json` + 历史快照）检验后，这个信号不成立：

| 观察 | 数据 |
| --- | --- |
| 共享前缀簇（≥2 成员） | 只有 5 个；24 个前缀键是单例 |
| 「除了第一个」反例 | `[DSH] 插件开发` 第 1、3、9 条无前缀；某工作区是**最后一条**无前缀 |
| 前缀里的序号 | `PR\d` / `第N步` / `v\d` / 日期命中数全为 0；3 处数字串是分支名 `kp/dev/1103` 与端口 `8081`/`5199` |
| `T<n>` 前缀 | 不是稳定序号：与字段 `no` 有 12/48 不符、存在重号，历史快照里同一任务被改过号（9→3、2→16） |
| 真实依赖 | 只有 2 条 `depends_on`（54→53、39→38），**两条都跨前缀** |
| 前缀规则的成绩 | 命中 0/2；自身连出 10 条边，其中约 8 条明显误连 |

结论：**前缀是「同一项目」的弱分组信号，不是「先后顺序」信号**。同一前缀下的 7 条 `dsh-feishu` 是并行功能，自动串边会把它们错连成一条互相阻塞的链。

## 2. 目标与非目标

**目标**

1. 创建 / 绑定 / 手动触发时，由 AI 基于**任务正文（标题 + 描述 + 已有关系 + 清单字段）**识别：前置、后置、来源。
2. 同时识别**里程碑与阶段**：把散落的任务归入里程碑、排出阶段序号，帮助「整理任务」。
3. 所有识别结果先进**建议态**，逐条（或批量）由人确认后才写入；可撤销。
4. 建议生成**零副作用**：不写本地关系图、不写飞书、不阻塞创建与自动开工。

**非目标**

- 不做「按创建顺序自动串链」的静默落库（理由见 §9.1）。
- 不改 `depends_on` / `derived_from` 的边语义，不为里程碑新增边类型。
- 不自动开工、不自动改期、不自动改负责人。

## 3. 概念模型

| 概念 | 载体 | 是否阻塞 | 说明 |
| --- | --- | --- | --- |
| 前置 / 后置 | `state.relations` 的 `depends_on` 边 | 是 | 前置未完成 → `blockedBy` 命中 → 自动开工门控拦下 |
| 来源 / 派生 | `state.relations` 的 `derived_from` 边 | 否 | 只说明「从哪条派生」 |
| 里程碑 | 清单自定义字段（文本，如「里程碑」） | 否 | **分组维度**，不是边；跨任务共享同一个名字 |
| 阶段序号 | 清单自定义字段（文本或数字，如「阶段」） | 否 | 同里程碑内 1..n；用于排序展示 |

里程碑之所以不做成边：飞书里没有里程碑实体，边的一端必须是 `state.tasks` 里真实存在的任务（`relations.js:59` 要求 id 已知）。把它做成反向依赖会立刻撞上「缺失前驱永久阻塞」（§9.1）。

飞书原生还有 `is_milestone`（`index.js:4780` 读取、`index.js:929` 展示在任务材料里），目前**只读**。本方案不改它的写路径；若日后要写，属于独立增量。

## 4. 建议单（suggestion）

### 4.1 数据结构

```jsonc
// state.organizeSuggestions[batchId]
{
  "batchId": "sg-<taskId|workspace>:<ts>",
  "at": 1793700000000,
  "scope": { "workspace": "[DSH] 插件开发", "taskId": "<当前任务 guid>" },
  "model": { "provider": "...", "reason": "..." },
  "items": [
    { "type": "relation", "kind": "depends_on", "from": "<id>", "to": "<id>",
      "confidence": 0.86, "evidence": "描述里写着「等 PR2 合并后再做」",
      "status": "pending" },
    { "type": "milestone", "name": "关系识别", "taskIds": ["<id>", "<id>"],
      "confidence": 0.72, "evidence": "两条都在同一交付范围内的收口任务", "status": "pending" },
    { "type": "stage", "taskId": "<id>", "milestone": "关系识别", "step": 2,
      "confidence": 0.8, "evidence": "标题里的先后描述", "status": "pending" }
  ],
  "notes": "整体判断（≤120 字）"
}
```

`status` ∈ `pending | accepted | rejected`；接受/拒绝后条目保留，便于回看与撤销（撤销 = 删除本次新增的边与字段值）。

### 4.2 生成管线（四段，全部可离线测试）

1. **取材（evidence pack）**：候选不粗暴截断 24 条（现状 `index.js:5775-5777`），改为：
   - 先按 workspace / 清单分组，只把「当前任务所在组 + 共享前缀的相邻组」纳入；
   - 组内按创建时间与 `no` 排序，每条给 `id/title/description 摘要/done/workspace/startedAt/已有关系/命中的清单字段`；
   - 总预算按字符数封顶（建议 12k），超出按「同组优先、时间近优先」截断，并在提示里声明「候选不完整」。
2. **识别**：一次调用产出 §4.1 的结构。提示词硬规则：
   - 只能引用候选里出现的 id；
   - 每条必须给 `evidence`（引用标题/描述里的具体片段），**只凭「同主题/同前缀」不得连边**；
   - `depends_on` 必须能说出「谁等谁」；说不清就退成 `derived_from` 或不提；
   - 里程碑只允许两种输出：归入已有名字，或提议一个新名字（≤6 字、不与现有重名）；
   - 同一任务只能属于一个里程碑；同里程碑的 step 必须连续 1..n，冲突要显式报出来。
   - 移除现行提示词里的「不猜任务顺序」（`index.js:5780`）——它正是今天拿不到顺序关系的直接原因；换成「顺序必须有正文证据」。
3. **校验（纯函数，无网络）**：
   - id 存在性、自环、`hasCycle` 预演（复用 `updateRelations` 的干跑能力，`relations.js:88-89`）；
   - `confidence < 0.6` 丢弃；`kind` 只能是 `depends_on | derived_from`；
   - 里程碑名去重与长度校验、step 连续性与唯一性。
   - 校验失败只丢弃该条并记录原因，不整批失败。
4. **存放与呈现**：写入 `state.organizeSuggestions`，随快照下发到面板；**不写 `state.relations`、不写飞书**。

### 4.3 接受与落库

- 关系：走 `setTaskRelations`（`index.js:5757`）——先 `refreshTaskRelations` 再 merge，`pending` 时跳过 refresh 让未送达的本地修改优先。**不要直接调 `writeTaskRelations`**：它按本地图算「远端多余依赖」并删除（`index.js:5729`），本地图没先 refresh 时会删掉别人在飞书里加的依赖。
- 来源关系复用 `'creation'`（或同时改 `relations.js:3` 白名单与 `:46` 文案再加 `'organize'`）；建议加 `reason` 写清「整理建议，batchId=…」，便于撤销。
- 里程碑/阶段：复用清单自定义字段链路 `ensure_custom_field` / `set_custom_field`（`index.js:2569`、`:3269`、`:3890`），字段名进 `settings.taskFields`（现在有 `workspace/trigger/doc/priority/eta/startCol/endCol`，`index.js:436-443`）；已有「前置任务/后置任务/来源任务」文本列投影可作模板。
- 批量接受：逐条调用同一路径，逐条汇报成功/失败；不引入事务（远端依赖写入本来就可能部分失败）。

## 5. 触发时机（一律只出建议）

| 时机 | 位置 | 行为 |
| --- | --- | --- |
| 创建任务 | `createTaskFromSession` 的 `autoRelate` 分支（`index.js:5962`，在 `syncTasks :5927` 与 `linkTask :5931` 之后） | 异步生成建议；返回体带 `suggestions` 摘要，失败只记 warning |
| 绑定会话 | `linkTask` 的 `:5467` 之后、`:5468` 返回之前（钩子自带 `persistState`——该函数上一个 `persistState` 在 `:5446`） | 钩子非致命，失败只追加 `relationWarning`；**绝不能**让 `linkTask` 返回 `ok:false`（它是创建流程 `:5931` 的收尾，会把一次成功创建打成 partial） |
| 手动 | 面板「整理建议」按钮 / `feishu_task_relations action=organize` | 可对单任务或整个 workspace 跑一次 |
| 补算（可选） | 低频（每日一次 / 同步后）对「无关系且未整理」的任务 | 配额与去重：同 scope 的 batch 在 N 小时内不重复生成 |

`autoRelate=true`（`README.md:181`、`CONTRACT.md:34`）的语义建议改为「生成建议并**自动接受**」的兼容开关，默认仍关；新默认是「生成建议、不写」。

## 6. 接口

**工具**

- `feishu_task_relations`：`action=suggest` 改为返回结构化建议单并落 `state.organizeSuggestions`（仍不写关系）；新增 `action=organize`（关系 + 里程碑/阶段一起出）；`action=accept`（`batchId` + `itemIds` 或 `all`）；`action=undo`（撤销某 batch 已落库的内容）。
- `feishu_task_create` / `feishu_task_session`：返回体增加 `suggestions`（摘要），不新增必填参数。

**面板**

- 任务卡：命中建议时显示「整理建议 N 条」，点开是建议单（类型 / 涉及任务 / 证据原文 / 置信度），逐条接受或拒绝。宿主能力位沿用现有 `tasks.relations`（`panel.html:6841`，关闭时提示「请更新并重启 DSH」）。
- 依赖列表面板：接受前先显示「会新增哪些边、哪些任务会因此变为 blocked」的预览；提交走既有 `api('tasks/relations')`（`panel.html:6827` 一带）。
- 里程碑视图：按里程碑分组 + 阶段序号排序（现在面板没有分组视图，只有旭日图按 `[]` 前缀统计，`index.js:7361`）。

## 7. 幂等与状态

- 建议 batch 的 `batchId` 只由 **scope + 时间窗**决定（如 `sg:<workspace>:<dayHour>`），**不含内容指纹**：同一批任务两次模型输出必然不同，含指纹会生成两个 batch；而创建路径 `:5931` 自己会调 `linkTask`，创建钩子与绑定钩子天然会双重触发（见 §9.6）。
- 接受操作幂等：同一条目重复接受不产生重复边（`updateRelations` 去重键是 `[kind,from,to]`，`relations.js:69-87`，重复边保留原 metadata）。
- **建议内容绝不能进创建幂等指纹 `requestKey`**（`index.js:5805`）：否则指纹随推断结果变化，会被当成新请求而重复建任务。
- state 没有「白名单」层：载入是 `state = { ...DEFAULT_STATE, ...savedState }`（`index.js:3091`），未知顶层键自动保留；落盘 `persistState` → `writeJson(stateFile, state)` 整对象写（`:3120-3142`，写盘在 `:3140`）。所以新键要改的是三处显式代码：
  1. `DEFAULT_STATE`（`:526`）加 `organizeSuggestions: {}`，位置照 `relations` / `relationSync`（`:537-538`）的样式；
  2. 载入后的防御式规范化那段（`:3102-3108`，`relations`/`relationSync`/`suspensions` 都在那里）加一行，保证旧 state 读进来是对象而不是 `undefined`；
  3. 面板快照导出该字段（见 §6）。
  回归测试参考 `test/stateAdoptionRegression.mjs`（现状只有「采纳」回归，没有迁移白名单测试——不要照抄一个不存在的机制）。

## 8. 远端与同步

- 本地建议态不参与 `relationSync`，`pending` 语义不变。
- 接受后由 `setTaskRelations` 走既有远端写回；远端失败保持 `pending` 并区分「本地已存 / 远端待同步」（`CONTRACT.md:28` 的口径）。
- 远端采纳：`refreshTaskRelations` 会用远端重建 `depends_on`，但按 `(kind,from,to)` 复用本地同一对象，`source='ai'/'creation'` 与 `reason` 原样保留（`index.js:5708-5711`）；`pending` 期间整段跳过（`:5700-5701`）。
- 顺序窗口（真实存在，且比「一轮」更宽）：`writeTaskRelations`（`:5924`）成功后立刻把 `pending` 置 false（`:5752`），紧接的 `syncTasks`（`:5927`）若列表带 `dependencies` 就会用远端覆盖本地；保护逻辑是 `relationSync` 的 `pending`（`:4972` 跳过、`:4973` `protectedEdge` 任一端 pending 即保护、`:4975` 过滤），而 `:4975` 按**边端点**匹配——接受 A→B 后，处理 **B 的列表项**时也会匹配到这条边并把 B 未 pending 的边删掉。
  对策：接受后对新增三元组 `(kind, from, to)` 做 N 分钟豁免（例如 10 分钟），而不是只依赖 `pending`；不要指望「把 syncTasks 挪到写回之后」——现状已经是写回在前、同步在后（`:5924` → `:5927`），那是一条空操作。

## 9. 硬约束与风险

### 9.1 缺失前驱永久阻塞（最高）

`projectRelations` 对不在 `state.tasks` 里的前驱一律按未完成处理（`relations.js:96-99`、`blockedBy` `:112`），而同步不会把已完成任务拉回来（`index.js:4895-4897`），自动开工门控再据此判定（`:8899`）。写错一条 `depends_on` = 后继永远开不了工，且没有自动清理。

对策：建议态默认不落库；预览里明确「这条边会让谁阻塞」；提供 undo；`depends_on` 的置信度阈值高于 `derived_from`。

### 9.2 幂等（高）

见 §7：推断结果不进 `requestKey`。

### 9.3 误连（高）

前缀规则的真实成绩是 0/2 命中、8/10 误连，这就是为什么必须要求 `evidence` 引用正文，并做 precision 优先的评估（§10）。

### 9.4 半途失败（中）

建议生成可能超时/返回坏 JSON/被限流：整条链路必须「失败即无建议 + warning」，不得半写状态；`writer` 侧重复调用要幂等（§7）。

### 9.5 跨 workspace / 跨后端（中）

候选只允许同 workspace 或同清单内（沿用 `index.js:5775-5777` 的范围），并额外要求与当前任务 `creationBackend` 一致；`backendScope` 只保证单次操作配置不变（`backendScope.js`），不保证边不跨后端。

### 9.6 双重触发（中）

`createTaskFromSession` 自己在 `:5931` 调 `linkTask(guid, id, 'current')`，因此「创建钩子」与「绑定钩子」对同一次创建都会触发。对策：`batchId` 只用 scope + 时间窗（§7），生成入口加 in-flight 去重（同 scope 有未完成 batch 时直接复用），并让两个钩子走同一个幂等入口。

### 9.7 里程碑/阶段没有失败载体（中）

`relationSync.pending`（`:5752`）与 `:5738-5750` 的文本列投影只覆盖关系；`ensure_custom_field` / `set_custom_field`（`:2569` 的 op 白名单、`:3269` 的批量建字段、`:3890` 的「预期完成」示例）失败没有状态机、没有重试、面板也没有标记，会静默丢。P2 之前必须先补一张字段级 `pending/retry` 表（形状照 `relationSync`），否则 §8 的「远端失败保持 pending」只对关系成立。

## 10. 评估方案（先离线，后接线）

1. **标注集**：以真实数据里的 2 条已知依赖（54→53、39→38）为正例，补 10~20 条人工判定的正例与**负例**（同前缀并行任务必须判为「不连」），落在 `test/fixtures/relationGroundTruth.json`。
2. **离线脚本**：读 `~/.dsh/dsh-feishu/state.json` + 标注集，跑识别管线（校验段可离线复用），输出 confusion matrix。
3. **指标（precision 优先）**：`depends_on` precision ≥ 0.9（误连一条 = 永久阻塞一条），recall 允许低；`derived_from` 可以宽一些；里程碑归组用人工抽检 n=20。
4. **副作用断言**：建议生成路径必须产生**零** CLI 写调用（`ensure_custom_field`/`set_custom_field`/原生依赖写都不允许）——沿用 `test/relationsBridge.mjs` 的「无 CLI 调用」断言风格。
5. **回归**：现有 `test/relations.mjs`、`test/relationsBridge.mjs`、`test/relations_api.py` 必须全绿；`autoRelate=true` 的既有行为不得静默改变。

## 11. 分阶段落地

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| **P0（先做，零插件改动）** | 标注集 + 离线评估脚本，先证明 AI 建议的 precision | `test/fixtures/…` + `scripts/eval-relations.mjs`（不碰 `index.js`） |
| **P1** | 建议单数据结构 + `action=suggest/organize/accept/undo` + 面板「整理建议」卡片 | 关系建议可确认落库，含零副作用测试 |
| **P2** | 先补字段级 `pending/retry`（§9.7），再做里程碑/阶段字段与分组视图、创建/绑定时异步生成建议 | 面板按里程碑分组，字段写入可重试 |
| **P3（可选）** | 批量整理整个 workspace、撤销批次、低频补算 | 配额与去重 |

## 12. 待定问题

1. 里程碑落地成**飞书清单自定义字段**（推荐：飞书里可见可改，复用现有字段链路）还是**纯本地虚拟分组**？
2. 建议生成用哪个模型、成本与延迟预算；是否只在显式触发时调用（默认），还是创建时每次都调？
3. 接受后是否立刻 `writeBack` 到飞书原生依赖（默认 true，可 `writeBack=false` 仅本地）？
4. `autoRelate=true` 保留为「生成并自动接受」的兼容开关，还是直接废弃改名？
