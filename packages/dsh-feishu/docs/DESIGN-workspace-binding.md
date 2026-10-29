# 设计：工作区绑定改成「id 为主键，名字跟着同步」

> 状态：**已实施（v0.15.0）**。与设计稿的差异只有一处：绑定存在独立的 `state.workspaceLinks`，
> 不是 `state.bindings[].workspace`——任务可能先分配了工作区、还没开工（那时没有 session，
> `state.bindings` 会被整条删掉）。
> 相关代码：`index.js` 的 `resolveWorkspace / enrichWorkspace / startTask / fillWorkspaceFields / syncTask / persistState`，
> 以及 DSH 的 `@deepseek-ai/dsh-workspace`（`ctx.workspaceRegistry`）。

## 1. 现在是什么样

飞书任务上的「工作区」只是一个**文本**（单选字段的值，或描述里的 `工作区：X`，或清单名兜底）。
每次同步/开工时，插件拿这段文本去 `workspaceRegistry.list()` 里**猜**一个工作区：

| # | 规则 | 风险 |
| --- | --- | --- |
| 1 | `title === 值` 或 `path === 值` | DSH 里改名后直接掉到下一级 |
| 2 | 去括号/空格/标点 + 小写后相等 | 安全 |
| 3 | 标题**包含**输入（≥2 字） | 相近名字命中列表第一个，静默开错目录 |
| 4 | `path` 以 `/输入` 结尾（≥2 字） | 同名目录多个路径时依赖顺序 |
| 5 | 输入是存在的绝对路径 | 没登记也能开工，但 `attachSession` 失败，会话挂不进项目 |
| 6 | 都不命中 | 卡片红字「没找到工作区」 |

DSH 的工作区**是有稳定 id 的**（`WorkspaceId(randomUUID())`，与 `path/title/sessionIds` 一起持久化，
registry 的 `list()` 返回带 `id` 的实体）。插件从来没存过这个 id：`resolveWorkspace()` 返回了 `id`，
`enrichWorkspace()` 直接丢掉；`state.bindings` 只存会话，不存工作区。

## 2. 目标与非目标

目标：

1. 绑定以 **workspace.id** 为准：DSH 里改标题不再断链；
2. 名字变了就**自动同步到飞书**（人看到的仍是名字，不是 uuid）；
3. 匹配不再猜：命中就命中，不命中就显式失效，绝不静默开错目录；
4. 老数据**零操作迁移**（第一次解析成功就把 id/path 落盘）。

非目标：

- 不改飞书字段结构（仍是单选「工作区」，值是人话名字）；
- 不做跨机器的 id 迁移：id 是本机 registry 的 uuid，换机后靠 `path` 重新绑定。

## 3. 数据模型

```jsonc
// state.workspaceLinks[taskId]（与会话绑定分开：没开工的任务也可以有工作区）
{
  "workspace": {
    "id": "0b0f2c1e-…",        // 主键：registry 的 WorkspaceId
    "path": "/Users/kp/DEV/x",  // 校验：id 还在但路径变了 → 视为失效；id 没了但路径还在 → 重新绑
    "title": "工作区名字",       // 显示 + 改名检测基线
    "boundAt": 0,
    "titleSyncedAt": 0,         // 上次把 title 写回飞书的时刻（防抖）
    "stale": false              // true = 解析不到，卡片显式提示，不尝试开工
  }
}
```

为什么同时存 `path`：id 是内部 uuid，工作区被删掉再建（新 id、同目录）时 path 能接上；
反过来 id 在、path 对不上，说明登记被改指向了，按失效处理更安全。

**注意**：`persistState()` 会**重建** `state.bindings`（只写白名单字段）。工作区绑定因此放在
独立的 `state.workspaceLinks` 里（整体随 state 落盘），不受会话解绑影响。

## 4. 解析算法（`resolveWorkspace`）

输入：任务上的飞书文本 + 已存 `binding.workspace`。输出：`{ id, path, title }` 或 `{ error, stale: true }`。

```
1. binding.id 在 registry 里且 path 相同        → 命中（title 取 registry 当前值）
2. binding.path 在 registry 里命中              → 命中，并把 id 换成新的
3. 文本精确等于 title                           → 命中并落盘
4. 文本精确等于 path                            → 命中并落盘
5. 归一化后（去括号/空格/标点，小写）相等        → 命中并落盘
6. 否则                                        → 失效：stale=true + workspaceError，不猜
```

**删掉**：包含匹配（原 3）、路径后缀匹配（原 4）、绝对路径兜底（原 5）。

未登记路径怎么办：不再静默放行。给一个显式动作「登记并绑定」——调用
`registry.create(path, title)`（DSH 的 `create` 会做 realpath、要求目录存在），成功后按第 3 步落盘。
这个动作在面板上是一次点击，在模型侧是一个工具参数（`workspace_register`）。

## 5. 改名同步

- **检测**：`registry.list()` 是同步内存投影，便宜。每次 `sync()`（30 min）比对一次；
  `/api/state` 走 10 秒节流的轻量比对（只在有 binding 的任务上做）。registry 没有事件，
  只能轮询——但它不读盘，成本可以忽略。
- **动作**（仅限「插件已绑定过」的任务，不碰人手填的其它值）：
  1. `binding.workspace.title = 新标题`；
  2. 复用现有 `set_custom_field` 把新标题写回飞书「工作区」字段；
  3. `ensure_select_options` 把新标题补进单选选项（rename 后旧选项仍保留，历史任务还能读）；
  4. 记 `titleSyncedAt`，同一个 (taskId, 新标题) 只写一次。
- **批量与失败**：一轮最多 5 条（与现有 `fillWorkspaceFields` 一致）；失败只记日志，下一轮重试，不阻塞同步。
- **方向**：DSH → 飞书单向（DSH 是工作区的真相源）。飞书字段被人手改成另一个工作区时，
  视为「换绑」：解析成功后覆盖 binding。

## 6. 迁移

第一轮 `sync()`（以及插件启动后的第一次 `/api/state`）里：

1. 对每个有工作区文本、但没有 `binding.workspace` 的任务跑一次解析；
2. 成功 → 落 `{id, path, title}`；失败 → 不写 binding（避免脏数据），只在快照里给 `workspaceError`；
3. 已经是 `stale` 的任务不重复解析（除非文本变了或 registry 变了）。

迁移只读 registry，不写飞书，因此可随时回滚。

## 7. 边界行为

| 情况 | 行为 |
| --- | --- |
| 工作区被删（id 不在 registry） | path 还能命中 → 重绑新 id；否则 stale + 卡片提示 |
| 路径不存在 | stale，不尝试开工，不猜 |
| 两个工作区同名 | id/path 才唯一：只要 binding 在，永远按 id/path；无 binding 时精确同名 → 取第一个但记一条 warning |
| 未登记路径 | 拒绝自动绑定；面板/工具提供「登记并绑定」 |
| 跨机器 | path 命中则重绑本机 id；否则 stale |
| 工作区改名 | 自动同步到飞书字段（§5） |
| 工作区改名后飞书字段被人手改 | 下一轮解析按 id 命中 → 以 id 为准，名字再同步一次 |

## 8. 代码落点

| 位置 | 改动 |
| --- | --- |
| `resolveWorkspace()` | 改成吃 `(task)` 或 `(text, binding)`，按 §4 顺序；返回 `{id,path,title}` |
| `enrichWorkspace()` | 保留 id；stale 时给 `workspaceError` + `workspaceStale: true` |
| `startTask()` | 只用解析出的 `path` 开工；stale 直接拒绝并提示重选 |
| `sync()` | 迁移（§6）+ 改名检测（§5） |
| `syncTask()` / `fillWorkspaceFields()` | 写回改名的标题（复用现有 set_custom_field） |
| `persistState()` | `bindings[taskId].workspace` 白名单字段 |
| `panel.html` | 卡片：工作区失效的红色提示 + 「重选/登记」入口；设置页不需要新开关 |
| 新 `test/workspace.mjs` | 解析顺序、迁移、改名检测、同名/失效的纯函数用例 |

## 9. 验收

1. 在 DSH 里把工作区改名 → 下一轮同步后，飞书任务上的「工作区」字段变成新名字，卡片仍归属该工作区；
2. 两个名字相近的工作区（`[DSH] 插件开发` / `DSH 插件开发 2`）不会互相串；
3. 删掉工作区 → 卡片显式失效（红字 + 不会开工），不会静默开到别的目录；
4. 老 state 迁移后 `bindings[].workspace` 有 id/path/title；
5. 全部旧测试仍绿（尤其 smoke 里「工作区识别」和「开工」两条）。

## 10. 分步落地（每步可单独回滚）

1. **纯函数 + 测试**：按 §4 写解析器并加单测，暂不接线（行为不变）；
2. **落盘 + 优先 id/path**：`persistState` 加字段、解析时优先用 binding，仍保留名字兜底；
3. **收紧匹配**：删包含匹配/路径兜底，引入 stale 与「登记并绑定」；
4. **改名同步 + 面板提示**：写回飞书、卡片提示、批量与防抖。

## 11. 待定

- 未登记路径：允许「一键登记并绑定」，还是直接拒绝？
- 改名写回：字段值用纯新名字（建议），还是保留旧名做别名？
- 改名检测频率：跟随 sync（30 min，建议）还是独立 60 秒轻量轮询？
